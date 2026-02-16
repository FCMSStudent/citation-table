// deno-lint-ignore-file
declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};
import type { ExpansionMode, OpenAlexWork, UnifiedPaper } from "./types.ts";
import { resolvePreparedQuery } from "./query-builder.ts";
import { normalizeDoi, reconstructAbstract } from "./normalization.ts";
import { fetchWithRetry } from "./http.ts";

const OPENALEX_PROVIDER_TIMEOUT_MS = 8_000;
const OPENALEX_PROVIDER_RETRIES = 4;
const OPENALEX_BATCH_LOOKUP_SIZE = 50;
const OPENALEX_SELECT_FIELDS =
  "id,title,publication_year,abstract_inverted_index,authorships,primary_location,best_oa_location,doi,type,cited_by_count,referenced_works,is_retracted";

interface OpenAlexListResponse {
  results?: OpenAlexWork[];
}

function buildOpenAlexHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": Deno.env.get("OPENALEX_USER_AGENT") || "ResearchAssistant/1.0 (mailto:research@example.com)",
  };
}

function normalizeOpenAlexWorkId(rawRef: string): string {
  return rawRef
    .trim()
    .replace(/^https?:\/\/openalex\.org\//i, "")
    .toUpperCase();
}

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
  const apiKey = Deno.env.get("OPENALEX_API_KEY");
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", prepared.apiQuery);
  url.searchParams.set("filter", "has_abstract:true");
  url.searchParams.set("per-page", "25");
  url.searchParams.set("sort", "relevance_score:desc");
  url.searchParams.set("select", OPENALEX_SELECT_FIELDS);

  if (apiKey) {
    url.searchParams.set("api_key", apiKey);
    console.log("[OpenAlex] Using API key for polite pool access");
  }

  console.log(
    `[OpenAlex] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"`,
  );

  try {
    const response = await fetchWithRetry(
      url.toString(),
      { headers: buildOpenAlexHeaders() },
      {
        label: "openalex-search",
        timeoutMs: OPENALEX_PROVIDER_TIMEOUT_MS,
        maxRetries: OPENALEX_PROVIDER_RETRIES,
        onRetry: ({ attempt, delayMs, reason }) => {
          console.warn(`[OpenAlex] Retry #${attempt} in ${delayMs}ms (${reason})`);
        },
      },
    );

    if (!response.ok) {
      console.error(`[OpenAlex] API error: ${response.status}`);
      return [];
    }

    const data = await response.json() as OpenAlexListResponse;
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
  const headers = buildOpenAlexHeaders();

  const batches: UnifiedPaper[] = [];
  for (let i = 0; i < uniqueRefs.length; i += OPENALEX_BATCH_LOOKUP_SIZE) {
    const chunk = uniqueRefs.slice(i, i + OPENALEX_BATCH_LOOKUP_SIZE);
    const normalizedChunk = chunk.map(normalizeOpenAlexWorkId).filter(Boolean);
    if (normalizedChunk.length === 0) continue;

    const queryUrl = new URL("https://api.openalex.org/works");
    queryUrl.searchParams.set("filter", `openalex_id:${normalizedChunk.join("|")}`);
    queryUrl.searchParams.set("per-page", String(normalizedChunk.length));
    queryUrl.searchParams.set("select", OPENALEX_SELECT_FIELDS);
    if (apiKey) queryUrl.searchParams.set("api_key", apiKey);

    let response: Response;
    try {
      response = await fetchWithRetry(
        queryUrl.toString(),
        { headers },
        {
          label: "openalex-expand",
          timeoutMs: OPENALEX_PROVIDER_TIMEOUT_MS,
          maxRetries: OPENALEX_PROVIDER_RETRIES,
          onRetry: ({ attempt, delayMs, reason }) => {
            console.warn(`[OpenAlex] Expansion retry #${attempt} in ${delayMs}ms (${reason})`);
          },
        },
      );
    } catch {
      continue;
    }

    if (!response.ok) continue;
    const payload = await response.json() as OpenAlexListResponse;
    const byId = new Map<string, OpenAlexWork>();
    for (const work of payload.results || []) {
      const normalizedId = normalizeOpenAlexWorkId(work.id || "");
      if (!normalizedId) continue;
      byId.set(normalizedId, work);
    }

    for (let idx = 0; idx < normalizedChunk.length; idx += 1) {
      const normalizedId = normalizedChunk[idx];
      const work = byId.get(normalizedId);
      if (!work) continue;
      const paper = toUnifiedFromOpenAlex(work, 0.2 / (i + idx + 1));
      if (!paper.abstract || paper.abstract.length < 50) continue;
      batches.push(paper);
      if (batches.length >= maxAdditional) break;
    }

    if (batches.length >= maxAdditional) {
      break;
    }
  }

  return batches.slice(0, maxAdditional);
}
