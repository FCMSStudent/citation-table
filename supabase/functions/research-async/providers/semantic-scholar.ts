// deno-lint-ignore-file
declare const Deno: any;
import type { ExpansionMode, SemanticScholarPaper, UnifiedPaper } from "./types.ts";
import { resolvePreparedQuery } from "./query-builder.ts";

let lastS2RequestTime = 0;

async function s2RateLimit() {
  const now = Date.now();
  const elapsed = now - lastS2RequestTime;
  if (elapsed < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
  }
  lastS2RequestTime = Date.now();
}

export async function searchSemanticScholar(
  query: string,
  mode: ExpansionMode = "balanced",
  precompiledQuery?: string,
): Promise<UnifiedPaper[]> {
  const prepared = resolvePreparedQuery(query, "semantic_scholar", mode, precompiledQuery);
  if (!prepared.apiQuery) return [];

  const encodedQuery = encodeURIComponent(prepared.apiQuery);
  const fields = "paperId,title,abstract,year,authors,venue,citationCount,publicationTypes,externalIds,openAccessPdf,url,isRetracted,references.paperId";
  const url = `https://api.semanticscholar.org/graph/v1/paper/search/bulk?query=${encodedQuery}&fields=${fields}`;
  const apiKey = Deno.env.get("SEMANTIC_SCHOLAR_API_KEY");

  console.log(
    `[SemanticScholar] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"${apiKey ? " (with API key)" : " (public tier)"}`,
  );

  try {
    await s2RateLimit();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;

    const response = await fetch(url, { headers });
    if (!response.ok) {
      console.error(`[SemanticScholar] API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const papers: SemanticScholarPaper[] = data.data || [];
    console.log(`[SemanticScholar] Found ${papers.length} papers`);

    return papers
      .filter((paper) => paper.abstract && paper.abstract.length > 50)
      .slice(0, 50)
      .map((paper, idx) => ({
        id: paper.paperId,
        title: paper.title || "Untitled",
        year: paper.year || new Date().getFullYear(),
        abstract: paper.abstract || "",
        authors: paper.authors?.map((author) => author.name) || ["Unknown"],
        venue: paper.venue || "",
        doi: paper.externalIds?.DOI || null,
        pubmed_id: paper.externalIds?.PubMed || null,
        openalex_id: null,
        source: "semantic_scholar" as const,
        citationCount: paper.citationCount,
        publicationTypes: paper.publicationTypes ?? undefined,
        pdfUrl: paper.openAccessPdf?.url || null,
        landingPageUrl: paper.url || null,
        referenced_ids: (paper.references || []).map((ref) => ref.paperId).filter(Boolean),
        is_retracted: Boolean(paper.isRetracted),
        preprint_status: (paper.publicationTypes || []).some((ptype) => /preprint/i.test(ptype)) ? "Preprint" : "Peer-reviewed",
        rank_signal: 1 / (idx + 1),
      }));
  } catch (error) {
    console.error("[SemanticScholar] Error:", error);
    return [];
  }
}
