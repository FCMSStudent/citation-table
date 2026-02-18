import type { SearchResponsePayload } from "../../../_shared/lit-search.ts";
import {
  RESEARCH_JOB_PROVIDER,
  RESEARCH_QUEUE_STAGE_INGEST_PROVIDER,
  corsHeaders,
  runningSearchResponse,
  type SupabaseClientLike,
} from "../../domain/models/research.ts";
import {
  buildCacheKey,
  buildProviderHash,
  buildLitRequest,
  checkRateLimit,
  createExtractionRunForSearch,
  createQueuedReport,
  enqueueResearchJob,
  markReportCompletedFromCache,
  normalizeQueryForCache,
  readCachedSearch,
} from "../../infrastructure/repositories/research-repository.ts";
import {
  hashPayload,
  markReportPipelineVersion,
  resolvePipelineVersion,
} from "../../infrastructure/repositories/stage-orchestration-repository.ts";

function parseSeed(rawBody: Record<string, unknown>): number {
  const parsed = Number(rawBody.seed ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.trunc(parsed);
}

function buildPipelineManifestHashes(): {
  promptManifestHash: string;
  extractorBundleHash: string;
  configSnapshot: Record<string, unknown>;
} {
  const configSnapshot = {
    query_pipeline_mode: Deno.env.get("QUERY_PIPELINE_MODE") || "shadow",
    extraction_engine: Deno.env.get("EXTRACTION_ENGINE") || "hybrid",
    extraction_max_candidates: Number(Deno.env.get("EXTRACTION_MAX_CANDIDATES") || 25),
    metadata_enrichment_mode: Deno.env.get("METADATA_ENRICHMENT_MODE") || "offline_shadow",
  };
  return {
    promptManifestHash: hashPayload({
      deterministic_extractor_version: "deterministic_first_v1",
      llm_model: "gemini-2.5-flash",
      query_pipeline_mode: configSnapshot.query_pipeline_mode,
      extraction_engine: configSnapshot.extraction_engine,
    }),
    extractorBundleHash: hashPayload({
      deterministic_extractor_version: "deterministic_first_v1",
      bundle: Deno.env.get("EXTRACTOR_BUNDLE_VERSION") || "bundle_v1",
    }),
    configSnapshot,
  };
}

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
  const providerProfile = Array.isArray(rawBody?.provider_profile)
    ? rawBody.provider_profile.map((provider) => String(provider)).filter(Boolean)
    : null;
  const providerHash = buildProviderHash(providerProfile || undefined);
  const normalizedCacheQuery = normalizeQueryForCache(litRequest.query || question);
  const seed = parseSeed(rawBody as Record<string, unknown>);

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

  const cacheKey = buildCacheKey(litRequest, providerHash);
  const runInputHash = hashPayload({
    question,
    litRequest,
    providerHash,
    seed,
  });
  const manifest = buildPipelineManifestHashes();
  const pipelineVersion = await resolvePipelineVersion(supabase, {
    promptManifestHash: manifest.promptManifestHash,
    extractorBundleHash: manifest.extractorBundleHash,
    seed,
    configSnapshot: manifest.configSnapshot,
  });
  const reportId = await createQueuedReport(supabase, question, userId);
  await markReportPipelineVersion(supabase, reportId, pipelineVersion.id);

  if (isLitRoute) {
    const cached = await readCachedSearch(supabase, cacheKey, normalizedCacheQuery, providerHash);
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
        pipelineVersionId: pipelineVersion.id,
        seed,
        inputHash: runInputHash,
        outputHash: hashPayload(replayed),
        configSnapshot: manifest.configSnapshot,
        promptManifestHash: manifest.promptManifestHash,
        extractorBundleHash: manifest.extractorBundleHash,
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
    stage: RESEARCH_QUEUE_STAGE_INGEST_PROVIDER,
    provider: RESEARCH_JOB_PROVIDER,
    maxAttempts: 5,
    inputHash: runInputHash,
    payload: {
      report_id: reportId,
      question,
      user_id: userId,
      lit_request: litRequest,
      cache_key: cacheKey,
      provider_hash: providerHash,
      provider_profile: providerProfile || null,
      experiment: (rawBody && typeof rawBody === "object" && (rawBody as Record<string, unknown>).experiment)
        ? (rawBody as Record<string, unknown>).experiment
        : null,
      pipeline_version_id: pipelineVersion.id,
      run_input_hash: runInputHash,
      seed,
      pipeline_started_at: Date.now(),
      config_snapshot: manifest.configSnapshot,
      simulation: (rawBody && typeof rawBody === "object" && (rawBody as Record<string, unknown>).simulation)
        ? (rawBody as Record<string, unknown>).simulation
        : null,
    },
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
