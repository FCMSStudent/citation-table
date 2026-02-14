

# Fix 504 Timeout: Inline Research Logic

## Problem

`research-async` calls the `research` edge function via HTTP. The research process takes 2-3 minutes (fetching from 3 APIs, enriching 73 papers via Crossref, running LLM extraction). The Supabase gateway enforces a timeout shorter than this, killing the connection and returning 504 before the response arrives.

The research function actually finishes its work successfully -- but the HTTP response never reaches `research-async`.

## Solution

Move the core research logic into `research-async` directly. The `research` function stays as-is (for any direct callers), but `research-async` no longer calls it via HTTP. Instead, it imports/inlines the same logic and runs it within its `waitUntil` background task, which is not subject to the HTTP gateway timeout.

## What Changes

### 1. Extract shared research logic

The `research` function contains all the logic (API calls, deduplication, Crossref enrichment, LLM extraction). The key functions to reuse:

- `extractKeywords()` - query normalization
- `searchSemanticScholar()` - Semantic Scholar API
- `searchOpenAlex()` - OpenAlex API  
- `searchArxiv()` - ArXiv API
- `deduplicatePapers()` - deduplication
- `enrichWithCrossref()` - citation enrichment
- `extractStudyData()` - Gemini LLM extraction

Since edge functions can't share modules across directories, the approach is to copy the core logic into `research-async/index.ts`.

### 2. Update `research-async/index.ts`

- Remove the HTTP fetch call to `/functions/v1/research`
- Inline the research pipeline directly in the background task
- The pipeline runs inside `waitUntil`, which has no HTTP gateway timeout constraint
- Keep the same error handling: catch errors and update the report row as "failed"

### 3. Keep `research/index.ts` unchanged

It continues to work for any direct HTTP callers (though currently only `research-async` calls it).

## Technical Details

### Files modified

1. **`supabase/functions/research-async/index.ts`**
   - Copy the core research functions from `research/index.ts` (keyword extraction, API searches, deduplication, Crossref enrichment, LLM extraction)
   - Replace the HTTP fetch block (lines 70-81) with direct function calls
   - The background work section becomes:
     ```
     const results = await runResearchPipeline(question);
     // Update report with results directly
     ```

### Why this works

`EdgeRuntime.waitUntil()` keeps the isolate alive for background work without being subject to the HTTP response timeout. The gateway timeout only applies to the HTTP request/response cycle. Since `research-async` already returns immediately with the report ID, the background work can run as long as needed.

### Risk

The file will be large since it contains the full research pipeline. This is a trade-off of Supabase edge functions not supporting cross-function imports. The logic is identical to what's in `research/index.ts`.

