CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.touch_extraction_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE IF NOT EXISTS public.extraction_column_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('system', 'user')),
  domain TEXT NOT NULL DEFAULT 'research',
  version INTEGER NOT NULL CHECK (version > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, created_by, name, version)
);

CREATE INDEX IF NOT EXISTS idx_extraction_column_sets_active
  ON public.extraction_column_sets (scope, domain, is_active, version DESC);

CREATE TABLE IF NOT EXISTS public.extraction_column_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id UUID NOT NULL REFERENCES public.extraction_column_sets(id) ON DELETE CASCADE,
  column_key TEXT NOT NULL,
  label TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('text', 'number', 'integer', 'boolean', 'date', 'enum', 'json')),
  extract_prompt TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  nullable BOOLEAN NOT NULL DEFAULT true,
  regex_pattern TEXT,
  enum_values TEXT[] NOT NULL DEFAULT '{}',
  source_priority TEXT[] NOT NULL DEFAULT '{abstract,metadata,pdf}',
  normalizer JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (set_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_extraction_column_instructions_set_order
  ON public.extraction_column_instructions (set_id, display_order, column_key);

CREATE TABLE IF NOT EXISTS public.extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.research_reports(id) ON DELETE CASCADE,
  run_index INTEGER NOT NULL CHECK (run_index > 0),
  parent_run_id UUID REFERENCES public.extraction_runs(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('initial_pipeline', 'initial_pipeline_cached', 'pdf_reextract', 'add_study', 'manual_rerun', 'backfill')),
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  engine TEXT NOT NULL CHECK (engine IN ('llm', 'scripted', 'hybrid', 'manual', 'unknown')),
  column_set_id UUID NOT NULL REFERENCES public.extraction_column_sets(id) ON DELETE RESTRICT,
  question TEXT,
  normalized_query TEXT,
  lit_request JSONB NOT NULL DEFAULT '{}'::jsonb,
  lit_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  partial_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_table JSONB NOT NULL DEFAULT '[]'::jsonb,
  brief_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  coverage_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  extraction_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  canonical_papers JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (report_id, run_index)
);

CREATE INDEX IF NOT EXISTS idx_extraction_runs_report_created
  ON public.extraction_runs (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extraction_runs_report_index
  ON public.extraction_runs (report_id, run_index DESC);

CREATE TABLE IF NOT EXISTS public.extraction_run_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
  source_instruction_id UUID REFERENCES public.extraction_column_instructions(id) ON DELETE SET NULL,
  column_key TEXT NOT NULL,
  label TEXT NOT NULL,
  data_type TEXT NOT NULL CHECK (data_type IN ('text', 'number', 'integer', 'boolean', 'date', 'enum', 'json')),
  extract_prompt TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  nullable BOOLEAN NOT NULL DEFAULT true,
  regex_pattern TEXT,
  enum_values TEXT[] NOT NULL DEFAULT '{}',
  source_priority TEXT[] NOT NULL DEFAULT '{abstract,metadata,pdf}',
  normalizer JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_extraction_run_columns_run_order
  ON public.extraction_run_columns (run_id, display_order, column_key);

CREATE TABLE IF NOT EXISTS public.extraction_run_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.extraction_runs(id) ON DELETE CASCADE,
  row_rank INTEGER NOT NULL CHECK (row_rank > 0),
  paper_id TEXT,
  canonical_paper JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, row_rank)
);

CREATE INDEX IF NOT EXISTS idx_extraction_run_rows_run_rank
  ON public.extraction_run_rows (run_id, row_rank);

CREATE TABLE IF NOT EXISTS public.extraction_run_cells (
  row_id UUID NOT NULL REFERENCES public.extraction_run_rows(id) ON DELETE CASCADE,
  run_column_id UUID NOT NULL REFERENCES public.extraction_run_columns(id) ON DELETE CASCADE,
  value_text TEXT,
  value_number NUMERIC,
  value_boolean BOOLEAN,
  value_json JSONB,
  value_null BOOLEAN NOT NULL DEFAULT true,
  confidence NUMERIC(4, 3),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('filled', 'missing', 'conflict')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (row_id, run_column_id)
);

CREATE INDEX IF NOT EXISTS idx_extraction_run_cells_column
  ON public.extraction_run_cells (run_column_id);

ALTER TABLE public.research_reports
  ADD COLUMN IF NOT EXISTS active_extraction_run_id UUID,
  ADD COLUMN IF NOT EXISTS active_column_set_id UUID,
  ADD COLUMN IF NOT EXISTS extraction_run_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'research_reports_active_extraction_run_id_fkey'
      AND conrelid = 'public.research_reports'::regclass
  ) THEN
    ALTER TABLE public.research_reports
      ADD CONSTRAINT research_reports_active_extraction_run_id_fkey
      FOREIGN KEY (active_extraction_run_id)
      REFERENCES public.extraction_runs(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'research_reports_active_column_set_id_fkey'
      AND conrelid = 'public.research_reports'::regclass
  ) THEN
    ALTER TABLE public.research_reports
      ADD CONSTRAINT research_reports_active_column_set_id_fkey
      FOREIGN KEY (active_column_set_id)
      REFERENCES public.extraction_column_sets(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trigger_extraction_column_sets_updated_at ON public.extraction_column_sets;
CREATE TRIGGER trigger_extraction_column_sets_updated_at
BEFORE UPDATE ON public.extraction_column_sets
FOR EACH ROW EXECUTE FUNCTION public.touch_extraction_updated_at();

DROP TRIGGER IF EXISTS trigger_extraction_column_instructions_updated_at ON public.extraction_column_instructions;
CREATE TRIGGER trigger_extraction_column_instructions_updated_at
BEFORE UPDATE ON public.extraction_column_instructions
FOR EACH ROW EXECUTE FUNCTION public.touch_extraction_updated_at();

INSERT INTO public.extraction_column_sets (name, scope, domain, version, is_active)
VALUES ('canonical_evidence_v1', 'system', 'research', 1, true)
ON CONFLICT (scope, created_by, name, version) DO UPDATE
SET is_active = EXCLUDED.is_active,
    updated_at = now();

WITH seed_set AS (
  SELECT id
  FROM public.extraction_column_sets
  WHERE name = 'canonical_evidence_v1'
    AND scope = 'system'
    AND version = 1
    AND created_by IS NULL
  LIMIT 1
)
INSERT INTO public.extraction_column_instructions (
  set_id,
  column_key,
  label,
  data_type,
  extract_prompt,
  required,
  nullable,
  display_order,
  normalizer
)
SELECT
  seed_set.id,
  v.column_key,
  v.label,
  v.data_type,
  v.extract_prompt,
  v.required,
  v.nullable,
  v.display_order,
  v.normalizer
FROM seed_set
CROSS JOIN (
  VALUES
    ('rank', 'Rank', 'integer', 'Row rank from quality ordering.', true, false, 1, '{"cast":"integer"}'::jsonb),
    ('paper_id', 'Paper ID', 'text', 'Stable canonical paper identifier.', true, false, 2, '{}'::jsonb),
    ('title', 'Title', 'text', 'Paper title.', true, false, 3, '{}'::jsonb),
    ('year', 'Year', 'integer', 'Publication year.', false, true, 4, '{"cast":"integer"}'::jsonb),
    ('authors', 'Authors', 'json', 'List of author names.', false, true, 5, '{"kind":"string_array"}'::jsonb),
    ('venue', 'Venue', 'text', 'Journal or venue name.', false, true, 6, '{}'::jsonb),
    ('doi', 'DOI', 'text', 'DOI identifier.', false, true, 7, '{"trim":true}'::jsonb),
    ('pubmed_id', 'PubMed ID', 'text', 'PubMed identifier.', false, true, 8, '{}'::jsonb),
    ('openalex_id', 'OpenAlex ID', 'text', 'OpenAlex identifier.', false, true, 9, '{}'::jsonb),
    ('arxiv_id', 'arXiv ID', 'text', 'arXiv identifier.', false, true, 10, '{}'::jsonb),
    ('abstract_snippet', 'Abstract Snippet', 'text', 'Short evidence snippet from abstract.', false, true, 11, '{}'::jsonb),
    ('proposition_label', 'Proposition Label', 'text', 'Direction/conflict proposition label.', false, true, 12, '{"lowercase":true}'::jsonb),
    ('quality', 'Quality Breakdown', 'json', 'Structured quality score breakdown object.', false, true, 13, '{}'::jsonb),
    ('provenance', 'Provenance', 'json', 'Source provenance list.', false, true, 14, '{}'::jsonb)
) AS v(column_key, label, data_type, extract_prompt, required, nullable, display_order, normalizer)
ON CONFLICT (set_id, column_key) DO UPDATE
SET label = EXCLUDED.label,
    data_type = EXCLUDED.data_type,
    extract_prompt = EXCLUDED.extract_prompt,
    required = EXCLUDED.required,
    nullable = EXCLUDED.nullable,
    display_order = EXCLUDED.display_order,
    normalizer = EXCLUDED.normalizer,
    updated_at = now();

ALTER TABLE public.extraction_column_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_column_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_run_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_run_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_run_cells ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages extraction column sets" ON public.extraction_column_sets;
CREATE POLICY "Service role manages extraction column sets"
  ON public.extraction_column_sets FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages extraction column instructions" ON public.extraction_column_instructions;
CREATE POLICY "Service role manages extraction column instructions"
  ON public.extraction_column_instructions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages extraction runs" ON public.extraction_runs;
CREATE POLICY "Service role manages extraction runs"
  ON public.extraction_runs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages extraction run columns" ON public.extraction_run_columns;
CREATE POLICY "Service role manages extraction run columns"
  ON public.extraction_run_columns FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages extraction run rows" ON public.extraction_run_rows;
CREATE POLICY "Service role manages extraction run rows"
  ON public.extraction_run_rows FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages extraction run cells" ON public.extraction_run_cells;
CREATE POLICY "Service role manages extraction run cells"
  ON public.extraction_run_cells FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

WITH default_set AS (
  SELECT id AS set_id
  FROM public.extraction_column_sets
  WHERE name = 'canonical_evidence_v1'
    AND scope = 'system'
    AND version = 1
    AND created_by IS NULL
  LIMIT 1
),
reports_to_backfill AS (
  SELECT
    rr.id AS report_id,
    rr.user_id,
    rr.question,
    rr.normalized_query,
    rr.lit_request,
    rr.lit_response,
    rr.results,
    rr.partial_results,
    rr.evidence_table,
    rr.brief_json,
    rr.coverage_report,
    rr.search_stats,
    rr.extraction_stats,
    rr.created_at,
    rr.completed_at
  FROM public.research_reports rr
  WHERE rr.status = 'completed'
    AND rr.active_extraction_run_id IS NULL
),
inserted_runs AS (
  INSERT INTO public.extraction_runs (
    report_id,
    run_index,
    parent_run_id,
    trigger,
    status,
    engine,
    column_set_id,
    question,
    normalized_query,
    lit_request,
    lit_response,
    results,
    partial_results,
    evidence_table,
    brief_json,
    coverage_report,
    search_stats,
    extraction_stats,
    canonical_papers,
    created_by,
    created_at,
    started_at,
    completed_at
  )
  SELECT
    r.report_id,
    1,
    NULL,
    'backfill',
    'completed',
    'unknown',
    default_set.set_id,
    r.question,
    r.normalized_query,
    COALESCE(r.lit_request, '{}'::jsonb),
    COALESCE(r.lit_response, '{}'::jsonb),
    COALESCE(r.results, '[]'::jsonb),
    COALESCE(r.partial_results, '[]'::jsonb),
    COALESCE(r.evidence_table, '[]'::jsonb),
    COALESCE(r.brief_json, '{}'::jsonb),
    COALESCE(r.coverage_report, '{}'::jsonb),
    COALESCE(r.search_stats, '{}'::jsonb),
    COALESCE(r.extraction_stats, '{}'::jsonb),
    '[]'::jsonb,
    r.user_id,
    r.created_at,
    COALESCE(r.created_at, now()),
    COALESCE(r.completed_at, now())
  FROM reports_to_backfill r
  CROSS JOIN default_set
  ON CONFLICT (report_id, run_index) DO NOTHING
  RETURNING id, report_id
),
seed_columns AS (
  INSERT INTO public.extraction_run_columns (
    run_id,
    source_instruction_id,
    column_key,
    label,
    data_type,
    extract_prompt,
    required,
    nullable,
    regex_pattern,
    enum_values,
    source_priority,
    normalizer,
    display_order,
    is_enabled
  )
  SELECT
    runs.id,
    instr.id,
    instr.column_key,
    instr.label,
    instr.data_type,
    instr.extract_prompt,
    instr.required,
    instr.nullable,
    instr.regex_pattern,
    instr.enum_values,
    instr.source_priority,
    instr.normalizer,
    instr.display_order,
    instr.is_enabled
  FROM inserted_runs runs
  JOIN default_set ds ON true
  JOIN public.extraction_column_instructions instr ON instr.set_id = ds.set_id
  ON CONFLICT (run_id, column_key) DO NOTHING
  RETURNING run_id
),
seed_rows AS (
  INSERT INTO public.extraction_run_rows (run_id, row_rank, paper_id, canonical_paper)
  SELECT
    runs.id AS run_id,
    COALESCE((elem.value ->> 'rank')::INT, elem.ordinality::INT) AS row_rank,
    elem.value ->> 'paper_id' AS paper_id,
    '{}'::jsonb AS canonical_paper
  FROM inserted_runs runs
  JOIN reports_to_backfill r ON r.report_id = runs.report_id
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(r.evidence_table, '[]'::jsonb)) WITH ORDINALITY AS elem(value, ordinality) ON true
  WHERE elem.value IS NOT NULL
  ON CONFLICT (run_id, row_rank) DO NOTHING
  RETURNING id, run_id, row_rank
)
INSERT INTO public.extraction_run_cells (
  row_id,
  run_column_id,
  value_text,
  value_number,
  value_boolean,
  value_json,
  value_null,
  confidence,
  evidence,
  status
)
SELECT
  rows.id AS row_id,
  run_cols.id AS run_column_id,
  CASE
    WHEN jsonb_typeof(ev.row_json -> run_cols.column_key) IN ('string', 'number', 'boolean')
      THEN trim(both '"' from (ev.row_json -> run_cols.column_key)::text)
    ELSE NULL
  END AS value_text,
  CASE
    WHEN jsonb_typeof(ev.row_json -> run_cols.column_key) = 'number'
      THEN (ev.row_json ->> run_cols.column_key)::numeric
    ELSE NULL
  END AS value_number,
  CASE
    WHEN jsonb_typeof(ev.row_json -> run_cols.column_key) = 'boolean'
      THEN (ev.row_json ->> run_cols.column_key)::boolean
    ELSE NULL
  END AS value_boolean,
  CASE
    WHEN ev.row_json ? run_cols.column_key THEN ev.row_json -> run_cols.column_key
    ELSE NULL
  END AS value_json,
  NOT (ev.row_json ? run_cols.column_key) OR (ev.row_json -> run_cols.column_key) IS NULL AS value_null,
  NULL::numeric,
  '{}'::jsonb,
  CASE
    WHEN ev.row_json ? run_cols.column_key AND (ev.row_json -> run_cols.column_key) IS NOT NULL THEN 'filled'
    ELSE 'missing'
  END AS status
FROM inserted_runs runs
JOIN reports_to_backfill r ON r.report_id = runs.report_id
JOIN LATERAL jsonb_array_elements(COALESCE(r.evidence_table, '[]'::jsonb)) WITH ORDINALITY AS ev(row_json, ordinality) ON true
JOIN public.extraction_run_rows rows
  ON rows.run_id = runs.id
 AND rows.row_rank = COALESCE((ev.row_json ->> 'rank')::INT, ev.ordinality::INT)
JOIN public.extraction_run_columns run_cols ON run_cols.run_id = runs.id
ON CONFLICT (row_id, run_column_id) DO NOTHING;

UPDATE public.research_reports rr
SET
  active_extraction_run_id = runs.id,
  active_column_set_id = runs.column_set_id,
  extraction_run_count = 1
FROM public.extraction_runs runs
WHERE runs.report_id = rr.id
  AND runs.run_index = 1
  AND rr.active_extraction_run_id IS NULL;
