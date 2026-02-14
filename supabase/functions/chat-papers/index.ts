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
    const { report_id, messages } = await req.json();

    if (!report_id || !messages?.length) {
      return new Response(
        JSON.stringify({ error: "report_id and messages are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch report data
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: report, error: dbError } = await supabase
      .from("research_reports")
      .select("question, results, normalized_query")
      .eq("id", report_id)
      .single();

    if (dbError || !report?.results) {
      return new Response(
        JSON.stringify({ error: "Report not found or has no results" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context from study data
    const studies = report.results as any[];
    const studyContext = studies
      .map((s: any, i: number) => {
        const outcomes = (s.outcomes || [])
          .map((o: any) => `  - ${o.outcome_measured}: ${o.key_result || "Not reported"} [Citation: "${o.citation_snippet || ""}"]`)
          .join("\n");
        return `[Study ${i + 1}] "${s.title}" (${s.year})
  Design: ${s.study_design} | Sample: ${s.sample_size ?? "Not reported"} | Population: ${s.population ?? "Not reported"}
  DOI: ${s.citation?.doi || "N/A"}
  Preprint: ${s.preprint_status} | Review type: ${s.review_type}
  Abstract: ${s.abstract_excerpt || "Not available"}
  Outcomes:
${outcomes}`;
      })
      .join("\n\n");

    const systemPrompt = `You are a research assistant helping a user understand the findings from a systematic evidence review on the question: "${report.question}"${report.normalized_query ? ` (normalized: "${report.normalized_query}")` : ""}.

Below are all ${studies.length} studies extracted from this review. You MUST only reference information present in these studies. Always cite studies by their title and year. If the user asks something not covered by the data, say so.

--- STUDY DATA ---
${studyContext}
--- END STUDY DATA ---

Guidelines:
- Ground every claim in specific study data above
- Use citations like (Author/Title, Year) when referencing findings
- If asked to compare studies, use the actual outcomes and sample sizes
- Be concise but thorough
- Format responses with markdown for readability`;

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
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
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

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("chat-papers error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
