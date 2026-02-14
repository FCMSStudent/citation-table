import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function isCompleteStudy(study: any): boolean {
  if (!study.title || !study.year) return false;
  if (study.study_design === "unknown") return false;
  if (!study.abstract_excerpt || study.abstract_excerpt.trim().length < 50) return false;
  if (!study.outcomes || study.outcomes.length === 0) return false;
  if (!study.population && !study.sample_size) return false;
  return study.outcomes.some((o: any) =>
    o.outcome_measured && (o.effect_size || o.p_value || o.intervention || o.comparator)
  );
}

function scoreStudy(study: any, query: string): number {
  let score = 0;
  const keywords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
  const outcomesText = (study.outcomes || [])
    .map((o: any) => `${o.outcome_measured} ${o.key_result || ""}`.toLowerCase())
    .join(" ");
  const matches = keywords.filter((k: string) => outcomesText.includes(k)).length;
  if (keywords.length >= 2 && matches >= 2) score += 2;
  else if (matches >= 1) score += 1;

  if (study.review_type === "Meta-analysis" || study.review_type === "Systematic review") score += 1;

  if (study.citationCount && study.citationCount > 0) {
    score += Math.min(3, Math.log2(study.citationCount));
  }

  return score;
}

async function checkRateLimit(
  supabase: any, functionName: string, clientIp: string, maxRequests: number, windowMinutes: number
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("function_name", functionName)
    .eq("client_ip", clientIp)
    .gte("created_at", windowStart);
  if (error) { console.error("[rate-limit] Check failed:", error); return true; }
  if ((count || 0) >= maxRequests) return false;
  await supabase.from("rate_limits").insert({ function_name: functionName, client_ip: clientIp });
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    // Rate limit: 30 chat messages per IP per hour
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const allowed = await checkRateLimit(serviceClient, "chat-papers", clientIp, 30, 60);
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Auth: validate JWT and extract userId ---
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
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = claimsData.claims.sub as string;

    const { report_id, messages } = await req.json();

    if (!report_id || !messages?.length) {
      return new Response(
        JSON.stringify({ error: "report_id and messages are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch report data and verify ownership
    const { data: report, error: dbError } = await serviceClient
      .from("research_reports")
      .select("question, results, normalized_query, user_id")
      .eq("id", report_id)
      .single();

    if (dbError || !report?.results || report.user_id !== userId) {
      return new Response(
        JSON.stringify({ error: "Report not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build context from top-10 complete studies (same as synthesize-papers)
    const allStudies = report.results as any[];
    const queryText = (report.normalized_query || report.question || "").toLowerCase();

    const completeStudies = allStudies.filter(isCompleteStudy);
    const ranked = completeStudies
      .map(s => ({ ...s, _score: scoreStudy(s, queryText) }))
      .sort((a, b) => b._score - a._score);
    const studies = ranked.slice(0, 10).map(({ _score, ...s }) => s);

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

Below are the top ${studies.length} studies (out of ${allStudies.length} total) selected for completeness and relevance. You MUST only reference information present in these studies.

--- STUDY DATA ---
${studyContext}
--- END STUDY DATA ---

CRITICAL CITATION RULES:
- You MUST cite every factual claim using the format (Title, Year) — e.g. ("Effect of X on Y", 2022).
- If you cannot cite a specific study for a claim, DO NOT make that claim.
- Do NOT invent findings, statistics, or data points not present in the study data above.

Guidelines:
- Ground every claim in specific study data above
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
