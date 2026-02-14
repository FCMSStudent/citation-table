import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
  source: "openalex" | "semantic_scholar" | "arxiv";
  citationCount?: number;
}

interface OpenAlexWork {
  id: string;
  title: string;
  publication_year: number;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: Array<{ author: { display_name: string } }>;
  primary_location?: { source?: { display_name: string } };
  doi?: string;
  type?: string;
  cited_by_count?: number;
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
  source: "openalex" | "semantic_scholar" | "arxiv";
  citationCount?: number;
  publicationTypes?: string[];
  journal?: string;
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

function extractSearchKeywords(query: string): string {
  const STOP_WORDS = new Set([
    "what", "are", "is", "the", "a", "an", "of", "for", "with", "to", "in", "on",
    "and", "or", "how", "does", "do", "can", "could", "would", "should", "will",
    "that", "this", "these", "those", "it", "its", "be", "been", "being", "was",
    "were", "has", "have", "had", "not", "no", "but", "by", "from", "at", "as",
    "into", "through", "between", "about", "their", "there", "than",
    "reported", "outcomes", "associated", "effects", "effect", "impact",
    "relationship", "role", "influence", "evidence", "studies", "study",
  ]);
  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 1 && !STOP_WORDS.has(w));
  const seen = new Set<string>();
  const unique = keywords.filter(w => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });
  const result = unique.slice(0, 6).join(" ");
  console.log(`[Keywords] "${query}" -> "${result}"`);
  return result;
}

// ─── API Search Functions ────────────────────────────────────────────────────

async function searchOpenAlex(query: string): Promise<UnifiedPaper[]> {
  const encodedQuery = encodeURIComponent(query);
  const apiKey = Deno.env.get("OPENALEX_API_KEY");
  let url = `https://api.openalex.org/works?search=${encodedQuery}&filter=has_abstract:true&per_page=25&sort=relevance_score:desc`;
  if (apiKey) {
    url += `&api_key=${apiKey}`;
    console.log(`[OpenAlex] Using API key for polite pool access`);
  }
  console.log(`[OpenAlex] Searching: ${query}`);
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
    return works.map(work => ({
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

async function searchSemanticScholar(query: string): Promise<UnifiedPaper[]> {
  const keywords = extractSearchKeywords(query);
  if (!keywords) return [];
  const encodedQuery = encodeURIComponent(keywords);
  const fields = "paperId,title,abstract,year,authors,venue,citationCount,publicationTypes,externalIds";
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodedQuery}&fields=${fields}&limit=25`;
  const apiKey = Deno.env.get("SEMANTIC_SCHOLAR_API_KEY");
  console.log(`[SemanticScholar] Searching: ${query}${apiKey ? ' (with API key)' : ' (public tier)'}`);
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
      .map(paper => ({
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
      }));
  } catch (error) {
    console.error(`[SemanticScholar] Error:`, error);
    return [];
  }
}

async function searchArxiv(query: string): Promise<UnifiedPaper[]> {
  const keywords = extractSearchKeywords(query);
  if (!keywords) return [];
  const encodedQuery = encodeURIComponent(keywords);
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodedQuery}&max_results=25`;
  console.log(`[ArXiv] Searching: ${keywords}`);
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
      });
    }
    console.log(`[ArXiv] Found ${papers.length} papers`);
    return papers;
  } catch (error) {
    console.error(`[ArXiv] Error:`, error);
    return [];
  }
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function deduplicateAndMerge(s2Papers: UnifiedPaper[], openAlexPapers: UnifiedPaper[], arxivPapers: UnifiedPaper[]): UnifiedPaper[] {
  const doiMap = new Map<string, UnifiedPaper>();
  const titleMap = new Map<string, UnifiedPaper>();
  const uniquePapers = new Set<UnifiedPaper>();
  const allPapers = [...s2Papers, ...openAlexPapers, ...arxivPapers];
  for (const paper of allPapers) {
    const normalizedTitle = paper.title.toLowerCase().trim();
    const doi = paper.doi?.toLowerCase().trim();
    const existingPaper = (doi ? doiMap.get(doi) : undefined) || titleMap.get(normalizedTitle);
    if (existingPaper) {
      if (paper.source === "semantic_scholar" && paper.citationCount !== undefined) {
        existingPaper.citationCount = paper.citationCount;
      }
      if (paper.pubmed_id && !existingPaper.pubmed_id) existingPaper.pubmed_id = paper.pubmed_id;
      if (paper.openalex_id && !existingPaper.openalex_id) existingPaper.openalex_id = paper.openalex_id;
      if (doi && !existingPaper.doi) {
        existingPaper.doi = paper.doi;
        doiMap.set(doi, existingPaper);
      }
    } else {
      uniquePapers.add(paper);
      if (doi) doiMap.set(doi, paper);
      titleMap.set(normalizedTitle, paper);
    }
  }
  console.log(`[Deduplication] ${allPapers.length} total -> ${uniquePapers.size} unique papers`);
  return Array.from(uniquePapers);
}

// ─── Crossref Enrichment ─────────────────────────────────────────────────────

async function enrichWithCrossref(papers: UnifiedPaper[]): Promise<UnifiedPaper[]> {
  const enrichedPapers = [...papers];
  for (const paper of enrichedPapers) {
    try {
      let crossrefData = null;
      if (paper.doi) {
        const encodedDoi = encodeURIComponent(paper.doi);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(`https://api.crossref.org/works/${encodedDoi}`, {
            headers: { 'User-Agent': 'CitationTable/1.0 (https://github.com/FCMSStudent/citation-table)' },
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (response.ok) {
            const data = await response.json();
            crossrefData = data.message;
          } else if (response.status === 404) {
            console.log(`[Crossref] DOI not found: ${paper.doi}`);
          } else if (response.status === 429) {
            console.warn(`[Crossref] Rate limit hit for DOI: ${paper.doi}`);
          }
        } catch (error) {
          clearTimeout(timeoutId);
          if ((error as Error).name === 'AbortError') {
            console.warn(`[Crossref] Request timeout for DOI: ${paper.doi}`);
          } else {
            throw error;
          }
        }
      } else if (paper.title) {
        const encodedTitle = encodeURIComponent(paper.title);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(
            `https://api.crossref.org/works?query.bibliographic=${encodedTitle}&rows=1`,
            {
              headers: { 'User-Agent': 'CitationTable/1.0 (https://github.com/FCMSStudent/citation-table)' },
              signal: controller.signal
            }
          );
          clearTimeout(timeoutId);
          if (response.ok) {
            const data = await response.json();
            if (data.message.items && data.message.items.length > 0) {
              crossrefData = data.message.items[0];
            }
          }
        } catch (error) {
          clearTimeout(timeoutId);
          if ((error as Error).name === 'AbortError') {
            console.warn(`[Crossref] Request timeout for title search: ${paper.title}`);
          } else {
            throw error;
          }
        }
      }
      if (crossrefData) {
        paper.doi = crossrefData.DOI || paper.doi;
        paper.year = crossrefData.issued?.['date-parts']?.[0]?.[0] || paper.year;
        paper.citationCount = crossrefData['is-referenced-by-count'] ?? paper.citationCount;
        if (crossrefData['container-title']?.[0]) {
          paper.journal = crossrefData['container-title'][0];
        }
        console.log(`[Crossref] Enriched "${paper.title}" with citation count: ${crossrefData['is-referenced-by-count']}`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`[Crossref] Enrichment failed for paper "${paper.title}":`, error);
    }
  }
  console.log(`[Crossref] Enrichment complete for ${enrichedPapers.length} papers`);
  return enrichedPapers;
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
  "source": "openalex" | "semantic_scholar" | "arxiv",
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
    const allowedDesigns = new Set(["RCT", "cohort", "cross-sectional", "review"]);
    const filtered = results.filter((s: any) => allowedDesigns.has(s.study_design));
    console.log(`[LLM] Filtered: ${results.length} -> ${filtered.length} (removed ${results.length - filtered.length} unknown/ineligible)`);
    const withAbstract = filtered.filter((s: any) =>
      s.abstract_excerpt && s.abstract_excerpt.trim().length >= 50
    );
    console.log(`[LLM] Abstract filter: ${filtered.length} -> ${withAbstract.length}`);
    return withAbstract;
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
}

async function runResearchPipeline(question: string): Promise<PipelineResult> {
  const GOOGLE_GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
  if (!GOOGLE_GEMINI_API_KEY) {
    throw new Error("AI service not configured. Please add your Google Gemini API key.");
  }

  console.log(`[Pipeline] Processing question: "${question}"`);

  const { normalized, wasNormalized } = normalizeQuery(question);
  const searchQuery = wasNormalized ? normalized : question;
  if (wasNormalized) console.log(`[Pipeline] Query normalized: "${question}" -> "${normalized}"`);

  const s2Papers = await searchSemanticScholar(searchQuery);
  const openAlexPapers = await searchOpenAlex(searchQuery);
  const arxivPapers = await searchArxiv(searchQuery);

  const allPapers = deduplicateAndMerge(s2Papers, openAlexPapers, arxivPapers);

  if (allPapers.length === 0) {
    return {
      results: [],
      normalized_query: wasNormalized ? normalized : undefined,
      total_papers_searched: 0,
      openalex_count: 0,
      semantic_scholar_count: 0,
      arxiv_count: 0,
    };
  }

  const enrichedPapers = await enrichWithCrossref(allPapers);
  const papersWithAbstracts = enrichedPapers.filter(p => p.abstract.length > 50);
  console.log(`[Pipeline] ${papersWithAbstracts.length} papers with valid abstracts`);

  if (papersWithAbstracts.length === 0) {
    return {
      results: [],
      normalized_query: wasNormalized ? normalized : undefined,
      total_papers_searched: allPapers.length,
      openalex_count: openAlexPapers.length,
      semantic_scholar_count: s2Papers.length,
      arxiv_count: arxivPapers.length,
    };
  }

  const topPapers = papersWithAbstracts.slice(0, 15);
  const results = await extractStudyData(topPapers, question, GOOGLE_GEMINI_API_KEY);

  console.log(`[Pipeline] Returning ${results.length} structured results`);

  return {
    results,
    normalized_query: wasNormalized ? normalized : undefined,
    total_papers_searched: allPapers.length,
    openalex_count: openAlexPapers.length,
    semantic_scholar_count: s2Papers.length,
    arxiv_count: arxivPapers.length,
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
      .insert({ question: question.trim(), status: "processing" })
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
            total_papers_searched: data.total_papers_searched || 0,
            openalex_count: data.openalex_count || 0,
            semantic_scholar_count: data.semantic_scholar_count || 0,
            arxiv_count: data.arxiv_count || 0,
            completed_at: new Date().toISOString(),
          })
          .eq("id", reportId);

        if (updateError) {
          console.error(`[research-async] Update error for ${reportId}:`, updateError);
        } else {
          console.log(`[research-async] Report ${reportId} completed with ${(data.results || []).length} results`);

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
              body: JSON.stringify({ report_id: reportId, dois }),
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
