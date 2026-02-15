

# Filter Incomplete Papers and Refine Table Columns

## Overview

Apply the existing `isCompleteStudy` filter consistently across all views, and refine the `PaperResultsTable` columns to match the requested structure exactly.

## What Changes

### 1. Stricter Filtering in ResultsTable

Currently, `ResultsTable.tsx` only filters papers by abstract length (>=50 chars). The `isCompleteStudy` filter is applied in `ReportDetail.tsx` before passing data, but not inside `ResultsTable` itself. This means if `ResultsTable` is used elsewhere without pre-filtering, incomplete papers slip through.

**Fix**: Apply `isCompleteStudy` as the primary filter inside `ResultsTable.tsx` (line 62-64), replacing the weaker abstract-length check.

### 2. Refined PaperResultsTable Columns

The current table already has columns close to the spec but needs adjustments:

| Current Column | Change |
|---|---|
| Paper (title + author + year + DOI) | Add citation count and abstract availability badge -- already present, just ensure consistent display |
| Study Method (design + N + population) | Already correct as bullet points -- no change needed |
| Outcomes (bullet list) | Already correct -- no change needed |
| Results (key_result + effect size + p-value) | Already correct -- no change needed |
| Limitations (filtered from key_result) | Current approach greps for "limit" in key_result, which is fragile. Keep as-is but improve the fallback label |
| Conclusion | Currently picks the first `key_result` or falls back to abstract. Improve to generate a one-line summary from the abstract excerpt instead |
| PDF | Keep as-is |

The main refinements:
- **Paper column**: Ensure citation count always shows (even as "0 cit." if zero) and abstract availability badge is always rendered
- **Conclusions column**: Use the first ~120 characters of the abstract excerpt as the concise summary, rather than re-using a key_result (which is already shown in the Results column)
- **Limitations column**: Keep the current heuristic but show "Not explicitly reported" instead of "Not reported" for clarity

## Technical Details

### Files Modified

| File | Change |
|---|---|
| `src/components/ResultsTable.tsx` | Replace abstract-length filter (line 62-64) with `isCompleteStudy` import and usage |
| `src/components/PaperResultsTable.tsx` | Refine Paper column to always show citation count; fix Conclusion column to use abstract excerpt; improve Limitations fallback text |

### ResultsTable.tsx Changes
- Add `import { isCompleteStudy } from '@/utils/isCompleteStudy'`
- Change `filteredByAbstract` to use `results.filter(isCompleteStudy)` instead of the abstract-length check
- Rename the variable from `filteredByAbstract` to `completeStudies` for clarity

### PaperResultsTable.tsx Changes
- **Paper column**: Always render citation count (show "0 cit." when `citationCount` is 0 or undefined)
- **Conclusion column**: Use `study.abstract_excerpt` truncated to 120 chars as the concise summary, removing the fallback to `key_result` (which duplicates the Results column)
- **Limitations column**: Change fallback from "Not reported" to "Not explicitly reported"

