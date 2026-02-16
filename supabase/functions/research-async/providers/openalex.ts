import type { ExpansionMode, OpenAlexWork, UnifiedPaper } from "./types.ts";
import { resolvePreparedQuery } from "./query-builder.ts";
import { normalizeDoi, reconstructAbstract } from "./normalization.ts";
import { withTimeout } from "./http.ts";

const OPENALEX_PROVIDER_TIMEOUT_MS = 8_000;

function toUnifiedFromOpenAlex(work: OpenAlexWork, rankSignal: number): UnifiedPaper {
  return {
    id: work.id,
    title: work.title || "Untitled",
    year: work.publication_year || new Date().getFullYear(),
    abstract: reconstructAbstract(work.abstract_inverted_index),
    authors: work.authorships?.map((author) => author.author.display_name) || ["Unknown"],
    venue: work.primary_location?.source?.display_name || "",
    doi: normalizeDoi(work.doi),
    pubmed_id: null,
    openalex_id: work.id,
    source: "openalex",
    citationCount: work.cited_by_count,
    publicationTypes: work.type ? [work.type] : undefined,
    pdfUrl: work.best_oa_location?.pdf_url || null,
    landingPageUrl: work.best_oa_location?.landing_page_url || null,
    referenced_ids: work.referenced_works || [],
    is_retracted: Boolean(work.is_retracted),
    preprint_status: work.type === "preprint" ? "Preprint" : "Peer-reviewed",
    rank_signal: rankSignal,
  };
}

export async function searchOpenAlex(
  query: string,
  mode: ExpansionMode = "balanced",
  precompiledQuery?: string,
): Promise<UnifiedPaper[]> {
  const prepared = resolvePreparedQuery(query, "openalex", mode, precompiledQuery);
  const encodedQuery = encodeURIComponent(prepared.apiQuery);
  const apiKey = Deno.env.get("OPENALEX_API_KEY");
  let url = `https://api.openalex.org/works?search=${encodedQuery}&filter=has_abstract:true&per_page=25&sort=relevance_score:desc`;

  if (apiKey) {
    url += `&api_key=${apiKey}`;
    console.log("[OpenAlex] Using API key for polite pool access");
  }

  console.log(
    `[OpenAlex] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"`,
  );

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ResearchAssistant/1.0 (mailto:research@example.com)",
      },
    });

    if (!response.ok) {
      console.error(`[OpenAlex] API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const works: OpenAlexWork[] = data.results || [];
    console.log(`[OpenAlex] Found ${works.length} papers`);
    return works.map((work, idx) => toUnifiedFromOpenAlex(work, 1 / (idx + 1)));
  } catch (error) {
    console.error("[OpenAlex] Error:", error);
    return [];
  }
}

export async function expandOpenAlexCitationGraph(
  seedPapers: UnifiedPaper[],
  maxAdditional: number,
): Promise<UnifiedPaper[]> {
  if (maxAdditional <= 0) return [];

  const openAlexSeeds = seedPapers
    .filter((paper) => paper.source === "openalex")
    .filter((paper) => (paper.referenced_ids || []).length > 0)
    .slice(0, 20);

  if (openAlexSeeds.length === 0) return [];

  const references: string[] = [];
  for (const seed of openAlexSeeds) {
    for (const ref of seed.referenced_ids || []) {
      if (!ref) continue;
      references.push(ref);
      if (references.length >= maxAdditional) break;
    }
    if (references.length >= maxAdditional) break;
  }

  const uniqueRefs = Array.from(new Set(references)).slice(0, maxAdditional);
  const apiKey = Deno.env.get("OPENALEX_API_KEY");

  const batches: UnifiedPaper[] = [];
  const concurrency = 12;

  for (let i = 0; i < uniqueRefs.length; i += concurrency) {
    const chunk = uniqueRefs.slice(i, i + concurrency);
    const fetched = await Promise.all(
      chunk.map(async (rawRef, index) => {
        const refId = rawRef.replace(/^https?:\/\/openalex\.org\//, "");
        if (!refId) return null;

        const baseUrl = `https://api.openalex.org/works/${encodeURIComponent(refId)}`;
        const url = apiKey ? `${baseUrl}?api_key=${apiKey}` : baseUrl;

        try {
          const response = await withTimeout(
            fetch(url, { headers: { Accept: "application/json" } }),
            OPENALEX_PROVIDER_TIMEOUT_MS,
            "openalex-expand",
          );
          if (!response.ok) return null;
          const work = (await response.json()) as OpenAlexWork;
          return toUnifiedFromOpenAlex(work, 0.2 / (index + 1));
        } catch {
          return null;
        }
      }),
    );

    for (const paper of fetched) {
      if (!paper || !paper.abstract || paper.abstract.length < 50) continue;
      batches.push(paper);
      if (batches.length >= maxAdditional) break;
    }

    if (batches.length >= maxAdditional) break;
  }

  return batches.slice(0, maxAdditional);
}
