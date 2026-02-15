# Eureka

Evidence-focused literature search app built with React + Supabase Edge Functions.

## What this implementation provides

- Live federated retrieval across OpenAlex, Semantic Scholar, PubMed, and arXiv.
- Query normalization + source-specific query compilation (`query-processing v2`).
- Canonicalization with DOI/PMID/arXiv priority and provenance merging.
- Recall-first retrieval with OpenAlex citation-graph expansion.
- Hard quality gating with weighted scoring and rejection rules.
- Structured outputs:
  - Evidence table (`evidence_table`)
  - Citation-anchored brief (`brief_json`)
  - Coverage + latency stats (`coverage_report`, `search_stats`)
- Supabase-backed caches:
  - `lit_query_cache` (6h)
  - `lit_paper_cache` (30d)

## Edge Function API

Base function path: `/functions/v1/research-async`

- `POST /v1/lit/search`
- `GET /v1/lit/search/{search_id}`
- `GET /v1/lit/paper/{paper_id}`
- `GET /v1/lit/providers/health`

Legacy compatibility is preserved:

- `POST /functions/v1/research-async` with `{ "question": "..." }` still returns `{ "report_id": "..." }`.

## Local development

```bash
npm install
npm run dev
```

Run tests:

```bash
npm test
```

## Supabase migrations added

- `20260215143000_lit_search_api.sql`

Apply migrations before deploying the updated edge function.
