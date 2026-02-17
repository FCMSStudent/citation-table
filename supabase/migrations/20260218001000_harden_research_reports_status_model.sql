-- Harden research_reports status model + idempotency surface.
-- This migration is written to be rerunnable and safe for mixed-version deploys.

-- 1) Add new columns (nullable first for compatibility while workers are still on old code).
ALTER TABLE public.research_reports
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS request_hash TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_version TEXT,
  ADD COLUMN IF NOT EXISTS error_category TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 2) Ensure JSON columns have deterministic defaults.
ALTER TABLE public.research_reports
  ALTER COLUMN results SET DEFAULT '[]'::jsonb,
  ALTER COLUMN lit_request SET DEFAULT '{}'::jsonb,
  ALTER COLUMN lit_response SET DEFAULT '{}'::jsonb,
  ALTER COLUMN coverage_report SET DEFAULT '{}'::jsonb,
  ALTER COLUMN evidence_table SET DEFAULT '[]'::jsonb,
  ALTER COLUMN brief_json SET DEFAULT '{}'::jsonb,
  ALTER COLUMN search_stats SET DEFAULT '{}'::jsonb,
  ALTER COLUMN query_processing_meta SET DEFAULT '{}'::jsonb;

-- 3) Backfill existing rows before adding NOT NULL / validated checks.
UPDATE public.research_reports
SET
  results = COALESCE(results, '[]'::jsonb),
  lit_request = COALESCE(lit_request, '{}'::jsonb),
  lit_response = COALESCE(lit_response, '{}'::jsonb),
  coverage_report = COALESCE(coverage_report, '{}'::jsonb),
  evidence_table = COALESCE(evidence_table, '[]'::jsonb),
  brief_json = COALESCE(brief_json, '{}'::jsonb),
  search_stats = COALESCE(search_stats, '{}'::jsonb),
  query_processing_meta = COALESCE(query_processing_meta, '{}'::jsonb),
  completed_at = CASE
    WHEN status = 'completed' THEN COALESCE(completed_at, created_at)
    ELSE completed_at
  END,
  pipeline_version = COALESCE(pipeline_version, 'legacy'),
  request_hash = COALESCE(request_hash, md5(COALESCE(normalized_query, question, '')))
WHERE
  results IS NULL
  OR lit_request IS NULL
  OR lit_response IS NULL
  OR coverage_report IS NULL
  OR evidence_table IS NULL
  OR brief_json IS NULL
  OR search_stats IS NULL
  OR query_processing_meta IS NULL
  OR (status = 'completed' AND completed_at IS NULL)
  OR pipeline_version IS NULL
  OR request_hash IS NULL;

-- 4) Lock in JSON non-nullability after backfill.
ALTER TABLE public.research_reports
  ALTER COLUMN results SET NOT NULL,
  ALTER COLUMN lit_request SET NOT NULL,
  ALTER COLUMN lit_response SET NOT NULL,
  ALTER COLUMN coverage_report SET NOT NULL,
  ALTER COLUMN evidence_table SET NOT NULL,
  ALTER COLUMN brief_json SET NOT NULL,
  ALTER COLUMN search_stats SET NOT NULL,
  ALTER COLUMN query_processing_meta SET NOT NULL;

-- 5) Replace legacy status constraint with expanded status model.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.research_reports'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.research_reports DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.research_reports
  ALTER COLUMN status SET DEFAULT 'queued';

ALTER TABLE public.research_reports
  ADD CONSTRAINT research_reports_status_check
  CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'timed_out', 'cancelled'));

-- 6) completed => completed_at IS NOT NULL
-- Add NOT VALID first, then validate after backfill for low-risk rollout.
ALTER TABLE public.research_reports
  ADD CONSTRAINT research_reports_completed_requires_completed_at
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
  NOT VALID;

ALTER TABLE public.research_reports
  VALIDATE CONSTRAINT research_reports_completed_requires_completed_at;

-- 7) Idempotency uniqueness surface.
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_reports_user_id_idempotency_key
  ON public.research_reports (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
