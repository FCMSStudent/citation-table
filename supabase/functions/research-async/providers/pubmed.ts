// deno-lint-ignore-file
declare const Deno: any;
import type { ExpansionMode, UnifiedPaper } from "./types.ts";
import { resolvePreparedQuery } from "./query-builder.ts";
import { fetchWithRetry, sleep } from "./http.ts";

const PUBMED_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const PUBMED_TIMEOUT_MS = 8_000;
const PUBMED_MAX_RETRIES = 4;

let lastPubMedRequestTime = 0;

function getPubMedMinIntervalMs(hasApiKey: boolean): number {
  return hasApiKey ? 120 : 350;
}

async function pubMedRateLimit(hasApiKey: boolean): Promise<void> {
  const minIntervalMs = getPubMedMinIntervalMs(hasApiKey);
  const elapsedMs = Date.now() - lastPubMedRequestTime;
  if (elapsedMs < minIntervalMs) {
    await sleep(minIntervalMs - elapsedMs);
  }
  lastPubMedRequestTime = Date.now();
}

function buildPubMedParams(params: Record<string, string>, apiKey?: string): URLSearchParams {
  const searchParams = new URLSearchParams(params);
  const tool = Deno.env.get("NCBI_TOOL") || "research-async";
  const email = Deno.env.get("NCBI_EMAIL") || "research@example.com";
  searchParams.set("tool", tool);
  searchParams.set("email", email);
  if (apiKey) searchParams.set("api_key", apiKey);
  return searchParams;
}

export async function searchPubMed(
  query: string,
  mode: ExpansionMode = "balanced",
  precompiledQuery?: string,
): Promise<UnifiedPaper[]> {
  const prepared = resolvePreparedQuery(query, "pubmed", mode, precompiledQuery);
  if (!prepared.apiQuery) return [];

  const apiQuery = prepared.apiQuery;
  console.log(
    `[PubMed] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"`,
  );

  try {
    const ncbiApiKey = Deno.env.get("NCBI_API_KEY") || undefined;
    const hasApiKey = Boolean(ncbiApiKey);
    if (ncbiApiKey) console.log("[PubMed] Using NCBI API key for enhanced rate limits");

    const esearchParams = buildPubMedParams({
      db: "pubmed",
      term: apiQuery,
      retmax: "25",
      retmode: "json",
    }, ncbiApiKey);
    const esearchUrl = `${PUBMED_BASE_URL}/esearch.fcgi?${esearchParams.toString()}`;
    await pubMedRateLimit(hasApiKey);
    const esearchRes = await fetchWithRetry(
      esearchUrl,
      { headers: { Accept: "application/json" } },
      {
        label: "pubmed-esearch",
        timeoutMs: PUBMED_TIMEOUT_MS,
        maxRetries: PUBMED_MAX_RETRIES,
        onRetry: ({ attempt, delayMs, reason }) => {
          console.warn(`[PubMed] ESearch retry #${attempt} in ${delayMs}ms (${reason})`);
        },
      },
    );
    if (!esearchRes.ok) {
      console.error(`[PubMed] ESearch error: ${esearchRes.status}`);
      return [];
    }

    const esearchData = await esearchRes.json();
    if (esearchData?.error) {
      console.error(`[PubMed] ESearch API error: ${esearchData.error}`);
      return [];
    }
    const pmids: string[] = esearchData?.esearchresult?.idlist || [];
    if (pmids.length === 0) {
      console.log("[PubMed] No results found");
      return [];
    }
    console.log(`[PubMed] ESearch returned ${pmids.length} PMIDs`);

    const efetchParams = buildPubMedParams({
      db: "pubmed",
      id: pmids.join(","),
      rettype: "xml",
      retmode: "xml",
    }, ncbiApiKey);
    const efetchUrl = `${PUBMED_BASE_URL}/efetch.fcgi?${efetchParams.toString()}`;
    await pubMedRateLimit(hasApiKey);
    const efetchRes = await fetchWithRetry(
      efetchUrl,
      { headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" } },
      {
        label: "pubmed-efetch",
        timeoutMs: PUBMED_TIMEOUT_MS,
        maxRetries: PUBMED_MAX_RETRIES,
        onRetry: ({ attempt, delayMs, reason }) => {
          console.warn(`[PubMed] EFetch retry #${attempt} in ${delayMs}ms (${reason})`);
        },
      },
    );
    if (!efetchRes.ok) {
      console.error(`[PubMed] EFetch error: ${efetchRes.status}`);
      return [];
    }

    const xmlText = await efetchRes.text();
    const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
    const papers: UnifiedPaper[] = [];
    let match: RegExpExecArray | null;

    while ((match = articleRegex.exec(xmlText)) !== null) {
      const article = match[1];

      const getTag = (tag: string, context: string = article): string => {
        const tagMatch = context.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return tagMatch ? tagMatch[1].trim().replace(/\s+/g, " ") : "";
      };

      const pmid = getTag("PMID");
      let title = getTag("ArticleTitle");
      title = title.replace(/<[^>]+>/g, "");
      if (!title) continue;

      let abstract = "";
      const abstractSection = article.match(/<Abstract>([\s\S]*?)<\/Abstract>/);
      if (abstractSection) {
        const abstractTextRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
        const parts: string[] = [];
        let abstractMatch: RegExpExecArray | null;
        while ((abstractMatch = abstractTextRegex.exec(abstractSection[1])) !== null) {
          parts.push(abstractMatch[1].trim().replace(/<[^>]+>/g, ""));
        }
        abstract = parts.join(" ").replace(/\s+/g, " ").trim();
      }
      if (abstract.length < 50) continue;

      let year = new Date().getFullYear();
      const pubDateMatch = article.match(/<PubDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/);
      if (pubDateMatch) year = parseInt(pubDateMatch[1], 10);
      else {
        const articleDateMatch = article.match(/<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/);
        if (articleDateMatch) year = parseInt(articleDateMatch[1], 10);
      }

      const authorRegex = /<Author[^>]*>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?<ForeName>([^<]*)<\/ForeName>/g;
      const authors: string[] = [];
      let authorMatch: RegExpExecArray | null;
      while ((authorMatch = authorRegex.exec(article)) !== null) {
        authors.push(`${authorMatch[2].trim()} ${authorMatch[1].trim()}`);
      }

      let doi: string | null = null;
      const doiMatch = article.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/);
      if (doiMatch) doi = doiMatch[1].trim();

      const journal = getTag("Title");
      papers.push({
        id: pmid,
        title,
        year,
        abstract,
        authors: authors.length > 0 ? authors : ["Unknown"],
        venue: journal,
        doi,
        pubmed_id: pmid,
        openalex_id: null,
        source: "pubmed" as const,
        citationCount: undefined,
        publicationTypes: undefined,
        journal,
        preprint_status: "Peer-reviewed",
        rank_signal: 1 / (papers.length + 1),
      });
    }

    console.log(`[PubMed] Found ${papers.length} papers`);
    return papers;
  } catch (error) {
    console.error("[PubMed] Error:", error);
    return [];
  }
}
