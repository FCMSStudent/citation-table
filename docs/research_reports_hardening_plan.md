# research_reports hardening plan

## Safe backfill strategy

1. Deploy schema additions first (new columns nullable, expanded status check, JSON defaults).
2. Run backfill in controlled batches if table volume is large:
   - Batch key: `id` (or `created_at` window).
   - Batch shape: update rows where any target JSON column is null, `status = 'completed' AND completed_at IS NULL`, or `request_hash/pipeline_version` is null.
   - Keep transactions small (for example 1k to 10k rows per batch).
3. After backfill reaches zero remaining rows, enforce `NOT NULL` on JSON columns and validate `completed => completed_at`.
4. Add unique partial index on `(user_id, idempotency_key)` only after application paths are writing deterministic idempotency keys.

## Rollback-safe migration plan

1. Use an expand-contract rollout:
   - Expand (this migration): add compatible columns + broaden status states.
   - Application rollout: write new fields (`idempotency_key`, `request_hash`, `pipeline_version`, `error_category`) while still tolerating old rows.
   - Contract (future): tighten additional nullability rules only when writes are fully migrated.
2. If application rollback is required:
   - Keep this schema in place (it is backward compatible with old writers that still send `processing/completed/failed`).
   - Disable any new code path that depends on `queued/timed_out/cancelled` semantics.
3. Emergency database rollback (only if absolutely required):
   - Drop `idx_research_reports_user_id_idempotency_key`.
   - Drop `research_reports_completed_requires_completed_at`.
   - Revert `status` default to `processing`.
   - Replace status check with legacy values `('processing','completed','failed')` only after confirming there are no rows using new statuses.

## Post-migration verification queries

```sql
-- New status values should all satisfy the check.
SELECT status, count(*)
FROM public.research_reports
GROUP BY status
ORDER BY status;

-- Should return 0.
SELECT count(*) AS completed_without_timestamp
FROM public.research_reports
WHERE status = 'completed' AND completed_at IS NULL;

-- Should return 0 after backfill.
SELECT count(*) AS json_null_violations
FROM public.research_reports
WHERE results IS NULL
   OR lit_request IS NULL
   OR lit_response IS NULL
   OR coverage_report IS NULL
   OR evidence_table IS NULL
   OR brief_json IS NULL
   OR search_stats IS NULL
   OR query_processing_meta IS NULL;
```
