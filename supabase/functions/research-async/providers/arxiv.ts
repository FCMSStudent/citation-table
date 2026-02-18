import type { ExpansionMode, UnifiedPaper } from "./types.ts";
import { resolvePreparedQuery } from "./query-builder.ts";
import { fetchWithRetry, sleep } from "./http.ts";

const ARXIV_TIMEOUT_MS = 8_000;
const ARXIV_MAX_RETRIES = 4;
const ARXIV_MIN_INTERVAL_MS = 3_000;

function createRateLimiter(minIntervalMs: number): () => Promise<void> {
  let lastRequestAt = 0;
  return async () => {
    const elapsedMs = Date.now() - lastRequestAt;
    if (elapsedMs < minIntervalMs) {
      await sleep(minIntervalMs - elapsedMs);
    }
    lastRequestAt = Date.now();
  };
}

export async function searchArxiv(
  query: string,
  mode: ExpansionMode = "balanced",
  precompiledQuery?: string,
): Promise<UnifiedPaper[]> {
  const prepared = resolvePreparedQuery(query, "arxiv", mode, precompiledQuery);
  if (!prepared.apiQuery) return [];

  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${prepared.apiQuery}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", "25");
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("sortOrder", "descending");

  console.log(
    `[ArXiv] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"`,
  );

  const rateLimit = createRateLimiter(ARXIV_MIN_INTERVAL_MS);
  await rateLimit();
  const response = await fetchWithRetry(
    url.toString(),
    { headers: { Accept: "application/atom+xml,text/xml;q=0.9,*/*;q=0.8" } },
    {
      label: "arxiv-search",
      timeoutMs: ARXIV_TIMEOUT_MS,
      maxRetries: ARXIV_MAX_RETRIES,
      shouldRetryStatus: (status) => status === 429 || status >= 500,
      onRetry: ({ attempt, delayMs, reason }) => {
        console.warn(`[ArXiv] Retry #${attempt} in ${delayMs}ms (${reason})`);
      },
    },
  );
  if (!response.ok) {
    throw new Error(`[ArXiv] API error ${response.status}`);
  }

  const xmlText = await response.text();
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  const papers: UnifiedPaper[] = [];
  const feedErrors: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entry = match[1];
    if (/<title[^>]*>\s*Error\s*<\/title>/i.test(entry)) {
      const errorSummary = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1]?.trim().replace(/\s+/g, " ");
      feedErrors.push(errorSummary || "Unknown error");
      continue;
    }

    const getTag = (tag: string): string => {
      const tagMatch = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return tagMatch ? tagMatch[1].trim().replace(/\s+/g, " ") : "";
    };

    const fullId = getTag("id");
    const title = getTag("title");
    const published = getTag("published");
    const abstract = getTag("summary");

    if (!fullId || !title || !abstract || abstract.length < 50) continue;

    const arxivId = fullId
      .replace(/^https?:\/\/(export\.)?arxiv\.org\/abs\//, "")
      .replace(/v\d+$/, "");
    const year = published ? parseInt(published.substring(0, 4), 10) : new Date().getFullYear();

    const authorRegex = /<author>\s*<name>([^<]+)<\/name>/g;
    const authors: string[] = [];
    let authorMatch: RegExpExecArray | null;
    while ((authorMatch = authorRegex.exec(entry)) !== null) {
      authors.push(authorMatch[1].trim());
    }

    let doi: string | null = null;
    const doiMatch = entry.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/);
    if (doiMatch) doi = doiMatch[1].trim();

    papers.push({
      id: arxivId,
      title,
      year,
      abstract,
      authors: authors.length > 0 ? authors : ["Unknown"],
      venue: "arXiv",
      doi,
      pubmed_id: null,
      openalex_id: null,
      source: "arxiv" as const,
      citationCount: undefined,
      publicationTypes: ["Preprint"],
      preprint_status: "Preprint",
      rank_signal: 1 / (papers.length + 1),
    });
  }

  if (feedErrors.length > 0 && papers.length === 0) {
    throw new Error(`[ArXiv] API feed error: ${feedErrors[0]}`);
  }

  if (feedErrors.length > 0) {
    console.warn(`[ArXiv] Ignored ${feedErrors.length} feed error entr${feedErrors.length === 1 ? "y" : "ies"} with partial results`);
  }

  console.log(`[ArXiv] Found ${papers.length} papers`);
  return papers;
}
