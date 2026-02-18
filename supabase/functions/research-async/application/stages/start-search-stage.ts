import type { SearchResponsePayload } from "../../../_shared/lit-search.ts";
import {
  RESEARCH_JOB_PROVIDER,
  RESEARCH_JOB_STAGE_PIPELINE,
  corsHeaders,
  runningSearchResponse,
  type SupabaseClientLike,
} from "../../domain/models/research.ts";
import {
  buildCacheKey,
  buildLitRequest,
  checkRateLimit,
  createExtractionRunForSearch,
  createQueuedReport,
  enqueueResearchJob,
  markReportCompletedFromCache,
  readCachedSearch,
} from "../../infrastructure/repositories/research-repository.ts";

export async function handleStartSearch(
  req: Request,
  supabase: SupabaseClientLike,
  userId: string,
  isLitRoute: boolean,
): Promise<Response> {
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const allowed = await checkRateLimit(supabase, "research-async", clientIp, 10, 60);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const rawBody = await req.json().catch(() => ({}));
  const { litRequest, question } = buildLitRequest(rawBody, isLitRoute);

  if (!question || question.length < 5) {
    return new Response(JSON.stringify({ error: "Please provide a valid research query (at least 5 characters)" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (question.length > 500) {
    return new Response(JSON.stringify({ error: "Query is too long (maximum 500 characters)" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const cacheKey = buildCacheKey(litRequest);
  const reportId = await createQueuedReport(supabase, question, userId);

  if (isLitRoute) {
    const cached = await readCachedSearch(supabase, cacheKey);
    if (cached && cached.status === "completed") {
      const replayed: SearchResponsePayload = { ...cached, search_id: reportId };
      const runSnapshot = await createExtractionRunForSearch(supabase, {
        reportId,
        userId,
        trigger: "initial_pipeline_cached",
        engine: "unknown",
        question,
        normalizedQuery: null,
        litRequest,
        litResponse: replayed,
        results: [],
        partialResults: [],
        evidenceTable: replayed.evidence_table || [],
        brief: replayed.brief || { sentences: [] },
        coverage: replayed.coverage,
        stats: replayed.stats,
        extractionStats: {},
        extractorVersion: "cache_replay_v1",
        promptHash: null,
        model: null,
        deterministicFlag: false,
        canonicalPapers: [],
      });
      replayed.active_run_id = runSnapshot.runId;
      replayed.run_version = runSnapshot.runIndex;

      await markReportCompletedFromCache(supabase, reportId, runSnapshot.runId, runSnapshot.runIndex, litRequest, replayed);
      return new Response(JSON.stringify(replayed), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  await enqueueResearchJob(supabase, {
    reportId,
    question,
    userId,
    litRequest,
    cacheKey,
    stage: RESEARCH_JOB_STAGE_PIPELINE,
    provider: RESEARCH_JOB_PROVIDER,
    maxAttempts: 5,
  });

  if (isLitRoute) {
    return new Response(JSON.stringify(runningSearchResponse(reportId)), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ report_id: reportId }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
