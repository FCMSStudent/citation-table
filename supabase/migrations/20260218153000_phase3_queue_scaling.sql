-- Phase 3: queue stage orchestration, provider runtime controls, caching, observability,
-- reproducibility, and validation surfaces.

-- ============================================================
-- 1) Run-level reproducibility snapshots
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pipeline_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_manifest_hash TEXT NOT NULL,
  extractor_bundle_hash TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  seed BIGINT NOT NULL DEFAULT 0,
  config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prompt_manifest_hash, extractor_bundle_hash, config_hash, seed)
);

ALTER TABLE public.pipeline_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages pipeline_versions" ON public.pipeline_versions;
CREATE POLICY "Service role manages pipeline_versions"
  ON public.pipeline_versions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.extraction_runs
  ADD COLUMN IF NOT EXISTS pipeline_version_id UUID REFERENCES public.pipeline_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seed BIGINT,
  ADD COLUMN IF NOT EXISTS input_hash TEXT,
  ADD COLUMN IF NOT EXISTS output_hash TEXT,
  ADD COLUMN IF NOT EXISTS config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS prompt_manifest_hash TEXT,
  ADD COLUMN IF NOT EXISTS extractor_bundle_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_extraction_runs_pipeline_version_id
  ON public.extraction_runs (pipeline_version_id);

-- ============================================================
-- 2) Immutable stage outputs for stage-split queue execution
-- ============================================================

CREATE TABLE IF NOT EXISTS public.research_stage_outputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.research_reports(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (
    stage IN (
      'ingest_provider',
      'normalize',
      'dedupe',
      'quality_filter',
      'deterministic_extract',
      'llm_augment',
      'compile_report'
    )
  ),
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  pipeline_version_id UUID REFERENCES public.pipeline_versions(id) ON DELETE SET NULL,
  producer_job_id UUID REFERENCES public.research_jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, stage, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_research_stage_outputs_report_stage
  ON public.research_stage_outputs (report_id, stage, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_research_stage_output_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'research_stage_outputs rows are immutable';
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trig_research_stage_outputs_no_update ON public.research_stage_outputs;
CREATE TRIGGER trig_research_stage_outputs_no_update
BEFORE UPDATE OR DELETE ON public.research_stage_outputs
FOR EACH ROW EXECUTE FUNCTION public.prevent_research_stage_output_mutation();

ALTER TABLE public.research_stage_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages stage outputs" ON public.research_stage_outputs;
CREATE POLICY "Service role manages stage outputs"
  ON public.research_stage_outputs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 3) Provider-safe shared concurrency + circuit breaker runtime
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_limits (
  provider TEXT PRIMARY KEY,
  refill_rate_per_sec NUMERIC(12,4) NOT NULL CHECK (refill_rate_per_sec > 0),
  burst_capacity NUMERIC(12,4) NOT NULL CHECK (burst_capacity > 0),
  max_concurrent INTEGER NOT NULL DEFAULT 8 CHECK (max_concurrent > 0),
  circuit_failure_threshold INTEGER NOT NULL DEFAULT 5 CHECK (circuit_failure_threshold > 0),
  circuit_open_seconds INTEGER NOT NULL DEFAULT 30 CHECK (circuit_open_seconds > 0),
  half_open_probe_count INTEGER NOT NULL DEFAULT 1 CHECK (half_open_probe_count > 0),
  starvation_floor NUMERIC(12,4) NOT NULL DEFAULT 1 CHECK (starvation_floor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_runtime_state (
  provider TEXT PRIMARY KEY REFERENCES public.provider_limits(provider) ON DELETE CASCADE,
  tokens NUMERIC(12,4) NOT NULL DEFAULT 0,
  in_flight INTEGER NOT NULL DEFAULT 0 CHECK (in_flight >= 0),
  last_refill_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  blocked_until TIMESTAMPTZ,
  circuit_state TEXT NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed', 'open', 'half_open')),
  circuit_opened_at TIMESTAMPTZ,
  next_probe_at TIMESTAMPTZ,
  half_open_successes INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_status INTEGER,
  last_error TEXT,
  last_retry_after_seconds INTEGER,
  last_latency_ms INTEGER,
  total_successes BIGINT NOT NULL DEFAULT 0,
  total_failures BIGINT NOT NULL DEFAULT 0,
  total_429s BIGINT NOT NULL DEFAULT 0,
  last_served_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_runtime_state_circuit
  ON public.provider_runtime_state (circuit_state, next_probe_at);

INSERT INTO public.provider_limits (
  provider,
  refill_rate_per_sec,
  burst_capacity,
  max_concurrent,
  circuit_failure_threshold,
  circuit_open_seconds,
  half_open_probe_count,
  starvation_floor
) VALUES
  ('openalex', 3.0, 15.0, 10, 5, 20, 1, 1.0),
  ('semantic_scholar', 2.0, 10.0, 8, 5, 30, 1, 1.0),
  ('arxiv', 0.34, 2.0, 2, 4, 45, 1, 1.0),
  ('pubmed', 3.0, 12.0, 10, 5, 20, 1, 1.0)
ON CONFLICT (provider) DO NOTHING;

INSERT INTO public.provider_runtime_state (provider, tokens, last_refill_at)
SELECT l.provider, l.burst_capacity, now()
FROM public.provider_limits l
ON CONFLICT (provider) DO NOTHING;

CREATE OR REPLACE FUNCTION public.provider_rate_limit_try_acquire(
  p_provider TEXT,
  p_tokens NUMERIC DEFAULT 1,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  acquired BOOLEAN,
  wait_ms INTEGER,
  circuit_state TEXT,
  blocked_until TIMESTAMPTZ,
  tokens_remaining NUMERIC,
  in_flight INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit public.provider_limits;
  v_state public.provider_runtime_state;
  v_now TIMESTAMPTZ := COALESCE(p_now, now());
  v_required NUMERIC := GREATEST(COALESCE(p_tokens, 1), 1);
  v_elapsed_sec NUMERIC;
  v_wait_ms INTEGER;
BEGIN
  INSERT INTO public.provider_limits (provider, refill_rate_per_sec, burst_capacity, max_concurrent)
  VALUES (p_provider, 2.0, 10.0, 8)
  ON CONFLICT (provider) DO NOTHING;

  INSERT INTO public.provider_runtime_state (provider, tokens, last_refill_at)
  VALUES (p_provider, 0, v_now)
  ON CONFLICT (provider) DO NOTHING;

  SELECT * INTO v_limit
  FROM public.provider_limits
  WHERE provider = p_provider
  FOR UPDATE;

  SELECT * INTO v_state
  FROM public.provider_runtime_state
  WHERE provider = p_provider
  FOR UPDATE;

  v_elapsed_sec := GREATEST(EXTRACT(EPOCH FROM (v_now - COALESCE(v_state.last_refill_at, v_now))), 0);
  v_state.tokens := LEAST(v_limit.burst_capacity, COALESCE(v_state.tokens, 0) + (v_elapsed_sec * v_limit.refill_rate_per_sec));
  v_state.last_refill_at := v_now;

  IF v_state.circuit_state = 'open' AND (v_state.next_probe_at IS NULL OR v_state.next_probe_at <= v_now) THEN
    v_state.circuit_state := 'half_open';
    v_state.half_open_successes := 0;
  END IF;

  IF v_state.blocked_until IS NOT NULL AND v_state.blocked_until > v_now THEN
    UPDATE public.provider_runtime_state
    SET tokens = v_state.tokens,
        last_refill_at = v_state.last_refill_at,
        circuit_state = v_state.circuit_state,
        half_open_successes = v_state.half_open_successes,
        updated_at = v_now
    WHERE provider = p_provider;

    RETURN QUERY
    SELECT
      FALSE,
      LEAST(60000, GREATEST(100, CEIL(EXTRACT(EPOCH FROM (v_state.blocked_until - v_now)) * 1000)::INTEGER)),
      v_state.circuit_state,
      v_state.blocked_until,
      v_state.tokens,
      v_state.in_flight;
    RETURN;
  END IF;

  IF v_state.circuit_state = 'open' THEN
    v_wait_ms := LEAST(60000, GREATEST(250, CEIL(EXTRACT(EPOCH FROM (COALESCE(v_state.next_probe_at, v_now) - v_now)) * 1000)::INTEGER));
    UPDATE public.provider_runtime_state
    SET tokens = v_state.tokens,
        last_refill_at = v_state.last_refill_at,
        updated_at = v_now
    WHERE provider = p_provider;

    RETURN QUERY
    SELECT FALSE, v_wait_ms, v_state.circuit_state, v_state.blocked_until, v_state.tokens, v_state.in_flight;
    RETURN;
  END IF;

  IF v_state.in_flight >= v_limit.max_concurrent THEN
    UPDATE public.provider_runtime_state
    SET tokens = v_state.tokens,
        last_refill_at = v_state.last_refill_at,
        updated_at = v_now
    WHERE provider = p_provider;

    RETURN QUERY
    SELECT FALSE, 250, v_state.circuit_state, v_state.blocked_until, v_state.tokens, v_state.in_flight;
    RETURN;
  END IF;

  IF v_state.circuit_state = 'half_open' AND v_state.in_flight >= v_limit.half_open_probe_count THEN
    UPDATE public.provider_runtime_state
    SET tokens = v_state.tokens,
        last_refill_at = v_state.last_refill_at,
        updated_at = v_now
    WHERE provider = p_provider;

    RETURN QUERY
    SELECT FALSE, 500, v_state.circuit_state, v_state.blocked_until, v_state.tokens, v_state.in_flight;
    RETURN;
  END IF;

  IF v_state.tokens >= v_required THEN
    v_state.tokens := v_state.tokens - v_required;
    v_state.in_flight := v_state.in_flight + 1;
    v_state.last_served_at := v_now;

    UPDATE public.provider_runtime_state
    SET tokens = v_state.tokens,
        in_flight = v_state.in_flight,
        last_refill_at = v_state.last_refill_at,
        circuit_state = v_state.circuit_state,
        half_open_successes = v_state.half_open_successes,
        last_served_at = v_state.last_served_at,
        updated_at = v_now
    WHERE provider = p_provider;

    RETURN QUERY
    SELECT TRUE, 0, v_state.circuit_state, v_state.blocked_until, v_state.tokens, v_state.in_flight;
    RETURN;
  END IF;

  v_wait_ms := LEAST(
    60000,
    GREATEST(
      100,
      CEIL(((v_required - v_state.tokens) / NULLIF(v_limit.refill_rate_per_sec, 0)) * 1000)::INTEGER
    )
  );

  UPDATE public.provider_runtime_state
  SET tokens = v_state.tokens,
      last_refill_at = v_state.last_refill_at,
      updated_at = v_now
  WHERE provider = p_provider;

  RETURN QUERY
  SELECT FALSE, v_wait_ms, v_state.circuit_state, v_state.blocked_until, v_state.tokens, v_state.in_flight;
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_rate_limit_record_result(
  p_provider TEXT,
  p_success BOOLEAN,
  p_status INTEGER DEFAULT NULL,
  p_retry_after_seconds INTEGER DEFAULT NULL,
  p_latency_ms INTEGER DEFAULT NULL,
  p_error TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS public.provider_runtime_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit public.provider_limits;
  v_state public.provider_runtime_state;
  v_now TIMESTAMPTZ := COALESCE(p_now, now());
  v_elapsed_sec NUMERIC;
  v_backoff_sec INTEGER;
BEGIN
  INSERT INTO public.provider_limits (provider, refill_rate_per_sec, burst_capacity, max_concurrent)
  VALUES (p_provider, 2.0, 10.0, 8)
  ON CONFLICT (provider) DO NOTHING;

  INSERT INTO public.provider_runtime_state (provider, tokens, last_refill_at)
  VALUES (p_provider, 0, v_now)
  ON CONFLICT (provider) DO NOTHING;

  SELECT * INTO v_limit
  FROM public.provider_limits
  WHERE provider = p_provider
  FOR UPDATE;

  SELECT * INTO v_state
  FROM public.provider_runtime_state
  WHERE provider = p_provider
  FOR UPDATE;

  v_elapsed_sec := GREATEST(EXTRACT(EPOCH FROM (v_now - COALESCE(v_state.last_refill_at, v_now))), 0);
  v_state.tokens := LEAST(v_limit.burst_capacity, COALESCE(v_state.tokens, 0) + (v_elapsed_sec * v_limit.refill_rate_per_sec));
  v_state.last_refill_at := v_now;
  v_state.in_flight := GREATEST(COALESCE(v_state.in_flight, 0) - 1, 0);
  v_state.last_status := p_status;
  v_state.last_latency_ms := p_latency_ms;
  v_state.last_error := LEFT(COALESCE(p_error, ''), 4000);
  v_state.last_retry_after_seconds := p_retry_after_seconds;

  IF p_success THEN
    v_state.total_successes := COALESCE(v_state.total_successes, 0) + 1;
    v_state.consecutive_failures := 0;
    v_state.blocked_until := NULL;

    IF v_state.circuit_state = 'half_open' THEN
      v_state.half_open_successes := COALESCE(v_state.half_open_successes, 0) + 1;
      IF v_state.half_open_successes >= v_limit.half_open_probe_count THEN
        v_state.circuit_state := 'closed';
        v_state.circuit_opened_at := NULL;
        v_state.next_probe_at := NULL;
        v_state.half_open_successes := 0;
      END IF;
    ELSIF v_state.circuit_state = 'open' THEN
      v_state.circuit_state := 'closed';
      v_state.circuit_opened_at := NULL;
      v_state.next_probe_at := NULL;
      v_state.half_open_successes := 0;
    END IF;
  ELSE
    v_state.total_failures := COALESCE(v_state.total_failures, 0) + 1;
    v_state.consecutive_failures := COALESCE(v_state.consecutive_failures, 0) + 1;

    IF p_status = 429 THEN
      v_state.total_429s := COALESCE(v_state.total_429s, 0) + 1;
    END IF;

    v_backoff_sec := COALESCE(
      p_retry_after_seconds,
      LEAST(300, GREATEST(1, 2 ^ LEAST(v_state.consecutive_failures, 8)))
    );

    v_state.blocked_until := GREATEST(
      COALESCE(v_state.blocked_until, v_now),
      v_now + make_interval(secs => v_backoff_sec)
    );

    IF v_state.circuit_state = 'half_open' OR v_state.consecutive_failures >= v_limit.circuit_failure_threshold THEN
      v_state.circuit_state := 'open';
      v_state.circuit_opened_at := v_now;
      v_state.next_probe_at := v_now + make_interval(secs => v_limit.circuit_open_seconds);
      v_state.half_open_successes := 0;
    END IF;
  END IF;

  UPDATE public.provider_runtime_state
  SET tokens = v_state.tokens,
      in_flight = v_state.in_flight,
      last_refill_at = v_state.last_refill_at,
      blocked_until = v_state.blocked_until,
      circuit_state = v_state.circuit_state,
      circuit_opened_at = v_state.circuit_opened_at,
      next_probe_at = v_state.next_probe_at,
      half_open_successes = v_state.half_open_successes,
      consecutive_failures = v_state.consecutive_failures,
      last_status = v_state.last_status,
      last_error = NULLIF(v_state.last_error, ''),
      last_retry_after_seconds = v_state.last_retry_after_seconds,
      last_latency_ms = v_state.last_latency_ms,
      total_successes = v_state.total_successes,
      total_failures = v_state.total_failures,
      total_429s = v_state.total_429s,
      updated_at = v_now
  WHERE provider = p_provider
  RETURNING * INTO v_state;

  RETURN v_state;
END;
$$;

ALTER TABLE public.provider_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_runtime_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages provider limits" ON public.provider_limits;
CREATE POLICY "Service role manages provider limits"
  ON public.provider_limits FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages provider runtime" ON public.provider_runtime_state;
CREATE POLICY "Service role manages provider runtime"
  ON public.provider_runtime_state FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 4) Cache expansions + cache event metrics
-- ============================================================

ALTER TABLE public.lit_query_cache
  ADD COLUMN IF NOT EXISTS normalized_query TEXT,
  ADD COLUMN IF NOT EXISTS provider_hash TEXT,
  ADD COLUMN IF NOT EXISTS cache_version TEXT NOT NULL DEFAULT 'v2',
  ADD COLUMN IF NOT EXISTS ttl_hours INTEGER NOT NULL DEFAULT 12 CHECK (ttl_hours BETWEEN 6 AND 24),
  ADD COLUMN IF NOT EXISTS hit_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lit_query_cache_v2_lookup
  ON public.lit_query_cache (normalized_query, provider_hash, expires_at DESC);

CREATE TABLE IF NOT EXISTS public.doi_cache (
  normalized_doi TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  cache_version TEXT NOT NULL DEFAULT 'v1',
  source TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  hit_count BIGINT NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doi_cache_expiry
  ON public.doi_cache (expires_at);

CREATE TABLE IF NOT EXISTS public.extraction_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL UNIQUE,
  study_id TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_hash TEXT NOT NULL,
  cache_version TEXT NOT NULL DEFAULT 'v1',
  expires_at TIMESTAMPTZ,
  hit_count BIGINT NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (study_id, extractor_version, prompt_hash, model, cache_version)
);

CREATE INDEX IF NOT EXISTS idx_extraction_cache_lookup
  ON public.extraction_cache (study_id, extractor_version, prompt_hash, model, cache_version);

CREATE TABLE IF NOT EXISTS public.canonical_record_cache (
  fingerprint TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT NOT NULL,
  cache_version TEXT NOT NULL DEFAULT 'v1',
  expires_at TIMESTAMPTZ NOT NULL,
  hit_count BIGINT NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_record_cache_expiry
  ON public.canonical_record_cache (expires_at);

CREATE TABLE IF NOT EXISTS public.research_cache_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_name TEXT NOT NULL CHECK (cache_name IN ('query', 'doi', 'extraction', 'canonical_record')),
  event_type TEXT NOT NULL CHECK (event_type IN ('hit', 'miss', 'write', 'invalidate')),
  key_hash TEXT,
  report_id UUID REFERENCES public.research_reports(id) ON DELETE SET NULL,
  run_id UUID REFERENCES public.research_jobs(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_cache_events_cache_time
  ON public.research_cache_events (cache_name, created_at DESC);

ALTER TABLE public.doi_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_record_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_cache_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages doi cache" ON public.doi_cache;
CREATE POLICY "Service role manages doi cache"
  ON public.doi_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages extraction cache" ON public.extraction_cache;
CREATE POLICY "Service role manages extraction cache"
  ON public.extraction_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages canonical record cache" ON public.canonical_record_cache;
CREATE POLICY "Service role manages canonical record cache"
  ON public.canonical_record_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages research cache events" ON public.research_cache_events;
CREATE POLICY "Service role manages research cache events"
  ON public.research_cache_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 5) Metrics + tracing samples for production observability
-- ============================================================

CREATE TABLE IF NOT EXISTS public.research_metrics_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL,
  unit TEXT,
  tags JSONB NOT NULL DEFAULT '{}'::jsonb,
  report_id UUID REFERENCES public.research_reports(id) ON DELETE SET NULL,
  run_id UUID REFERENCES public.research_jobs(id) ON DELETE SET NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_metrics_samples_name_time
  ON public.research_metrics_samples (metric_name, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.research_trace_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES public.research_jobs(id) ON DELETE CASCADE,
  report_id UUID REFERENCES public.research_reports(id) ON DELETE SET NULL,
  span_name TEXT NOT NULL,
  stage TEXT,
  provider TEXT,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_trace_spans_trace
  ON public.research_trace_spans (trace_id, started_at);

CREATE INDEX IF NOT EXISTS idx_research_trace_spans_provider
  ON public.research_trace_spans (provider, started_at DESC);

ALTER TABLE public.research_metrics_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.research_trace_spans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages research metrics samples" ON public.research_metrics_samples;
CREATE POLICY "Service role manages research metrics samples"
  ON public.research_metrics_samples FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages research trace spans" ON public.research_trace_spans;
CREATE POLICY "Service role manages research trace spans"
  ON public.research_trace_spans FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE VIEW public.research_queue_health AS
SELECT
  stage,
  COUNT(*) FILTER (WHERE status IN ('queued', 'leased')) AS queue_depth,
  MIN(next_run_at) FILTER (WHERE status IN ('queued', 'leased')) AS oldest_next_run_at,
  MAX(CASE WHEN status IN ('queued', 'leased') THEN EXTRACT(EPOCH FROM (now() - next_run_at))::INTEGER ELSE NULL END) AS oldest_age_seconds
FROM public.research_jobs
GROUP BY stage;

-- ============================================================
-- 6) Grants for new RPCs
-- ============================================================

GRANT EXECUTE ON FUNCTION public.provider_rate_limit_try_acquire(TEXT, NUMERIC, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_rate_limit_record_result(TEXT, BOOLEAN, INTEGER, INTEGER, INTEGER, TEXT, TIMESTAMPTZ) TO service_role;
