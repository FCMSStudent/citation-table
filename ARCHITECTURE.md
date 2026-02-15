# Eureka System Architecture

## High-Level Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                              User Layer                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │   Browser    │  │  Mobile App  │  │   API Client │                │
│  │   (React)    │  │   (Future)   │  │              │                │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                │
└─────────┼──────────────────┼──────────────────┼─────────────────────────┘
          │                  │                  │
          └──────────────────┴──────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         API Gateway Layer                               │
│                      (Supabase Edge Functions)                         │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                   research-async (Main Orchestrator)             │  │
│  │  • Query Processing v2                                           │  │
│  │  • Federated Search Coordination                                │  │
│  │  • Deduplication & Canonicalization                             │  │
│  │  • Quality Gating                                               │  │
│  │  • Evidence Extraction                                          │  │
│  │  • Brief Generation                                             │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │metadata-     │  │chat-papers   │  │coci          │                │
│  │enrichment-   │  │              │  │              │                │
│  │worker        │  │(AI synthesis)│  │(citations)   │                │
│  └──────────────┘  └──────────────┘  └──────────────┘                │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐                                   │
│  │scihub-       │  │synthesize-   │                                   │
│  │download      │  │papers        │                                   │
│  │(PDF fetch)   │  │              │                                   │
│  └──────────────┘  └──────────────┘                                   │
└─────────┬──────────────────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Data Processing Layer                              │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    Query Processing Module                       │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │  │
│  │  │Normalization │  │Synonym       │  │Source-       │          │  │
│  │  │              │  │Expansion     │  │Specific      │          │  │
│  │  │              │  │              │  │Compilation   │          │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                   Retrieval Coordination                         │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │  │
│  │  │Parallel      │  │Timeout       │  │Graceful      │          │  │
│  │  │Execution     │  │Handling      │  │Degradation   │          │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                 Deduplication Pipeline                           │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │  │
│  │  │DOI/PMID      │  │Fuzzy Title   │  │Provenance    │          │  │
│  │  │Matching      │  │Matching      │  │Merging       │          │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    Quality Control                               │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │  │
│  │  │Hard          │  │Quality       │  │Metadata      │          │  │
│  │  │Rejection     │  │Scoring       │  │Validation    │          │  │
│  │  │Rules         │  │              │  │              │          │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                  AI Processing Layer                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │  │
│  │  │Claim         │  │Outcome       │  │Brief         │          │  │
│  │  │Extraction    │  │Clustering    │  │Generation    │          │  │
│  │  │              │  │              │  │              │          │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────┬──────────────────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    External Services Layer                              │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │  OpenAlex    │  │  Semantic    │  │   PubMed     │                │
│  │              │  │  Scholar     │  │              │                │
│  │50k req/day   │  │100 req/min   │  │Rate limited  │                │
│  └──────────────┘  └──────────────┘  └──────────────┘                │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│  │   arXiv      │  │Google Gemini │  │  SciHub      │                │
│  │              │  │    (AI)      │  │  (PDFs)      │                │
│  │No rate limit │  │60 req/min    │  │Best effort   │                │
│  └──────────────┘  └──────────────┘  └──────────────┘                │
└─────────┬──────────────────────────────────────────────────────────────┘
          │
          ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Storage Layer (PostgreSQL)                        │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    Core Research Tables                          │  │
│  │  • research_reports (search results, evidence tables, briefs)   │  │
│  │  • study_pdfs (PDF download tracking)                           │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                      Cache Tables                                │  │
│  │  • lit_query_cache (6h TTL, query results)                      │  │
│  │  • lit_paper_cache (30d TTL, paper metadata)                    │  │
│  │  • metadata_enrichment_cache (provider lookups)                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                  Deduplication Tables                            │  │
│  │  • dim_canonical_record (canonical paper records)               │  │
│  │  • fact_duplicate_link (source-to-canonical mappings)           │  │
│  │  • raw_publication_ingest (staging)                             │  │
│  │  • stg_records_normalized (normalized staging)                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                  Metadata Enrichment                             │  │
│  │  • metadata_enrichment_jobs (job queue)                         │  │
│  │  • metadata_enrichment_events (audit trail)                     │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    Monitoring & Analytics                        │  │
│  │  • query_processing_events (query analysis)                     │  │
│  │  • query_benchmark_runs (performance tracking)                  │  │
│  │  • rate_limits (API throttling)                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Request Flow Diagram

### Standard Search Request Flow

```
1. User submits query
   │
   ├─► POST /v1/lit/search
   │   {
   │     "query": "metformin for diabetes",
   │     "filters": { "year_min": 2020 }
   │   }
   │
   ▼
2. Query Processing v2
   │
   ├─► Normalize comparative language
   ├─► Remove question prefixes
   ├─► Expand biomedical synonyms
   ├─► Compile source-specific queries
   │
   ▼
3. Cache Lookup
   │
   ├─► Query hash: md5(query + filters)
   ├─► Check lit_query_cache
   │
   ├─► CACHE HIT? ───► Return cached results (200ms)
   │                   └─► END
   │
   └─► CACHE MISS
       │
       ▼
4. Federated Retrieval (Parallel)
   │
   ├─► Thread 1: OpenAlex API
   │   ├─► Search query
   │   ├─► Citation graph expansion
   │   └─► Returns 142 papers
   │
   ├─► Thread 2: Semantic Scholar API
   │   ├─► Search query
   │   └─► Returns 89 papers
   │
   ├─► Thread 3: PubMed API
   │   ├─► Search query
   │   └─► Returns 67 papers
   │
   └─► Thread 4: arXiv API
       ├─► Search query
       └─► Returns 23 papers
   │
   ▼
5. Deduplication Pipeline
   │
   ├─► Stage 1: DOI matching
   ├─► Stage 2: PMID matching
   ├─► Stage 3: arXiv ID matching
   ├─► Stage 4: Fuzzy title matching
   │
   ├─► Input: 321 papers
   └─► Output: 187 canonical papers
   │
   ▼
6. Quality Gating
   │
   ├─► Hard rejections:
   │   ├─► Retracted papers ❌
   │   ├─► Preprints (if excluded) ❌
   │   └─► Outside year range ❌
   │
   ├─► Quality scoring:
   │   ├─► Source authority (30%)
   │   ├─► Study design (25%)
   │   ├─► Methods transparency (20%)
   │   ├─► Citation impact (15%)
   │   └─► Recency (10%)
   │
   ├─► Threshold: 0.6
   ├─► Input: 187 papers
   └─► Output: 73 high-quality papers
   │
   ▼
7. AI Evidence Extraction (Batched)
   │
   ├─► Batch 1 (papers 1-10)
   │   ├─► Extract study design
   │   ├─► Extract outcomes
   │   ├─► Extract effect sizes
   │   └─► Generate citation anchors
   │
   ├─► Batch 2 (papers 11-20)
   │   └─► ... (parallel processing)
   │
   └─► ... (continue for all papers)
   │
   ▼
8. Outcome Clustering
   │
   ├─► Extract all outcomes
   ├─► Compute pairwise similarity
   ├─► Group by Jaccard threshold
   ├─► Assign cluster labels
   └─► Detect disposition (positive/negative/conflicting)
   │
   ▼
9. Brief Generation
   │
   ├─► Synthesize narrative text
   ├─► Add multi-citation anchors
   ├─► Include stance metadata
   └─► Validate character positions
   │
   ▼
10. Store Results
    │
    ├─► Save to research_reports table
    ├─► Cache in lit_query_cache (6h TTL)
    ├─► Cache papers in lit_paper_cache (30d TTL)
    └─► Log coverage stats
    │
    ▼
11. Return Response
    └─► {
          "search_id": "uuid",
          "status": "completed",
          "results": {
            "evidence_table": [...],
            "brief_json": {...},
            "coverage_report": {...}
          }
        }
```

---

## Data Flow: Deduplication Pipeline

```
┌──────────────────────────────────────────────────────┐
│         Raw Papers from Multiple Sources             │
│  • OpenAlex: 142 papers                              │
│  • Semantic Scholar: 89 papers                       │
│  • PubMed: 67 papers                                 │
│  • arXiv: 23 papers                                  │
│  Total: 321 papers                                   │
└────────────────┬─────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│        Stage 1: Insert into raw_publication_ingest   │
│  • Preserve all source metadata                      │
│  • Generate source-specific IDs                      │
│  • Track ingestion timestamp                         │
└────────────────┬─────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│      Stage 2: Normalize into stg_records_normalized  │
│  • Extract DOI (if present)                          │
│  • Extract PMID (if present)                         │
│  • Extract arXiv ID (if present)                     │
│  • Normalize title (lowercase, remove punctuation)   │
│  • Parse year                                        │
└────────────────┬─────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│     Stage 3: DOI-Based Deduplication (Highest Priority) │
│  ┌────────────────────────────────────────────────┐  │
│  │  SELECT * FROM stg_records_normalized          │  │
│  │  WHERE doi IS NOT NULL                         │  │
│  │  GROUP BY doi                                  │  │
│  └────────────────────────────────────────────────┘  │
│  • 234 papers have DOI                               │
│  • 178 unique DOIs                                   │
│  • 56 duplicates removed                             │
└────────────────┬─────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│   Stage 4: PMID-Based Deduplication (Second Priority)│
│  ┌────────────────────────────────────────────────┐  │
│  │  SELECT * FROM stg_records_normalized          │  │
│  │  WHERE doi IS NULL AND pubmed_id IS NOT NULL   │  │
│  │  GROUP BY pubmed_id                            │  │
│  └────────────────────────────────────────────────┘  │
│  • 67 papers have PMID (no DOI)                      │
│  • 63 unique PMIDs                                   │
│  • 4 duplicates removed                              │
└────────────────┬─────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│  Stage 5: arXiv-Based Deduplication (Third Priority) │
│  ┌────────────────────────────────────────────────┐  │
│  │  SELECT * FROM stg_records_normalized          │  │
│  │  WHERE doi IS NULL AND pubmed_id IS NULL       │  │
│  │    AND arxiv_id IS NOT NULL                    │  │
│  │  GROUP BY arxiv_id                             │  │
│  └────────────────────────────────────────────────┘  │
│  • 23 papers have arXiv ID (no DOI/PMID)             │
│  • 21 unique arXiv IDs                               │
│  • 2 duplicates removed                              │
└────────────────┬─────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│     Stage 6: Fuzzy Title Matching (Last Resort)      │
│  ┌────────────────────────────────────────────────┐  │
│  │  For each paper without identifier:            │  │
│  │    1. Compute normalized title hash            │  │
│  │    2. Compare with existing canonical records  │  │
│  │    3. If similarity > 0.85:                    │  │
│  │       - Mark as duplicate                      │  │
│  │       - Link to canonical record               │  │
│  └────────────────────────────────────────────────┘  │
│  • 18 papers without identifiers                     │
│  • 7 matched by fuzzy title                          │
│  • 11 new canonical records                          │
└────────────────┬─────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│    Stage 7: Create Canonical Records & Links         │
│  ┌────────────────────────────────────────────────┐  │
│  │  INSERT INTO dim_canonical_record              │  │
│  │    (canonical_id, doi, pubmed_id, arxiv_id)    │  │
│  │  VALUES (uuid, ..., ..., ...)                  │  │
│  │                                                │  │
│  │  INSERT INTO fact_duplicate_link               │  │
│  │    (source_id, canonical_id, confidence_score) │  │
│  │  VALUES ('openalex:W123', uuid, 0.98)          │  │
│  └────────────────────────────────────────────────┘  │
│  • 187 canonical records created                     │
│  • 321 source-to-canonical links established         │
│  • Average confidence: 0.94                          │
└────────────────┬─────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│           Stage 8: Provenance Merging                │
│  For each canonical record:                          │
│    • Collect all source records                      │
│    • Merge metadata by source priority:              │
│      1. PubMed (priority 3)                          │
│      2. OpenAlex (priority 2)                        │
│      3. Semantic Scholar (priority 1)                │
│    • Resolve conflicts by priority                   │
│    • Track all source IDs                            │
└────────────────┬─────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│              Final Output                             │
│  • 187 unique canonical papers                       │
│  • Full provenance tracking                          │
│  • Deduplication rate: 41.7%                         │
│  • Average merge confidence: 0.94                    │
└──────────────────────────────────────────────────────┘
```

---

## Quality Gating Decision Tree

```
                         Paper Input
                             │
                             ▼
                    ┌────────────────┐
                    │  Is Retracted? │
                    └────────┬───────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                   Yes               No
                    │                 │
                    ▼                 ▼
              ❌ REJECT      ┌────────────────┐
                             │  Is Preprint?  │
                             └────────┬───────┘
                                      │
                             ┌────────┴────────┐
                             │                 │
                         Yes/No           Check Settings
                             │                 │
                    ┌────────┴────────┐        │
                    │                 │        │
          include_preprints=false   include_preprints=true
                    │                 │
                    ▼                 ▼
              ❌ REJECT          ┌────────────────┐
                                 │ Year in Range? │
                                 └────────┬───────┘
                                          │
                                 ┌────────┴────────┐
                                 │                 │
                                No               Yes
                                 │                 │
                                 ▼                 ▼
                           ❌ REJECT      ┌────────────────┐
                                          │ Has Methods    │
                                          │ Metadata?      │
                                          └────────┬───────┘
                                                   │
                                          ┌────────┴────────┐
                                          │                 │
                                         No               Yes
                                          │                 │
                                          ▼                 ▼
                                    ❌ REJECT      ┌────────────────┐
                                       (empirical  │ Calculate      │
                                        studies)   │ Quality Score  │
                                                   └────────┬───────┘
                                                            │
                                                            ▼
                                                   ┌────────────────┐
                                                   │ Score >= 0.6?  │
                                                   └────────┬───────┘
                                                            │
                                                   ┌────────┴────────┐
                                                   │                 │
                                                  No               Yes
                                                   │                 │
                                                   ▼                 ▼
                                             ❌ REJECT          ✅ ACCEPT
                                                                     │
                                                                     ▼
                                                            ┌────────────────┐
                                                            │ Add to         │
                                                            │ Evidence Table │
                                                            └────────────────┘

Quality Score Calculation:
─────────────────────────
Score = (Source Authority × 0.30) +
        (Study Design × 0.25) +
        (Methods Transparency × 0.20) +
        (Citation Impact × 0.15) +
        (Recency × 0.10)

Component Scoring:
─────────────────
Source Authority:
  • PubMed: 0.98
  • OpenAlex: 0.92
  • Semantic Scholar: 0.90
  • arXiv: 0.85

Study Design:
  • Meta-analysis: 0.90
  • RCT: 0.86
  • Cohort: 0.72
  • Cross-sectional: 0.64
  • Unknown: 0.40

Methods Transparency:
  • Signal words present + numeric data: 0.90
  • Signal words present: 0.70
  • Some methods description: 0.50
  • Minimal/none: 0.30

Citation Impact:
  • Field-normalized citations
  • Adjusted for paper age
  • Score: min(citations / (age_years × field_avg), 1.0)

Recency:
  • Within requested timeframe: bonus +0.15
  • Exponential decay: exp(-0.1 × years_old)
```

---

## Caching Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Request Entry Point                          │
│                   POST /v1/lit/search                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Generate       │
                    │ Query Hash     │
                    │ (MD5)          │
                    └────────┬───────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                    Cache Layer 1: Query Cache                  │
│                    (TTL: 6 hours)                              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  SELECT lit_response, coverage_report, search_stats      │ │
│  │  FROM lit_query_cache                                    │ │
│  │  WHERE query_hash = $1 AND expires_at > NOW()           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                             │                                  │
│                    ┌────────┴────────┐                         │
│                    │                 │                         │
│                  Found            Not Found                    │
│                    │                 │                         │
│                    ▼                 │                         │
│          ┌────────────────┐          │                         │
│          │ Return Cached  │          │                         │
│          │ Results        │          │                         │
│          │ (~200ms)       │          │                         │
│          └────────────────┘          │                         │
└──────────────────────────────────────┼─────────────────────────┘
                                       │
                                       ▼
┌────────────────────────────────────────────────────────────────┐
│              Cache Layer 2: Paper Metadata Cache               │
│                    (TTL: 30 days)                              │
│  For each paper in search results:                            │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  SELECT paper_metadata                                   │ │
│  │  FROM lit_paper_cache                                    │ │
│  │  WHERE paper_id = $1 AND expires_at > NOW()             │ │
│  └──────────────────────────────────────────────────────────┘ │
│                             │                                  │
│                    ┌────────┴────────┐                         │
│                    │                 │                         │
│                  Found            Not Found                    │
│                    │                 │                         │
│                    ▼                 ▼                         │
│          ┌────────────────┐  ┌────────────────┐               │
│          │ Use Cached     │  │ Fetch from     │               │
│          │ Metadata       │  │ Provider API   │               │
│          └────────────────┘  └────────┬───────┘               │
│                                       │                         │
│                                       ▼                         │
│                              ┌────────────────┐                │
│                              │ Cache Result   │                │
│                              │ (30d TTL)      │                │
│                              └────────────────┘                │
└────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌────────────────────────────────────────────────────────────────┐
│        Cache Layer 3: Metadata Enrichment Cache                │
│                 (Variable TTL based on outcome)                │
│  For each enrichment lookup:                                  │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  SELECT enrichment_data, outcome                         │ │
│  │  FROM metadata_enrichment_cache                          │ │
│  │  WHERE lookup_key = $1 AND expires_at > NOW()           │ │
│  └──────────────────────────────────────────────────────────┘ │
│                             │                                  │
│                    ┌────────┴────────┐                         │
│                    │                 │                         │
│                  Found            Not Found                    │
│                    │                 │                         │
│                    ▼                 ▼                         │
│          ┌────────────────┐  ┌────────────────┐               │
│          │ Return Cached  │  │ Execute        │               │
│          │ Enrichment     │  │ Enrichment     │               │
│          └────────────────┘  └────────┬───────┘               │
│                                       │                         │
│                                       ▼                         │
│                              ┌────────────────┐                │
│                              │ Cache Result:  │                │
│                              │ • accepted: 30d│                │
│                              │ • not_found: 7d│                │
│                              │ • error: 1h    │                │
│                              └────────────────┘                │
└────────────────────────────────────────────────────────────────┘

Cache Hit Rates (Production Data):
─────────────────────────────────
Query Cache:        38% hit rate → 99% latency reduction
Paper Cache:        67% hit rate → 85% latency reduction
Enrichment Cache:   54% hit rate → 70% latency reduction

Overall Performance Impact:
──────────────────────────
Without cache:  ~23s average response time
With cache:     ~0.2s average response time (cache hit)
                ~15s average response time (partial cache miss)
```

This architecture ensures:
1. **Minimal redundant API calls** to external providers
2. **Fast response times** for repeated queries
3. **Cost optimization** by reducing AI API usage
4. **Graceful degradation** when caches are cold
