import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { report_id } = await req.json();

    if (!report_id) {
      return new Response(
        JSON.stringify({ error: "report_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: report, error: dbError } = await supabase
      .from("research_reports")
      .select("question, results, normalized_query, narrative_synthesis")
      .eq("id", report_id)
      .single();

    if (dbError || !report?.results) {
      return new Response(
        JSON.stringify({ error: "Report not found or has no results" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build study context table
    const studies = report.results as any[];
    const studyContext = studies
      .map((s: any, i: number) => {
        const outcomes = (s.outcomes || [])
          .map((o: any) => `  - ${o.outcome_measured}: ${o.key_result || "Not reported"} [Source: "${o.citation_snippet || ""}"]`)
          .join("\n");
        return `[Study ${i + 1}] "${s.title}" (${s.year})
  Design: ${s.study_design} | Sample: ${s.sample_size ?? "Not reported"} | Population: ${s.population ?? "Not reported"}
  DOI: ${s.citation?.doi || "N/A"}
  Preprint: ${s.preprint_status} | Review type: ${s.review_type}
  Outcomes:
${outcomes}`;
      })
      .join("\n\n");

    const systemPrompt = `You are a research synthesis assistant. You have been given ${studies.length} studies extracted from a systematic evidence search on the question: "${report.question}"${report.normalized_query ? ` (normalized query: "${report.normalized_query}")` : ""}.

Your task is to produce a structured narrative synthesis that descriptively compresses patterns across these studies. This is NOT a meta-analysis. Do NOT compute pooled effect sizes or p-values. Do NOT introduce any information not present in the study data below.

--- STUDY DATA ---
${studyContext}
--- END STUDY DATA ---

Write 3-5 paragraphs covering these sections (use markdown headers):

### Corpus Overview
Briefly describe the body of evidence: number of studies, mix of study designs, range of sample sizes, populations studied, and year range.

### Areas of Agreement
Identify outcomes or findings where multiple studies converge. Describe what the evidence consistently shows. Cite each claim with (Author/Title, Year).

### Areas of Disagreement
Identify conflicting findings. Suggest possible methodological explanations (different populations, study designs, sample sizes) WITHOUT speculating beyond the data. Cite each claim.

### Limitations
Flag concrete limitations: preprint status, small sample sizes, narrow populations, lack of certain study designs (e.g., no RCTs), reliance on self-report measures, or other issues visible in the data.

### Evidence Gaps
Note what questions remain unanswered by this body of evidence. What populations, outcomes, or designs are missing?

CRITICAL RULES:
- Cite EVERY factual claim with (Author/Title, Year) referencing a specific study above
- Use NO causal language (e.g., "causes", "leads to") unless the study is an RCT; use "associated with", "correlated with", "reported" instead
- Do NOT invent findings, studies, or data points
- Do NOT perform quantitative synthesis (no pooled estimates, no forest plots)
- Be concise -- each section should be 2-4 sentences
- Use markdown formatting`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate the structured narrative synthesis for this body of evidence." },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await response.json();
    const synthesis = aiResult.choices?.[0]?.message?.content || "";

    if (!synthesis) {
      return new Response(
        JSON.stringify({ error: "AI returned empty synthesis" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cache in database
    const { error: updateError } = await supabase
      .from("research_reports")
      .update({ narrative_synthesis: synthesis })
      .eq("id", report_id);

    if (updateError) {
      console.error("Failed to cache synthesis:", updateError);
    }

    return new Response(
      JSON.stringify({ synthesis }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("synthesize-papers error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
