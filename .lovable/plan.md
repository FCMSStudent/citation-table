

## Remaining Synthesis View Improvements

### Overview
Three items from the previous plan remain unimplemented. The wall-of-text summary and condensed narrative function are no longer needed since the LLM-generated NarrativeSynthesis now handles that. The SynthesisOverview stats card is also unnecessary -- the NarrativeSynthesis already covers corpus context.

---

### 1. Fix the "+N more" Button in Key Findings

The button at line 136 of `SynthesisView.tsx` has no click handler. Add an `expandedOutcomes` state (Set of outcome keys) and toggle visibility on click.

**File:** `src/components/SynthesisView.tsx`
- Add `const [expandedOutcomes, setExpandedOutcomes] = useState<Set<string>>(new Set())`
- On button click, toggle the outcome key in the set
- When expanded, render all studies instead of slicing to 3
- Change button text to "Show fewer" when expanded

---

### 2. Add Effect Direction Indicators

Create a heuristic utility that scans `key_result` text for direction keywords and returns positive/negative/neutral.

**New file:** `src/utils/effectDirection.ts`
- Positive keywords: "improved", "increased", "enhanced", "reduced symptoms", "significant decrease in", "beneficial", "protective"
- Negative/adverse keywords: "worsened", "increased risk", "adverse", "harmful", "declined"
- Null keywords: "no significant", "no difference", "similar", "no association", "no effect"
- Returns `'positive' | 'negative' | 'neutral' | 'mixed'`

**Modified file:** `src/components/SynthesisView.tsx`
- Import the utility
- Add a small colored indicator (green up-arrow, red down-arrow, gray dash) next to each outcome result in both "Key Findings by Outcome" and "Evidence by Study Design" sections

---

### 3. Add Expandable Verbatim Citation Snippets

Each outcome in `StudyResult.outcomes[]` has a `citation_snippet` field that is never displayed. Add a small toggle ("Show source text") that reveals the verbatim abstract excerpt grounding each finding.

**File:** `src/components/SynthesisView.tsx`
- Add `expandedSnippets` state (Set of compound keys like `studyId-outcomeIdx`)
- Below each outcome result line, add a small "Source" button
- When toggled, show the `citation_snippet` in a styled blockquote below the result
- Apply to both "Key Findings by Outcome" and "Evidence by Study Design" sections

---

### Technical Details

| File | Action |
|------|--------|
| `src/utils/effectDirection.ts` | New -- heuristic effect direction parser |
| `src/components/SynthesisView.tsx` | Modified -- expandable outcomes, effect indicators, citation snippets |

No database changes. No edge functions. No new dependencies.

