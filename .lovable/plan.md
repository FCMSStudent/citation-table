

## Fix Semantic Scholar and arXiv Returning 0 Results

### Problem 1: Semantic Scholar
The Semantic Scholar `/paper/search` endpoint works best with short keyword queries, not long natural-language sentences. The normalized query "What are the reported outcomes associated with sleep deprivation on cognitive performance?" is too verbose and returns nothing.

**Fix:** Extract keywords from the query before sending to Semantic Scholar. For example, reduce to "sleep deprivation cognitive performance".

### Problem 2: arXiv
The `DOMParser` API used to parse arXiv's XML response is not available in the Deno runtime that powers backend functions. The function fails silently and returns an empty array.

**Fix:** Replace `DOMParser` with simple string/regex-based XML parsing that works in Deno.

### Changes

**File: `supabase/functions/research/index.ts`**

1. Add a `extractKeywords()` helper that strips common filler words (what, are, the, effects, of, on, etc.) and returns a compact keyword string for Semantic Scholar.

2. Update `searchSemanticScholar()` to use the keyword-extracted query instead of the full normalized query.

3. Rewrite `searchArxiv()` to parse XML using regex/string methods instead of `DOMParser`:
   - Extract `<entry>` blocks with regex
   - Parse `<id>`, `<title>`, `<published>`, `<summary>`, `<author><name>` fields with simple regex captures

4. Redeploy the `research` edge function.

### Expected Outcome
- Semantic Scholar should return 10-25 papers for typical queries
- arXiv should return relevant preprints
- Source counts in the UI will reflect actual contributions from all three sources
