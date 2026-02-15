CREATE TABLE IF NOT EXISTS public.metadata_enrichment_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lookup_key TEXT NOT NULL UNIQUE,
  lookup_kind TEXT NOT NULL CHECK (lookup_kind IN ('doi', 'title')),
  doi_norm TEXT,
  title_fingerprint TEXT,
  resolved_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_payloads JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(4, 3) CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'deferred', 'rejected', 'not_found', 'error')),
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_cache_doi
  ON public.metadata_enrichment_cache (doi_norm);
CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_cache_expires_at
  ON public.metadata_enrichment_cache (expires_at);

CREATE TABLE IF NOT EXISTS public.metadata_enrichment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stack TEXT NOT NULL CHECK (stack IN ('supabase_edge', 'python_api', 'backfill')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  report_id UUID REFERENCES public.research_reports(id) ON DELETE CASCADE,
  search_id TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_jobs_status_next
  ON public.metadata_enrichment_jobs (status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_jobs_stack
  ON public.metadata_enrichment_jobs (stack);
CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_jobs_report_id
  ON public.metadata_enrichment_jobs (report_id);
CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_jobs_search_id
  ON public.metadata_enrichment_jobs (search_id);

CREATE TABLE IF NOT EXISTS public.metadata_enrichment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stack TEXT NOT NULL,
  function_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('offline_shadow', 'offline_apply', 'inline_apply')),
  report_id UUID REFERENCES public.research_reports(id) ON DELETE SET NULL,
  search_id TEXT,
  paper_id TEXT,
  lookup_key TEXT,
  providers_attempted TEXT[] NOT NULL DEFAULT '{}',
  provider_statuses JSONB NOT NULL DEFAULT '{}'::jsonb,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'deferred', 'rejected', 'not_found', 'error')),
  confidence NUMERIC(4, 3) CHECK (confidence >= 0 AND confidence <= 1),
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  fields_applied JSONB NOT NULL DEFAULT '{}'::jsonb,
  latency_ms INTEGER,
  used_cache BOOLEAN NOT NULL DEFAULT false,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_events_created_at
  ON public.metadata_enrichment_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_events_outcome
  ON public.metadata_enrichment_events (outcome);
CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_events_report_id
  ON public.metadata_enrichment_events (report_id);
CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_events_search_id
  ON public.metadata_enrichment_events (search_id);

CREATE OR REPLACE FUNCTION public.touch_metadata_enrichment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trigger_metadata_enrichment_cache_updated_at ON public.metadata_enrichment_cache;
CREATE TRIGGER trigger_metadata_enrichment_cache_updated_at
BEFORE UPDATE ON public.metadata_enrichment_cache
FOR EACH ROW EXECUTE FUNCTION public.touch_metadata_enrichment_updated_at();

DROP TRIGGER IF EXISTS trigger_metadata_enrichment_jobs_updated_at ON public.metadata_enrichment_jobs;
CREATE TRIGGER trigger_metadata_enrichment_jobs_updated_at
BEFORE UPDATE ON public.metadata_enrichment_jobs
FOR EACH ROW EXECUTE FUNCTION public.touch_metadata_enrichment_updated_at();

ALTER TABLE public.metadata_enrichment_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata_enrichment_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metadata_enrichment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages metadata enrichment cache" ON public.metadata_enrichment_cache;
CREATE POLICY "Service role manages metadata enrichment cache"
  ON public.metadata_enrichment_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages metadata enrichment jobs" ON public.metadata_enrichment_jobs;
CREATE POLICY "Service role manages metadata enrichment jobs"
  ON public.metadata_enrichment_jobs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages metadata enrichment events" ON public.metadata_enrichment_events;
CREATE POLICY "Service role manages metadata enrichment events"
  ON public.metadata_enrichment_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
