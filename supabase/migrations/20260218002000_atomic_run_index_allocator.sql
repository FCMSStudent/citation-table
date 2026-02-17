CREATE TABLE IF NOT EXISTS public.extraction_run_counters (
  report_id UUID PRIMARY KEY REFERENCES public.research_reports(id) ON DELETE CASCADE,
  last_run_index INTEGER NOT NULL CHECK (last_run_index >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.next_run_index(p_report_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_next_run_index INTEGER;
BEGIN
  INSERT INTO public.extraction_run_counters (report_id, last_run_index)
  VALUES (
    p_report_id,
    COALESCE((
      SELECT MAX(r.run_index)
      FROM public.extraction_runs r
      WHERE r.report_id = p_report_id
    ), 0) + 1
  )
  ON CONFLICT (report_id)
  DO UPDATE
  SET last_run_index = public.extraction_run_counters.last_run_index + 1,
      updated_at = now()
  RETURNING last_run_index
  INTO v_next_run_index;

  RETURN v_next_run_index;
END;
$$;
