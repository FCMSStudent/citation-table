

# Add PubMed Search Support

## Overview

Add NCBI PubMed/E-utilities as a fourth search source alongside Semantic Scholar, OpenAlex, and arXiv. PubMed is the gold standard for biomedical literature and will significantly improve recall for medical research queries.

## How It Works

The search pipeline currently runs Semantic Scholar, OpenAlex, and arXiv sequentially, deduplicates results, then sends them to the LLM for extraction. PubMed will be added as a parallel source that fetches papers via the NCBI E-utilities API (free, no API key required for moderate usage).

PubMed's E-utilities workflow:
1. **ESearch** -- search PubMed and get a list of PMIDs
2. **EFetch** -- fetch full article metadata (title, authors, abstract, DOI, year, journal) for those PMIDs in XML format

## Changes

### 1. Database Migration

Add a `pubmed_count` column to `research_reports` to track how many papers came from PubMed (matching the existing `openalex_count`, `semantic_scholar_count`, `arxiv_count` pattern).

```sql
ALTER TABLE public.research_reports
  ADD COLUMN pubmed_count integer DEFAULT 0;
```

### 2. Backend -- Edge Function (`supabase/functions/research-async/index.ts`)

**New types:**
- Add `"pubmed"` to the `source` union type in `StudyResult` and `UnifiedPaper`
- Add `SearchSource` type update to include `"pubmed"`

**New function -- `searchPubMed(query, mode)`:**
- Uses the extracted keywords to call ESearch: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=QUERY&retmax=25&retmode=json`
- Takes the returned PMIDs and calls EFetch: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=PMIDS&rettype=xml`
- Parses the XML response (regex-based, matching the existing arXiv pattern) to extract title, authors, abstract, year, DOI, journal, and PMID
- Returns `UnifiedPaper[]` with `source: "pubmed"`
- All papers are `preprint_status: "Peer-reviewed"` (PubMed indexes peer-reviewed literature)
- Rate limited with a 350ms delay between requests (NCBI asks for max 3 req/sec without API key)

**Pipeline changes (`runResearchPipeline`):**
- Call `searchPubMed()` alongside the existing three sources
- Pass PubMed papers into `deduplicateAndMerge()` as a fourth array
- Track `pubmed_count` in the pipeline result and store it in the database

**Deduplication:**
- PubMed papers will naturally deduplicate via DOI matching (most PubMed articles have DOIs)
- The existing fuzzy title matching handles the rest
- PubMed's PMID will be merged into `pubmed_id` on the unified paper during metadata merge

### 3. Frontend Types (`src/types/research.ts`)

- Add `"pubmed"` to the `source` union: `source: "openalex" | "semantic_scholar" | "arxiv" | "pubmed"`

### 4. Source Badge (`src/components/SourceBadge.tsx`)

- Add a PubMed case with a green badge (PubMed's brand color)

### 5. Report Hook (`src/hooks/useReport.ts`)

- Add `pubmed_count` to the `Report` interface

### 6. Sync `research/index.ts` (legacy function)

- Add the same `searchPubMed` function and `"pubmed"` source type to keep the legacy endpoint consistent (though `research-async` is the primary path)

## Files Modified

| File | Change |
|---|---|
| `supabase/functions/research-async/index.ts` | Add `searchPubMed()`, update pipeline, types, dedup call |
| `supabase/functions/research/index.ts` | Same PubMed function + type updates for consistency |
| `src/types/research.ts` | Add `"pubmed"` to source union |
| `src/components/SourceBadge.tsx` | Add PubMed badge (green) |
| `src/hooks/useReport.ts` | Add `pubmed_count` field |
| Database migration | Add `pubmed_count` column |

## Technical Details

**PubMed ESearch response (JSON):**
```json
{
  "esearchresult": {
    "idlist": ["12345678", "23456789", ...]
  }
}
```

**PubMed EFetch XML structure (parsed via regex):**
```xml
<PubmedArticle>
  <MedlineCitation>
    <PMID>12345678</PMID>
    <Article>
      <ArticleTitle>...</ArticleTitle>
      <Abstract><AbstractText>...</AbstractText></Abstract>
      <AuthorList>
        <Author><LastName>...</LastName><ForeName>...</ForeName></Author>
      </AuthorList>
      <Journal><Title>...</Title></Journal>
      <ArticleDate><Year>2023</Year></ArticleDate>
    </Article>
  </MedlineCitation>
  <PubmedData>
    <ArticleIdList>
      <ArticleId IdType="doi">10.1234/...</ArticleId>
    </ArticleIdList>
  </PubmedData>
</PubmedArticle>
```

**No API key needed** -- NCBI E-utilities are free for up to 3 requests/second. A 350ms delay between ESearch and EFetch calls keeps usage well within limits. If higher throughput is needed later, an NCBI API key can be added as a secret.

