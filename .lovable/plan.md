
# New Paper-Level Results Table and CSV Export

## Overview

Create a new `PaperResultsTable` component showing one row per paper (instead of one row per outcome), make it the default "Table" tab, and add a paper-level CSV export. The existing outcome-level table and CSV export remain available as secondary options.

## Changes

### 1. Create `src/components/PaperResultsTable.tsx` (new file)

A table component with these columns:

| Column | Content |
|--------|---------|
| Checkbox | Selection (reuse existing pattern) |
| Paper Info | Title (bold), authors extracted from citation, year, citation count, DOI link (external), abstract/full-text availability indicator |
| Study Method | Bullet list: design, sample size (N=X), population |
| Outcomes | Bullet list of `outcome_measured` values from `study.outcomes` |
| Results | Bullet list of `key_result` values (with effect_size and p_value inline) |
| Limitations | Bullet list from `study.outcomes` where key_result mentions limitations, or "Not reported" |
| Conclusion | First outcome's `key_result` summary or abstract excerpt (truncated) |
| PDF Available | Icon/badge showing PDF availability from legal OA sources |

**PDF Available column logic** (checks in order, shows first match):
1. `study.pdf_url` -- from OpenAlex `best_oa_location.pdf_url` or Semantic Scholar `openAccessPdf.url`
2. `study.landing_page_url` -- from OpenAlex `best_oa_location.landing_page_url`
3. arXiv PDF: if `study.source === 'arxiv'`, construct `https://arxiv.org/pdf/{study_id}`
4. Sci-Hub PDF: check `pdfsByDoi` prop for downloaded PDFs
5. If none available, show a muted "No" indicator

Each link opens in a new tab. Multiple sources shown if available.

Props will mirror `TableView`: `studies`, `query`, `pdfsByDoi`, `onExportSelected`, `onCompare`.

Sortable columns: Paper (by title), Year, Design, Citation Count.

### 2. Update `src/components/ResultsTable.tsx`

- Import `PaperResultsTable`
- Change `ViewMode` type to `'synthesis' | 'table' | 'pico' | 'cards'`
- Rename current "Table" tab to "PICO Table" and add new "Table" tab as default table view
- Tab order: Synthesis | Table (paper-level, new) | PICO Table (outcome-level, existing) | Cards
- Wire `viewMode === 'table'` to render `<PaperResultsTable>`, `viewMode === 'pico'` to render existing `<TableView>`
- Add a dropdown or second button for CSV export: "Export CSV (Paper)" calls new function, "Export CSV (Outcomes)" calls existing `downloadCSV`

### 3. Create `src/lib/csvPaperExport.ts` (new file)

New export function `downloadPaperCSV(studies, filename)` with columns matching the table:
- Title, Authors, Year, DOI, Citation Count, Study Design, Sample Size, Population
- Outcomes (semicolon-joined list of outcome_measured)
- Results (semicolon-joined key_result values)
- Effect Sizes (semicolon-joined)
- P-values (semicolon-joined)
- Review Type, Preprint Status
- PDF URL (first available legal OA link)
- Landing Page URL
- OpenAlex ID

One row per paper. Reuses `escapeCSV` and `extractAuthors` helpers (extracted to shared or duplicated).

### 4. Update `src/lib/csvExport.ts`

- Export the `escapeCSV` and `extractAuthors` helpers so they can be reused by `csvPaperExport.ts`
- Keep existing `downloadCSV` function unchanged

## Files Changed

| File | Action |
|------|--------|
| `src/components/PaperResultsTable.tsx` | Create: new paper-level table component |
| `src/lib/csvPaperExport.ts` | Create: paper-level CSV export function |
| `src/lib/csvExport.ts` | Edit: export helper functions |
| `src/components/ResultsTable.tsx` | Edit: add new tab, wire up new table and export |
