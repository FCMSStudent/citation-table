-- Manual SQL validation suite for DOI deduplication subsystem.
-- Run against a database where migration 20260215112000_doi_dedup_strategy.sql is applied.

BEGIN;

-- Cleanup prior fixtures.
DELETE FROM public.raw_publication_ingest WHERE record_id LIKE 'test-dedup-%';

DO $$
BEGIN
  IF public.normalize_doi(' https://doi.org/10.1234/AbC-1 ') <> '10.1234/abc-1' THEN
    RAISE EXCEPTION 'normalize_doi failed URL stripping/case folding';
  END IF;

  IF public.normalize_doi('doi:10.5555/XYZ.2024') <> '10.5555/xyz.2024' THEN
    RAISE EXCEPTION 'normalize_doi failed DOI prefix stripping';
  END IF;

  IF public.is_valid_doi('10.1000/xyz') IS NOT TRUE THEN
    RAISE EXCEPTION 'is_valid_doi should accept valid DOI';
  END IF;

  IF public.is_valid_doi('abc/10.1000') IS NOT FALSE THEN
    RAISE EXCEPTION 'is_valid_doi should reject malformed DOI';
  END IF;

  IF public.record_quality_score(1.0, 0.9, 0.8, 0.7) <> 90.00 THEN
    RAISE EXCEPTION 'record_quality_score formula mismatch';
  END IF;
END;
$$;

-- DOI group: openalex should become canonical by score.
INSERT INTO public.raw_publication_ingest (
  record_id,
  source,
  source_updated_at,
  raw_doi,
  title,
  authors,
  pub_year,
  citation_count,
  aux_signal,
  metadata,
  is_deleted,
  ingest_run_id,
  ingested_at
)
VALUES
  (
    'test-dedup-doi-openalex',
    'openalex',
    now() - interval '1 day',
    'https://doi.org/10.7777/ALPHA.1',
    'Primary outcome analysis for chronic pain treatment',
    ARRAY['Smith J', 'Jones R', 'Lee A'],
    2024,
    120,
    0.02,
    '{}'::jsonb,
    false,
    'test-run-1',
    now()
  ),
  (
    'test-dedup-doi-semantic',
    'semantic_scholar',
    now() - interval '2 day',
    '10.7777/alpha.1',
    'Primary outcome analysis for chronic pain treatment',
    ARRAY['Smith J', 'Jones R', 'Lee A'],
    2024,
    15,
    0.00,
    '{}'::jsonb,
    false,
    'test-run-1',
    now()
  ),
  (
    'test-dedup-doi-arxiv',
    'arxiv',
    now() - interval '3 hour',
    'doi:10.7777/alpha.1',
    'Primary outcome analysis for chronic pain treatment',
    ARRAY['Smith J', 'Jones R', 'Lee A'],
    2024,
    0,
    0.00,
    '{}'::jsonb,
    false,
    'test-run-1',
    now()
  );

CALL public.sp_dedup_full_rebuild(now());

DO $$
DECLARE
  v_canonical_record_id TEXT;
  v_duplicate_count INTEGER;
BEGIN
  SELECT c.record_id
    INTO v_canonical_record_id
  FROM public.dim_canonical_record c
  WHERE c.active = true
    AND c.dedup_key_type = 'DOI'
    AND c.dedup_key = '10.7777/alpha.1';

  IF v_canonical_record_id <> 'test-dedup-doi-openalex' THEN
    RAISE EXCEPTION 'Expected openalex DOI record canonical, got %', v_canonical_record_id;
  END IF;

  SELECT COUNT(*)
    INTO v_duplicate_count
  FROM public.fact_duplicate_link f
  WHERE f.active = true
    AND f.canonical_id = (
      SELECT canonical_id
      FROM public.dim_canonical_record c
      WHERE c.active = true
        AND c.dedup_key_type = 'DOI'
        AND c.dedup_key = '10.7777/alpha.1'
    );

  IF v_duplicate_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 DOI duplicates, got %', v_duplicate_count;
  END IF;
END;
$$;

-- Fallback matching: first two should cluster, third should remain separate.
INSERT INTO public.raw_publication_ingest (
  record_id,
  source,
  source_updated_at,
  raw_doi,
  title,
  authors,
  pub_year,
  citation_count,
  aux_signal,
  metadata,
  is_deleted,
  ingest_run_id,
  ingested_at
)
VALUES
  (
    'test-dedup-fp-1',
    'openalex',
    now() - interval '12 hour',
    NULL,
    'Effect of Omega-3 on pain in adults',
    ARRAY['Lee A', 'Kim B', 'Ng C'],
    2023,
    30,
    0.01,
    '{}'::jsonb,
    false,
    'test-run-2',
    now()
  ),
  (
    'test-dedup-fp-2',
    'semantic_scholar',
    now() - interval '14 hour',
    NULL,
    'Effect of omega 3 on pain in adults',
    ARRAY['Lee A', 'Kim B', 'Ng C'],
    2023,
    10,
    0.00,
    '{}'::jsonb,
    false,
    'test-run-2',
    now()
  ),
  (
    'test-dedup-fp-3',
    'semantic_scholar',
    now() - interval '14 hour',
    NULL,
    'Completely different oncology cohort outcomes',
    ARRAY['Lee A', 'Kim B', 'Ng C'],
    2023,
    10,
    0.00,
    '{}'::jsonb,
    false,
    'test-run-2',
    now()
  );

CALL public.sp_dedup_full_rebuild(now());

DO $$
DECLARE
  v_key_1 TEXT;
  v_key_2 TEXT;
  v_key_3 TEXT;
BEGIN
  SELECT dedup_key INTO v_key_1 FROM public.stg_records_normalized WHERE record_id = 'test-dedup-fp-1';
  SELECT dedup_key INTO v_key_2 FROM public.stg_records_normalized WHERE record_id = 'test-dedup-fp-2';
  SELECT dedup_key INTO v_key_3 FROM public.stg_records_normalized WHERE record_id = 'test-dedup-fp-3';

  IF v_key_1 <> v_key_2 THEN
    RAISE EXCEPTION 'Expected fp-1 and fp-2 to be grouped; got %, %', v_key_1, v_key_2;
  END IF;

  IF v_key_1 = v_key_3 THEN
    RAISE EXCEPTION 'Expected fp-3 to remain outside the near-duplicate group';
  END IF;
END;
$$;

-- Canonical delete handling: mark current DOI canonical deleted, expect re-election.
UPDATE public.raw_publication_ingest
SET is_deleted = true,
    ingest_run_id = 'test-run-3',
    ingested_at = now(),
    source_updated_at = now()
WHERE record_id = 'test-dedup-doi-openalex';

CALL public.sp_dedup_incremental(now());

DO $$
DECLARE
  v_canonical_after_delete TEXT;
BEGIN
  SELECT c.record_id
    INTO v_canonical_after_delete
  FROM public.dim_canonical_record c
  WHERE c.active = true
    AND c.dedup_key_type = 'DOI'
    AND c.dedup_key = '10.7777/alpha.1';

  IF v_canonical_after_delete <> 'test-dedup-doi-semantic' THEN
    RAISE EXCEPTION 'Expected semantic_scholar to be re-elected canonical, got %', v_canonical_after_delete;
  END IF;
END;
$$;

ROLLBACK;
