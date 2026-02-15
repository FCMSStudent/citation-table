-- DOI-first deduplication subsystem
-- Implements deterministic canonical election, duplicate linking, auditability,
-- quality gates, and scheduled incremental/full rebuild jobs.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Priority/trust lookup for source-based tie-breaks and quality scoring.
CREATE TABLE IF NOT EXISTS public.dedup_source_priority (
  source TEXT PRIMARY KEY,
  priority INTEGER NOT NULL CHECK (priority > 0),
  trust_score NUMERIC(4,3) NOT NULL CHECK (trust_score >= 0 AND trust_score <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.dedup_source_priority (source, priority, trust_score)
VALUES
  ('pubmed', 1, 0.980),
  ('openalex', 2, 0.920),
  ('semantic_scholar', 3, 0.900),
  ('crossref', 4, 0.890),
  ('arxiv', 5, 0.840),
  ('unknown', 999, 0.500)
ON CONFLICT (source) DO UPDATE
SET priority = EXCLUDED.priority,
    trust_score = EXCLUDED.trust_score,
    updated_at = now();

-- Landing table: raw ingest snapshots are preserved as-is from upstream collectors.
CREATE TABLE IF NOT EXISTS public.raw_publication_ingest (
  record_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  raw_doi TEXT,
  title TEXT NOT NULL,
  authors TEXT[] NOT NULL DEFAULT '{}',
  pub_year INTEGER,
  citation_count INTEGER,
  aux_signal NUMERIC(8,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  ingest_run_id TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pub_year IS NULL OR (pub_year >= 1600 AND pub_year <= EXTRACT(YEAR FROM now())::INTEGER + 1))
);

CREATE INDEX IF NOT EXISTS idx_raw_publication_ingest_ingested_at
  ON public.raw_publication_ingest (ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_publication_ingest_source_updated_at
  ON public.raw_publication_ingest (source_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_publication_ingest_source_deleted
  ON public.raw_publication_ingest (source, is_deleted);

-- Normalized staging table used by dedup procedures.
CREATE TABLE IF NOT EXISTS public.stg_records_normalized (
  record_id TEXT PRIMARY KEY REFERENCES public.raw_publication_ingest(record_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ NOT NULL,
  raw_doi TEXT,
  doi_norm TEXT,
  doi_valid BOOLEAN NOT NULL DEFAULT false,
  title_norm TEXT NOT NULL,
  authors_norm TEXT,
  pub_year INTEGER,
  fingerprint TEXT NOT NULL,
  dedup_key_type TEXT NOT NULL CHECK (dedup_key_type IN ('DOI', 'FINGERPRINT')),
  dedup_key TEXT NOT NULL,
  metadata_completeness NUMERIC(6,5) NOT NULL,
  source_trust NUMERIC(6,5) NOT NULL,
  recency_score NUMERIC(6,5) NOT NULL,
  citation_aux_score NUMERIC(6,5) NOT NULL,
  quality_score NUMERIC(5,2) NOT NULL,
  source_deleted BOOLEAN NOT NULL DEFAULT false,
  ingest_run_id TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (pub_year IS NULL OR (pub_year >= 1600 AND pub_year <= EXTRACT(YEAR FROM now())::INTEGER + 1))
);

CREATE INDEX IF NOT EXISTS idx_stg_records_normalized_doi_norm
  ON public.stg_records_normalized (doi_norm) WHERE doi_valid = true;
CREATE INDEX IF NOT EXISTS idx_stg_records_normalized_dedup_key
  ON public.stg_records_normalized (dedup_key_type, dedup_key);
CREATE INDEX IF NOT EXISTS idx_stg_records_normalized_quality
  ON public.stg_records_normalized (quality_score DESC, source_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stg_records_normalized_active
  ON public.stg_records_normalized (source_deleted, dedup_key_type);

CREATE TABLE IF NOT EXISTS public.dim_canonical_record (
  canonical_id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES public.stg_records_normalized(record_id) ON DELETE CASCADE,
  dedup_key_type TEXT NOT NULL CHECK (dedup_key_type IN ('DOI', 'FINGERPRINT')),
  dedup_key TEXT NOT NULL,
  quality_score NUMERIC(5,2) NOT NULL,
  elected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true,
  run_id TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dim_canonical_record_active_key
  ON public.dim_canonical_record (dedup_key_type, dedup_key)
  WHERE active = true;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dim_canonical_record_active_record
  ON public.dim_canonical_record (record_id)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.fact_duplicate_link (
  record_id TEXT NOT NULL REFERENCES public.stg_records_normalized(record_id) ON DELETE CASCADE,
  canonical_id TEXT NOT NULL REFERENCES public.dim_canonical_record(canonical_id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true,
  run_id TEXT NOT NULL,
  PRIMARY KEY (record_id, canonical_id, run_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fact_duplicate_link_active_record
  ON public.fact_duplicate_link (record_id)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_fact_duplicate_link_active_canonical
  ON public.fact_duplicate_link (canonical_id)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.audit_dedup_decision (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id TEXT NOT NULL,
  record_id TEXT,
  action TEXT NOT NULL,
  prior_canonical_id TEXT,
  new_canonical_id TEXT,
  reason TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_dedup_decision_run_id
  ON public.audit_dedup_decision (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_dedup_decision_record_id
  ON public.audit_dedup_decision (record_id, created_at DESC)
  WHERE record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dedup_fingerprint_candidate_cache (
  record_id TEXT PRIMARY KEY REFERENCES public.stg_records_normalized(record_id) ON DELETE CASCADE,
  candidate_key TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dedup_fingerprint_cache_expiry
  ON public.dedup_fingerprint_candidate_cache (expires_at);

-- Optional labeled evaluation pairs for precision/recall estimates.
CREATE TABLE IF NOT EXISTS public.dedup_validation_samples (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  left_record_id TEXT NOT NULL REFERENCES public.stg_records_normalized(record_id) ON DELETE CASCADE,
  right_record_id TEXT NOT NULL REFERENCES public.stg_records_normalized(record_id) ON DELETE CASCADE,
  expected_duplicate BOOLEAN NOT NULL,
  note TEXT,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (left_record_id <> right_record_id),
  UNIQUE (left_record_id, right_record_id)
);

CREATE INDEX IF NOT EXISTS idx_dedup_validation_samples_reviewed_at
  ON public.dedup_validation_samples (reviewed_at DESC);

CREATE TABLE IF NOT EXISTS public.dedup_run_metrics (
  run_id TEXT PRIMARY KEY,
  run_ts TIMESTAMPTZ NOT NULL,
  duplicate_rate_by_source JSONB NOT NULL DEFAULT '{}'::jsonb,
  pct_missing_doi NUMERIC(6,3),
  pct_fallback_matched NUMERIC(6,3),
  canonical_churn_pct NUMERIC(6,3),
  estimated_precision NUMERIC(6,3),
  estimated_recall NUMERIC(6,3),
  validation_sample_size INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dedup_run_metrics_created_at
  ON public.dedup_run_metrics (created_at DESC);

-- Internal helper: best-effort Unicode normalization + punctuation cleanup.
CREATE OR REPLACE FUNCTION public.normalize_text(raw_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF raw_text IS NULL THEN
    RETURN NULL;
  END IF;

  cleaned := btrim(raw_text);

  -- Use built-in normalize(text, text) when available.
  IF to_regprocedure('normalize(text,text)') IS NOT NULL THEN
    EXECUTE 'SELECT normalize($1, $2)' INTO cleaned USING cleaned, 'NFKC';
  END IF;

  cleaned := lower(cleaned);
  cleaned := regexp_replace(cleaned, '[[:punct:]]+', ' ', 'g');
  cleaned := regexp_replace(cleaned, '\s+', ' ', 'g');
  cleaned := btrim(cleaned);

  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  RETURN cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_doi(raw_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  cleaned TEXT;
BEGIN
  IF raw_text IS NULL THEN
    RETURN NULL;
  END IF;

  cleaned := btrim(raw_text);

  IF to_regprocedure('normalize(text,text)') IS NOT NULL THEN
    EXECUTE 'SELECT normalize($1, $2)' INTO cleaned USING cleaned, 'NFKC';
  END IF;

  cleaned := lower(cleaned);
  cleaned := regexp_replace(cleaned, '^(https?://(dx\.)?doi\.org/)+', '');
  cleaned := regexp_replace(cleaned, '^doi:\s*', '');
  cleaned := regexp_replace(cleaned, '\s+', '', 'g');
  cleaned := regexp_replace(cleaned, '^[[:punct:]]+|[[:punct:]]+$', '', 'g');

  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  RETURN cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_valid_doi(doi TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT doi IS NOT NULL
    AND doi ~* '^10\.[0-9]{4,9}/[-._;()/:a-z0-9]+$';
$$;

CREATE OR REPLACE FUNCTION public.metadata_completeness_score(
  p_title TEXT,
  p_authors TEXT[],
  p_pub_year INTEGER,
  p_raw_doi TEXT,
  p_citation_count INTEGER
)
RETURNS NUMERIC(6,5)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    ((p_title IS NOT NULL AND btrim(p_title) <> '')::INT)
    + ((p_authors IS NOT NULL AND cardinality(p_authors) > 0)::INT)
    + ((p_pub_year IS NOT NULL)::INT)
    + ((p_raw_doi IS NOT NULL AND btrim(p_raw_doi) <> '')::INT)
    + ((COALESCE(p_citation_count, 0) > 0)::INT)
  )::NUMERIC / 5.0;
$$;

CREATE OR REPLACE FUNCTION public.citation_aux_score(
  p_citation_count INTEGER,
  p_aux_signal NUMERIC
)
RETURNS NUMERIC(6,5)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LEAST(
    1.0,
    GREATEST(0.0, LN(1 + GREATEST(COALESCE(p_citation_count, 0), 0)) / LN(1 + 500.0))
    + GREATEST(COALESCE(p_aux_signal, 0.0), 0.0)
  )::NUMERIC(6,5);
$$;

CREATE OR REPLACE FUNCTION public.recency_score(
  p_source_updated_at TIMESTAMPTZ,
  p_anchor_ts TIMESTAMPTZ DEFAULT now()
)
RETURNS NUMERIC(6,5)
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_source_updated_at IS NULL THEN 0.0::NUMERIC(6,5)
    ELSE GREATEST(
      0.0,
      LEAST(
        1.0,
        EXP(-EXTRACT(EPOCH FROM (p_anchor_ts - p_source_updated_at)) / 31557600.0)
      )
    )::NUMERIC(6,5)
  END;
$$;

CREATE OR REPLACE FUNCTION public.record_quality_score(
  metadata_completeness NUMERIC,
  source_trust NUMERIC,
  recency_score NUMERIC,
  citation_aux_score NUMERIC
)
RETURNS NUMERIC(5,2)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(
    (
      0.40 * GREATEST(0.0, LEAST(1.0, COALESCE(metadata_completeness, 0.0)))
      + 0.30 * GREATEST(0.0, LEAST(1.0, COALESCE(source_trust, 0.0)))
      + 0.20 * GREATEST(0.0, LEAST(1.0, COALESCE(recency_score, 0.0)))
      + 0.10 * GREATEST(0.0, LEAST(1.0, COALESCE(citation_aux_score, 0.0)))
    ) * 100.0,
    2
  )::NUMERIC(5,2);
$$;

CREATE OR REPLACE FUNCTION public.build_fingerprint(
  p_title_norm TEXT,
  p_authors_norm TEXT,
  p_pub_year INTEGER
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      COALESCE(p_title_norm, '') || '|' || COALESCE(p_authors_norm, '') || '|' || COALESCE(p_pub_year::TEXT, ''),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public.dedup_author_overlap(
  left_authors TEXT,
  right_authors TEXT
)
RETURNS NUMERIC(4,3)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH left_tokens AS (
    SELECT DISTINCT token
    FROM (
      SELECT btrim(value) AS token
      FROM regexp_split_to_table(COALESCE(left_authors, ''), '\\|') AS value
    ) s
    WHERE token <> ''
  ),
  right_tokens AS (
    SELECT DISTINCT token
    FROM (
      SELECT btrim(value) AS token
      FROM regexp_split_to_table(COALESCE(right_authors, ''), '\\|') AS value
    ) s
    WHERE token <> ''
  ),
  overlap AS (
    SELECT COUNT(*)::NUMERIC AS cnt
    FROM left_tokens lt
    INNER JOIN right_tokens rt USING (token)
  ),
  counts AS (
    SELECT
      (SELECT COUNT(*)::NUMERIC FROM left_tokens) AS left_cnt,
      (SELECT COUNT(*)::NUMERIC FROM right_tokens) AS right_cnt
  )
  SELECT CASE
    WHEN LEAST(left_cnt, right_cnt) = 0 THEN 0.0::NUMERIC(4,3)
    ELSE ROUND((SELECT cnt FROM overlap) / LEAST(left_cnt, right_cnt), 3)::NUMERIC(4,3)
  END
  FROM counts;
$$;

-- Core dedup routine shared by incremental and full-rebuild procedures.
CREATE OR REPLACE FUNCTION public.refresh_dedup_snapshot(
  p_run_id TEXT,
  p_run_ts TIMESTAMPTZ,
  p_full BOOLEAN,
  p_window_start TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_missing_doi_pct NUMERIC(6,3);
  v_fallback_match_pct NUMERIC(6,3);
  v_canonical_churn_pct NUMERIC(6,3);
  v_estimated_precision NUMERIC(6,3);
  v_estimated_recall NUMERIC(6,3);
  v_validation_sample_size INTEGER;
  v_duplicate_rate_by_source JSONB;
BEGIN
  -- Refresh normalized staging rows from landing ingestion.
  -- Ensure repeatable execution within the same transaction/session.
  DROP TABLE IF EXISTS tmp_fp_records;
  DROP TABLE IF EXISTS tmp_fp_edges;
  DROP TABLE IF EXISTS tmp_fp_graph;
  DROP TABLE IF EXISTS tmp_fp_cluster_roots;
  DROP TABLE IF EXISTS tmp_fp_cluster_assignment;
  DROP TABLE IF EXISTS tmp_active_records;
  DROP TABLE IF EXISTS tmp_prior_canonical;
  DROP TABLE IF EXISTS tmp_new_canonical;

  DELETE FROM public.stg_records_normalized s
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.raw_publication_ingest r
    WHERE r.record_id = s.record_id
  );

  -- Refresh normalized staging rows from landing ingestion.
  INSERT INTO public.stg_records_normalized (
    record_id,
    source,
    source_updated_at,
    raw_doi,
    doi_norm,
    doi_valid,
    title_norm,
    authors_norm,
    pub_year,
    fingerprint,
    dedup_key_type,
    dedup_key,
    metadata_completeness,
    source_trust,
    recency_score,
    citation_aux_score,
    quality_score,
    source_deleted,
    ingest_run_id,
    ingested_at,
    updated_at
  )
  SELECT
    r.record_id,
    r.source,
    r.source_updated_at,
    r.raw_doi,
    public.normalize_doi(r.raw_doi) AS doi_norm,
    public.is_valid_doi(public.normalize_doi(r.raw_doi)) AS doi_valid,
    COALESCE(public.normalize_text(r.title), '') AS title_norm,
    NULLIF(
      ARRAY_TO_STRING(
        ARRAY(
          SELECT public.normalize_text(author_name)
          FROM unnest(COALESCE(r.authors, '{}')) WITH ORDINALITY AS a(author_name, ord)
          WHERE author_name IS NOT NULL
            AND btrim(author_name) <> ''
          ORDER BY ord
          LIMIT 3
        ),
        '|'
      ),
      ''
    ) AS authors_norm,
    r.pub_year,
    public.build_fingerprint(
      COALESCE(public.normalize_text(r.title), ''),
      NULLIF(
        ARRAY_TO_STRING(
          ARRAY(
            SELECT public.normalize_text(author_name)
            FROM unnest(COALESCE(r.authors, '{}')) WITH ORDINALITY AS a(author_name, ord)
            WHERE author_name IS NOT NULL
              AND btrim(author_name) <> ''
            ORDER BY ord
            LIMIT 3
          ),
          '|'
        ),
        ''
      ),
      r.pub_year
    ) AS fingerprint,
    CASE
      WHEN public.is_valid_doi(public.normalize_doi(r.raw_doi)) THEN 'DOI'
      ELSE 'FINGERPRINT'
    END AS dedup_key_type,
    CASE
      WHEN public.is_valid_doi(public.normalize_doi(r.raw_doi)) THEN public.normalize_doi(r.raw_doi)
      ELSE public.build_fingerprint(
        COALESCE(public.normalize_text(r.title), ''),
        NULLIF(
          ARRAY_TO_STRING(
            ARRAY(
              SELECT public.normalize_text(author_name)
              FROM unnest(COALESCE(r.authors, '{}')) WITH ORDINALITY AS a(author_name, ord)
              WHERE author_name IS NOT NULL
                AND btrim(author_name) <> ''
              ORDER BY ord
              LIMIT 3
            ),
            '|'
          ),
          ''
        ),
        r.pub_year
      )
    END AS dedup_key,
    public.metadata_completeness_score(r.title, r.authors, r.pub_year, r.raw_doi, r.citation_count) AS metadata_completeness,
    COALESCE(sp.trust_score, 0.500)::NUMERIC(6,5) AS source_trust,
    public.recency_score(r.source_updated_at, p_run_ts) AS recency_score,
    public.citation_aux_score(r.citation_count, r.aux_signal) AS citation_aux_score,
    public.record_quality_score(
      public.metadata_completeness_score(r.title, r.authors, r.pub_year, r.raw_doi, r.citation_count),
      COALESCE(sp.trust_score, 0.500),
      public.recency_score(r.source_updated_at, p_run_ts),
      public.citation_aux_score(r.citation_count, r.aux_signal)
    ) AS quality_score,
    r.is_deleted AS source_deleted,
    r.ingest_run_id,
    r.ingested_at,
    now() AS updated_at
  FROM public.raw_publication_ingest r
  LEFT JOIN public.dedup_source_priority sp ON sp.source = r.source
  WHERE p_full
     OR r.ingested_at >= p_window_start
     OR r.source_updated_at >= p_window_start
  ON CONFLICT (record_id) DO UPDATE
  SET source = EXCLUDED.source,
      source_updated_at = EXCLUDED.source_updated_at,
      raw_doi = EXCLUDED.raw_doi,
      doi_norm = EXCLUDED.doi_norm,
      doi_valid = EXCLUDED.doi_valid,
      title_norm = EXCLUDED.title_norm,
      authors_norm = EXCLUDED.authors_norm,
      pub_year = EXCLUDED.pub_year,
      fingerprint = EXCLUDED.fingerprint,
      dedup_key_type = EXCLUDED.dedup_key_type,
      dedup_key = EXCLUDED.dedup_key,
      metadata_completeness = EXCLUDED.metadata_completeness,
      source_trust = EXCLUDED.source_trust,
      recency_score = EXCLUDED.recency_score,
      citation_aux_score = EXCLUDED.citation_aux_score,
      quality_score = EXCLUDED.quality_score,
      source_deleted = EXCLUDED.source_deleted,
      ingest_run_id = EXCLUDED.ingest_run_id,
      ingested_at = EXCLUDED.ingested_at,
      updated_at = now();

  -- Retention for fallback candidate cache.
  DELETE FROM public.dedup_fingerprint_candidate_cache
  WHERE expires_at < p_run_ts;

  -- Fingerprint candidate generation with title similarity + author overlap gate.
  CREATE TEMP TABLE tmp_fp_records ON COMMIT DROP AS
  SELECT
    s.record_id,
    s.title_norm,
    s.authors_norm,
    s.pub_year,
    s.fingerprint
  FROM public.stg_records_normalized s
  WHERE s.dedup_key_type = 'FINGERPRINT'
    AND s.source_deleted = false;

  CREATE TEMP TABLE tmp_fp_edges ON COMMIT DROP AS
  SELECT
    a.record_id AS record_id_a,
    b.record_id AS record_id_b,
    similarity(a.title_norm, b.title_norm)::NUMERIC(4,3) AS title_similarity,
    public.dedup_author_overlap(a.authors_norm, b.authors_norm) AS author_overlap
  FROM tmp_fp_records a
  INNER JOIN tmp_fp_records b ON a.record_id < b.record_id
  WHERE a.pub_year IS NOT DISTINCT FROM b.pub_year
    AND similarity(a.title_norm, b.title_norm) >= 0.92
    AND public.dedup_author_overlap(a.authors_norm, b.authors_norm) >= 0.50;

  CREATE TEMP TABLE tmp_fp_graph ON COMMIT DROP AS
  SELECT
    record_id_a AS src,
    record_id_b AS dst,
    title_similarity,
    author_overlap
  FROM tmp_fp_edges
  UNION ALL
  SELECT
    record_id_b AS src,
    record_id_a AS dst,
    title_similarity,
    author_overlap
  FROM tmp_fp_edges;

  CREATE TEMP TABLE tmp_fp_cluster_roots ON COMMIT DROP AS
  WITH RECURSIVE reach(root, member) AS (
    SELECT record_id, record_id
    FROM tmp_fp_records
    UNION
    SELECT r.root, g.dst
    FROM reach r
    INNER JOIN tmp_fp_graph g ON g.src = r.member
  )
  SELECT
    member AS record_id,
    MIN(root) AS cluster_root
  FROM reach
  GROUP BY member;

  CREATE TEMP TABLE tmp_fp_cluster_assignment ON COMMIT DROP AS
  WITH cluster_agg AS (
    SELECT
      c.cluster_root,
      MIN(fr.fingerprint) AS min_fingerprint,
      COUNT(*) AS cluster_size
    FROM tmp_fp_cluster_roots c
    INNER JOIN tmp_fp_records fr ON fr.record_id = c.record_id
    GROUP BY c.cluster_root
  ),
  cluster_confidence AS (
    SELECT
      c.record_id,
      c.cluster_root,
      CASE
        WHEN ca.cluster_size = 1 THEN 1.000::NUMERIC(4,3)
        ELSE COALESCE(
          (
            SELECT GREATEST(0.920::NUMERIC, MAX(g.title_similarity))::NUMERIC(4,3)
            FROM tmp_fp_graph g
            INNER JOIN tmp_fp_cluster_roots c2 ON c2.record_id = g.dst
            WHERE g.src = c.record_id
              AND c2.cluster_root = c.cluster_root
          ),
          0.920::NUMERIC(4,3)
        )
      END AS confidence
    FROM tmp_fp_cluster_roots c
    INNER JOIN cluster_agg ca ON ca.cluster_root = c.cluster_root
  )
  SELECT
    c.record_id,
    'fp:' || encode(digest(ca.min_fingerprint, 'sha256'), 'hex') AS dedup_key,
    cc.confidence
  FROM tmp_fp_cluster_roots c
  INNER JOIN cluster_agg ca ON ca.cluster_root = c.cluster_root
  INNER JOIN cluster_confidence cc ON cc.record_id = c.record_id;

  UPDATE public.stg_records_normalized s
  SET dedup_key = a.dedup_key,
      updated_at = now()
  FROM tmp_fp_cluster_assignment a
  WHERE s.record_id = a.record_id
    AND s.dedup_key_type = 'FINGERPRINT';

  INSERT INTO public.dedup_fingerprint_candidate_cache (
    record_id,
    candidate_key,
    confidence,
    expires_at,
    created_at
  )
  SELECT
    record_id,
    dedup_key,
    confidence,
    p_run_ts + interval '365 days',
    now()
  FROM tmp_fp_cluster_assignment
  ON CONFLICT (record_id) DO UPDATE
  SET candidate_key = EXCLUDED.candidate_key,
      confidence = EXCLUDED.confidence,
      expires_at = EXCLUDED.expires_at,
      created_at = now();

  CREATE TEMP TABLE tmp_active_records ON COMMIT DROP AS
  SELECT
    s.*,
    COALESCE(sp.priority, 9999) AS source_priority
  FROM public.stg_records_normalized s
  LEFT JOIN public.dedup_source_priority sp ON sp.source = s.source
  WHERE s.source_deleted = false;

  CREATE TEMP TABLE tmp_prior_canonical ON COMMIT DROP AS
  SELECT canonical_id, record_id
  FROM public.dim_canonical_record
  WHERE active = true;

  CREATE TEMP TABLE tmp_new_canonical ON COMMIT DROP AS
  WITH ranked AS (
    SELECT
      'canon:' || encode(digest(a.dedup_key_type || '|' || a.dedup_key, 'sha256'), 'hex') AS canonical_id,
      a.record_id,
      a.dedup_key_type,
      a.dedup_key,
      a.quality_score,
      ROW_NUMBER() OVER (
        PARTITION BY a.dedup_key_type, a.dedup_key
        ORDER BY
          a.quality_score DESC,
          a.source_updated_at DESC,
          a.source_priority ASC,
          a.record_id ASC
      ) AS rn
    FROM tmp_active_records a
  )
  SELECT
    canonical_id,
    record_id,
    dedup_key_type,
    dedup_key,
    quality_score
  FROM ranked
  WHERE rn = 1;

  UPDATE public.dim_canonical_record
  SET active = false
  WHERE active = true;

  INSERT INTO public.dim_canonical_record (
    canonical_id,
    record_id,
    dedup_key_type,
    dedup_key,
    quality_score,
    elected_at,
    active,
    run_id
  )
  SELECT
    canonical_id,
    record_id,
    dedup_key_type,
    dedup_key,
    quality_score,
    p_run_ts,
    true,
    p_run_id
  FROM tmp_new_canonical
  ON CONFLICT (canonical_id) DO UPDATE
  SET record_id = EXCLUDED.record_id,
      dedup_key_type = EXCLUDED.dedup_key_type,
      dedup_key = EXCLUDED.dedup_key,
      quality_score = EXCLUDED.quality_score,
      elected_at = EXCLUDED.elected_at,
      active = true,
      run_id = EXCLUDED.run_id;

  INSERT INTO public.audit_dedup_decision (
    run_id,
    record_id,
    action,
    prior_canonical_id,
    new_canonical_id,
    reason,
    details,
    created_at
  )
  SELECT
    p_run_id,
    n.record_id,
    CASE
      WHEN p.canonical_id IS NULL THEN 'CANONICAL_ELECTED'
      ELSE 'CANONICAL_REELECTED'
    END AS action,
    p.canonical_id,
    n.canonical_id,
    CASE
      WHEN p.canonical_id IS NULL THEN 'initial_election'
      WHEN prev_record.source_deleted THEN 'prior_canonical_inactive'
      ELSE 'quality_or_tie_break'
    END AS reason,
    jsonb_build_object(
      'prior_record_id', p.record_id,
      'new_record_id', n.record_id,
      'new_quality_score', n.quality_score,
      'prior_source_deleted', COALESCE(prev_record.source_deleted, false)
    ),
    now()
  FROM tmp_new_canonical n
  LEFT JOIN tmp_prior_canonical p ON p.canonical_id = n.canonical_id
  LEFT JOIN public.stg_records_normalized prev_record ON prev_record.record_id = p.record_id
  WHERE p.canonical_id IS NULL OR p.record_id <> n.record_id;

  INSERT INTO public.audit_dedup_decision (
    run_id,
    record_id,
    action,
    prior_canonical_id,
    new_canonical_id,
    reason,
    details,
    created_at
  )
  SELECT
    p_run_id,
    p.record_id,
    'CANONICAL_DEACTIVATED',
    p.canonical_id,
    NULL,
    'no_active_candidates',
    jsonb_build_object('prior_record_id', p.record_id),
    now()
  FROM tmp_prior_canonical p
  LEFT JOIN tmp_new_canonical n ON n.canonical_id = p.canonical_id
  WHERE n.canonical_id IS NULL;

  UPDATE public.fact_duplicate_link
  SET active = false
  WHERE active = true;

  INSERT INTO public.fact_duplicate_link (
    record_id,
    canonical_id,
    reason,
    confidence,
    linked_at,
    active,
    run_id
  )
  SELECT
    a.record_id,
    c.canonical_id,
    CASE
      WHEN a.dedup_key_type = 'DOI' THEN 'EXACT_DOI_MATCH'
      ELSE 'FINGERPRINT_SIMILARITY_MATCH'
    END AS reason,
    CASE
      WHEN a.dedup_key_type = 'DOI' THEN 1.000::NUMERIC(4,3)
      ELSE COALESCE(cache.confidence, 0.920::NUMERIC(4,3))
    END AS confidence,
    p_run_ts,
    true,
    p_run_id
  FROM tmp_active_records a
  INNER JOIN public.dim_canonical_record c
    ON c.active = true
   AND c.dedup_key_type = a.dedup_key_type
   AND c.dedup_key = a.dedup_key
  LEFT JOIN public.dedup_fingerprint_candidate_cache cache
    ON cache.record_id = a.record_id
  WHERE a.record_id <> c.record_id
  ON CONFLICT (record_id, canonical_id, run_id) DO UPDATE
  SET reason = EXCLUDED.reason,
      confidence = EXCLUDED.confidence,
      linked_at = EXCLUDED.linked_at,
      active = true;

  WITH src_stats AS (
    SELECT
      s.source,
      COUNT(*)::NUMERIC AS total_rows,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM public.fact_duplicate_link f
          WHERE f.record_id = s.record_id
            AND f.active = true
        )
      )::NUMERIC AS duplicate_rows
    FROM public.stg_records_normalized s
    WHERE s.source_deleted = false
    GROUP BY s.source
  )
  SELECT COALESCE(
    jsonb_object_agg(
      source,
      ROUND((duplicate_rows / NULLIF(total_rows, 0)) * 100.0, 3)
    ),
    '{}'::jsonb
  )
  INTO v_duplicate_rate_by_source
  FROM src_stats;

  WITH counts AS (
    SELECT
      COUNT(*)::NUMERIC AS total_rows,
      COUNT(*) FILTER (WHERE doi_valid = false)::NUMERIC AS missing_doi_rows
    FROM public.stg_records_normalized
    WHERE source_deleted = false
  )
  SELECT ROUND((missing_doi_rows / NULLIF(total_rows, 0)) * 100.0, 3)
  INTO v_missing_doi_pct
  FROM counts;

  WITH counts AS (
    SELECT
      COUNT(*) FILTER (WHERE s.dedup_key_type = 'FINGERPRINT')::NUMERIC AS fallback_rows,
      COUNT(*) FILTER (
        WHERE s.dedup_key_type = 'FINGERPRINT'
          AND EXISTS (
            SELECT 1
            FROM public.fact_duplicate_link f
            WHERE f.record_id = s.record_id
              AND f.active = true
          )
      )::NUMERIC AS fallback_linked_rows
    FROM public.stg_records_normalized s
    WHERE s.source_deleted = false
  )
  SELECT ROUND((fallback_linked_rows / NULLIF(fallback_rows, 0)) * 100.0, 3)
  INTO v_fallback_match_pct
  FROM counts;

  WITH churn AS (
    SELECT
      COUNT(*)::NUMERIC AS total_groups,
      COUNT(*) FILTER (WHERE p.record_id IS NOT NULL AND p.record_id <> n.record_id)::NUMERIC AS changed_groups
    FROM tmp_new_canonical n
    LEFT JOIN tmp_prior_canonical p ON p.canonical_id = n.canonical_id
  )
  SELECT ROUND((changed_groups / NULLIF(total_groups, 0)) * 100.0, 3)
  INTO v_canonical_churn_pct
  FROM churn;

  WITH labeled AS (
    SELECT
      sample.expected_duplicate,
      (
        l.dedup_key_type = r.dedup_key_type
        AND l.dedup_key = r.dedup_key
      ) AS predicted_duplicate
    FROM public.dedup_validation_samples sample
    INNER JOIN public.stg_records_normalized l ON l.record_id = sample.left_record_id
    INNER JOIN public.stg_records_normalized r ON r.record_id = sample.right_record_id
    WHERE l.source_deleted = false
      AND r.source_deleted = false
  ),
  confusion AS (
    SELECT
      COUNT(*) FILTER (WHERE expected_duplicate = true AND predicted_duplicate = true)::NUMERIC AS tp,
      COUNT(*) FILTER (WHERE expected_duplicate = false AND predicted_duplicate = true)::NUMERIC AS fp,
      COUNT(*) FILTER (WHERE expected_duplicate = true AND predicted_duplicate = false)::NUMERIC AS fn,
      COUNT(*)::INTEGER AS sample_size
    FROM labeled
  )
  SELECT
    ROUND((tp / NULLIF(tp + fp, 0)) * 100.0, 3),
    ROUND((tp / NULLIF(tp + fn, 0)) * 100.0, 3),
    sample_size
  INTO v_estimated_precision, v_estimated_recall, v_validation_sample_size
  FROM confusion;

  INSERT INTO public.dedup_run_metrics (
    run_id,
    run_ts,
    duplicate_rate_by_source,
    pct_missing_doi,
    pct_fallback_matched,
    canonical_churn_pct,
    estimated_precision,
    estimated_recall,
    validation_sample_size,
    created_at
  )
  VALUES (
    p_run_id,
    p_run_ts,
    COALESCE(v_duplicate_rate_by_source, '{}'::jsonb),
    v_missing_doi_pct,
    v_fallback_match_pct,
    v_canonical_churn_pct,
    v_estimated_precision,
    v_estimated_recall,
    v_validation_sample_size,
    now()
  )
  ON CONFLICT (run_id) DO UPDATE
  SET run_ts = EXCLUDED.run_ts,
      duplicate_rate_by_source = EXCLUDED.duplicate_rate_by_source,
      pct_missing_doi = EXCLUDED.pct_missing_doi,
      pct_fallback_matched = EXCLUDED.pct_fallback_matched,
      canonical_churn_pct = EXCLUDED.canonical_churn_pct,
      estimated_precision = EXCLUDED.estimated_precision,
      estimated_recall = EXCLUDED.estimated_recall,
      validation_sample_size = EXCLUDED.validation_sample_size,
      created_at = now();

  -- Acceptance gate: block publish if sample-based estimates are below thresholds.
  IF v_estimated_precision IS NOT NULL AND v_estimated_precision < 99.0 THEN
    RAISE EXCEPTION 'Dedup quality gate failed: estimated precision % < 99.0', v_estimated_precision;
  END IF;

  IF v_estimated_recall IS NOT NULL AND v_estimated_recall < 97.0 THEN
    RAISE EXCEPTION 'Dedup quality gate failed: estimated recall % < 97.0', v_estimated_recall;
  END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE public.sp_dedup_incremental(run_ts TIMESTAMPTZ DEFAULT now())
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id TEXT;
BEGIN
  v_run_id := 'inc_' || to_char(run_ts AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS');

  -- Idempotent reruns for the same run timestamp.
  DELETE FROM public.audit_dedup_decision WHERE run_id = v_run_id;

  INSERT INTO public.audit_dedup_decision (
    run_id,
    record_id,
    action,
    reason,
    details,
    created_at
  )
  VALUES (
    v_run_id,
    NULL,
    'RUN_STARTED',
    'incremental',
    jsonb_build_object('run_ts', run_ts),
    now()
  );

  BEGIN
    PERFORM public.refresh_dedup_snapshot(
      p_run_id => v_run_id,
      p_run_ts => run_ts,
      p_full => false,
      p_window_start => run_ts - interval '2 hours'
    );

    INSERT INTO public.audit_dedup_decision (
      run_id,
      record_id,
      action,
      reason,
      details,
      created_at
    )
    VALUES (
      v_run_id,
      NULL,
      'RUN_COMPLETED',
      'incremental_success',
      jsonb_build_object('run_ts', run_ts),
      now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.audit_dedup_decision (
        run_id,
        record_id,
        action,
        reason,
        details,
        created_at
      )
      VALUES (
        v_run_id,
        NULL,
        'RUN_FAILED',
        'incremental_failure',
        jsonb_build_object(
          'run_ts', run_ts,
          'sqlstate', SQLSTATE,
          'message', SQLERRM
        ),
        now()
      );
  END;
END;
$$;

CREATE OR REPLACE PROCEDURE public.sp_dedup_full_rebuild(run_ts TIMESTAMPTZ DEFAULT now())
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id TEXT;
BEGIN
  v_run_id := 'full_' || to_char(run_ts AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS');

  DELETE FROM public.audit_dedup_decision WHERE run_id = v_run_id;

  INSERT INTO public.audit_dedup_decision (
    run_id,
    record_id,
    action,
    reason,
    details,
    created_at
  )
  VALUES (
    v_run_id,
    NULL,
    'RUN_STARTED',
    'full_rebuild',
    jsonb_build_object('run_ts', run_ts),
    now()
  );

  BEGIN
    PERFORM public.refresh_dedup_snapshot(
      p_run_id => v_run_id,
      p_run_ts => run_ts,
      p_full => true,
      p_window_start => '-infinity'::timestamptz
    );

    INSERT INTO public.audit_dedup_decision (
      run_id,
      record_id,
      action,
      reason,
      details,
      created_at
    )
    VALUES (
      v_run_id,
      NULL,
      'RUN_COMPLETED',
      'full_rebuild_success',
      jsonb_build_object('run_ts', run_ts),
      now()
    );
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.audit_dedup_decision (
        run_id,
        record_id,
        action,
        reason,
        details,
        created_at
      )
      VALUES (
        v_run_id,
        NULL,
        'RUN_FAILED',
        'full_rebuild_failure',
        jsonb_build_object(
          'run_ts', run_ts,
          'sqlstate', SQLSTATE,
          'message', SQLERRM
        ),
        now()
      );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_dedup_snapshot(TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON PROCEDURE public.sp_dedup_incremental(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON PROCEDURE public.sp_dedup_full_rebuild(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_dedup_snapshot(TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON PROCEDURE public.sp_dedup_incremental(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON PROCEDURE public.sp_dedup_full_rebuild(TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE VIEW public.vw_records_serving AS
SELECT
  c.canonical_id,
  s.record_id,
  s.source,
  s.source_updated_at,
  s.raw_doi,
  s.doi_norm,
  s.doi_valid,
  s.title_norm,
  s.authors_norm,
  s.pub_year,
  s.quality_score,
  s.dedup_key_type,
  s.dedup_key,
  s.ingest_run_id,
  s.ingested_at,
  c.elected_at AS canonical_elected_at
FROM public.dim_canonical_record c
INNER JOIN public.stg_records_normalized s ON s.record_id = c.record_id
WHERE c.active = true
  AND s.source_deleted = false;

-- Secure dedup internals to service role workflows.
ALTER TABLE public.raw_publication_ingest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stg_records_normalized ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_canonical_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fact_duplicate_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_dedup_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dedup_fingerprint_candidate_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dedup_validation_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dedup_run_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dedup_source_priority ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON public.raw_publication_ingest;
DROP POLICY IF EXISTS "Service role only" ON public.stg_records_normalized;
DROP POLICY IF EXISTS "Service role only" ON public.dim_canonical_record;
DROP POLICY IF EXISTS "Service role only" ON public.fact_duplicate_link;
DROP POLICY IF EXISTS "Service role only" ON public.audit_dedup_decision;
DROP POLICY IF EXISTS "Service role only" ON public.dedup_fingerprint_candidate_cache;
DROP POLICY IF EXISTS "Service role only" ON public.dedup_validation_samples;
DROP POLICY IF EXISTS "Service role only" ON public.dedup_run_metrics;
DROP POLICY IF EXISTS "Service role only" ON public.dedup_source_priority;

CREATE POLICY "Service role only"
  ON public.raw_publication_ingest FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY "Service role only"
  ON public.stg_records_normalized FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY "Service role only"
  ON public.dim_canonical_record FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY "Service role only"
  ON public.fact_duplicate_link FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY "Service role only"
  ON public.audit_dedup_decision FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY "Service role only"
  ON public.dedup_fingerprint_candidate_cache FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY "Service role only"
  ON public.dedup_validation_samples FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY "Service role only"
  ON public.dedup_run_metrics FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY "Service role only"
  ON public.dedup_source_priority FOR ALL
  USING (false) WITH CHECK (false);

-- Schedule jobs when pg_cron is installed. Cron expressions run in database timezone.
DO $$
DECLARE
  job RECORD;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    FOR job IN
      SELECT jobid
      FROM cron.job
      WHERE jobname IN ('dedup_incremental_2h', 'dedup_full_daily_2am')
    LOOP
      PERFORM cron.unschedule(job.jobid);
    END LOOP;

    PERFORM cron.schedule(
      'dedup_incremental_2h',
      '0 */2 * * *',
      'CALL public.sp_dedup_incremental(now());'
    );

    PERFORM cron.schedule(
      'dedup_full_daily_2am',
      '0 2 * * *',
      'CALL public.sp_dedup_full_rebuild(now());'
    );
  END IF;
END;
$$;
