ALTER TABLE public.research_reports
  ADD COLUMN IF NOT EXISTS partial_results jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.research_reports
  ADD COLUMN IF NOT EXISTS extraction_stats jsonb NOT NULL DEFAULT '{}'::jsonb;
