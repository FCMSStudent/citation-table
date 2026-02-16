// deno-lint-ignore-file
declare const Deno: any;
import type { ExpansionMode, SemanticScholarPaper, UnifiedPaper } from "./types.ts";
import { resolvePreparedQuery } from "./query-builder.ts";
import { fetchWithRetry } from "./http.ts";

let lastS2RequestTime = 0;
const SEMANTIC_SCHOLAR_TIMEOUT_MS = 8_000;
const SEMANTIC_SCHOLAR_MAX_RETRIES = 4;
const SEMANTIC_SCHOLAR_MAX_PAGES = 5;
const SEMANTIC_SCHOLAR_RESULT_CAP = 50;

interface SemanticScholarBulkSearchResponse {
  data?: SemanticScholarPaper[];
  token?: string;
}

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

  const fields = "paperId,title,abstract,year,authors,venue,citationCount,publicationTypes,externalIds,openAccessPdf,url,isRetracted,references.paperId";
  const baseUrl = new URL("https://api.semanticscholar.org/graph/v1/paper/search/bulk");
  baseUrl.searchParams.set("query", prepared.apiQuery);
  baseUrl.searchParams.set("fields", fields);
  const apiKey = Deno.env.get("SEMANTIC_SCHOLAR_API_KEY");

  console.log(
    `[SemanticScholar] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"${apiKey ? " (with API key)" : " (public tier)"}`,
  );

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;

    const papers: SemanticScholarPaper[] = [];
    let token: string | undefined;

    for (let page = 0; page < SEMANTIC_SCHOLAR_MAX_PAGES; page += 1) {
      const pageUrl = new URL(baseUrl.toString());
      if (token) pageUrl.searchParams.set("token", token);

      await s2RateLimit();
      const response = await fetchWithRetry(
        pageUrl.toString(),
        { headers },
        {
          label: "semantic-scholar-search",
          timeoutMs: SEMANTIC_SCHOLAR_TIMEOUT_MS,
          maxRetries: SEMANTIC_SCHOLAR_MAX_RETRIES,
          onRetry: ({ attempt, delayMs, reason }) => {
            console.warn(`[SemanticScholar] Retry #${attempt} in ${delayMs}ms (${reason})`);
          },
        },
      );

      if (!response.ok) {
        console.error(`[SemanticScholar] API error: ${response.status}`);
        break;
      }

      const data = await response.json() as SemanticScholarBulkSearchResponse;
      const batch = data.data || [];
      for (const paper of batch) {
        if (!paper.abstract || paper.abstract.length <= 50) continue;
        papers.push(paper);
        if (papers.length >= SEMANTIC_SCHOLAR_RESULT_CAP) break;
      }
      if (papers.length >= SEMANTIC_SCHOLAR_RESULT_CAP) break;
      if (!data.token) break;
      token = data.token;
    }

    console.log(`[SemanticScholar] Found ${papers.length} papers`);

    return papers
      .slice(0, SEMANTIC_SCHOLAR_RESULT_CAP)
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
