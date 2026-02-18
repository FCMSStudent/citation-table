import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { persistExtractionRun } from "../_shared/extraction-runs.ts";

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

interface CrossrefAuthor {
  given?: string;
  family?: string;
}

interface CrossrefWork {
  title?: string[];
  abstract?: string;
  author?: CrossrefAuthor[];
  published?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  "is-referenced-by-count"?: number;
}

function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
}

function stripControlChars(value: string): string {
  let output = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      output += char;
    }
  }
  return output;
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
      .select("user_id, question, normalized_query, partial_results, extraction_stats, evidence_table, brief_json, coverage_report, search_stats, lit_request, lit_response")
      .eq("id", report_id)
      .single();

    if (reportError || !report || report.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Report not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Atomic duplicate check — no RMW race
    const { data: hasDoi } = await supabase.rpc("report_has_doi", {
      p_report_id: report_id,
      p_doi: doi,
    });
    if (hasDoi) {
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

    const crossrefData = await crossrefResp.json() as { message?: CrossrefWork };
    const work = crossrefData.message || {};

    const title = Array.isArray(work.title) ? work.title[0] : work.title || "Unknown";
    const year =
      work.published?.["date-parts"]?.[0]?.[0] ||
      work["published-print"]?.["date-parts"]?.[0]?.[0] ||
      work["published-online"]?.["date-parts"]?.[0]?.[0] ||
      new Date().getFullYear();
    const abstract = work.abstract?.replace(/<[^>]+>/g, "") || "";
    const authors = (work.author || []).map((author) => `${author.given || ""} ${author.family || ""}`.trim());
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
        source: "manual",
      };

      // Atomic append — no read-modify-write race
      const { error: appendError } = await supabase.rpc("append_study_to_report", {
        p_report_id: report_id,
        p_study: manualStudy,
      });
      if (appendError) {
        return new Response(JSON.stringify({ error: "Failed to save study" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Read updated results for extraction run snapshot
      const { data: updatedReport } = await supabase
        .from("research_reports")
        .select("results")
        .eq("id", report_id)
        .single();
      const updatedResults = (updatedReport?.results as StudyResult[]) || [];

      const litResponse = typeof report.lit_response === "object" && report.lit_response
        ? { ...(report.lit_response as Record<string, unknown>) }
        : {};
      const runSnapshot = await persistExtractionRun(supabase, {
        reportId: report_id,
        userId,
        trigger: "add_study",
        status: "completed",
        engine: "manual",
        question: report.question,
        normalizedQuery: report.normalized_query ?? null,
        litRequest: (report.lit_request as Record<string, unknown>) || {},
        litResponse,
        results: updatedResults,
        partialResults: (report.partial_results as unknown[]) || [],
        evidenceTable: Array.isArray(report.evidence_table) ? report.evidence_table : [],
        briefJson: (report.brief_json as Record<string, unknown>) || {},
        coverageReport: (report.coverage_report as Record<string, unknown>) || {},
        searchStats: (report.search_stats as Record<string, unknown>) || {},
        extractionStats: (report.extraction_stats as Record<string, unknown>) || {},
        extractorVersion: "manual_add_study_v1",
        promptHash: null,
        model: null,
        deterministicFlag: false,
        canonicalPapers: [],
      });
      litResponse.active_run_id = runSnapshot.runId;
      litResponse.run_version = runSnapshot.runIndex;
      await supabase
        .from("research_reports")
        .update({
          lit_response: litResponse,
          active_extraction_run_id: runSnapshot.runId,
          extraction_run_count: runSnapshot.runIndex,
        })
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
    cleaned = stripControlChars(cleaned);

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
    study.source = "manual";
    study.study_id = study.study_id || doi;

    // Atomic append — no read-modify-write race
    const { error: appendError2 } = await supabase.rpc("append_study_to_report", {
      p_report_id: report_id,
      p_study: study,
    });

    if (appendError2) {
      console.error("[add-study] Append error:", appendError2);
      return new Response(JSON.stringify({ error: "Failed to save study" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read updated results for extraction run snapshot
    const { data: updatedReport2 } = await supabase
      .from("research_reports")
      .select("results")
      .eq("id", report_id)
      .single();
    const updatedResults = (updatedReport2?.results as StudyResult[]) || [];

    const litResponse = typeof report.lit_response === "object" && report.lit_response
      ? { ...(report.lit_response as Record<string, unknown>) }
      : {};
    const runSnapshot = await persistExtractionRun(supabase, {
      reportId: report_id,
      userId,
      trigger: "add_study",
      status: "completed",
      engine: "manual",
      question: report.question,
      normalizedQuery: report.normalized_query ?? null,
      litRequest: (report.lit_request as Record<string, unknown>) || {},
      litResponse,
      results: updatedResults,
      partialResults: (report.partial_results as unknown[]) || [],
      evidenceTable: Array.isArray(report.evidence_table) ? report.evidence_table : [],
      briefJson: (report.brief_json as Record<string, unknown>) || {},
      coverageReport: (report.coverage_report as Record<string, unknown>) || {},
      searchStats: (report.search_stats as Record<string, unknown>) || {},
      extractionStats: (report.extraction_stats as Record<string, unknown>) || {},
      extractorVersion: "manual_add_study_v1",
      promptHash: null,
      model: "gemini-2.5-flash",
      deterministicFlag: false,
      canonicalPapers: [],
    });
    litResponse.active_run_id = runSnapshot.runId;
    litResponse.run_version = runSnapshot.runIndex;
    await supabase
      .from("research_reports")
      .update({
        lit_response: litResponse,
        active_extraction_run_id: runSnapshot.runId,
        extraction_run_count: runSnapshot.runIndex,
      })
      .eq("id", report_id);

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
