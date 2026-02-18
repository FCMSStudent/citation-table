
-- ============================================================
-- PHASE 1: Extend research_reports with missing columns
-- ============================================================

-- Drop old CHECK and replace with extended status set
ALTER TABLE public.research_reports DROP CONSTRAINT IF EXISTS research_reports_status_check;
ALTER TABLE public.research_reports ADD CONSTRAINT research_reports_status_check
  CHECK (status = ANY (ARRAY['queued','processing','completed','failed','timed_out','cancelled']));

ALTER TABLE public.research_reports
  ADD COLUMN IF NOT EXISTS active_extraction_run_id uuid,
  ADD COLUMN IF NOT EXISTS active_column_set_id uuid,
  ADD COLUMN IF NOT EXISTS extraction_run_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lit_request jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS lit_response jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS coverage_report jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_table jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS brief_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS search_stats jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_research_reports_user_id ON public.research_reports (user_id);

-- ============================================================
-- PHASE 2: research_jobs table + RPC functions
-- ============================================================

CREATE TABLE IF NOT EXISTS public.research_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.research_reports(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'pipeline',
  provider text NOT NULL DEFAULT 'research-async',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status = ANY (ARRAY['queued','leased','completed','dead'])),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  dedupe_key text NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_jobs_dedupe ON public.research_jobs (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_research_jobs_status ON public.research_jobs (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_research_jobs_report ON public.research_jobs (report_id);

ALTER TABLE public.research_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages research_jobs"
  ON public.research_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Enqueue RPC (idempotent via dedupe_key)
CREATE OR REPLACE FUNCTION public.research_jobs_enqueue(
  p_report_id uuid,
  p_stage text,
  p_provider text,
  p_payload jsonb,
  p_dedupe_key text,
  p_max_attempts integer DEFAULT 5
) RETURNS SETOF public.research_jobs
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN QUERY
  INSERT INTO public.research_jobs (report_id, stage, provider, payload, dedupe_key, max_attempts)
  VALUES (p_report_id, p_stage, p_provider, p_payload, p_dedupe_key, p_max_attempts)
  ON CONFLICT (dedupe_key) DO UPDATE SET updated_at = now()
  RETURNING *;
END;
$$;

-- Claim RPC (lease-based)
CREATE OR REPLACE FUNCTION public.research_jobs_claim(
  p_worker_id text,
  p_batch_size integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 300
) RETURNS SETOF public.research_jobs
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.research_jobs
  SET status = 'leased',
      lease_owner = p_worker_id,
      lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
      attempts = attempts + 1,
      updated_at = now()
  WHERE id IN (
    SELECT j.id FROM public.research_jobs j
    WHERE j.status = 'queued'
       OR (j.status = 'leased' AND j.lease_expires_at < now())
    ORDER BY j.created_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

-- Complete RPC
CREATE OR REPLACE FUNCTION public.research_jobs_complete(
  p_job_id uuid,
  p_worker_id text
) RETURNS SETOF public.research_jobs
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.research_jobs
  SET status = 'completed', updated_at = now()
  WHERE id = p_job_id AND lease_owner = p_worker_id
  RETURNING *;
END;
$$;

-- Fail RPC
CREATE OR REPLACE FUNCTION public.research_jobs_fail(
  p_job_id uuid,
  p_worker_id text,
  p_error text DEFAULT NULL
) RETURNS SETOF public.research_jobs
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.research_jobs
  SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
      last_error = p_error,
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = p_job_id AND lease_owner = p_worker_id
  RETURNING *;
END;
$$;

-- ============================================================
-- PHASE 3: research_run_events (observability)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.research_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id text,
  run_id text,
  report_id text,
  stage text NOT NULL,
  status text NOT NULL,
  duration double precision,
  error_category text,
  message text,
  event_at text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_events_run ON public.research_run_events (run_id);
CREATE INDEX IF NOT EXISTS idx_run_events_report ON public.research_run_events (report_id);

ALTER TABLE public.research_run_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages run_events"
  ON public.research_run_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- PHASE 4: Extraction run system
-- ============================================================

CREATE TABLE IF NOT EXISTS public.extraction_column_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'system',
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, name, version)
);

ALTER TABLE public.extraction_column_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages column_sets"
  ON public.extraction_column_sets FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read column_sets"
  ON public.extraction_column_sets FOR SELECT TO authenticated
  USING (true);

-- Seed the default column set
INSERT INTO public.extraction_column_sets (scope, name, version, description)
VALUES ('system', 'canonical_evidence_v1', 1, 'Default evidence extraction column set')
ON CONFLICT (scope, name, version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.extraction_column_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.extraction_column_sets(id) ON DELETE CASCADE,
  column_key text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL DEFAULT 'text',
  extract_prompt text NOT NULL DEFAULT '',
  required boolean NOT NULL DEFAULT false,
  nullable boolean NOT NULL DEFAULT true,
  regex_pattern text,
  enum_values jsonb DEFAULT '[]'::jsonb,
  source_priority jsonb DEFAULT '["abstract","metadata","pdf"]'::jsonb,
  normalizer jsonb DEFAULT '{}'::jsonb,
  display_order integer NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_col_instructions_set ON public.extraction_column_instructions (set_id);

ALTER TABLE public.extraction_column_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages col_instructions"
  ON public.extraction_column_instructions FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated read col_instructions"
  ON public.extraction_column_instructions FOR SELECT TO authenticated
  USING (true);

-- Atomic run index allocator
CREATE OR REPLACE FUNCTION public.next_run_index(p_report_id uuid)
RETURNS integer
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_next integer;
BEGIN
  UPDATE public.research_reports
  SET extraction_run_count = COALESCE(extraction_run_count, 0) + 1
  WHERE id = p_report_id
  RETURNING extraction_run_count INTO v_next;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Report % not found', p_report_id;
  END IF;

  RETURN v_next;
END;
$$;

CREATE TABLE IF NOT EXISTS public.extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.research_reports(id) ON DELETE CASCADE,
  run_index integer NOT NULL,
  parent_run_id uuid,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  engine text NOT NULL DEFAULT 'unknown',
  column_set_id uuid REFERENCES public.extraction_column_sets(id),
  question text,
  normalized_query text,
  lit_request jsonb DEFAULT '{}'::jsonb,
  lit_response jsonb DEFAULT '{}'::jsonb,
  results jsonb DEFAULT '[]'::jsonb,
  partial_results jsonb DEFAULT '[]'::jsonb,
  evidence_table jsonb DEFAULT '[]'::jsonb,
  brief_json jsonb DEFAULT '{}'::jsonb,
  coverage_report jsonb DEFAULT '{}'::jsonb,
  search_stats jsonb DEFAULT '{}'::jsonb,
  extraction_stats jsonb DEFAULT '{}'::jsonb,
  extractor_version text,
  prompt_hash text,
  model text,
  deterministic_flag boolean DEFAULT false,
  canonical_papers jsonb DEFAULT '[]'::jsonb,
  error_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (report_id, run_index)
);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_report ON public.extraction_runs (report_id);

ALTER TABLE public.extraction_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages extraction_runs"
  ON public.extraction_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);
CREATE POLICY "Users read own extraction_runs"
  ON public.extraction_runs FOR SELECT TO authenticated
  USING (report_id IN (SELECT id FROM public.research_reports WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.extraction_run_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
  source_instruction_id uuid,
  column_key text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL DEFAULT 'text',
  extract_prompt text DEFAULT '',
  required boolean DEFAULT false,
  nullable boolean DEFAULT true,
  regex_pattern text,
  enum_values jsonb DEFAULT '[]'::jsonb,
  source_priority jsonb DEFAULT '[]'::jsonb,
  normalizer jsonb DEFAULT '{}'::jsonb,
  display_order integer DEFAULT 0,
  is_enabled boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_columns_run ON public.extraction_run_columns (run_id);

ALTER TABLE public.extraction_run_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages run_columns"
  ON public.extraction_run_columns FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.extraction_run_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
  row_rank integer NOT NULL,
  paper_id text,
  canonical_paper jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_rows_run ON public.extraction_run_rows (run_id);

ALTER TABLE public.extraction_run_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages run_rows"
  ON public.extraction_run_rows FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.extraction_run_cells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id uuid NOT NULL REFERENCES public.extraction_run_rows(id) ON DELETE CASCADE,
  run_column_id uuid NOT NULL REFERENCES public.extraction_run_columns(id) ON DELETE CASCADE,
  value_text text,
  value_number double precision,
  value_boolean boolean,
  value_json jsonb,
  value_null boolean DEFAULT false,
  confidence double precision,
  evidence jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'missing',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_cells_row ON public.extraction_run_cells (row_id);
CREATE INDEX IF NOT EXISTS idx_run_cells_column ON public.extraction_run_cells (run_column_id);

ALTER TABLE public.extraction_run_cells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages run_cells"
  ON public.extraction_run_cells FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- PHASE 5: Caching tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lit_query_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  request_payload jsonb DEFAULT '{}'::jsonb,
  response_payload jsonb DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lit_query_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages query_cache"
  ON public.lit_query_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.lit_paper_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id text NOT NULL UNIQUE,
  paper_payload jsonb DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lit_paper_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages paper_cache"
  ON public.lit_paper_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- PHASE 6: Metadata enrichment system
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dedup_source_priority (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL UNIQUE,
  trust_score double precision NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dedup_source_priority ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages dedup_priority"
  ON public.dedup_source_priority FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Seed default trust scores
INSERT INTO public.dedup_source_priority (source, trust_score) VALUES
  ('pubmed', 0.98), ('openalex', 0.92), ('semantic_scholar', 0.9),
  ('crossref', 0.89), ('arxiv', 0.84), ('unknown', 0.5)
ON CONFLICT (source) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.metadata_enrichment_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lookup_key text NOT NULL UNIQUE,
  lookup_kind text NOT NULL DEFAULT 'doi',
  doi_norm text,
  title_fingerprint text,
  resolved_metadata jsonb DEFAULT '{}'::jsonb,
  provider_payloads jsonb DEFAULT '{}'::jsonb,
  confidence double precision,
  status text NOT NULL DEFAULT 'not_found',
  reason_codes jsonb DEFAULT '[]'::jsonb,
  fetched_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.metadata_enrichment_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages enrichment_cache"
  ON public.metadata_enrichment_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.metadata_enrichment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stack text NOT NULL,
  function_name text NOT NULL,
  mode text NOT NULL,
  report_id text,
  search_id text,
  paper_id text,
  lookup_key text,
  providers_attempted jsonb DEFAULT '[]'::jsonb,
  provider_statuses jsonb DEFAULT '{}'::jsonb,
  outcome text NOT NULL,
  confidence double precision,
  reason_codes jsonb DEFAULT '[]'::jsonb,
  fields_applied jsonb DEFAULT '{}'::jsonb,
  latency_ms double precision,
  used_cache boolean DEFAULT false,
  user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_events_report ON public.metadata_enrichment_events (report_id);

ALTER TABLE public.metadata_enrichment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages enrichment_events"
  ON public.metadata_enrichment_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.metadata_enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stack text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status = ANY (ARRAY['queued','processing','completed','failed'])),
  report_id text,
  search_id text,
  user_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status ON public.metadata_enrichment_jobs (status, next_run_at);

ALTER TABLE public.metadata_enrichment_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages enrichment_jobs"
  ON public.metadata_enrichment_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- PHASE 7: Attach the rate_limits cleanup trigger
-- ============================================================

CREATE OR REPLACE TRIGGER trg_cleanup_old_rate_limits
  AFTER INSERT ON public.rate_limits
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.cleanup_old_rate_limits();
