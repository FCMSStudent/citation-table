

## Background Search with Reports Section

### Overview
Transform the current synchronous search into a background task system. When you submit a query, it gets queued, and you can navigate away while it processes. A new "Reports" section lets you browse all past and in-progress research queries, and clicking one opens the full results page with tables and narrative summary.

### Database Design

**Table: `research_reports`**
| Column | Type | Purpose |
|---|---|---|
| id | uuid (PK) | Unique report ID |
| question | text | Original research question |
| normalized_query | text | Normalized version (if applicable) |
| status | text | `processing`, `completed`, `failed` |
| results | jsonb | Full StudyResult array (null while processing) |
| total_papers_searched | int | Source count |
| openalex_count | int | OpenAlex papers found |
| semantic_scholar_count | int | Semantic Scholar papers found |
| arxiv_count | int | arXiv papers found |
| error_message | text | Error details if failed |
| created_at | timestamptz | When the search was submitted |
| completed_at | timestamptz | When processing finished |

RLS: Public access (no auth required) -- this is a public-facing research tool.

### New Edge Function: `research-async`

A new backend function that:
1. Creates a `research_reports` row with status `processing`
2. Returns the report ID immediately (fast response)
3. Continues processing in the background -- calls the same search + LLM extraction logic
4. Updates the row with results and status `completed` (or `failed`) when done

The existing `research` edge function stays unchanged for reference, but the UI will call `research-async` instead.

### Frontend Changes

**New pages and components:**

1. **`/reports` page** -- Lists all research reports as cards showing:
   - Research question
   - Status badge (Processing / Completed / Failed)
   - Timestamp
   - Click to open the full report

2. **`/reports/:id` page** -- Displays a single report with the existing `ResultsTable` component (synthesis view, table view, cards, filters, exports -- everything currently shown on the home page)

3. **Updated home page (`/`):**
   - Search still happens from the home page
   - On submit: immediately redirects to `/reports/:id` which shows a progress indicator
   - Progress indicator shows estimated time (~30-60 seconds) with a progress bar and status messages
   - A link to "View all reports" in the header/nav

4. **Header update:** Add a "Reports" nav link next to the app title

5. **Polling mechanism:** The report detail page polls the database every 3 seconds to check if the report status changed from `processing` to `completed`, then renders the results

### Estimated Time Display

The progress page will show:
- "Searching academic databases..." (0-10s)
- "Analyzing and extracting evidence..." (10-30s)  
- "Generating synthesis..." (30-50s)
- Estimated completion: ~45 seconds (based on average processing time)
- A smooth progress bar animating through these stages

### Technical Details

**File changes:**

1. **Create migration** -- `research_reports` table with RLS allowing public read/write (no auth needed for this tool)
2. **Create `supabase/functions/research-async/index.ts`** -- New edge function that:
   - Inserts a report row (status: processing)
   - Returns `{ report_id }` immediately using `EdgeRuntime.waitUntil()` pattern (or by spawning the background work after responding)
   - Runs search + extraction in background
   - Updates the row on completion
3. **Create `src/pages/Reports.tsx`** -- Reports listing page
4. **Create `src/pages/ReportDetail.tsx`** -- Single report view with polling and progress UI
5. **Create `src/components/ReportCard.tsx`** -- Card component for reports list
6. **Create `src/components/SearchProgress.tsx`** -- Animated progress indicator with stage messages and ETA
7. **Update `src/hooks/useResearch.ts`** -- Change `search()` to call `research-async`, return report ID
8. **Update `src/pages/Index.tsx`** -- Redirect to `/reports/:id` after submitting
9. **Update `src/App.tsx`** -- Add routes for `/reports` and `/reports/:id`
10. **Update header** -- Add Reports nav link

### User Flow

```text
1. User types question on home page
2. Clicks "Search"
3. App calls research-async, gets report ID back instantly
4. Redirects to /reports/{id} -- shows progress animation
5. Page polls database every 3s
6. When complete: renders full results (synthesis, table, cards)
7. User can navigate to /reports anytime to see all past searches
```

