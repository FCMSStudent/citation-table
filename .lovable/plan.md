

# Restructure Research Table to PICO Evidence Grid

## Overview

Transform the current study-level table into a structured PICO (Population, Intervention, Comparator, Outcome) evidence grid where each row represents an individual **outcome** from a paper, not just the paper itself.

## What Changes

### 1. Extend the data model with new fields

Add `intervention`, `comparator`, `effect_size`, and `p_value` to the `Outcome` type in `src/types/research.ts`. This keeps the data at the outcome level where it belongs.

```
Outcome {
  outcome_measured: string;
  key_result: string | null;
  citation_snippet: string;
  intervention: string | null;    // NEW
  comparator: string | null;      // NEW
  effect_size: string | null;     // NEW (e.g., "d = 0.45")
  p_value: string | null;         // NEW (e.g., "p < 0.001")
}
```

### 2. Update the LLM extraction prompt

Modify the `extractStudyData` function in `supabase/functions/research/index.ts` to instruct the LLM to extract these four new fields per outcome. The prompt will require verbatim extraction (no inference), returning `null` when not stated in the abstract.

### 3. Rebuild the TableView component

Replace the current study-level table in `src/components/TableView.tsx` with an outcome-level PICO grid:

| Column | Source |
|--------|--------|
| Paper | `study.title` + author/year |
| Population | `study.population` |
| Intervention | `outcome.intervention` (new) |
| Comparator | `outcome.comparator` (new) |
| Outcome | `outcome.outcome_measured` |
| Effect Size | `outcome.effect_size` (new) |
| Direction | Derived via `getEffectDirection()` (existing) |
| P-value | `outcome.p_value` (new) |
| Study Design | `study.study_design` |

Key behaviors:
- Each row = one outcome from one study
- Studies with multiple outcomes produce multiple rows
- Rows from the same study are visually grouped (first row shows the paper title, subsequent rows show a subtle indent/dash)
- Direction column uses color-coded arrows/badges (green for positive, red for negative, gray for neutral, amber for mixed)
- All columns are sortable
- Checkbox selection still works at the study level
- Links column (DOI, OpenAlex, PDF) retained

### 4. Update CSV export

Update `src/lib/csvExport.ts` to include the new Intervention, Comparator, Effect Size, and P-value columns in exported files.

## Technical Details

### Edge function prompt changes (`supabase/functions/research/index.ts`)

The outcome schema in the LLM prompt will be updated to:
```json
{
  "outcome_measured": "string",
  "key_result": "verbatim finding" | null,
  "citation_snippet": "verbatim text",
  "intervention": "treatment/exposure" | null,
  "comparator": "control/comparison group" | null,
  "effect_size": "verbatim effect size (e.g., Cohen's d, OR, RR, HR)" | null,
  "p_value": "verbatim p-value or CI" | null
}
```

### Backward compatibility

The new fields are all nullable (`string | null`), so existing reports with stored results will continue to work -- those outcomes will simply show "--" in the new columns.

### Files modified

1. `src/types/research.ts` -- add 4 fields to `Outcome`
2. `supabase/functions/research/index.ts` -- update extraction prompt
3. `src/components/TableView.tsx` -- complete rebuild as PICO grid
4. `src/lib/csvExport.ts` -- add new columns to export
5. `supabase/functions/research-async/index.ts` -- update extraction prompt (if it has its own copy)

