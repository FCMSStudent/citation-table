import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYNTHESIS_MAX_CONTEXT_STUDIES = 15;
const SYNTHESIS_STRICT_TARGET = 10;
const SYNTHESIS_PARTIAL_TARGET = 5;

interface StudyOutcome {
  outcome_measured?: string | null;
  key_result?: string | null;
  citation_snippet?: string | null;
  intervention?: string | null;
  comparator?: string | null;
  effect_size?: string | null;
  p_value?: string | null;
}

interface StudyCitation {
  doi?: string | null;
}

interface ContextStudy {
  study_id?: string;
  title?: string | null;
  year?: number | null;
  study_design?: string | null;
  sample_size?: number | null;
  population?: string | null;
  outcomes?: StudyOutcome[] | null;
  citation?: StudyCitation | null;
  abstract_excerpt?: string | null;
  preprint_status?: string | null;
  review_type?: string | null;
  source?: string | null;
  citationCount?: number | null;
}

interface WarningItem {
  type: string;
  text: string;
}

interface SynthesisPayload {
  narrative: string;
  warnings?: WarningItem[];
}

interface SynthesisCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

type SupabaseClientLike = ReturnType<typeof createClient>;

type TieredStudy = ContextStudy & {
  _score: number;
  _tier: "strict" | "partial";
};

function isCompleteStudy(study: ContextStudy): boolean {
  if (!study.title || !study.year) return false;
  if (study.study_design === "unknown") return false;
  if (!study.abstract_excerpt || study.abstract_excerpt.trim().length < 50) return false;
  const outcomes = Array.isArray(study.outcomes) ? study.outcomes : [];
  if (outcomes.length === 0) return false;
  return outcomes.some((o) =>
    o.outcome_measured && (o.effect_size || o.p_value || o.intervention || o.comparator)
  );
}

function scoreStudy(study: ContextStudy, query: string): number {
  let score = 0;
  const keywords = query.toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
  const outcomes = Array.isArray(study.outcomes) ? study.outcomes : [];
  const outcomesText = outcomes
    .map((o) => `${o.outcome_measured || ""} ${o.key_result || ""}`.toLowerCase())
    .join(" ");
  const matches = keywords.filter((k: string) => outcomesText.includes(k)).length;
  if (keywords.length >= 2 && matches >= 2) score += 2;
  else if (matches >= 1) score += 1;

  if (study.review_type === "Meta-analysis" || study.review_type === "Systematic review") score += 1;

  if (typeof study.citationCount === "number" && study.citationCount > 0) {
    score += Math.min(3, Math.log2(study.citationCount));
  }

  return score;
}

function dedupeByStudyId(studies: ContextStudy[]): ContextStudy[] {
  const byId = new Map<string, ContextStudy>();
  for (const study of studies || []) {
    const studyId = typeof study?.study_id === "string" ? study.study_id : null;
    if (!studyId || byId.has(studyId)) continue;
    byId.set(studyId, study);
  }
  return Array.from(byId.values());
}

function selectMixedContextStudies(
  strictStudies: ContextStudy[],
  partialStudies: ContextStudy[],
  query: string,
): { selected: TieredStudy[]; strict_total: number; partial_total: number } {
  const strictRanked = dedupeByStudyId(strictStudies)
    .map((study): TieredStudy => ({ ...study, _score: scoreStudy(study, query), _tier: "strict" as const }))
    .sort((a, b) => b._score - a._score);

  const strictIds = new Set(strictRanked.map((study) => study.study_id).filter((studyId): studyId is string => typeof studyId === "string"));
  const partialRanked = dedupeByStudyId(partialStudies)
    .filter((study) => typeof study.study_id === "string" && !strictIds.has(study.study_id))
    .map((study): TieredStudy => ({ ...study, _score: scoreStudy(study, query), _tier: "partial" as const }))
    .sort((a, b) => b._score - a._score);

  const selectedStrict = strictRanked.slice(0, SYNTHESIS_STRICT_TARGET);
  const selectedPartial = partialRanked.slice(0, SYNTHESIS_PARTIAL_TARGET);
  const selected: TieredStudy[] = [...selectedStrict, ...selectedPartial];

  let strictCursor = selectedStrict.length;
  let partialCursor = selectedPartial.length;
  while (selected.length < SYNTHESIS_MAX_CONTEXT_STUDIES && (strictCursor < strictRanked.length || partialCursor < partialRanked.length)) {
    const strictRemaining = strictRanked.length - strictCursor;
    const partialRemaining = partialRanked.length - partialCursor;
    if (strictRemaining >= partialRemaining && strictCursor < strictRanked.length) {
      selected.push(strictRanked[strictCursor++]);
      continue;
    }
    if (partialCursor < partialRanked.length) {
      selected.push(partialRanked[partialCursor++]);
      continue;
    }
    if (strictCursor < strictRanked.length) selected.push(strictRanked[strictCursor++]);
  }

  return {
    selected: selected.slice(0, SYNTHESIS_MAX_CONTEXT_STUDIES),
    strict_total: strictRanked.length,
    partial_total: partialRanked.length,
  };
}

function computeWarnings(studies: ContextStudy[]): WarningItem[] {
  const warnings: WarningItem[] = [];

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

async function checkRateLimit(
  supabase: SupabaseClientLike, functionName: string, clientIp: string, maxRequests: number, windowMinutes: number
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

interface SynthesizeRequestPayload {
  report_id?: string;
}

function asContextStudies(value: unknown): ContextStudy[] {
  return Array.isArray(value) ? (value as ContextStudy[]) : [];
}

function sanitizeControlChars(value: string): string {
  let sanitized = "";
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    const code = value.charCodeAt(i);
    if ((code >= 0 && code <= 31) || code === 127) {
      if (char === "\n" || char === "\r" || char === "\t") sanitized += " ";
      continue;
    }
    sanitized += char;
  }
  return sanitized;
}

function isWarningItem(value: unknown): value is WarningItem {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { type?: unknown; text?: unknown };
  return typeof candidate.type === "string" && typeof candidate.text === "string";
}

function isSynthesisPayload(value: unknown): value is SynthesisPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { narrative?: unknown; warnings?: unknown };
  if (typeof candidate.narrative !== "string") return false;
  if (candidate.warnings === undefined) return true;
  return Array.isArray(candidate.warnings) && candidate.warnings.every(isWarningItem);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Rate limit: 20 synthesis requests per IP per hour
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const rlSupabase = createClient(supabaseUrl, supabaseKey);
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const allowed = await checkRateLimit(rlSupabase, "synthesize-papers", clientIp, 20, 60);
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
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = userData.user.id;

    const requestPayload = await req.json() as SynthesizeRequestPayload;
    const report_id = requestPayload.report_id;

    if (!report_id) {
      return new Response(
        JSON.stringify({ error: "report_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: report, error: dbError } = await rlSupabase
      .from("research_reports")
      .select("question, results, normalized_query, narrative_synthesis, user_id")
      .eq("id", report_id)
      .single();

    if (dbError || !report?.results || report.user_id !== userId) {
      console.error("[synthesize] DB error or access denied:", dbError?.message);
      return new Response(
        JSON.stringify({ error: "Report not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const allStudies = asContextStudies(report.results);
    const allPartialStudies = allStudies.filter((s: ContextStudy) => !isCompleteStudy(s));
    const queryText = (report.normalized_query || report.question || "").toLowerCase();

    const strictStudies = allStudies.filter(isCompleteStudy);
    const selection = selectMixedContextStudies(strictStudies, allPartialStudies, queryText);
    const studies = selection.selected;
    const strictIncluded = studies.filter((study) => study._tier === "strict").length;
    const partialIncluded = studies.filter((study) => study._tier === "partial").length;
    console.log(
      `[Synthesis] Selected ${studies.length} studies (${strictIncluded} strict, ${partialIncluded} partial) from ` +
      `${selection.strict_total + selection.partial_total} candidates`,
    );

    // Build numbered study context
    const studyContext = studies
      .map((s, i: number) => {
        const outcomes = (Array.isArray(s.outcomes) ? s.outcomes : [])
          .map((o) => {
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
        return `[Study ${i + 1}] "${s.title}" (${s.year})
  Evidence tier: ${s._tier === "strict" ? "Strict (high confidence)" : "Partial (lower confidence)"}
  Design: ${s.study_design} | Sample: ${s.sample_size ?? "NR"} | Population: ${s.population ?? "NR"}
  DOI: ${s.citation?.doi || "N/A"}
  Preprint: ${s.preprint_status} | Review type: ${s.review_type}
  Outcomes:
${outcomes}`;
      })
      .join("\n\n");

    // Compute deterministic warnings
    const computedWarnings = computeWarnings(studies);
    if (partialIncluded > 0) {
      computedWarnings.push({
        type: "quality",
        text: `${partialIncluded} partial-tier studies were included; interpret claims from these studies as lower confidence.`,
      });
    }
    const totalCandidates = selection.strict_total + selection.partial_total;
    const strictExcluded = Math.max(0, selection.strict_total - strictIncluded);
    const partialExcluded = Math.max(0, selection.partial_total - partialIncluded);
    if (totalCandidates > studies.length) {
      const totalExcluded = totalCandidates - studies.length;
      computedWarnings.push({
        type: "quality",
        text: `${totalExcluded} of ${totalCandidates} studies excluded from synthesis context (${strictExcluded} strict, ${partialExcluded} partial below relevance cutoff).`,
      });
    }

    const systemPrompt = `You are a research synthesis assistant. You have ${studies.length} studies from a systematic search on: "${report.question}"${report.normalized_query ? ` (normalized: "${report.normalized_query}")` : ""}.
The context includes ${strictIncluded} strict-tier studies and ${partialIncluded} partial-tier studies.

--- STUDY DATA ---
${studyContext}
--- END STUDY DATA ---

Produce a JSON object with this EXACT schema:
{
  "narrative": "A single markdown string with flowing prose",
  "warnings": [
    { "type": "gap", "text": "Description of evidence gap" }
  ]
}

NARRATIVE FIELD RULES:
- Start with a **bold sentence** that directly answers the research question based on the evidence
- Follow with 2-4 paragraphs of flowing prose
- Cite EVERY factual claim inline as (AuthorLastName et al., Year) — derive author last names from the study titles provided
- Use natural paragraph transitions ("However,", "Neuroimaging evidence shows...", "In contrast,", etc.)
- Do NOT use markdown headers, bullet points, or numbered lists
- Do NOT invent findings or data points not present in the study data above
- Do NOT use causal language unless the study is an RCT
- Treat partial-tier studies as lower confidence: use conditional language ("may", "suggests", "possibly") and never base definitive conclusions only on partial-tier evidence
- Keep the narrative concise and evidence-dense

WARNING FIELD RULES:
- Include evidence gaps (populations not studied, outcomes not measured, time horizons not covered). Use type "gap" for missing evidence and "quality" for methodological concerns.

Return ONLY valid JSON, no markdown fences or extra text`;

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GOOGLE_GEMINI_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Gemini API error:", response.status, text);
      return new Response(
        JSON.stringify({ error: `Gemini API error (${response.status})` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResult = await response.json() as SynthesisCompletionResponse;
    const rawText = aiResult.choices?.[0]?.message?.content || "";

    if (!rawText) {
      return new Response(
        JSON.stringify({ error: "AI returned empty synthesis" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse and validate the narrative output
    let synthesisData: SynthesisPayload;
    try {
      // Strip markdown code fences if present
      let cleaned = rawText
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      // Remove control characters that break JSON.parse
      cleaned = sanitizeControlChars(cleaned);

      // Find JSON boundaries
      const jsonStart = cleaned.search(/[[{]/);
      const startChar = jsonStart !== -1 ? cleaned[jsonStart] : "{";
      const endChar = startChar === "[" ? "]" : "}";
      const jsonEnd = cleaned.lastIndexOf(endChar);

      if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
        throw new Error("No JSON object found in response");
      }

      let jsonString = cleaned.substring(jsonStart, jsonEnd + 1);

      // Fix trailing commas
      jsonString = jsonString.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");

      const parsed = JSON.parse(jsonString) as unknown;
      if (!isSynthesisPayload(parsed)) throw new Error("Missing narrative string");
      synthesisData = parsed;
    } catch (parseErr) {
      console.error("Failed to parse/validate synthesis JSON:", parseErr);
      console.error("Raw text (first 500 chars):", rawText.substring(0, 500));
      return new Response(
        JSON.stringify({ error: "AI returned invalid synthesis. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Merge computed warnings with LLM-generated warnings
    const llmWarnings = Array.isArray(synthesisData.warnings) ? synthesisData.warnings : [];
    const allWarnings: WarningItem[] = [...computedWarnings, ...llmWarnings];
    // Deduplicate by text similarity
    const seen = new Set<string>();
    const dedupedWarnings = allWarnings.filter((w) => {
      const key = w.text.toLowerCase().slice(0, 40);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    synthesisData.warnings = dedupedWarnings;

    const synthesisJson = JSON.stringify(synthesisData);

    // Cache in database
    const { error: updateError } = await rlSupabase
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
