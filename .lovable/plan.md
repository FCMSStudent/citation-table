

## LLM-Generated Narrative Synthesis (Elicit-Style)

### Overview
Replace the current template-based `generateNarrativeSummary()` with an LLM-generated, table-grounded synthesis. The LLM reads all extracted study data and produces a structured narrative that identifies patterns, agreement, disagreement, and limitations across the evidence -- without introducing new data or performing quantitative meta-analysis.

---

### How It Changes

**Before:** A heuristic function (`narrativeSummary.ts`) concatenates strings like "Observational evidence from 3 studies (combined n=450) reported associations with anxiety." This produces repetitive, hard-to-read output that doesn't actually synthesize findings.

**After:** An LLM reads the full study table (titles, designs, sample sizes, outcomes, key results, citation snippets) and produces 3-5 structured paragraphs covering:
1. **Corpus overview** -- study count, design mix, population range
2. **Agreement** -- what most studies converge on
3. **Disagreement** -- conflicting findings and possible explanations (different populations, designs)
4. **Limitations** -- preprint status, small samples, narrow populations
5. **Evidence gaps** -- what's not covered

---

### Architecture

The synthesis is generated once when a report completes, then cached in the database so it doesn't re-run on every page load.

```text
Report completes
       |
       v
Frontend detects completed report with no cached synthesis
       |
       v
Calls "synthesize-papers" edge function
       |
       v
Edge function: builds study context -> calls Lovable AI (non-streaming) -> returns structured summary
       |
       v
Frontend stores result in `research_reports.narrative_synthesis` column
       |
       v
On subsequent loads, uses cached synthesis directly
```

---

### Technical Details

**1. Database Migration**
- Add a `narrative_synthesis` text column to `research_reports` table (nullable, no default)

**2. New Edge Function: `supabase/functions/synthesize-papers/index.ts`**
- Receives `report_id`
- Fetches study data from `research_reports.results`
- Builds a structured context block from all studies (same format as `chat-papers`)
- System prompt instructs the LLM to:
  - Describe patterns of agreement across studies
  - Note disagreements and possible methodological explanations
  - Flag limitations (preprints, small n, narrow populations)
  - Identify evidence gaps
  - Cite every claim with (Author, Year)
  - Use NO causal language unless the study is an RCT
  - Introduce NO information beyond what's in the data
- Calls Lovable AI (google/gemini-3-flash-preview) **non-streaming**
- Saves the result to `research_reports.narrative_synthesis`
- Returns the synthesis text

**3. Update `supabase/config.toml`**
- Register `synthesize-papers` with `verify_jwt = false`

**4. Update `src/components/ResultsTable.tsx`**
- Replace the static `narrativeSummary` paragraph (lines 144-156) with a component that:
  - Shows cached `narrative_synthesis` if available (passed as prop)
  - If not cached, shows a "Generate synthesis" button or auto-triggers the edge function
  - Displays a loading skeleton while generating
  - Renders the result as markdown (using ReactMarkdown, already installed)
- Remove the `generateNarrativeSummary()` import and `narrativeSummary` useMemo

**5. New component: `src/components/NarrativeSynthesis.tsx`**
- Props: `reportId`, `studies`, `query`, `cachedSynthesis`
- States: `synthesis` (string), `isGenerating` (boolean), `error`
- On mount: if `cachedSynthesis` exists, use it; otherwise call the edge function
- Renders markdown with `ReactMarkdown` and `prose` styling
- Shows a "Regenerate" button to re-run the synthesis

**6. Update `src/pages/ReportDetail.tsx`**
- Pass `report.narrative_synthesis` to `ResultsTable` as a new prop

**7. Keep `src/lib/narrativeSummary.ts`**
- Keep as fallback for offline/export use -- no changes needed

### Files Changed
| File | Action |
|------|--------|
| Migration SQL | New -- add `narrative_synthesis` column |
| `supabase/functions/synthesize-papers/index.ts` | New |
| `supabase/config.toml` | Add function entry |
| `src/components/NarrativeSynthesis.tsx` | New |
| `src/components/ResultsTable.tsx` | Replace static summary with NarrativeSynthesis |
| `src/pages/ReportDetail.tsx` | Pass cached synthesis prop |

