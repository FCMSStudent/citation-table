import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function computeWarnings(studies: any[]): { type: string; text: string }[] {
  const warnings: { type: string; text: string }[] = [];

  const preprintCount = studies.filter((s) => s.preprint_status === "Preprint").length;
  if (preprintCount > 0) {
    const pct = Math.round((preprintCount / studies.length) * 100);
    warnings.push({ type: "quality", text: `${preprintCount} of ${studies.length} studies (${pct}%) are preprints without peer review` });
  }

  const designs = new Set(studies.map((s) => s.study_design));
  if (!designs.has("RCT")) {
    warnings.push({ type: "gap", text: "No randomized controlled trials (RCTs) found in this evidence corpus" });
  }
  if (!designs.has("review") && studies.length > 3) {
    warnings.push({ type: "gap", text: "No systematic reviews or meta-analyses found" });
  }

  const sources = new Set(studies.map((s) => s.source));
  if (sources.size === 1) {
    warnings.push({ type: "quality", text: `All studies sourced from a single database (${[...sources][0]})` });
  }

  const smallStudies = studies.filter((s) => s.sample_size && s.sample_size < 50).length;
  if (smallStudies > studies.length / 2) {
    warnings.push({ type: "quality", text: `${smallStudies} of ${studies.length} studies have small sample sizes (<50)` });
  }

  return warnings;
}

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

    const allStudies = report.results as any[];

    // Filter to studies with at least one complete outcome row
    const studies = allStudies.filter((s: any) =>
      (s.outcomes || []).some((o: any) =>
        o.outcome_measured && (o.intervention || o.comparator || o.effect_size || o.p_value)
      )
    );
    const excludedCount = allStudies.length - studies.length;
    console.log(`[Synthesis] ${excludedCount} of ${allStudies.length} studies excluded due to incomplete extracted data`);

    // Build numbered study context
    const studyContext = studies
      .map((s: any, i: number) => {
        const outcomes = (s.outcomes || [])
          .map((o: any) => {
            const parts = [`  - Outcome: ${o.outcome_measured}`];
            if (o.key_result) parts.push(`    Result: ${o.key_result}`);
            if (o.intervention) parts.push(`    Intervention: ${o.intervention}`);
            if (o.comparator) parts.push(`    Comparator: ${o.comparator}`);
            if (o.effect_size) parts.push(`    Effect size: ${o.effect_size}`);
            if (o.p_value) parts.push(`    P-value: ${o.p_value}`);
            if (o.citation_snippet) parts.push(`    Source text: "${o.citation_snippet}"`);
            return parts.join("\n");
          })
          .join("\n");
        return `[Study ${i}] "${s.title}" (${s.year})
  Design: ${s.study_design} | Sample: ${s.sample_size ?? "NR"} | Population: ${s.population ?? "NR"}
  DOI: ${s.citation?.doi || "N/A"}
  Preprint: ${s.preprint_status} | Review type: ${s.review_type}
  Outcomes:
${outcomes}`;
      })
      .join("\n\n");

    // Compute deterministic warnings
    const computedWarnings = computeWarnings(studies);
    if (excludedCount > 0) {
      computedWarnings.push({
        type: "quality",
        text: `${excludedCount} of ${allStudies.length} studies excluded from synthesis due to incomplete extracted data`,
      });
    }

    const systemPrompt = `You are a research synthesis assistant. You have ${studies.length} studies from a systematic search on: "${report.question}"${report.normalized_query ? ` (normalized: "${report.normalized_query}")` : ""}.

--- STUDY DATA ---
${studyContext}
--- END STUDY DATA ---

Produce a JSON object with this EXACT schema:
{
  "sections": [
    {
      "heading": "Section title",
      "claims": [
        {
          "text": "Claim text referencing specific findings from studies.",
          "citations": ["study-0", "study-3"]
        }
      ]
    }
  ],
  "warnings": [
    { "type": "gap", "text": "Description of evidence gap" }
  ]
}

SECTIONS TO INCLUDE (3-5 sections):
1. "Corpus Overview" — Describe the evidence body: number of studies, designs, populations, year range. Cite all studies referenced.
2. "Areas of Agreement" — Findings where multiple studies converge. Every sentence must cite specific studies.
3. "Areas of Disagreement" — Conflicting findings with possible methodological explanations. Cite each.
4. "Limitations" — Concrete limitations visible in the data. Cite specific studies.
5. "Evidence Gaps" — What questions remain unanswered.

CRITICAL RULES:
- The "citations" array must contain study index references formatted as "study-N" where N is the study number from [Study N] above (0-indexed)
- EVERY claim MUST have at least one citation. If you cannot tie a claim to a specific study, DO NOT include it.
- Do NOT invent findings or data points not present in the study data above
- Do NOT use causal language unless the study is an RCT
- Be concise: 2-4 claims per section
- For "warnings", include LLM-identified evidence gaps (populations not studied, outcomes not measured, time horizons not covered). Use type "gap" for missing evidence and "quality" for methodological concerns.
- Return ONLY valid JSON, no markdown fences or extra text`;

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_GEMINI_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: systemPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 3000,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("Gemini API error:", response.status, text);
      return new Response(
        JSON.stringify({ error: `Gemini API error (${response.status})` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await response.json();
    const rawText = aiResult.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!rawText) {
      return new Response(
        JSON.stringify({ error: "AI returned empty synthesis" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse and validate the structured output
    let synthesisData: any;
    try {
      synthesisData = JSON.parse(rawText);
    } catch {
      // If JSON parse fails, wrap raw text as legacy format
      console.error("Failed to parse synthesis JSON, storing raw text");
      const { error: updateError } = await supabase
        .from("research_reports")
        .update({ narrative_synthesis: rawText })
        .eq("id", report_id);
      if (updateError) console.error("Failed to cache synthesis:", updateError);

      return new Response(
        JSON.stringify({ synthesis: rawText }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Merge computed warnings with LLM-generated warnings
    const llmWarnings = synthesisData.warnings || [];
    const allWarnings = [...computedWarnings, ...llmWarnings];
    // Deduplicate by text similarity
    const seen = new Set<string>();
    const dedupedWarnings = allWarnings.filter((w) => {
      const key = w.text.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    synthesisData.warnings = dedupedWarnings;

    // Recalculate confidence on the server based on citation count
    for (const section of synthesisData.sections || []) {
      for (const claim of section.claims || []) {
        const count = (claim.citations || []).length;
        claim.confidence = count >= 3 ? "high" : count === 2 ? "moderate" : "low";
      }
    }

    const synthesisJson = JSON.stringify(synthesisData);

    // Cache in database
    const { error: updateError } = await supabase
      .from("research_reports")
      .update({ narrative_synthesis: synthesisJson })
      .eq("id", report_id);

    if (updateError) {
      console.error("Failed to cache synthesis:", updateError);
    }

    return new Response(
      JSON.stringify({ synthesis: synthesisJson }),
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
