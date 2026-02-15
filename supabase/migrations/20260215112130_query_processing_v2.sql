ALTER TABLE public.research_reports
  ADD COLUMN IF NOT EXISTS query_processing_meta JSONB;

CREATE TABLE IF NOT EXISTS public.query_processing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  report_id UUID REFERENCES public.research_reports(id) ON DELETE SET NULL,
  function_name TEXT NOT NULL CHECK (function_name IN ('research', 'research-async')),
  mode TEXT NOT NULL CHECK (mode IN ('v1', 'v2', 'shadow')),
  original_query TEXT NOT NULL,
  served_query TEXT NOT NULL,
  normalized_query TEXT,
  deterministic_confidence NUMERIC(4, 3),
  used_llm_fallback BOOLEAN NOT NULL DEFAULT false,
  processing_ms INTEGER,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  source_queries JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_processing_events_created_at
  ON public.query_processing_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_processing_events_user_id
  ON public.query_processing_events (user_id);
CREATE INDEX IF NOT EXISTS idx_query_processing_events_mode
  ON public.query_processing_events (mode);

ALTER TABLE public.query_processing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own query processing events" ON public.query_processing_events;
CREATE POLICY "Users can insert own query processing events"
  ON public.query_processing_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND (user_id IS NULL OR auth.uid() = user_id));

DROP POLICY IF EXISTS "Users can view own query processing events" ON public.query_processing_events;
CREATE POLICY "Users can view own query processing events"
  ON public.query_processing_events FOR SELECT
  USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage query processing events" ON public.query_processing_events;
CREATE POLICY "Service role can manage query processing events"
  ON public.query_processing_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.query_benchmark_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_text TEXT NOT NULL,
  expected_concepts TEXT[] NOT NULL DEFAULT '{}',
  forbidden_concepts TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_benchmark_cases_active
  ON public.query_benchmark_cases (is_active);

ALTER TABLE public.query_benchmark_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read benchmark cases" ON public.query_benchmark_cases;
CREATE POLICY "Authenticated can read benchmark cases"
  ON public.query_benchmark_cases FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated can create benchmark cases" ON public.query_benchmark_cases;
CREATE POLICY "Authenticated can create benchmark cases"
  ON public.query_benchmark_cases FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND (created_by IS NULL OR created_by = auth.uid()));

DROP POLICY IF EXISTS "Creator can update benchmark cases" ON public.query_benchmark_cases;
CREATE POLICY "Creator can update benchmark cases"
  ON public.query_benchmark_cases FOR UPDATE
  USING (auth.uid() IS NOT NULL AND (created_by = auth.uid() OR auth.role() = 'service_role'));

CREATE TABLE IF NOT EXISTS public.query_benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES public.query_benchmark_cases(id) ON DELETE SET NULL,
  pipeline_version TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('v1', 'v2', 'shadow')),
  original_query TEXT NOT NULL,
  normalized_query TEXT,
  served_query TEXT,
  matched_expected TEXT[] NOT NULL DEFAULT '{}',
  matched_forbidden TEXT[] NOT NULL DEFAULT '{}',
  pass BOOLEAN NOT NULL DEFAULT false,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_benchmark_runs_case_id
  ON public.query_benchmark_runs (case_id);
CREATE INDEX IF NOT EXISTS idx_query_benchmark_runs_created_at
  ON public.query_benchmark_runs (created_at DESC);

ALTER TABLE public.query_benchmark_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read benchmark runs" ON public.query_benchmark_runs;
CREATE POLICY "Authenticated can read benchmark runs"
  ON public.query_benchmark_runs FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated can create benchmark runs" ON public.query_benchmark_runs;
CREATE POLICY "Authenticated can create benchmark runs"
  ON public.query_benchmark_runs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND (created_by IS NULL OR created_by = auth.uid()));
