import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Updated schema matching meta prompt requirements
interface Outcome {
  outcome_measured: string;
  key_result: string | null;
  citation_snippet: string;
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
  authorships?: Array<{
    author: { display_name: string };
  }>;
  primary_location?: {
    source?: { display_name: string };
  };
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
  externalIds: {
    DOI?: string;
    PubMed?: string;
  };
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

// Reconstruct abstract from OpenAlex inverted index
function reconstructAbstract(invertedIndex: Record<string, number[]> | undefined): string {
  if (!invertedIndex) return "";
  
  // Find max index to determine array size
  let maxIndex = 0;
  for (const indices of Object.values(invertedIndex)) {
    for (const index of indices) {
      if (index > maxIndex) maxIndex = index;
    }
  }

  // Build array of words at their positions
  const words = new Array(maxIndex + 1);
  for (const [word, indices] of Object.entries(invertedIndex)) {
    for (const index of indices) {
      words[index] = word;
    }
  }

  // Filter out any potential gaps and join
  return words.filter(word => word !== undefined).join(" ");
}

// Format citation in APA style
function formatCitation(paper: UnifiedPaper): string {
  const authors = paper.authors.slice(0, 3).join(", ");
  const etAl = paper.authors.length > 3 ? " et al." : "";
  const year = paper.year || "n.d.";
  const venue = paper.venue || "";
  
  return `${authors}${etAl} (${year}). ${paper.title}. ${venue}`.trim();
}

// Normalize query per meta prompt requirements
function normalizeQuery(query: string): { normalized: string; wasNormalized: boolean } {
  const original = query.trim();
  let normalized = original;
  let wasNormalized = false;

  // Remove comparative/evaluative language
  const comparativePatterns = [
    /\b(better|best|worse|worst|superior|inferior)\b/gi,
    /\b(more|less)\s+(effective|efficient|beneficial)\b/gi,
  ];

  for (const pattern of comparativePatterns) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, (match) => {
        wasNormalized = true;
        // Replace with neutral form
        if (/better|best|superior/i.test(match)) return "associated with";
        if (/worse|worst|inferior/i.test(match)) return "associated with";
        return "outcomes of";
      });
    }
  }

  // Rewrite vague "effects of X" to "reported outcomes associated with X"
  if (/\beffects?\s+of\b/i.test(normalized)) {
    normalized = normalized.replace(/\beffects?\s+of\b/gi, "reported outcomes associated with");
    wasNormalized = true;
  }

  return { normalized: normalized.trim(), wasNormalized };
}

// Query OpenAlex API
async function searchOpenAlex(query: string): Promise<UnifiedPaper[]> {
  const encodedQuery = encodeURIComponent(query);
  const apiKey = Deno.env.get("OPENALEX_API_KEY");
  
  // Build URL with API key if available
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
    
    // Convert to unified format
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

// Rate limiter for Semantic Scholar (1 req/sec with API key)
let lastS2RequestTime = 0;
async function s2RateLimit() {
  const now = Date.now();
  const elapsed = now - lastS2RequestTime;
  if (elapsed < 1000) {
    const wait = 1000 - elapsed;
    console.log(`[SemanticScholar] Rate limiting: waiting ${wait}ms`);
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  lastS2RequestTime = Date.now();
}

// Query Semantic Scholar API
async function searchSemanticScholar(query: string): Promise<UnifiedPaper[]> {
  const encodedQuery = encodeURIComponent(query);
  const fields = "paperId,title,abstract,year,authors,venue,citationCount,publicationTypes,externalIds";
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodedQuery}&fields=${fields}&limit=25`;
  
  const apiKey = Deno.env.get("SEMANTIC_SCHOLAR_API_KEY");
  console.log(`[SemanticScholar] Searching: ${query}${apiKey ? ' (with API key)' : ' (public tier)'}`);
  
  try {
    await s2RateLimit();
    const headers: Record<string, string> = {
      "Accept": "application/json",
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.error(`[SemanticScholar] API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const papers: SemanticScholarPaper[] = data.data || [];
    console.log(`[SemanticScholar] Found ${papers.length} papers`);
    
    // Convert to unified format - fix null to undefined for publicationTypes
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

interface ArxivEntry {
  id: string;           // arXiv ID (e.g., "http://arxiv.org/abs/2301.12345v1")
  title: string;
  published: string;    // ISO date string
  summary: string;      // abstract
  authors: Array<{ name: string }>;
  doi?: string;         // optional DOI
  primary_category?: string;
}

// Query arXiv API
async function searchArxiv(query: string): Promise<UnifiedPaper[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodedQuery}&max_results=25`;
  
  console.log(`[ArXiv] Searching: ${query}`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[ArXiv] API error: ${response.status}`);
      return [];
    }
    
    const xmlText = await response.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "text/xml");
    const entries = xml.querySelectorAll("entry");
    
    const papers: UnifiedPaper[] = [];
    for (const entry of entries) {
      // Extract fields from XML
      const idElement = entry.querySelector("id");
      const titleElement = entry.querySelector("title");
      const publishedElement = entry.querySelector("published");
      const summaryElement = entry.querySelector("summary");
      
      if (!idElement || !titleElement || !publishedElement || !summaryElement) {
        continue; // Skip entries with missing required fields
      }
      
      const fullId = idElement.textContent?.trim() || "";
      // Extract arXiv ID from URL: "http(s)://(export.)arxiv.org/abs/2301.12345v1" -> "2301.12345"
      // First remove the URL prefix (handles both arxiv.org and export.arxiv.org)
      // Then remove version suffix (v1, v2, etc.)
      const arxivId = fullId.replace(/^https?:\/\/(export\.)?arxiv\.org\/abs\//, "").replace(/v\d+$/, "");
      
      const title = titleElement.textContent?.trim().replace(/\s+/g, " ") || "Untitled";
      const published = publishedElement.textContent?.trim() || "";
      const year = published ? parseInt(published.substring(0, 4)) : new Date().getFullYear();
      const abstract = summaryElement.textContent?.trim().replace(/\s+/g, " ") || "";
      
      // Extract authors
      const authorElements = entry.querySelectorAll("author > name");
      const authors: string[] = [];
      for (const authorEl of authorElements) {
        const authorName = authorEl.textContent?.trim();
        if (authorName) {
          authors.push(authorName);
        }
      }
      
      // Extract DOI if present (arXiv uses namespaced elements, try multiple selectors)
      let doi: string | null = null;
      // Try different namespace selector approaches
      const doiElement = entry.querySelector("doi") || 
                        entry.querySelector("arxiv\\:doi") || 
                        entry.querySelector('[*|doi]');
      if (doiElement) {
        doi = doiElement.textContent?.trim() || null;
      }
      
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

// Deduplicate and merge papers from both sources (Semantic Scholar preferred)
function deduplicateAndMerge(s2Papers: UnifiedPaper[], openAlexPapers: UnifiedPaper[], arxivPapers: UnifiedPaper[]): UnifiedPaper[] {
  const doiMap = new Map<string, UnifiedPaper>();
  const titleMap = new Map<string, UnifiedPaper>();
  const uniquePapers = new Set<UnifiedPaper>();
  
  // Process Semantic Scholar first so it takes priority
  const allPapers = [...s2Papers, ...openAlexPapers, ...arxivPapers];
  
  for (const paper of allPapers) {
    const normalizedTitle = paper.title.toLowerCase().trim();
    const doi = paper.doi?.toLowerCase().trim();

    // Try to find existing paper by DOI or Title
    const existingPaper = (doi ? doiMap.get(doi) : undefined) || titleMap.get(normalizedTitle);
    
    if (existingPaper) {
      // Merge: combine metadata from current paper into existingPaper
      // Prefer Semantic Scholar for citation count
      if (paper.source === "semantic_scholar" && paper.citationCount !== undefined) {
        existingPaper.citationCount = paper.citationCount;
      }
      // Merge identifiers - prefer non-null values
      if (paper.pubmed_id && !existingPaper.pubmed_id) {
        existingPaper.pubmed_id = paper.pubmed_id;
      }
      if (paper.openalex_id && !existingPaper.openalex_id) {
        existingPaper.openalex_id = paper.openalex_id;
      }
      // If we found it by title but now have a DOI, update doiMap
      if (doi && !existingPaper.doi) {
        existingPaper.doi = paper.doi;
        doiMap.set(doi, existingPaper);
      }
    } else {
      // New unique paper
      uniquePapers.add(paper);
      if (doi) doiMap.set(doi, paper);
      titleMap.set(normalizedTitle, paper);
    }
  }
  
  console.log(`[Deduplication] ${allPapers.length} total -> ${uniquePapers.size} unique papers`);
  return Array.from(uniquePapers);
}

// Enrich papers with Crossref metadata
async function enrichWithCrossref(papers: UnifiedPaper[]): Promise<UnifiedPaper[]> {
  const enrichedPapers = [...papers];
  
  for (const paper of enrichedPapers) {
    try {
      let crossrefData = null;
      
      // Try fetching by DOI first
      if (paper.doi) {
        const encodedDoi = encodeURIComponent(paper.doi);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        try {
          const response = await fetch(`https://api.crossref.org/works/${encodedDoi}`, {
            headers: {
              'User-Agent': 'CitationTable/1.0 (https://github.com/FCMSStudent/citation-table)'
            },
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
          if (error.name === 'AbortError') {
            console.warn(`[Crossref] Request timeout for DOI: ${paper.doi}`);
          } else {
            throw error;
          }
        }
      } 
      // Fallback: search by title if no DOI
      else if (paper.title) {
        const encodedTitle = encodeURIComponent(paper.title);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        try {
          const response = await fetch(
            `https://api.crossref.org/works?query.bibliographic=${encodedTitle}&rows=1`,
            {
              headers: {
                'User-Agent': 'CitationTable/1.0 (https://github.com/FCMSStudent/citation-table)'
              },
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
          if (error.name === 'AbortError') {
            console.warn(`[Crossref] Request timeout for title search: ${paper.title}`);
          } else {
            throw error;
          }
        }
      }
      
      // Merge Crossref data into paper
      if (crossrefData) {
        paper.doi = crossrefData.DOI || paper.doi;
        paper.year = crossrefData.issued?.['date-parts']?.[0]?.[0] || paper.year;
        paper.citationCount = crossrefData['is-referenced-by-count'] ?? paper.citationCount;
        
        // Add journal/publisher metadata
        if (crossrefData['container-title']?.[0]) {
          paper.journal = crossrefData['container-title'][0];
        }
        
        console.log(`[Crossref] Enriched "${paper.title}" with citation count: ${crossrefData['is-referenced-by-count']}`);
      }
      
      // Rate limiting: small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`[Crossref] Enrichment failed for paper "${paper.title}":`, error);
      // Continue without enrichment
    }
  }
  
  console.log(`[Crossref] Enrichment complete for ${enrichedPapers.length} papers`);
  return enrichedPapers;
}

// Extract data using LLM with strict prompting per meta prompt
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
10. Classify preprint_status: "Preprint" if preprint/not peer-reviewed, else "Peer-reviewed"
11. Classify review_type: "Meta-analysis" for meta-analyses (MUST flag), "Systematic review" for systematic reviews, else "None"

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
    "citation_snippet": "verbatim text from abstract supporting this result"
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
- Each outcome needs its own citation_snippet
- No inference - null for missing data
- Verbatim extraction for populations and numerical results`;

  console.log(`[LLM] Sending ${papers.length} papers for extraction via Google Gemini`);

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[LLM] Gemini error: ${response.status}`, errorText);
    
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again in a moment.");
    }
    if (response.status === 403) {
      throw new Error("Invalid Google Gemini API key. Please check your key.");
    }
    throw new Error(`LLM extraction failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
  console.log(`[LLM] Raw response length: ${content.length}`);

  // Parse JSON from response (handle potential markdown wrapping)
  let jsonStr = content.trim();
  if (jsonStr.startsWith("```json")) {
    jsonStr = jsonStr.slice(7);
  }
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith("```")) {
    jsonStr = jsonStr.slice(0, -3);
  }
  
  try {
    const results = JSON.parse(jsonStr.trim());
    console.log(`[LLM] Parsed ${results.length} study results`);
    return results;
  } catch (parseError) {
    console.error(`[LLM] JSON parse error:`, parseError);
    console.error(`[LLM] Content was:`, jsonStr.slice(0, 500));
    throw new Error("Failed to parse LLM response as JSON");
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { question } = await req.json();
    
    // Security: Input validation
    if (!question || typeof question !== "string" || question.trim().length < 5) {
      return new Response(
        JSON.stringify({ error: "Please provide a valid research question (at least 5 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Security: Limit input length to prevent DoS/excessive token usage
    if (question.length > 500) {
      return new Response(
        JSON.stringify({ error: "Question is too long (maximum 500 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const GOOGLE_GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GOOGLE_GEMINI_API_KEY) {
      console.error("GOOGLE_GEMINI_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured. Please add your Google Gemini API key." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Research] Processing question: "${question}"`);

    // Step 1: Normalize query if needed
    const { normalized, wasNormalized } = normalizeQuery(question);
    const searchQuery = wasNormalized ? normalized : question;
    
    if (wasNormalized) {
      console.log(`[Research] Query normalized: "${question}" -> "${normalized}"`);
    }

    // Step 2: Search Semantic Scholar first (primary), then OpenAlex (secondary)
    const s2Papers = await searchSemanticScholar(searchQuery);
    const openAlexPapers = await searchOpenAlex(searchQuery);
    const arxivPapers = await searchArxiv(searchQuery);

    // Step 3: Deduplicate and merge (Semantic Scholar results prioritized)
    const allPapers = deduplicateAndMerge(s2Papers, openAlexPapers, arxivPapers);
    
    if (allPapers.length === 0) {
      return new Response(
        JSON.stringify({ 
          results: [], 
          query: question,
          normalized_query: wasNormalized ? normalized : undefined,
          total_papers_searched: 0,
          openalex_count: 0,
          semantic_scholar_count: 0,
          arxiv_count: 0,
          message: "No eligible studies matching the query were identified in the searched sources." 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3.5: Enrich with Crossref data
    const enrichedPapers = await enrichWithCrossref(allPapers);

    // Filter papers with sufficient abstracts
    const papersWithAbstracts = enrichedPapers.filter(p => p.abstract.length > 50);
    console.log(`[Research] ${papersWithAbstracts.length} papers with valid abstracts`);

    if (papersWithAbstracts.length === 0) {
      return new Response(
        JSON.stringify({ 
          results: [], 
          query: question,
          normalized_query: wasNormalized ? normalized : undefined,
          total_papers_searched: allPapers.length,
          openalex_count: openAlexPapers.length,
          semantic_scholar_count: s2Papers.length,
          arxiv_count: arxivPapers.length,
          message: "No eligible studies matching the query were identified in the searched sources." 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 4: Rerank - prioritize direct exposure-outcome match, then population match
    // For now, take top 15 by relevance (already sorted by API)
    const topPapers = papersWithAbstracts.slice(0, 15);

    // Step 5: Extract structured data using LLM
    const results = await extractStudyData(
      topPapers,
      question,
      GOOGLE_GEMINI_API_KEY
    );

    console.log(`[Research] Returning ${results.length} structured results`);

    return new Response(
      JSON.stringify({ 
        results, 
        query: question,
        normalized_query: wasNormalized ? normalized : undefined,
        total_papers_searched: allPapers.length,
        openalex_count: openAlexPapers.length,
        semantic_scholar_count: s2Papers.length,
        arxiv_count: arxivPapers.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    // Security: Log detailed error internally, but return generic message to client
    // to avoid leaking sensitive system information or stack traces
    console.error("[Research] Error:", error);

    let clientMessage = "An unexpected error occurred while processing your research question";
    let statusCode = 500;

    if (error instanceof Error) {
      // Allow specific safe error messages through if they are useful to the user
      if (error.message.includes("Rate limit") || error.message.includes("API credits")) {
        clientMessage = error.message;
        statusCode = 429;
      }
    }
    
    return new Response(
      JSON.stringify({ error: clientMessage }),
      { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
