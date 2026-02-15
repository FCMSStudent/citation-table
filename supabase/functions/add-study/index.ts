import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Outcome {
  outcome_measured: string;
  key_result: string | null;
  citation_snippet: string;
  intervention: string | null;
  comparator: string | null;
  effect_size: string | null;
  p_value: string | null;
}

interface StudyResult {
  study_id: string;
  title: string;
  year: number;
  study_design: "RCT" | "cohort" | "cross-sectional" | "review" | "unknown";
  sample_size: number | null;
  population: string | null;
  outcomes: Outcome[];
  citation: {
    doi: string | null;
    pubmed_id: string | null;
    openalex_id: string | null;
    formatted: string;
  };
  abstract_excerpt: string;
  preprint_status: "Preprint" | "Peer-reviewed";
  review_type: "None" | "Systematic review" | "Meta-analysis";
  source: "openalex" | "semantic_scholar" | "arxiv" | "pubmed" | "manual";
  citationCount?: number;
}

function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY")!;

    // Auth
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { report_id, doi: rawDoi } = await req.json();
    if (!report_id || !rawDoi) {
      return new Response(JSON.stringify({ error: "report_id and doi are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const doi = normalizeDoi(rawDoi);
    if (!doi || doi.length < 3) {
      return new Response(JSON.stringify({ error: "Invalid DOI" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify report ownership
    const { data: report, error: reportError } = await supabase
      .from("research_reports")
      .select("user_id, results, question")
      .eq("id", report_id)
      .single();

    if (reportError || !report || report.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Report not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for duplicate DOI
    const existingResults = (report.results as StudyResult[]) || [];
    if (existingResults.some((r) => r.citation?.doi === doi)) {
      return new Response(JSON.stringify({ error: "This DOI already exists in the report" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch metadata from Crossref
    console.log(`[add-study] Fetching Crossref metadata for DOI: ${doi}`);
    const crossrefResp = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { "User-Agent": "EurekaSearch/1.0 (mailto:contact@eurekasearch.app)" },
    });

    if (!crossrefResp.ok) {
      return new Response(
        JSON.stringify({ error: `DOI not found in Crossref (${crossrefResp.status})` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const crossrefData = await crossrefResp.json();
    const work = crossrefData.message;

    const title = Array.isArray(work.title) ? work.title[0] : work.title || "Unknown";
    const year =
      work.published?.["date-parts"]?.[0]?.[0] ||
      work["published-print"]?.["date-parts"]?.[0]?.[0] ||
      work["published-online"]?.["date-parts"]?.[0]?.[0] ||
      new Date().getFullYear();
    const abstract = work.abstract?.replace(/<[^>]+>/g, "") || "";
    const authors = (work.author || []).map(
      (a: any) => `${a.given || ""} ${a.family || ""}`.trim()
    );
    const venue = work["container-title"]?.[0] || "";

    if (!abstract || abstract.length < 20) {
      // No abstract available — build a minimal StudyResult without LLM
      const manualStudy: StudyResult = {
        study_id: doi,
        title,
        year,
        study_design: "unknown",
        sample_size: null,
        population: null,
        outcomes: [],
        citation: {
          doi,
          pubmed_id: null,
          openalex_id: null,
          formatted: `${authors.slice(0, 3).join(", ")}${authors.length > 3 ? " et al." : ""} (${year}). ${title}. ${venue}`.trim(),
        },
        abstract_excerpt: abstract || "No abstract available",
        preprint_status: "Peer-reviewed",
        review_type: "None",
        source: "manual" as any,
      };

      const updatedResults = [...existingResults, manualStudy];
      await supabase
        .from("research_reports")
        .update({ results: updatedResults })
        .eq("id", report_id);

      return new Response(JSON.stringify({ study: manualStudy }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract via Gemini
    const paperContext = {
      title,
      year,
      abstract,
      id: doi,
      source: "manual",
      doi,
      pubmed_id: null,
      openalex_id: null,
      citationCount: work["is-referenced-by-count"] || null,
    };

    const systemPrompt = `You are a rigorous medical research data extractor. Extract ONLY from the abstract provided.

OUTPUT SCHEMA - return valid JSON matching this exact structure:
{
  "study_id": "string (paper ID)",
  "title": "string",
  "year": number,
  "study_design": "RCT" | "cohort" | "cross-sectional" | "review" | "unknown",
  "sample_size": number | null,
  "population": "verbatim population description" | null,
  "outcomes": [{
    "outcome_measured": "string",
    "key_result": "verbatim finding" | null,
    "citation_snippet": "verbatim text from abstract",
    "intervention": "treatment/exposure" | null,
    "comparator": "control/comparison group" | null,
    "effect_size": "verbatim effect size" | null,
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
  "source": "manual",
  "citationCount": number | null
}

Return ONLY valid JSON. No markdown, no explanation.`;

    const userPrompt = `Research Question: "${report.question}"

Paper to analyze:
${JSON.stringify(paperContext, null, 2)}

Extract structured data from this paper's abstract.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    const geminiResp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
      }),
    });

    if (!geminiResp.ok) {
      console.error(`[add-study] Gemini error: ${geminiResp.status}`);
      return new Response(JSON.stringify({ error: "AI extraction failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiResp.json();
    const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let cleaned = rawText.trim();
    cleaned = cleaned.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    let study: StudyResult;
    try {
      study = JSON.parse(cleaned);
    } catch {
      console.error("[add-study] Failed to parse Gemini response:", cleaned.slice(0, 200));
      return new Response(JSON.stringify({ error: "AI returned invalid data" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure source is "manual"
    study.source = "manual" as any;
    study.study_id = study.study_id || doi;

    // Append to results
    const updatedResults = [...existingResults, study];
    const { error: updateError } = await supabase
      .from("research_reports")
      .update({ results: updatedResults })
      .eq("id", report_id);

    if (updateError) {
      console.error("[add-study] Update error:", updateError);
      return new Response(JSON.stringify({ error: "Failed to save study" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[add-study] Successfully added study: ${study.title}`);
    return new Response(JSON.stringify({ study }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[add-study] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
