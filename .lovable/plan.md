

# Add Studies by DOI + Fix Build Errors

## Overview

Add a manual "Add Study" feature to completed reports, allowing users to include additional studies by entering a DOI. This also fixes all 13 existing build errors blocking deployment.

---

## Part 1: Fix Build Errors (prerequisite)

These must be resolved before any new features can deploy.

### 1a. Fix `process` references in shared modules

**Files:** `supabase/functions/_shared/metadata-enrichment.ts`, `supabase/functions/_shared/query-processing.ts`

Replace bare `process` references with the same `(globalThis as any)` guard pattern already used for Deno, so the Deno type checker doesn't error:

```typescript
// Before (fails):
if (typeof process !== "undefined" && process?.env) {
  return process.env[name];
}

// After (safe):
try {
  if (typeof (globalThis as any).process !== "undefined") {
    return (globalThis as any).process.env?.[name];
  }
} catch (_) {}
```

### 1b. Fix SupabaseClient type mismatch in `research-async`

Cast the `supabase` client to `any` at the call sites for `checkRateLimit`, `readCachedSearch`, `writeSearchCache`, `upsertPaperCache`, and `recordQueryProcessingEvent` (lines ~1729-1850).

### 1c. Fix `readCachedSearch` return type

Add a type assertion on line 1520: `return (data?.response_payload as SearchResponsePayload) || null;`

### 1d. Fix same `checkRateLimit` type issue in `scihub-download`

Same `as any` cast at lines ~391 and ~495.

---

## Part 2: "Add Study by DOI" Feature

### New Edge Function: `add-study/index.ts`

Accepts `{ report_id, doi }` from an authenticated user.

Pipeline:
1. Validate user owns the report (same pattern as other functions)
2. Fetch metadata from Crossref API using the DOI
3. Extract structured `StudyResult` data using Gemini (same prompt as the main extraction, but for a single paper)
4. Append the new study to the report's `results` JSONB array in `research_reports`
5. Return the extracted study

### Frontend Changes

**New component: `src/components/AddStudyDialog.tsx`**
- A dialog with a text input for DOI entry
- Submit button triggers the edge function
- Shows loading state and success/error feedback
- On success, the new study appears in the results list (report hook refetches)

**Modified: `src/pages/ReportDetail.tsx`**
- Add an "Add Study" button (with a `Plus` icon) next to the report header, visible only when `status === 'completed'`
- Renders the `AddStudyDialog` component

**Modified: `src/hooks/useReport.ts`**
- Add a `refetch` function to the return value so the dialog can trigger a data refresh after adding a study

### Config update: `supabase/config.toml`
- Add `[functions.add-study]` with `verify_jwt = false` (auth validated in code)

---

## Technical Details

### Edge function structure (add-study)

```
POST /add-study
Body: { report_id: string, doi: string }
Auth: Bearer token required

Steps:
  1. auth.getUser() -> verify ownership of report
  2. GET https://api.crossref.org/works/{doi}
  3. Map Crossref response to paper metadata (title, abstract, authors, year, venue)
  4. Call Gemini to extract StudyResult (same prompt template as research-async)
  5. Read current results from research_reports, append new study, update row
  6. Return { study: StudyResult }
```

### What about PDF upload?

The current architecture is abstract-based extraction. Adding a DOI lookup fits naturally since Crossref provides abstracts. Full PDF upload and parsing would require significant new infrastructure. This can be revisited as a follow-up if needed.

