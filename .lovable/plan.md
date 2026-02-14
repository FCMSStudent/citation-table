

# Update `synthesize-papers` to Filter, Rank, and Cap at Top 10 Studies

## Overview

Modify the `synthesize-papers` edge function to apply the same completeness filter used elsewhere, rank surviving studies by query relevance, select only the top 10, and run synthesis + warnings exclusively on that subset.

## Changes (single file: `supabase/functions/synthesize-papers/index.ts`)

### A. Add `isCompleteStudy()` function (before `computeWarnings`)

Inline the same logic used in `research-async` and `src/utils/isCompleteStudy.ts`:

```typescript
function isCompleteStudy(study: any): boolean {
  if (!study.title || !study.year) return false;
  if (study.study_design === "unknown") return false;
  if (!study.abstract_excerpt || study.abstract_excerpt.trim().length < 50) return false;
  if (!study.outcomes || study.outcomes.length === 0) return false;
  if (!study.population && !study.sample_size) return false;  // extra: population or sample_size
  return study.outcomes.some((o: any) =>
    o.outcome_measured && (o.effect_size || o.p_value || o.intervention || o.comparator)
  );
}
```

This adds one additional check vs. the existing `isCompleteStudy`: requiring `population` or `sample_size` to be present, per the request.

### B. Add `scoreStudy()` relevance ranking function

```typescript
function scoreStudy(study: any, query: string): number {
  let score = 0;
  // Keyword matches in outcomes
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const outcomesText = (study.outcomes || [])
    .map((o: any) => `${o.outcome_measured} ${o.key_result || ""}`.toLowerCase())
    .join(" ");
  const matches = keywords.filter(k => outcomesText.includes(k)).length;
  if (keywords.length >= 2 && matches >= 2) score += 2;
  else if (matches >= 1) score += 1;

  // Review type boost
  if (study.review_type === "Meta-analysis" || study.review_type === "Systematic review") score += 1;

  // Citation count log boost (log2, capped at +3)
  if (study.citationCount && study.citationCount > 0) {
    score += Math.min(3, Math.log2(study.citationCount));
  }

  return score;
}
```

### C. Replace the filtering block (lines 101-110)

Current code filters only by outcome completeness. Replace with:

1. Filter all studies through `isCompleteStudy()`
2. Rank by `scoreStudy()` descending
3. Slice to top 10

```typescript
const allStudies = report.results as any[];
const queryText = (report.normalized_query || report.question || "").toLowerCase();

// Step 1: completeness filter
const completeStudies = allStudies.filter(isCompleteStudy);
const excludedCount = allStudies.length - completeStudies.length;
console.log(`[Synthesis] ${excludedCount} of ${allStudies.length} excluded (incomplete)`);

// Step 2: rank by relevance
const ranked = completeStudies
  .map(s => ({ ...s, _score: scoreStudy(s, queryText) }))
  .sort((a, b) => b._score - a._score);

// Step 3: top 10
const studies = ranked.slice(0, 10).map(({ _score, ...s }) => s);
console.log(`[Synthesis] Selected top ${studies.length} of ${completeStudies.length} complete studies`);
```

### D. Update warning for excluded studies

The existing excluded-count warning (lines 138-143) will reflect both incomplete and rank-excluded studies:

```typescript
if (excludedCount > 0 || completeStudies.length > 10) {
  const totalExcluded = allStudies.length - studies.length;
  computedWarnings.push({
    type: "quality",
    text: `${totalExcluded} of ${allStudies.length} studies excluded from synthesis (${excludedCount} incomplete, ${completeStudies.length - studies.length} below relevance cutoff)`,
  });
}
```

### E. Fix duplicate variable declarations

Lines 84-85 re-declare `supabaseUrl` and `supabaseKey` (already declared on lines 63-64). Remove the duplicates and reuse the existing `rlSupabase` client or rename to `supabase`.

### F. Update system prompt study count

The prompt already uses `studies.length` dynamically, so no change needed -- it will automatically say "You have 10 studies" (or fewer).

## No other files change

The `computeWarnings` function already operates on whatever `studies` array it receives, so it will naturally scope to the selected 10.

## Summary of data flow after changes

```text
report.results (all studies)
  -> isCompleteStudy() filter (title/year/design/abstract/outcomes/population)
  -> scoreStudy() ranking (keyword + citationCount log + review_type)
  -> top 10
  -> computeWarnings() on those 10
  -> LLM synthesis prompt with those 10
  -> cache result
```
