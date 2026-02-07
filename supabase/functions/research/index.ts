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
  source: "openalex" | "semantic_scholar";
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
  source: "openalex" | "semantic_scholar";
  citationCount?: number;
  publicationTypes?: string[];
}

// Reconstruct abstract from OpenAlex inverted index
function reconstructAbstract(invertedIndex: Record<string, number[]> | undefined): string {
  if (!invertedIndex) return "";
  
  const positions: Array<[string, number]> = [];
  for (const [word, indices] of Object.entries(invertedIndex)) {
    for (const index of indices) {
      positions.push([word, index]);
    }
  }
  positions.sort((a, b) => a[1] - b[1]);
  return positions.map(([word]) => word).join(" ");
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
  const url = `https://api.openalex.org/works?search=${encodedQuery}&filter=has_abstract:true&per_page=25&sort=relevance_score:desc`;
  
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
      pubmed_id: null, // OpenAlex doesn't directly provide PubMed ID
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

// Query Semantic Scholar API
async function searchSemanticScholar(query: string): Promise<UnifiedPaper[]> {
  const encodedQuery = encodeURIComponent(query);
  const fields = "paperId,title,abstract,year,authors,venue,citationCount,publicationTypes,externalIds";
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodedQuery}&fields=${fields}&limit=25`;
  
  console.log(`[SemanticScholar] Searching: ${query}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
      },
    });
    
    if (!response.ok) {
      console.error(`[SemanticScholar] API error: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    const papers: SemanticScholarPaper[] = data.data || [];
    console.log(`[SemanticScholar] Found ${papers.length} papers`);
    
    // Convert to unified format
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
        publicationTypes: paper.publicationTypes,
      }));
  } catch (error) {
    console.error(`[SemanticScholar] Error:`, error);
    return [];
  }
}

// Deduplicate and merge papers from both sources
function deduplicateAndMerge(openAlexPapers: UnifiedPaper[], s2Papers: UnifiedPaper[]): UnifiedPaper[] {
  const doiMap = new Map<string, UnifiedPaper>();
  const titleMap = new Map<string, UnifiedPaper>();
  
  // Process all papers
  const allPapers = [...openAlexPapers, ...s2Papers];
  
  for (const paper of allPapers) {
    const normalizedTitle = paper.title.toLowerCase().trim();
    
    // Check for DOI match first
    if (paper.doi) {
      const existingByDoi = doiMap.get(paper.doi);
      if (existingByDoi) {
        // Merge: combine metadata from both sources
        const merged = { ...existingByDoi };
        // Prefer Semantic Scholar for citation count
        if (paper.source === "semantic_scholar" && paper.citationCount !== undefined) {
          merged.citationCount = paper.citationCount;
        }
        // Merge identifiers - prefer non-null values
        if (paper.pubmed_id && !merged.pubmed_id) {
          merged.pubmed_id = paper.pubmed_id;
        }
        if (paper.openalex_id && !merged.openalex_id) {
          merged.openalex_id = paper.openalex_id;
        }
        doiMap.set(paper.doi, merged);
        continue;
      }
      doiMap.set(paper.doi, paper);
    } else {
      // Fallback to title matching for papers without DOI
      if (titleMap.has(normalizedTitle)) {
        continue; // Skip duplicate
      }
      titleMap.set(normalizedTitle, paper);
    }
  }
  
  // Combine unique papers
  const uniquePapers = [...doiMap.values(), ...titleMap.values()];
  console.log(`[Deduplication] ${allPapers.length} total -> ${uniquePapers.length} unique papers`);
  
  return uniquePapers;
}

// Extract data using LLM with strict prompting per meta prompt
async function extractStudyData(
  papers: UnifiedPaper[],
  question: string,
  apiKey: string
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
  "source": "openalex" | "semantic_scholar",
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

  console.log(`[LLM] Sending ${papers.length} papers for extraction`);

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.0-flash-exp",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1, // Low temperature for consistency
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[LLM] Error: ${response.status}`, errorText);
    
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again in a moment.");
    }
    if (response.status === 402) {
      throw new Error("API credits exhausted. Please add credits to continue.");
    }
    throw new Error(`LLM extraction failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  
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
    
    if (!question || typeof question !== "string" || question.trim().length < 5) {
      return new Response(
        JSON.stringify({ error: "Please provide a valid research question (at least 5 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
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

    // Step 2: Search both APIs in parallel
    const [openAlexPapers, s2Papers] = await Promise.all([
      searchOpenAlex(searchQuery),
      searchSemanticScholar(searchQuery),
    ]);

    // Step 3: Deduplicate and merge
    const allPapers = deduplicateAndMerge(openAlexPapers, s2Papers);
    
    if (allPapers.length === 0) {
      return new Response(
        JSON.stringify({ 
          results: [], 
          query: question,
          normalized_query: wasNormalized ? normalized : undefined,
          total_papers_searched: 0,
          openalex_count: 0,
          semantic_scholar_count: 0,
          message: "No eligible studies matching the query were identified in the searched sources." 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter papers with sufficient abstracts
    const papersWithAbstracts = allPapers.filter(p => p.abstract.length > 50);
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
      LOVABLE_API_KEY
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
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[Research] Error:", error);
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
