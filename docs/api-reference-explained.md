# API Reference (Explained)

This document explains the APIs used by this project, including what each API does, how requests are made, and the shape of expected results.

## 1) Primary app API: `research-async` (Supabase Edge Function)

Base path: `/functions/v1/research-async` with versioned routes under `/v1/lit/*`.

### `POST /v1/lit/search`
- **Purpose:** Start a literature search job.
- **How it works:**
  1. Requires `Authorization: Bearer <token>`.
  2. Validates question/query length.
  3. Persists a `research_reports` row with `running` status.
  4. Returns immediately with a running payload while background work continues.
  5. Background pipeline fans out to providers (OpenAlex/Semantic Scholar/arXiv/PubMed), deduplicates, enriches metadata, extracts evidence, and writes completion state.
- **Immediate result:**
  - JSON similar to `{ search_id, status: "running", coverage, evidence_table: [], brief, stats }`.
- **Final result (retrieved via GET):**
  - JSON with `status: completed|failed`, `evidence_table`, `brief`, `coverage`, and `stats`.

### `GET /v1/lit/search/{search_id}`
- **Purpose:** Poll status/results for a search.
- **How it works:** Loads the user-owned report row and maps it to the search response payload.
- **Result:** 200 with search payload; 404 if not found; 500 on DB failure.

### `GET /v1/lit/search/{search_id}/runs`
- **Purpose:** List extraction runs for a search (including active run metadata).
- **How it works:** Verifies report ownership then returns run summaries from extraction-run tables.
- **Result:** `{ search_id, runs: [...] }`.

### `GET /v1/lit/search/{search_id}/runs/{run_id}`
- **Purpose:** Retrieve detailed extraction run contents (run + rows + cells).
- **How it works:** Checks user access and fetches run detail.
- **Result:** Run detail JSON or 404 if run/search missing.

### `GET /v1/lit/paper/{paper_id}`
- **Purpose:** Fetch cached canonical paper metadata by paper id.
- **How it works:** Reads `lit_paper_cache` if not expired.
- **Result:** Paper payload JSON or 404 if missing.

### `GET /v1/lit/providers/health`
- **Purpose:** Lightweight provider health snapshot.
- **How it works:** Pings each provider health URL in the provider registry.
- **Result:** Provider health report JSON.

### Legacy compatibility: `POST /functions/v1/research-async` with `{ question }`
- **Purpose:** Backward-compatible entrypoint for old clients.
- **Result:** Returns `{ report_id }` while job runs asynchronously.

## 2) Citation API: `coci` (Supabase Edge Function)

Path: `/functions/v1/coci`

### Input
- Query form: `?doi=<doi>`
- Path form: DOI may be included in URL path (e.g., `/functions/v1/coci/10.xxxx/yyy`).

### How it works
1. Handles CORS preflight.
2. Extracts DOI from query/path.
3. Validates DOI max length and required `10.` prefix.
4. Calls OpenCitations COCI endpoint: `https://opencitations.net/index/coci/api/v1/citations/{doi}`.
5. Normalizes response to include `count` and standardized citation items.

### Result
- Success: `{ doi, count, citations: [{ citing, cited, citation_date, raw, source: "coci" }] }`
- Errors:
  - 400 for missing/invalid DOI.
  - 502 for upstream COCI failures.
  - 500 generic for unexpected exceptions.

## 3) External literature provider APIs used by `research-async`

These are called server-side by provider adapters.

### OpenAlex API
- **Endpoint:** `https://api.openalex.org/works`
- **How used:** Search by keywords with filters (`has_abstract:true`, relevance sort) and optional API key for polite pool.
- **Result handling:** Maps each work into unified paper schema including reconstructed abstract, IDs, citation count, OA links, and retraction/preprint hints.

### Semantic Scholar API
- **Endpoint:** `https://api.semanticscholar.org/graph/v1/paper/search/bulk`
- **How used:** Bulk paginated search with optional `x-api-key`, 1 req/sec limiter, retries, and field selection.
- **Result handling:** Collects up to cap, filters short abstracts, maps into unified paper schema including references and open-access PDF URL.

### arXiv API
- **Endpoint:** `https://export.arxiv.org/api/query`
- **How used:** Atom feed query with 3-second minimum interval and retry policy.
- **Result handling:** Parses XML entries, extracts title/abstract/authors/year/doi, marks as preprint.

### PubMed (NCBI E-utilities)
- **Endpoints:**
  - `.../esearch.fcgi` (find PMIDs)
  - `.../efetch.fcgi` (fetch article metadata/abstract XML)
- **How used:** Two-step flow with optional NCBI API key, tool/email params, and adaptive rate limits.
- **Result handling:** Parses XML articles, builds unified records with PMID, title, abstract, year, journal, and DOI.

## 4) Provider health URLs used by the health endpoint

- Semantic Scholar: `/graph/v1/paper/search?query=health&limit=1&fields=paperId`
- OpenAlex: `/works?search=health&per-page=1`
- arXiv: `/api/query?search_query=all:health&max_results=1`
- PubMed: `/esearch.fcgi?db=pubmed&term=health&retmax=1&retmode=json`

These are used to quickly check availability, not full search quality.
