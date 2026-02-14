

# Improve Paper Retrieval and Add Study Completeness Filter

## Overview

Upgrade all three data source integrations in `research-async` to capture richer metadata (open-access PDFs, better sorting), and add a reusable `isCompleteStudy()` filter to exclude incomplete entries before they reach synthesis, table, or chat.

---

## 1. Semantic Scholar: Switch to Bulk Search Endpoint

**Current**: Uses `/graph/v1/paper/search` with `limit=25`
**New**: Switch to `/graph/v1/paper/search/bulk` which returns up to 1000 results per call (we'll still slice to top papers later).

**Changes to `searchSemanticScholar()`** (lines 221-261):
- Change URL from `/paper/search` to `/paper/search/bulk`
- Remove `limit=25` (bulk endpoint doesn't use it; returns up to 1000 by default)
- Add `openAccessPdf` and `url` to the `fields` parameter
- Update the `SemanticScholarPaper` interface (lines 56-66) to add:
  - `openAccessPdf?: { url: string } | null`
  - `url?: string`
- Pass these new fields through to `UnifiedPaper` by adding `pdfUrl` and `landingPageUrl` optional fields to the `UnifiedPaper` interface

## 2. OpenAlex: Capture OA Location URLs

**Current**: Only reads `primary_location.source.display_name`
**New**: Also read `best_oa_location.pdf_url` and `best_oa_location.landing_page_url`

**Changes to `searchOpenAlex()`** (lines 168-209):
- Update `OpenAlexWork` interface (lines 44-54) to add:
  - `best_oa_location?: { pdf_url?: string; landing_page_url?: string }`
- In the `.map()` at line 191, capture:
  - `pdfUrl: work.best_oa_location?.pdf_url || null`
  - `landingPageUrl: work.best_oa_location?.landing_page_url || null`

## 3. arXiv: Add Sorting Parameters

**Current** (line 267): `search_query=all:${encodedQuery}&max_results=25`
**New**: Append `&sortBy=relevance&sortOrder=descending` to the URL

One-line change.

## 4. Update `UnifiedPaper` Interface

Add two optional fields to the `UnifiedPaper` interface (lines 68-82):
```
pdfUrl?: string | null;
landingPageUrl?: string | null;
```

These fields carry through the pipeline for potential downstream use (e.g., linking to full-text PDFs legally). The deduplication function will also merge these fields when combining duplicates.

## 5. Update `StudyResult` Type and Frontend Type

Add to both the edge function's local `StudyResult` interface (line 28) and `src/types/research.ts`:
```
pdf_url?: string | null;
landing_page_url?: string | null;
```

Pass these fields through from `UnifiedPaper` into the LLM extraction context so they appear on the final result objects (they are metadata fields, not LLM-extracted).

## 6. Create `isCompleteStudy()` Filter

A reusable function defined in both the edge function and a shared frontend utility.

```typescript
function isCompleteStudy(study: StudyResult): boolean {
  // Must have title, year, study_design (not "unknown"), and abstract
  if (!study.title || !study.year) return false;
  if (study.study_design === "unknown") return false;
  if (!study.abstract_excerpt || study.abstract_excerpt.trim().length < 50) return false;

  // Must have at least one meaningful outcome
  // (outcome_measured present AND at least one PICO metric filled)
  if (!study.outcomes || study.outcomes.length === 0) return false;
  const hasCompleteOutcome = study.outcomes.some(o =>
    o.outcome_measured &&
    (o.effect_size || o.p_value || o.intervention || o.comparator)
  );
  return hasCompleteOutcome;
}
```

### Where it's applied:
- **Edge function** (line 554-561): Replace the current design + abstract filters with `isCompleteStudy()` in `extractStudyData()`
- **Frontend** (`src/utils/isCompleteStudy.ts`): New file exporting the same function
- **`src/pages/ReportDetail.tsx`**: Filter `report.results` through `isCompleteStudy()` before passing to `ResultsTable`, `PaperChat`, and synthesis components

This ensures that no matter how results are stored, only complete studies reach the user-facing views.

## Files Changed

| File | Action |
|------|--------|
| `supabase/functions/research-async/index.ts` | Edit: interfaces, 3 search functions, add `isCompleteStudy`, apply filter |
| `src/types/research.ts` | Edit: add `pdf_url`, `landing_page_url` to `StudyResult` |
| `src/utils/isCompleteStudy.ts` | Create: reusable filter function |
| `src/pages/ReportDetail.tsx` | Edit: filter results through `isCompleteStudy()` |

