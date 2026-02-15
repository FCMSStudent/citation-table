# DOI Deduplication Operations

This project implements a DOI-first dedup subsystem in migration:

- `supabase/migrations/20260215112000_doi_dedup_strategy.sql`

## Objects Created

- UDFs:
  - `public.normalize_doi(raw_text text) -> text`
  - `public.is_valid_doi(doi text) -> boolean`
  - `public.record_quality_score(metadata_completeness, source_trust, recency_score, citation_aux_score) -> numeric(5,2)`
- Tables:
  - `public.raw_publication_ingest`
  - `public.stg_records_normalized`
  - `public.dim_canonical_record`
  - `public.fact_duplicate_link`
  - `public.audit_dedup_decision`
  - `public.dedup_fingerprint_candidate_cache`
  - `public.dedup_run_metrics`
  - `public.dedup_validation_samples`
  - `public.dedup_source_priority`
- View:
  - `public.vw_records_serving`
- Procedures:
  - `public.sp_dedup_incremental(run_ts timestamptz)`
  - `public.sp_dedup_full_rebuild(run_ts timestamptz)`

## Ingestion Contract

Insert source records into `public.raw_publication_ingest`.

```sql
insert into public.raw_publication_ingest (
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
  ingest_run_id
)
values (
  'src-123',
  'openalex',
  now(),
  'https://doi.org/10.1000/xyz',
  'Paper title',
  array['Smith J', 'Doe A'],
  2025,
  42,
  0.01,
  '{}'::jsonb,
  false,
  'ingest-2026-02-15T12:00:00Z'
);
```

## Run Dedup

Incremental (2-hour window):

```sql
call public.sp_dedup_incremental(now());
```

Full rebuild:

```sql
call public.sp_dedup_full_rebuild(now());
```

## Serving Output

Query canonical records only:

```sql
select *
from public.vw_records_serving
order by canonical_elected_at desc;
```

Duplicates are available in `public.fact_duplicate_link` (`active = true`).

## Backfill Strategy (Oldest to Newest)

Recommended sequence:

1. Bulk load historical years into `raw_publication_ingest` oldest-first.
2. Run `sp_dedup_full_rebuild` after each historical chunk.
3. Start steady-state with `sp_dedup_incremental` every 2 hours.

## Quality Gate

`refresh_dedup_snapshot` computes run metrics into `public.dedup_run_metrics` and enforces:

- precision `>= 99.0`
- recall `>= 97.0`

when `dedup_validation_samples` has labeled data.

If a run fails, existing active canonical snapshot remains unchanged and a `RUN_FAILED` entry is written to `audit_dedup_decision`.

## Scheduling

When `pg_cron` is installed, migration auto-schedules:

- incremental: every 2 hours
- full rebuild: daily at 02:00 (database timezone)

