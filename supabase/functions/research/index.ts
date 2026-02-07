import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Strict output schema for research papers
interface StudyResult {
  study_id: string;
  title: string;
  year: number;
  study_design: "RCT" | "cohort" | "cross-sectional" | "review" | "unknown";
  sample_size: number | null;
  population: string | null;
  outcome_measured: string;
  key_result: string | null;
  citation: string;
  abstract_excerpt: string;
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
}

// Reconstruct abstract from inverted index
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

// Format citation
function formatCitation(work: OpenAlexWork): string {
  const authors = work.authorships?.slice(0, 3).map(a => a.author.display_name).join(", ") || "Unknown";
  const etAl = (work.authorships?.length || 0) > 3 ? " et al." : "";
  const year = work.publication_year || "n.d.";
  const source = work.primary_location?.source?.display_name || "";
  
  return `${authors}${etAl} (${year}). ${work.title}. ${source}`.trim();
}

// Query OpenAlex API
async function searchOpenAlex(query: string): Promise<OpenAlexWork[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://api.openalex.org/works?search=${encodedQuery}&filter=has_abstract:true&per_page=25&sort=relevance_score:desc`;
  
  console.log(`[OpenAlex] Searching: ${query}`);
  
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "ResearchAssistant/1.0 (mailto:research@example.com)",
    },
  });
  
  if (!response.ok) {
    throw new Error(`OpenAlex API error: ${response.status}`);
  }
  
  const data = await response.json();
  console.log(`[OpenAlex] Found ${data.results?.length || 0} papers`);
  
  return data.results || [];
}

// Extract data using LLM with strict prompting
async function extractStudyData(
  papers: Array<{ work: OpenAlexWork; abstract: string; citation: string }>,
  question: string,
  apiKey: string
): Promise<StudyResult[]> {
  const papersContext = papers.map((p, i) => ({
    index: i,
    title: p.work.title,
    year: p.work.publication_year,
    abstract: p.abstract,
    citation: p.citation,
    id: p.work.id,
  }));

  const systemPrompt = `You are a rigorous academic data extractor. Your task is to extract ONLY explicitly stated information from paper abstracts.

CRITICAL RULES:
1. Extract ONLY what is explicitly stated in the abstract text
2. NEVER infer, generalize, or assume information not present
3. Use null for ANY field where the information is not explicitly stated
4. For study_design: Classify based on explicit mentions only. If unclear, use "unknown"
5. For sample_size: Extract only if an exact number is stated (e.g., "n=150", "150 participants")
6. For key_result: Quote or closely paraphrase the main finding. Use null if no clear result stated
7. NEVER use causal language unless the abstract explicitly states causation
8. Every extraction must be traceable to specific text in the abstract

OUTPUT FORMAT: Return a JSON array of objects with this exact schema:
{
  "study_id": "string (use the paper ID)",
  "title": "string",
  "year": number,
  "study_design": "RCT" | "cohort" | "cross-sectional" | "review" | "unknown",
  "sample_size": number | null,
  "population": "string describing studied population" | null,
  "outcome_measured": "string describing what was measured",
  "key_result": "string with main finding, must be explicitly stated" | null,
  "citation": "string (formatted citation)",
  "abstract_excerpt": "string (the relevant sentence(s) from abstract supporting key_result)"
}

Return ONLY valid JSON array. No markdown, no explanation.`;

  const userPrompt = `Research Question: "${question}"

Papers to analyze:
${JSON.stringify(papersContext, null, 2)}

Extract structured data from each paper's abstract. Remember: null for missing data, no inference.`;

  console.log(`[LLM] Sending ${papers.length} papers for extraction`);

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
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

    // Step 1: Search OpenAlex
    const works = await searchOpenAlex(question);
    
    if (works.length === 0) {
      return new Response(
        JSON.stringify({ results: [], message: "No papers found for this query" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Prepare papers with abstracts
    const papersWithAbstracts = works
      .map(work => ({
        work,
        abstract: reconstructAbstract(work.abstract_inverted_index),
        citation: formatCitation(work),
      }))
      .filter(p => p.abstract.length > 50); // Filter out papers with very short abstracts

    console.log(`[Research] ${papersWithAbstracts.length} papers with valid abstracts`);

    if (papersWithAbstracts.length === 0) {
      return new Response(
        JSON.stringify({ results: [], message: "No papers with sufficient abstracts found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Extract structured data using LLM
    const results = await extractStudyData(
      papersWithAbstracts.slice(0, 15), // Limit to top 15 for LLM processing
      question,
      LOVABLE_API_KEY
    );

    console.log(`[Research] Returning ${results.length} structured results`);

    return new Response(
      JSON.stringify({ results, query: question, total_papers_searched: works.length }),
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
