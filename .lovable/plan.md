

# Filter Papers by Type and Completeness

## Overview

Two changes: (1) exclude papers that aren't one of the allowed study types, and (2) only include studies with at least one complete outcome row in the synthesis.

## What Changes

### 1. Post-extraction filtering in the `research` edge function

After the LLM extracts structured data (line ~683 in `supabase/functions/research/index.ts`), add a filter step that removes any study whose `study_design` is `"unknown"`. The allowed designs map to the user's list:

| User term | `study_design` value | `review_type` value |
|-----------|---------------------|---------------------|
| Original paper / RCT | `"RCT"` | `"None"` |
| Cohort / Longitudinal | `"cohort"` | `"None"` |
| Cross-sectional | `"cross-sectional"` | `"None"` |
| Narrative/Literature review | `"review"` | `"None"` |
| Systematic review | `"review"` | `"Systematic review"` |
| Meta-analysis | `"review"` | `"Meta-analysis"` |

Studies with `study_design === "unknown"` are excluded from the final results.

### 2. "Complete row" filter for synthesis

In `supabase/functions/synthesize-papers/index.ts`, before building the study context for the LLM, filter out any study that has zero outcomes with at least one non-null PICO field. A "complete" outcome row means it has `outcome_measured` AND at least one of: `intervention`, `comparator`, `effect_size`, or `p_value` is non-null.

Studies with no complete outcome rows are excluded from the synthesis input entirely, and a warning is added noting how many studies were excluded.

### 3. Update the LLM extraction prompt

Add to the extraction prompt in `supabase/functions/research/index.ts`: instruct the LLM that `study_design` must be one of `"RCT"`, `"cohort"`, `"cross-sectional"`, or `"review"`. If the paper doesn't clearly fit any of these (e.g., editorials, commentaries, case reports, opinion pieces), classify as `"unknown"` so it gets filtered out.

## Technical Details

### Files modified

1. **`supabase/functions/research/index.ts`**
   - After `const results = JSON.parse(...)` (~line 683), add filtering:
     ```
     const allowedDesigns = new Set(["RCT", "cohort", "cross-sectional", "review"]);
     const filtered = results.filter(s => allowedDesigns.has(s.study_design));
     console.log(`[LLM] Filtered: ${results.length} -> ${filtered.length} (removed ${results.length - filtered.length} unknown/ineligible)`);
     return filtered;
     ```
   - Update the extraction prompt to clarify that editorials, commentaries, case reports, letters, and opinion pieces should be classified as `"unknown"`

2. **`supabase/functions/synthesize-papers/index.ts`**
   - Before building `studyContext`, filter studies to only those with at least one complete outcome:
     ```
     const eligibleStudies = studies.filter(s =>
       (s.outcomes || []).some(o =>
         o.outcome_measured && (o.intervention || o.comparator || o.effect_size || o.p_value)
       )
     );
     ```
   - Add a computed warning if studies were excluded: `"N of M studies excluded from synthesis due to incomplete extracted data"`
   - Use `eligibleStudies` for building the prompt context and re-index study numbers accordingly
   - Pass `eligibleStudies` count in the prompt header

### No frontend changes needed

The filtering happens server-side. The UI already handles variable study counts gracefully.

