CREATE TABLE IF NOT EXISTS public.research_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.research_reports(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'completed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  dedupe_key TEXT NOT NULL,
  lease_owner TEXT,
  leased_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_research_jobs_claim
  ON public.research_jobs (status, next_run_at, lease_expires_at, created_at);

CREATE INDEX IF NOT EXISTS idx_research_jobs_report_id
  ON public.research_jobs (report_id);

CREATE OR REPLACE FUNCTION public.touch_research_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trigger_research_jobs_updated_at ON public.research_jobs;
CREATE TRIGGER trigger_research_jobs_updated_at
BEFORE UPDATE ON public.research_jobs
FOR EACH ROW EXECUTE FUNCTION public.touch_research_jobs_updated_at();

CREATE OR REPLACE FUNCTION public.research_jobs_enqueue(
  p_report_id UUID,
  p_stage TEXT,
  p_provider TEXT,
  p_payload JSONB,
  p_dedupe_key TEXT,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS public.research_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.research_jobs;
BEGIN
  INSERT INTO public.research_jobs (
    report_id,
    stage,
    provider,
    payload,
    status,
    attempts,
    max_attempts,
    dedupe_key,
    next_run_at
  )
  VALUES (
    p_report_id,
    p_stage,
    p_provider,
    COALESCE(p_payload, '{}'::jsonb),
    'queued',
    0,
    GREATEST(COALESCE(p_max_attempts, 5), 1),
    p_dedupe_key,
    now()
  )
  ON CONFLICT (dedupe_key) DO UPDATE
    SET payload = COALESCE(EXCLUDED.payload, public.research_jobs.payload),
        report_id = EXCLUDED.report_id,
        stage = EXCLUDED.stage,
        provider = EXCLUDED.provider,
        max_attempts = EXCLUDED.max_attempts
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.research_jobs_claim(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 1,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF public.research_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT j.id
    FROM public.research_jobs j
    WHERE j.status IN ('queued', 'leased')
      AND j.attempts < j.max_attempts
      AND j.next_run_at <= now()
      AND (
        j.status = 'queued'
        OR j.lease_expires_at IS NULL
        OR j.lease_expires_at <= now()
      )
    ORDER BY j.next_run_at ASC, j.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(COALESCE(p_batch_size, 1), 1)
  ),
  updated AS (
    UPDATE public.research_jobs j
    SET status = 'leased',
        attempts = j.attempts + 1,
        lease_owner = p_worker_id,
        leased_at = now(),
        lease_expires_at = now() + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 120), 30)),
        last_error = NULL,
        completed_at = NULL,
        updated_at = now()
    FROM picked
    WHERE j.id = picked.id
    RETURNING j.*
  )
  SELECT * FROM updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.research_jobs_complete(
  p_job_id UUID,
  p_worker_id TEXT
)
RETURNS public.research_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.research_jobs;
BEGIN
  UPDATE public.research_jobs
  SET status = 'completed',
      completed_at = now(),
      lease_owner = NULL,
      leased_at = NULL,
      lease_expires_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE id = p_job_id
    AND status = 'leased'
    AND (lease_owner = p_worker_id OR lease_owner IS NULL)
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.research_jobs_fail(
  p_job_id UUID,
  p_worker_id TEXT,
  p_error TEXT,
  p_base_delay_ms INTEGER DEFAULT 1000,
  p_max_delay_ms INTEGER DEFAULT 60000
)
RETURNS public.research_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.research_jobs;
  v_delay_ms INTEGER;
  v_exp INTEGER;
BEGIN
  SELECT *
  INTO v_job
  FROM public.research_jobs
  WHERE id = p_job_id
    AND status = 'leased'
    AND (lease_owner = p_worker_id OR lease_owner IS NULL)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_job.attempts >= v_job.max_attempts THEN
    UPDATE public.research_jobs
    SET status = 'dead',
        completed_at = now(),
        lease_owner = NULL,
        leased_at = NULL,
        lease_expires_at = NULL,
        last_error = LEFT(COALESCE(p_error, 'unknown_error'), 4000),
        updated_at = now()
    WHERE id = p_job_id
    RETURNING * INTO v_job;

    RETURN v_job;
  END IF;

  v_exp := LEAST(GREATEST(v_job.attempts, 1), 12);
  v_delay_ms := LEAST(
    GREATEST(COALESCE(p_max_delay_ms, 60000), 1000),
    (GREATEST(COALESCE(p_base_delay_ms, 1000), 100) * power(2::numeric, (v_exp - 1)))::INTEGER
  );

  -- Add up to 25%% jitter to smooth thundering herd retries.
  v_delay_ms := v_delay_ms + FLOOR(random() * (v_delay_ms * 0.25));

  UPDATE public.research_jobs
  SET status = 'queued',
      next_run_at = now() + (v_delay_ms || ' milliseconds')::interval,
      lease_owner = NULL,
      leased_at = NULL,
      lease_expires_at = NULL,
      last_error = LEFT(COALESCE(p_error, 'unknown_error'), 4000),
      updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

ALTER TABLE public.research_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages research jobs" ON public.research_jobs;
CREATE POLICY "Service role manages research jobs"
  ON public.research_jobs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

GRANT EXECUTE ON FUNCTION public.research_jobs_enqueue(UUID, TEXT, TEXT, JSONB, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.research_jobs_claim(TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.research_jobs_complete(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.research_jobs_fail(UUID, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
