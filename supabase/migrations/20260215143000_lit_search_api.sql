ALTER TABLE public.research_reports
  ADD COLUMN IF NOT EXISTS lit_request JSONB,
  ADD COLUMN IF NOT EXISTS lit_response JSONB,
  ADD COLUMN IF NOT EXISTS coverage_report JSONB,
  ADD COLUMN IF NOT EXISTS evidence_table JSONB,
  ADD COLUMN IF NOT EXISTS brief_json JSONB,
  ADD COLUMN IF NOT EXISTS search_stats JSONB;

CREATE TABLE IF NOT EXISTS public.lit_query_cache (
  cache_key TEXT PRIMARY KEY,
  request_payload JSONB NOT NULL,
  response_payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lit_query_cache_expires_at
  ON public.lit_query_cache (expires_at);

ALTER TABLE public.lit_query_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages lit query cache" ON public.lit_query_cache;
CREATE POLICY "Service role manages lit query cache"
  ON public.lit_query_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.lit_paper_cache (
  paper_id TEXT PRIMARY KEY,
  paper_payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lit_paper_cache_expires_at
  ON public.lit_paper_cache (expires_at);

ALTER TABLE public.lit_paper_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages lit paper cache" ON public.lit_paper_cache;
CREATE POLICY "Service role manages lit paper cache"
  ON public.lit_paper_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
