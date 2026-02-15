# Eureka: Federated Literature Search with AI-Powered Evidence Synthesis

Evidence-focused literature search app built with React + Supabase Edge Functions.

## 📚 Proof of Concept Documentation

This repository contains a production-ready implementation of Eureka, a federated literature search system with AI-powered evidence extraction and citation anchoring. For comprehensive documentation:

- **[Proof of Concept Overview](./PROOF_OF_CONCEPT.md)** - Complete system documentation, evaluation results, and academic context
- **[System Architecture](./ARCHITECTURE.md)** - Detailed architecture diagrams and data flow documentation
- **[Examples & Demonstrations](./EXAMPLES.md)** - Real-world examples across different query types and domains

## 🎯 Quick Start Demo

Try these example queries to see Eureka in action:

```bash
# Biomedical query with quality filtering
POST /v1/lit/search
{
  "query": "metformin for type 2 diabetes",
  "filters": { "year_min": 2020, "min_citations": 10 }
}

# Comparative query (automatically normalized)
POST /v1/lit/search
{
  "query": "What is better than statins for cholesterol?",
  "filters": { "include_preprints": true }
}

# Cross-domain interdisciplinary query
POST /v1/lit/search
{
  "query": "machine learning for drug discovery",
  "filters": { "year_min": 2020 }
}
```

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
