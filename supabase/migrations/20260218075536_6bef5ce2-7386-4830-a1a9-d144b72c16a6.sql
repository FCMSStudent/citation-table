
-- Add missing columns to research_run_events for Phase 1 observability
-- Additive only: no drops, no renames

ALTER TABLE public.research_run_events
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS duration_ms double precision,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS input_hash text,
  ADD COLUMN IF NOT EXISTS output_hash text;

-- Backfill event_type from existing status column
UPDATE public.research_run_events SET event_type = status WHERE event_type IS NULL;

-- Create index for trace_id lookups (common query pattern)
CREATE INDEX IF NOT EXISTS idx_run_events_trace ON public.research_run_events (trace_id);

-- Create index for stage + event_type queries
CREATE INDEX IF NOT EXISTS idx_run_events_stage_type ON public.research_run_events (stage, event_type);
