
# Diagnosis: "Found 2 relevant studies from 62 papers"

## Root Cause

The problem is a **cascading over-filtering** issue across three layers. Each layer is too strict on its own, and together they eliminate almost all studies.

### Layer 1: Backend Completeness Filter (moderate impact)

In `study-extraction.ts`, the `isStrictComplete` function requires ALL of:
- Title and year
- Study design must NOT be "unknown"
- Abstract excerpt at least 50 characters
- At least one outcome with a PICO metric (effect_size, p_value, intervention, or comparator)

Many real papers (especially prevalence studies, qualitative research, or papers with less structured abstracts) fail the study design classification or the PICO metric requirement, landing them in `partial_results` instead of `results`.

### Layer 2: Frontend Relevance Score (major impact -- the main culprit)

In `explainScore.ts`, the scoring system is extremely narrow:
- **+2 points** only if the study has outcomes AND 2 or more query keywords appear in the outcome text
- **+1 point** only if it's a Meta-analysis or Systematic review
- **-2 penalty** if no outcomes or "no outcomes reported"
- **Default score: 0** for a normal study with outcomes but no keyword overlap

### Layer 3: Frontend "Low Value" Filter (the breaking point)

In `relevanceScore.ts`, `isLowValueStudy` returns `true` when `relevanceScore <= 0`. Since most studies score exactly **0** (they have outcomes, but don't match 2+ keywords in the outcomes text), they are all classified as "low value" and hidden.

**Example**: A perfectly valid RCT about "anxiety treatment in Saudi Arabia" with well-extracted outcomes about "GAD-7 scores" would score 0 because the query keywords ("anxiety", "disorders", "prevalence", "burden", "Saudi", "Arabia") may not appear in the `outcome_measured` field text.

## The Fix

### Change 1: Adjust `isLowValueStudy` threshold

Change the condition from `relevanceScore <= 0` to `relevanceScore < 0`. This way studies scoring 0 (the vast majority) are kept, and only penalized studies (those with no outcomes at all) are hidden.

**File:** `src/utils/relevanceScore.ts`

```typescript
// Before:
return relevanceScore <= 0 || outcomesText.includes('no outcomes reported');

// After:
return relevanceScore < 0 || outcomesText.includes('no outcomes reported');
```

### Change 2: Improve the relevance scoring to be more granular

The current scoring gives 0 to most valid studies, making it useless for ranking. Add partial credit for:
- Having at least 1 keyword match in outcomes (+1 instead of requiring 2)
- Having a known study design other than "unknown" (+0.5)
- Having sample size data (+0.5)
- Title keyword matches (+0.5 for 1+ match)

**File:** `src/utils/explainScore.ts`

### Change 3: Include `partial_results` in the main display

The frontend already merges `partial_results` from the `ResultsTable` component (lines 288-295), but the `ReportDetailPage` only passes `report.results`. The `partialResults` prop should be populated from `report.partial_results`.

**File:** `src/features/report-detail/ui/ReportDetailPage.tsx` -- verify `partialResults` prop is correctly wired (it appears to already be at line 133, but we should confirm the data actually contains `partial_results`).

## Technical Summary

| Layer | Current behavior | Proposed fix |
|-------|-----------------|--------------|
| `isLowValueStudy` | Hides studies with score <= 0 | Hide only score < 0 |
| `getScoreBreakdown` | Binary: 0 or 2 for keyword match | Graduated: 0, 0.5, 1, 1.5, 2 |
| `partial_results` display | Included in UI merge | Verify data pipeline delivers them |

These changes will mean that instead of showing only the 2-3 studies that happen to be reviews or have exact keyword overlaps, the app will show all extracted studies ranked by a more nuanced relevance score.
