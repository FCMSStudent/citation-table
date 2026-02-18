CREATE TABLE IF NOT EXISTS public.research_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES public.research_jobs(id) ON DELETE CASCADE,
  report_id UUID REFERENCES public.research_reports(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (
    stage IN (
      'VALIDATE',
      'PREPARE_QUERY',
      'RETRIEVE_PROVIDERS',
      'CANONICALIZE',
      'QUALITY_FILTER',
      'DETERMINISTIC_EXTRACT',
      'LLM_AUGMENT',
      'PERSIST'
    )
  ),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'idempotent', 'failed')),
  duration INTEGER CHECK (duration IS NULL OR duration >= 0),
  error_category TEXT CHECK (
    error_category IS NULL
    OR error_category IN ('VALIDATION', 'TIMEOUT', 'EXTERNAL', 'TRANSIENT', 'INTERNAL')
  ),
  message TEXT,
  event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_research_run_events_trace
  ON public.research_run_events (trace_id, event_at);

CREATE INDEX IF NOT EXISTS idx_research_run_events_run
  ON public.research_run_events (run_id, event_at);

CREATE INDEX IF NOT EXISTS idx_research_run_events_report
  ON public.research_run_events (report_id, event_at);

ALTER TABLE public.research_run_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages research run events" ON public.research_run_events;
CREATE POLICY "Service role manages research run events"
  ON public.research_run_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
