import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { prepareQueryProcessingV2, type QueryProcessingMeta, type SearchSource } from "../_shared/query-processing.ts";
import {
  applyQualityFilter,
  buildEvidenceAndBrief,
  canonicalizePapers,
  defaultSearchRequestFromQuestion,
  sanitizeSearchRequest,
  type CanonicalPaper,
  type CoverageReport,
  type InputPaper,
  type SearchRequestPayload,
  type SearchResponsePayload,
  type SearchStats,
} from "../_shared/lit-search.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface Outcome {
  outcome_measured: string;
  key_result: string | null;
  citation_snippet: string;
  intervention: string | null;
  comparator: string | null;
  effect_size: string | null;
  p_value: string | null;
}

interface Citation {
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  formatted: string;
}

interface StudyResult {
  study_id: string;
  title: string;
  year: number;
  study_design: "RCT" | "cohort" | "cross-sectional" | "review" | "unknown";
  sample_size: number | null;
  population: string | null;
  outcomes: Outcome[];
  citation: Citation;
  abstract_excerpt: string;
  preprint_status: "Preprint" | "Peer-reviewed";
  review_type: "None" | "Systematic review" | "Meta-analysis";
  source: "openalex" | "semantic_scholar" | "arxiv" | "pubmed";
  citationCount?: number;
  pdf_url?: string | null;
  landing_page_url?: string | null;
}

interface OpenAlexWork {
  id: string;
  title: string;
  publication_year: number;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: Array<{ author: { display_name: string } }>;
  primary_location?: { source?: { display_name: string } };
  best_oa_location?: { pdf_url?: string; landing_page_url?: string };
  doi?: string;
  type?: string;
  cited_by_count?: number;
  referenced_works?: string[];
  is_retracted?: boolean;
}

interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract: string | null;
  year: number | null;
  authors: Array<{ authorId: string; name: string }>;
  venue: string;
  citationCount: number;
  publicationTypes: string[] | null;
  externalIds: { DOI?: string; PubMed?: string };
  openAccessPdf?: { url: string } | null;
  url?: string;
  isRetracted?: boolean;
  references?: Array<{ paperId: string }>;
}

interface UnifiedPaper {
  id: string;
  title: string;
  year: number;
  abstract: string;
  authors: string[];
  venue: string;
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  source: "openalex" | "semantic_scholar" | "arxiv" | "pubmed";
  citationCount?: number;
  publicationTypes?: string[];
  journal?: string;
  pdfUrl?: string | null;
  landingPageUrl?: string | null;
  referenced_ids?: string[];
  is_retracted?: boolean;
  preprint_status?: "Preprint" | "Peer-reviewed";
  rank_signal?: number;
}

// ─── Helpers (copied from research/index.ts) ─────────────────────────────────

function reconstructAbstract(invertedIndex: Record<string, number[]> | undefined): string {
  if (!invertedIndex) return "";
  let maxIndex = 0;
  for (const indices of Object.values(invertedIndex)) {
    for (const index of indices) {
      if (index > maxIndex) maxIndex = index;
    }
  }
  const words = new Array(maxIndex + 1);
  for (const [word, indices] of Object.entries(invertedIndex)) {
    for (const index of indices) {
      words[index] = word;
    }
  }
  return words.filter(word => word !== undefined).join(" ");
}

function formatCitation(paper: UnifiedPaper): string {
  const authors = paper.authors.slice(0, 3).join(", ");
  const etAl = paper.authors.length > 3 ? " et al." : "";
  const year = paper.year || "n.d.";
  const venue = paper.venue || "";
  return `${authors}${etAl} (${year}). ${paper.title}. ${venue}`.trim();
}

function normalizeQuery(query: string): { normalized: string; wasNormalized: boolean } {
  const original = query.trim();
  let normalized = original;
  let wasNormalized = false;

  const comparativePatterns = [
    /\b(better|best|worse|worst|superior|inferior)\b/gi,
    /\b(more|less)\s+(effective|efficient|beneficial)\b/gi,
  ];

  for (const pattern of comparativePatterns) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, (match) => {
        wasNormalized = true;
        if (/better|best|superior/i.test(match)) return "associated with";
        if (/worse|worst|inferior/i.test(match)) return "associated with";
        return "outcomes of";
      });
    }
  }

  if (/\beffects?\s+of\b/i.test(normalized)) {
    normalized = normalized.replace(/\beffects?\s+of\b/gi, "reported outcomes associated with");
    wasNormalized = true;
  }

  return { normalized: normalized.trim(), wasNormalized };
}

const STOP_WORDS = new Set([
  "what", "are", "is", "the", "a", "an", "of", "for", "with", "to", "in", "on",
  "and", "or", "how", "does", "do", "can", "could", "would", "should", "will",
  "that", "this", "these", "those", "it", "its", "be", "been", "being", "was",
  "were", "has", "have", "had", "not", "no", "but", "by", "from", "at", "as",
  "into", "through", "between", "about", "their", "there", "than",
  "reported", "outcomes", "associated", "effects", "effect", "impact",
  "relationship", "role", "influence", "evidence", "studies", "study",
]);

const BIOMEDICAL_SYNONYMS: Record<string, string[]> = {
  "sleep deprivation": ["sleep restriction", "sleep loss", "partial sleep deprivation"],
  "cognitive performance": ["attention", "working memory", "executive function", "reaction time"],
  "insomnia": ["sleep initiation", "sleep maintenance", "sleeplessness"],
  "anxiety": ["anxious symptoms", "anxiety disorder", "state anxiety"],
  "depression": ["depressive symptoms", "major depressive disorder", "mood symptoms"],
  "blood pressure": ["hypertension", "systolic blood pressure", "diastolic blood pressure"],
};

type ExpansionMode = "balanced" | "broad";
type QueryPipelineMode = "v1" | "v2" | "shadow";

interface PreparedSourceQuery {
  source: SearchSource;
  originalKeywordQuery: string;
  expandedKeywordQuery: string;
  apiQuery: string;
}

function extractSearchKeywords(query: string, mode: ExpansionMode = "balanced"): { originalTerms: string[]; expandedTerms: string[] } {
  const sanitized = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const keywords = sanitized
    .split(/\s+/)
    .filter(w => w.length >= 1 && !STOP_WORDS.has(w));

  const seen = new Set<string>();
  const originalTerms = keywords.filter(w => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  }).slice(0, 8);

  const expandedCandidates: string[] = [];
  for (const [concept, synonyms] of Object.entries(BIOMEDICAL_SYNONYMS)) {
    if (sanitized.includes(concept)) {
      expandedCandidates.push(concept, ...synonyms);
    }
  }

  const expandedSet = new Set<string>();
  for (const term of [...originalTerms, ...expandedCandidates]) {
    if (!term || STOP_WORDS.has(term)) continue;
    expandedSet.add(term);
  }

  const expandedTerms = Array.from(expandedSet).filter(term => !originalTerms.includes(term));
  const expandedLimit = mode === "broad" ? 12 : 6;

  const limitedExpanded = expandedTerms.slice(0, expandedLimit);
  console.log(`[Keywords] mode=${mode} "${query}" -> original="${originalTerms.join(" ")}" expanded="${limitedExpanded.join(" ")}"`);
  return { originalTerms, expandedTerms: limitedExpanded };
}

function buildSourceQuery(query: string, source: SearchSource, mode: ExpansionMode = "balanced"): PreparedSourceQuery {
  const { originalTerms, expandedTerms } = extractSearchKeywords(query, mode);
  const originalKeywordQuery = originalTerms.join(" ");
  const expandedKeywordQuery = [...originalTerms, ...expandedTerms].join(" ");

  const quoteIfPhrase = (term: string) => term.includes(" ") ? `"${term}"` : term;
  let apiQuery = originalKeywordQuery;

  if (source === "semantic_scholar") {
    const semanticExpanded = expandedTerms.slice(0, mode === "broad" ? 10 : 5);
    const origClause = originalTerms.map(quoteIfPhrase).join(" OR ");
    const expandedClause = semanticExpanded.map(quoteIfPhrase).join(" OR ");
    apiQuery = expandedClause ? `(${origClause}) OR (${expandedClause})` : origClause;
  } else {
    const balancedExpanded = expandedTerms.slice(0, mode === "broad" ? 6 : 3);
    apiQuery = [originalKeywordQuery, ...balancedExpanded].filter(Boolean).join(" ");
  }

  return { source, originalKeywordQuery, expandedKeywordQuery, apiQuery: apiQuery.trim() };
}

function resolvePreparedQuery(
  query: string,
  source: SearchSource,
  mode: ExpansionMode,
  precompiledQuery?: string,
): PreparedSourceQuery {
  if (!precompiledQuery?.trim()) return buildSourceQuery(query, source, mode);
  return {
    source,
    originalKeywordQuery: query,
    expandedKeywordQuery: precompiledQuery.trim(),
    apiQuery: precompiledQuery.trim(),
  };
}

function getQueryPipelineMode(): QueryPipelineMode {
  const raw = (Deno.env.get("QUERY_PIPELINE_MODE") || "shadow").toLowerCase();
  if (raw === "v1" || raw === "v2" || raw === "shadow") return raw;
  return "shadow";
}

const PROVIDER_TIMEOUT_MS = 8_000;
const PROVIDER_RETRIES = 2;
const RETRIEVAL_BUDGET_MS = 26_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: number | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}

async function retryProviderSearch(
  provider: SearchSource,
  fn: () => Promise<UnifiedPaper[]>,
): Promise<{ papers: UnifiedPaper[]; failed: boolean; error?: string; latencyMs: number }> {
  const started = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= PROVIDER_RETRIES; attempt += 1) {
    try {
      const papers = await withTimeout(fn(), PROVIDER_TIMEOUT_MS, provider);
      return { papers, failed: false, latencyMs: Date.now() - started };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < PROVIDER_RETRIES) {
        await sleep(250 * (attempt + 1));
      }
    }
  }

  return {
    papers: [],
    failed: true,
    error: lastError?.message || `${provider} failed`,
    latencyMs: Date.now() - started,
  };
}

function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.toLowerCase().trim().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
}

function hashKey(raw: string): string {
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ─── API Search Functions ────────────────────────────────────────────────────

async function searchOpenAlex(
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
    console.log(`[OpenAlex] Using API key for polite pool access`);
  }
  console.log(`[OpenAlex] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"`);
  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
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
    return works.map((work, idx) => ({
      id: work.id,
      title: work.title || "Untitled",
      year: work.publication_year || new Date().getFullYear(),
      abstract: reconstructAbstract(work.abstract_inverted_index),
      authors: work.authorships?.map(a => a.author.display_name) || ["Unknown"],
      venue: work.primary_location?.source?.display_name || "",
      doi: work.doi || null,
      pubmed_id: null,
      openalex_id: work.id,
      source: "openalex" as const,
      citationCount: work.cited_by_count,
      publicationTypes: work.type ? [work.type] : undefined,
      pdfUrl: work.best_oa_location?.pdf_url || null,
      landingPageUrl: work.best_oa_location?.landing_page_url || null,
      referenced_ids: work.referenced_works || [],
      is_retracted: Boolean(work.is_retracted),
      preprint_status: work.type === "preprint" ? "Preprint" : "Peer-reviewed",
      rank_signal: 1 / (idx + 1),
    }));
  } catch (error) {
    console.error(`[OpenAlex] Error:`, error);
    return [];
  }
}

let lastS2RequestTime = 0;
async function s2RateLimit() {
  const now = Date.now();
  const elapsed = now - lastS2RequestTime;
  if (elapsed < 1000) {
    await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
  }
  lastS2RequestTime = Date.now();
}

async function searchSemanticScholar(
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
  console.log(`[SemanticScholar] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"${apiKey ? ' (with API key)' : ' (public tier)'}`);
  try {
    await s2RateLimit();
    const headers: Record<string, string> = { "Accept": "application/json" };
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
      .filter(paper => paper.abstract && paper.abstract.length > 50)
      .slice(0, 50)
      .map((paper, idx) => ({
        id: paper.paperId,
        title: paper.title || "Untitled",
        year: paper.year || new Date().getFullYear(),
        abstract: paper.abstract || "",
        authors: paper.authors?.map(a => a.name) || ["Unknown"],
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
    console.error(`[SemanticScholar] Error:`, error);
    return [];
  }
}

async function searchArxiv(
  query: string,
  mode: ExpansionMode = "balanced",
  precompiledQuery?: string,
): Promise<UnifiedPaper[]> {
  const prepared = resolvePreparedQuery(query, "arxiv", mode, precompiledQuery);
  if (!prepared.apiQuery) return [];
  const encodedQuery = encodeURIComponent(prepared.apiQuery);
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodedQuery}&max_results=25&sortBy=relevance&sortOrder=descending`;
  console.log(`[ArXiv] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"`);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[ArXiv] API error: ${response.status}`);
      return [];
    }
    const xmlText = await response.text();
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    const papers: UnifiedPaper[] = [];
    let match;
    while ((match = entryRegex.exec(xmlText)) !== null) {
      const entry = match[1];
      const getTag = (tag: string): string => {
        const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].trim().replace(/\s+/g, " ") : "";
      };
      const fullId = getTag("id");
      const title = getTag("title");
      const published = getTag("published");
      const abstract = getTag("summary");
      if (!fullId || !title || !abstract || abstract.length < 50) continue;
      const arxivId = fullId.replace(/^https?:\/\/(export\.)?arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
      const year = published ? parseInt(published.substring(0, 4)) : new Date().getFullYear();
      const authorRegex = /<author>\s*<name>([^<]+)<\/name>/g;
      const authors: string[] = [];
      let authorMatch;
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
    console.log(`[ArXiv] Found ${papers.length} papers`);
    return papers;
  } catch (error) {
    console.error(`[ArXiv] Error:`, error);
    return [];
  }
}

// ─── PubMed Search ──────────────────────────────────────────────────────────

async function searchPubMed(
  query: string,
  mode: ExpansionMode = "balanced",
  precompiledQuery?: string,
): Promise<UnifiedPaper[]> {
  const prepared = resolvePreparedQuery(query, "pubmed", mode, precompiledQuery);
  if (!prepared.apiQuery) return [];
  const encodedQuery = encodeURIComponent(prepared.apiQuery);

  console.log(`[PubMed] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"`);

  try {
    // Use NCBI API key if available for higher rate limits (10 req/sec vs 3 req/sec)
    const ncbiApiKey = Deno.env.get("NCBI_API_KEY");
    const apiKeyParam = ncbiApiKey ? `&api_key=${ncbiApiKey}` : "";
    if (ncbiApiKey) console.log(`[PubMed] Using NCBI API key for enhanced rate limits`);

    // Step 1: ESearch to get PMIDs
    const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodedQuery}&retmax=25&retmode=json${apiKeyParam}`;
    const esearchRes = await fetch(esearchUrl);
    if (!esearchRes.ok) {
      console.error(`[PubMed] ESearch error: ${esearchRes.status}`);
      return [];
    }
    const esearchData = await esearchRes.json();
    const pmids: string[] = esearchData?.esearchresult?.idlist || [];
    if (pmids.length === 0) {
      console.log(`[PubMed] No results found`);
      return [];
    }
    console.log(`[PubMed] ESearch returned ${pmids.length} PMIDs`);

    // Rate limit: 350ms delay between ESearch and EFetch
    await new Promise(resolve => setTimeout(resolve, 350));

    // Step 2: EFetch to get metadata as XML
    const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmids.join(",")}&rettype=xml${apiKeyParam}`;
    const efetchRes = await fetch(efetchUrl);
    if (!efetchRes.ok) {
      console.error(`[PubMed] EFetch error: ${efetchRes.status}`);
      return [];
    }
    const xmlText = await efetchRes.text();

    // Step 3: Regex-based XML parsing
    const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
    const papers: UnifiedPaper[] = [];
    let match;

    while ((match = articleRegex.exec(xmlText)) !== null) {
      const article = match[1];

      const getTag = (tag: string, context: string = article): string => {
        const m = context.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? m[1].trim().replace(/\s+/g, " ") : "";
      };

      const pmid = getTag("PMID");
      // Handle titles with HTML tags inside (e.g. <i>, <sub>)
      let title = getTag("ArticleTitle");
      title = title.replace(/<[^>]+>/g, ""); // strip inline HTML
      if (!title) continue;

      // Extract abstract - handle structured abstracts with multiple AbstractText elements
      let abstract = "";
      const abstractSection = article.match(/<Abstract>([\s\S]*?)<\/Abstract>/);
      if (abstractSection) {
        const abstractTextRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
        const parts: string[] = [];
        let atMatch;
        while ((atMatch = abstractTextRegex.exec(abstractSection[1])) !== null) {
          parts.push(atMatch[1].trim().replace(/<[^>]+>/g, ""));
        }
        abstract = parts.join(" ").replace(/\s+/g, " ").trim();
      }
      if (abstract.length < 50) continue;

      // Extract year from multiple possible locations
      let year = new Date().getFullYear();
      const pubDateMatch = article.match(/<PubDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/);
      if (pubDateMatch) year = parseInt(pubDateMatch[1]);
      else {
        const articleDateMatch = article.match(/<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/);
        if (articleDateMatch) year = parseInt(articleDateMatch[1]);
      }

      // Extract authors
      const authorRegex = /<Author[^>]*>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?<ForeName>([^<]*)<\/ForeName>/g;
      const authors: string[] = [];
      let authorMatch;
      while ((authorMatch = authorRegex.exec(article)) !== null) {
        authors.push(`${authorMatch[2].trim()} ${authorMatch[1].trim()}`);
      }

      // Extract DOI from ArticleIdList
      let doi: string | null = null;
      const doiMatch = article.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/);
      if (doiMatch) doi = doiMatch[1].trim();

      // Extract journal
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
    console.error(`[PubMed] Error:`, error);
    return [];
  }
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function normalizeTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function fuzzyTitleThreshold(title: string): number {
  if (title.length <= 40) return 2;
  return 3;
}

function mergePaperMetadata(existingPaper: UnifiedPaper, incomingPaper: UnifiedPaper): void {
  if (incomingPaper.abstract && incomingPaper.abstract.length > (existingPaper.abstract?.length ?? 0)) {
    existingPaper.abstract = incomingPaper.abstract;
  }

  if (
    incomingPaper.citationCount !== undefined
    && (existingPaper.citationCount === undefined || incomingPaper.citationCount > existingPaper.citationCount)
  ) {
    existingPaper.citationCount = incomingPaper.citationCount;
  }

  if (incomingPaper.pubmed_id && !existingPaper.pubmed_id) existingPaper.pubmed_id = incomingPaper.pubmed_id;
  if (incomingPaper.openalex_id && !existingPaper.openalex_id) existingPaper.openalex_id = incomingPaper.openalex_id;
  if (incomingPaper.doi && !existingPaper.doi) existingPaper.doi = incomingPaper.doi;
  if (incomingPaper.pdfUrl && !existingPaper.pdfUrl) existingPaper.pdfUrl = incomingPaper.pdfUrl;
  if (incomingPaper.landingPageUrl && !existingPaper.landingPageUrl) existingPaper.landingPageUrl = incomingPaper.landingPageUrl;
}

function deduplicateAndMerge(s2Papers: UnifiedPaper[], openAlexPapers: UnifiedPaper[], arxivPapers: UnifiedPaper[], pubmedPapers: UnifiedPaper[] = []): UnifiedPaper[] {
  const doiMap = new Map<string, UnifiedPaper>();
  const titleMap = new Map<string, UnifiedPaper>();
  const uniquePapers = new Set<UnifiedPaper>();
  const allPapers = [...s2Papers, ...openAlexPapers, ...arxivPapers, ...pubmedPapers];

  for (const paper of allPapers) {
    const normalizedTitle = normalizeTitleForDedup(paper.title);
    const doi = paper.doi?.toLowerCase().trim();

    let existingPaper: UnifiedPaper | undefined;
    let dedupeReason: "doi_match" | "title_exact" | "title_fuzzy" | null = null;

    if (doi) {
      existingPaper = doiMap.get(doi);
      if (existingPaper) dedupeReason = "doi_match";
    }

    if (!existingPaper) {
      existingPaper = titleMap.get(normalizedTitle);
      if (existingPaper) dedupeReason = "title_exact";
    }

    if (!existingPaper) {
      let bestMatch: { paper: UnifiedPaper; distance: number } | null = null;
      const threshold = fuzzyTitleThreshold(normalizedTitle);

      for (const [knownTitle, knownPaper] of titleMap.entries()) {
        const distance = levenshteinDistance(normalizedTitle, knownTitle);
        if (distance <= threshold && (!bestMatch || distance < bestMatch.distance)) {
          bestMatch = { paper: knownPaper, distance };
          if (distance === 0) break;
        }
      }

      if (bestMatch) {
        existingPaper = bestMatch.paper;
        dedupeReason = "title_fuzzy";
      }
    }

    if (existingPaper && dedupeReason) {
      mergePaperMetadata(existingPaper, paper);
      if (doi) doiMap.set(doi, existingPaper);
      titleMap.set(normalizedTitle, existingPaper);
      console.log(`[Deduplication] Merged "${paper.title}" via ${dedupeReason}`);
      continue;
    }

    uniquePapers.add(paper);
    if (doi) doiMap.set(doi, paper);
    titleMap.set(normalizedTitle, paper);
  }

  console.log(`[Deduplication] ${allPapers.length} total -> ${uniquePapers.size} unique papers`);
  return Array.from(uniquePapers);
}


// ─── Crossref Enrichment ─────────────────────────────────────────────────────

async function enrichSinglePaper(paper: UnifiedPaper): Promise<void> {
  try {
    let crossrefData = null;
    if (paper.doi) {
      const encodedDoi = encodeURIComponent(paper.doi);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`https://api.crossref.org/works/${encodedDoi}`, {
          headers: { 'User-Agent': 'EurekaSearch/1.0 (mailto:research@eureka.app)' },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          crossrefData = (await response.json()).message;
        }
      } catch (error) {
        clearTimeout(timeoutId);
      }
    } else if (paper.title) {
      const encodedTitle = encodeURIComponent(paper.title);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(
          `https://api.crossref.org/works?query.bibliographic=${encodedTitle}&rows=1`,
          {
            headers: { 'User-Agent': 'EurekaSearch/1.0 (mailto:research@eureka.app)' },
            signal: controller.signal
          }
        );
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          if (data.message.items?.length > 0) {
            crossrefData = data.message.items[0];
          }
        }
      } catch (error) {
        clearTimeout(timeoutId);
      }
    }
    if (crossrefData) {
      paper.doi = crossrefData.DOI || paper.doi;
      paper.year = crossrefData.issued?.['date-parts']?.[0]?.[0] || paper.year;
      paper.citationCount = crossrefData['is-referenced-by-count'] ?? paper.citationCount;
      if (crossrefData['container-title']?.[0]) {
        paper.journal = crossrefData['container-title'][0];
      }
    }
  } catch (_) {
    // silently skip
  }
}

async function enrichWithCrossref(papers: UnifiedPaper[]): Promise<UnifiedPaper[]> {
  const enrichedPapers = [...papers];
  // Process in parallel batches of 10 to avoid rate limits
  const CONCURRENCY = 10;
  for (let i = 0; i < enrichedPapers.length; i += CONCURRENCY) {
    const batch = enrichedPapers.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(enrichSinglePaper));
  }
  console.log(`[Crossref] Enrichment complete for ${enrichedPapers.length} papers`);
  return enrichedPapers;
}

// ─── Study Completeness Filter ──────────────────────────────────────────────

function isCompleteStudy(study: any): boolean {
  if (!study.title || !study.year) return false;
  if (study.study_design === "unknown") return false;
  if (!study.abstract_excerpt || study.abstract_excerpt.trim().length < 50) return false;
  if (!study.outcomes || study.outcomes.length === 0) return false;
  const hasCompleteOutcome = study.outcomes.some((o: any) =>
    o.outcome_measured &&
    (o.effect_size || o.p_value || o.intervention || o.comparator)
  );
  return hasCompleteOutcome;
}

function getQueryKeywordSet(query: string, precomputedTerms?: string[]): Set<string> {
  if (precomputedTerms && precomputedTerms.length > 0) {
    return new Set(precomputedTerms.map((k) => k.trim().toLowerCase()).filter(Boolean));
  }
  const { originalTerms, expandedTerms } = extractSearchKeywords(query);
  const keywords = [...originalTerms, ...expandedTerms]
    .map(k => k.trim())
    .filter(Boolean);
  return new Set(keywords);
}

function scorePaperCandidate(paper: UnifiedPaper, queryKeywords: Set<string>): number {
  const text = `${paper.title} ${paper.abstract}`.toLowerCase();
  const textTokens = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));

  let keywordOverlap = 0;
  for (const keyword of queryKeywords) {
    if (textTokens.has(keyword)) keywordOverlap += 1;
  }

  const overlapScore = queryKeywords.size > 0 ? keywordOverlap / queryKeywords.size : 0;
  const abstractLengthScore = Math.min((paper.abstract.length || 0) / 2000, 1);
  const citationScore = Math.min(Math.log10((paper.citationCount ?? 0) + 1) / 3, 1);

  return overlapScore * 3 + abstractLengthScore + citationScore;
}

function mergeExtractedStudies(studies: StudyResult[]): StudyResult[] {
  const byStudyId = new Map<string, StudyResult>();

  for (const study of studies) {
    if (!study?.study_id) continue;

    const existing = byStudyId.get(study.study_id);
    if (!existing) {
      byStudyId.set(study.study_id, study);
      continue;
    }

    const combinedOutcomes = [...(existing.outcomes || []), ...(study.outcomes || [])];
    const seenOutcomes = new Set<string>();
    const dedupedOutcomes = combinedOutcomes.filter((outcome: any) => {
      const key = `${outcome?.outcome_measured || ""}|${outcome?.citation_snippet || ""}|${outcome?.key_result || ""}`;
      if (seenOutcomes.has(key)) return false;
      seenOutcomes.add(key);
      return true;
    });

    byStudyId.set(study.study_id, {
      ...existing,
      ...study,
      outcomes: dedupedOutcomes,
      citationCount: Math.max(existing.citationCount ?? 0, study.citationCount ?? 0) || undefined,
      abstract_excerpt: existing.abstract_excerpt?.length >= (study.abstract_excerpt?.length || 0)
        ? existing.abstract_excerpt
        : study.abstract_excerpt,
    });
  }

  return Array.from(byStudyId.values());
}

// ─── LLM Extraction ─────────────────────────────────────────────────────────

async function extractStudyData(
  papers: UnifiedPaper[],
  question: string,
  geminiApiKey: string
): Promise<StudyResult[]> {
  const papersContext = papers.map((p, i) => ({
    index: i,
    title: p.title,
    year: p.year,
    abstract: p.abstract,
    id: p.id,
    source: p.source,
    doi: p.doi,
    pubmed_id: p.pubmed_id,
    openalex_id: p.openalex_id,
    citationCount: p.citationCount,
    pdfUrl: p.pdfUrl,
    landingPageUrl: p.landingPageUrl,
  }));

  const systemPrompt = `You are a rigorous medical research data extractor following strict evidence-based principles.

CRITICAL EXTRACTION RULES (per meta prompt):
1. Extract ONLY from Abstract and explicitly labeled Results sections
2. NEVER infer study design - if not explicitly stated, return "unknown"
3. Population descriptions MUST be extracted verbatim from the source
4. Sample size: return only clearly stated total (e.g., "n=150", "150 participants"); otherwise null
5. Each study may report MULTIPLE outcomes - represent as separate objects in outcomes array
6. Each outcome MUST have its own citation_snippet (verbatim text from abstract)
7. Numerical values (CI, p-values, effect sizes) MUST be extracted verbatim - no rounding
8. Terms like "significant" or association language allowed ONLY if quoted or explicitly used in source
9. NO causal language unless the abstract explicitly states causation
12. For each outcome, extract "intervention" (the treatment/exposure) and "comparator" (control group) verbatim. Return null if not stated.
13. For each outcome, extract "effect_size" (verbatim: Cohen's d, OR, RR, HR, SMD, etc.) and "p_value" (verbatim p-value or CI). Return null if not stated.
10. Classify preprint_status: "Preprint" if preprint/not peer-reviewed, else "Peer-reviewed"
11. Classify review_type: "Meta-analysis" for meta-analyses (MUST flag), "Systematic review" for systematic reviews, else "None"

STUDY DESIGN CLASSIFICATION:
- "RCT": Randomized controlled trials, clinical trials with randomization
- "cohort": Cohort studies, longitudinal studies, prospective/retrospective follow-up studies
- "cross-sectional": Cross-sectional surveys, prevalence studies, single time-point observations
- "review": Narrative reviews, literature reviews, systematic reviews, meta-analyses, scoping reviews
- "unknown": Editorials, commentaries, case reports, case series, letters to the editor, opinion pieces, guidelines, conference abstracts, or any paper that does not clearly fit one of the above designs. When in doubt, classify as "unknown".

OUTPUT SCHEMA - return valid JSON array matching this exact structure:
[{
  "study_id": "string (paper ID)",
  "title": "string",
  "year": number,
  "study_design": "RCT" | "cohort" | "cross-sectional" | "review" | "unknown",
  "sample_size": number | null,
  "population": "verbatim population description" | null,
  "outcomes": [{
    "outcome_measured": "string describing what was measured",
    "key_result": "verbatim finding with exact numbers/CI/p-values" | null,
    "citation_snippet": "verbatim text from abstract supporting this result",
    "intervention": "treatment/exposure" | null,
    "comparator": "control/comparison group" | null,
    "effect_size": "verbatim effect size (e.g., Cohen's d, OR, RR, HR)" | null,
    "p_value": "verbatim p-value or CI" | null
  }],
  "citation": {
    "doi": "string" | null,
    "pubmed_id": "string" | null,
    "openalex_id": "string" | null,
    "formatted": "APA formatted citation"
  },
  "abstract_excerpt": "representative excerpt from abstract",
  "preprint_status": "Preprint" | "Peer-reviewed",
  "review_type": "None" | "Systematic review" | "Meta-analysis",
  "source": "openalex" | "semantic_scholar" | "arxiv" | "pubmed",
  "citationCount": number | null
}]

Return ONLY valid JSON array. No markdown, no explanation.`;

  const userPrompt = `Research Question: "${question}"

Papers to analyze:
${JSON.stringify(papersContext, null, 2)}

Extract structured data from each paper's abstract following the strict rules. Remember:
- Multiple outcomes per study as separate objects in outcomes array
- Each outcome needs its own citation_snippet, intervention, comparator, effect_size, and p_value
- No inference - null for missing data
- Verbatim extraction for populations, numerical results, interventions, and comparators`;

  console.log(`[LLM] Sending ${papers.length} papers for extraction via Google Gemini`);

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[LLM] Gemini error: ${response.status}`, errorText);
    if (response.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
    if (response.status === 403) throw new Error("Invalid Google Gemini API key.");
    throw new Error(`LLM extraction failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  console.log(`[LLM] Raw response length: ${content.length}`);

  let jsonStr = content.trim();
  if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
  if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);

  try {
    const results = JSON.parse(jsonStr.trim());
    console.log(`[LLM] Parsed ${results.length} study results`);

    // Merge pdf_url / landing_page_url from original papers into LLM results
    for (const study of results) {
      const matchedPaper = papers.find(p => p.id === study.study_id);
      if (matchedPaper) {
        study.pdf_url = matchedPaper.pdfUrl || null;
        study.landing_page_url = matchedPaper.landingPageUrl || null;
      }
    }

    return results;
  } catch (parseError) {
    console.error(`[LLM] JSON parse error:`, parseError);
    throw new Error("Failed to parse LLM response as JSON");
  }
}

// ─── Full Research Pipeline ──────────────────────────────────────────────────

interface PipelineResult {
  results: StudyResult[];
  normalized_query?: string;
  total_papers_searched: number;
  openalex_count: number;
  semantic_scholar_count: number;
  arxiv_count: number;
  pubmed_count: number;
  query_processing?: QueryProcessingMeta;
  query_pipeline_mode: QueryPipelineMode;
}

async function runResearchPipeline(question: string): Promise<PipelineResult> {
  const GOOGLE_GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
  if (!GOOGLE_GEMINI_API_KEY) {
    throw new Error("AI service not configured. Please add your Google Gemini API key.");
  }

  console.log(`[Pipeline] Processing question: "${question}"`);

  const queryPipelineMode = getQueryPipelineMode();
  const { normalized: v1Normalized, wasNormalized: v1WasNormalized } = normalizeQuery(question);
  let normalizedQueryForResponse = v1WasNormalized ? v1Normalized : undefined;
  let searchQuery = v1WasNormalized ? v1Normalized : question;
  let queryProcessingMeta: QueryProcessingMeta | undefined;
  let queryTermsForRanking: string[] | undefined;
  const sourceQueryOverrides: Partial<Record<SearchSource, string>> = {};

  let shadowPreparedPromise: Promise<Awaited<ReturnType<typeof prepareQueryProcessingV2>>> | null = null;

  if (queryPipelineMode === "v2") {
    const prepared = await prepareQueryProcessingV2(question, {
      llmApiKey: GOOGLE_GEMINI_API_KEY,
      fallbackTimeoutMs: 350,
    });
    searchQuery = prepared.search_query;
    normalizedQueryForResponse = prepared.was_normalized ? prepared.normalized_query : undefined;
    queryTermsForRanking = prepared.query_terms;
    queryProcessingMeta = prepared.query_processing;
    sourceQueryOverrides.semantic_scholar = prepared.query_processing.source_queries.semantic_scholar;
    sourceQueryOverrides.openalex = prepared.query_processing.source_queries.openalex;
    sourceQueryOverrides.pubmed = prepared.query_processing.source_queries.pubmed;
    sourceQueryOverrides.arxiv = prepared.query_processing.source_queries.arxiv;
  } else if (queryPipelineMode === "shadow") {
    shadowPreparedPromise = prepareQueryProcessingV2(question, {
      llmApiKey: GOOGLE_GEMINI_API_KEY,
      fallbackTimeoutMs: 350,
    });
  }

  if (normalizedQueryForResponse) {
    console.log(`[Pipeline] Query normalized: "${question}" -> "${normalizedQueryForResponse}"`);
  }

  // Run all API searches in parallel
  const [s2Papers, openAlexPapers, arxivPapers, pubmedPapers] = await Promise.all([
    searchSemanticScholar(searchQuery, "balanced", sourceQueryOverrides.semantic_scholar).catch(e => { console.error("[Pipeline] S2 failed:", e); return [] as UnifiedPaper[]; }),
    searchOpenAlex(searchQuery, "balanced", sourceQueryOverrides.openalex).catch(e => { console.error("[Pipeline] OpenAlex failed:", e); return [] as UnifiedPaper[]; }),
    searchArxiv(searchQuery, "balanced", sourceQueryOverrides.arxiv).catch(e => { console.error("[Pipeline] ArXiv failed:", e); return [] as UnifiedPaper[]; }),
    searchPubMed(searchQuery, "balanced", sourceQueryOverrides.pubmed).catch(e => { console.error("[Pipeline] PubMed failed:", e); return [] as UnifiedPaper[]; }),
  ]);

  if (queryPipelineMode === "shadow" && shadowPreparedPromise) {
    try {
      const prepared = await shadowPreparedPromise;
      queryProcessingMeta = prepared.query_processing;
    } catch (error) {
      console.warn("[Pipeline] Shadow query processing failed:", error);
    }
  }

  const totalFetched = s2Papers.length + openAlexPapers.length + arxivPapers.length + pubmedPapers.length;
  console.log(`[Pipeline] Stage stats: fetched=${totalFetched} (s2=${s2Papers.length}, openalex=${openAlexPapers.length}, arxiv=${arxivPapers.length}, pubmed=${pubmedPapers.length})`);

  const allPapers = deduplicateAndMerge(s2Papers, openAlexPapers, arxivPapers, pubmedPapers);
  console.log(`[Pipeline] Stage stats: deduped=${allPapers.length}`);

  if (allPapers.length === 0) {
    return {
      results: [],
      normalized_query: normalizedQueryForResponse,
      total_papers_searched: 0,
      openalex_count: 0,
      semantic_scholar_count: 0,
      arxiv_count: 0,
      pubmed_count: 0,
      query_processing: queryProcessingMeta,
      query_pipeline_mode: queryPipelineMode,
    };
  }

  const enrichedPapers = await enrichWithCrossref(allPapers);
  const papersWithAbstracts = enrichedPapers.filter(p => p.abstract.length > 50);
  console.log(`[Pipeline] Stage stats: abstract-qualified=${papersWithAbstracts.length}`);

  if (papersWithAbstracts.length === 0) {
    return {
      results: [],
      normalized_query: normalizedQueryForResponse,
      total_papers_searched: allPapers.length,
      openalex_count: openAlexPapers.length,
      semantic_scholar_count: s2Papers.length,
      arxiv_count: arxivPapers.length,
      pubmed_count: pubmedPapers.length,
      query_processing: queryProcessingMeta,
      query_pipeline_mode: queryPipelineMode,
    };
  }

  const queryKeywords = getQueryKeywordSet(searchQuery, queryPipelineMode === "v2" ? queryTermsForRanking : undefined);
  const rankedCandidates = [...papersWithAbstracts].sort(
    (a, b) => scorePaperCandidate(b, queryKeywords) - scorePaperCandidate(a, queryKeywords)
  );

  // Reduce to top 30 candidates, process in 2 parallel LLM batches
  const stagedCandidateCount = Math.min(30, rankedCandidates.length);
  const stagedCandidates = rankedCandidates.slice(0, stagedCandidateCount);
  const batchSize = 15;

  const batchPromises: Promise<StudyResult[]>[] = [];
  for (let i = 0; i < stagedCandidates.length; i += batchSize) {
    const batch = stagedCandidates.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    batchPromises.push(
      extractStudyData(batch, question, GOOGLE_GEMINI_API_KEY).then(results => {
        console.log(`[Pipeline] Stage stats: batch=${batchNumber} candidates=${batch.length} extracted=${results.length}`);
        return results;
      })
    );
  }
  const batchResults = await Promise.all(batchPromises);
  const extractedAcrossBatches = batchResults.flat();

  const mergedByStudy = mergeExtractedStudies(extractedAcrossBatches);
  const results = mergedByStudy.filter((s: any) => isCompleteStudy(s));
  console.log(`[Pipeline] Stage stats: extracted_total=${extractedAcrossBatches.length}, merged_unique=${mergedByStudy.length}, post-filter=${results.length}`);

  console.log(`[Pipeline] Returning ${results.length} structured results`);

  return {
    results,
    normalized_query: normalizedQueryForResponse,
    total_papers_searched: allPapers.length,
    openalex_count: openAlexPapers.length,
    semantic_scholar_count: s2Papers.length,
    arxiv_count: arxivPapers.length,
    pubmed_count: pubmedPapers.length,
    query_processing: queryProcessingMeta,
    query_pipeline_mode: queryPipelineMode,
  };
}

// ─── Background Work Helper ──────────────────────────────────────────────────

function scheduleBackgroundWork(work: Promise<void>): void {
  const runtime = globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<void>) => void } };
  if (runtime.EdgeRuntime?.waitUntil) {
    runtime.EdgeRuntime.waitUntil(work);
  } else {
    work.catch(console.error);
  }
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

async function checkRateLimit(
  supabase: any,
  functionName: string,
  clientIp: string,
  maxRequests: number,
  windowMinutes: number
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("function_name", functionName)
    .eq("client_ip", clientIp)
    .gte("created_at", windowStart);

  if (error) {
    console.error("[rate-limit] Check failed:", error);
    return true; // fail open
  }

  if ((count || 0) >= maxRequests) return false;

  await supabase.from("rate_limits").insert({ function_name: functionName, client_ip: clientIp });
  return true;
}

async function recordQueryProcessingEvent(
  supabase: any,
  params: {
    functionName: string;
    mode: QueryPipelineMode;
    reportId?: string;
    originalQuery: string;
    servedQuery: string;
    normalizedQuery?: string;
    queryProcessing?: QueryProcessingMeta;
    userId?: string;
  },
): Promise<void> {
  if (!params.queryProcessing) return;

  const payload = {
    function_name: params.functionName,
    mode: params.mode,
    user_id: params.userId ?? null,
    report_id: params.reportId ?? null,
    original_query: params.originalQuery,
    served_query: params.servedQuery,
    normalized_query: params.normalizedQuery ?? null,
    deterministic_confidence: params.queryProcessing.deterministic_confidence,
    used_llm_fallback: params.queryProcessing.used_llm_fallback,
    processing_ms: params.queryProcessing.processing_ms,
    reason_codes: params.queryProcessing.reason_codes,
    source_queries: params.queryProcessing.source_queries,
  };

  const { error } = await supabase.from("query_processing_events").insert(payload);
  if (error) {
    console.warn("[query-processing] Failed to record event:", error.message);
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Rate limit: 10 research requests per IP per hour
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const allowed = await checkRateLimit(supabase, "research-async", clientIp, 10, 60);
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = userData.user.id;

    const { question } = await req.json();

    if (!question || typeof question !== "string" || question.trim().length < 5) {
      return new Response(
        JSON.stringify({ error: "Please provide a valid research question (at least 5 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (question.length > 500) {
      return new Response(
        JSON.stringify({ error: "Question is too long (maximum 500 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: report, error: insertError } = await supabase
      .from("research_reports")
      .insert({ question: question.trim(), status: "processing", user_id: userId })
      .select("id")
      .single();

    if (insertError || !report) {
      console.error("[research-async] Insert error:", insertError);
      throw new Error("Failed to create report");
    }

    const reportId = report.id;
    console.log(`[research-async] Created report ${reportId} for: "${question}"`);

    // Run the full pipeline in background — no HTTP fetch, no gateway timeout
    const backgroundWork = (async () => {
      try {
        console.log(`[research-async] Starting background pipeline for ${reportId}`);
        const data = await runResearchPipeline(question.trim());

        const { error: updateError } = await supabase
          .from("research_reports")
          .update({
            status: "completed",
            results: data.results || [],
            normalized_query: data.normalized_query || null,
            query_processing_meta: data.query_processing || null,
            total_papers_searched: data.total_papers_searched || 0,
            openalex_count: data.openalex_count || 0,
            semantic_scholar_count: data.semantic_scholar_count || 0,
            arxiv_count: data.arxiv_count || 0,
            pubmed_count: data.pubmed_count || 0,
            completed_at: new Date().toISOString(),
          })
          .eq("id", reportId);

        if (updateError) {
          console.error(`[research-async] Update error for ${reportId}:`, updateError);
        } else {
          console.log(`[research-async] Report ${reportId} completed with ${(data.results || []).length} results`);
          await recordQueryProcessingEvent(supabase, {
            functionName: "research-async",
            mode: data.query_pipeline_mode,
            reportId,
            originalQuery: question.trim(),
            servedQuery: data.normalized_query || question.trim(),
            normalizedQuery: data.normalized_query,
            queryProcessing: data.query_processing,
            userId,
          });

          // Trigger PDF downloads for DOIs
          const dois = (data.results || [])
            .map((r: any) => r.citation?.doi?.trim())
            .filter((doi: string | undefined): doi is string => doi !== undefined && doi !== '');

          if (dois.length > 0) {
            console.log(`[research-async] Triggering PDF download for ${dois.length} DOIs`);
            const scihubUrl = `${supabaseUrl}/functions/v1/scihub-download`;
            fetch(scihubUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
              },
              body: JSON.stringify({ report_id: reportId, dois, user_id: userId }),
            }).catch(err => {
              console.error(`[research-async] Failed to trigger PDF downloads:`, err);
            });
          }
        }
      } catch (err) {
        console.error(`[research-async] Background pipeline failed for ${reportId}:`, err);
        await supabase
          .from("research_reports")
          .update({
            status: "failed",
            error_message: err instanceof Error ? err.message : "An unexpected error occurred",
            completed_at: new Date().toISOString(),
          })
          .eq("id", reportId);
      }
    })();

    scheduleBackgroundWork(backgroundWork);

    return new Response(
      JSON.stringify({ report_id: reportId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[research-async] Error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
