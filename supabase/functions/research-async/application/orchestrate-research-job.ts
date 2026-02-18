import {
  getMetadataEnrichmentRuntimeConfig,
  selectEffectiveEnrichmentMode,
} from "../../_shared/metadata-enrichment.ts";
import { defaultSearchRequestFromQuestion, sanitizeSearchRequest, type SearchRequestPayload, type SearchResponsePayload } from "../../_shared/lit-search.ts";
import { runResearchPipeline } from "./stages/research-pipeline-stage.ts";
import { createStageContext, runStage, type PipelineStage, type StageResult } from "./stages/pipeline-runtime.ts";
import {
  createExtractionRunForSearch,
  loadReportForProcessing,
  markReportProcessing,
  normalizeQueryForCache,
  persistPipelineCompletion,
  resolveQueryCacheTtlHours,
  upsertPaperCache,
  writeSearchCache,
} from "../infrastructure/repositories/research-repository.ts";
import { recordQueryProcessingEvent } from "../observability/query-processing-events.ts";
import { createResearchRunEventEmitter } from "../observability/research-run-events.ts";
import { hashKey, type ResearchJobRecord, type StudyResult, type SupabaseClientLike } from "../domain/models/research.ts";
import type { MetadataEnrichmentStore } from "../../_shared/metadata-enrichment-store.ts";

class PersistPipelineStage implements PipelineStage<{
  supabase: SupabaseClientLike;
  reportId: string;
  userId: string;
  question: string;
  cacheKey: string;
  providerHash?: string;
  pipelineVersionId?: string | null;
  seed?: number;
  runInputHash?: string;
  configSnapshot?: Record<string, unknown>;
  litRequest: SearchRequestPayload;
  data: Awaited<ReturnType<typeof runResearchPipeline>>;
}, {
  responsePayload: SearchResponsePayload;
}> {
  readonly name = "PERSIST" as const;

  async execute(input: {
    supabase: SupabaseClientLike;
    reportId: string;
    userId: string;
    question: string;
    cacheKey: string;
    providerHash?: string;
    pipelineVersionId?: string | null;
    seed?: number;
    runInputHash?: string;
    configSnapshot?: Record<string, unknown>;
    litRequest: SearchRequestPayload;
    data: Awaited<ReturnType<typeof runResearchPipeline>>;
  }): Promise<StageResult<{ responsePayload: SearchResponsePayload }>> {
    const responsePayload: SearchResponsePayload = {
      search_id: input.reportId,
      status: "completed",
      coverage: input.data.coverage,
      evidence_table: input.data.evidence_table,
      brief: input.data.brief,
      stats: input.data.stats,
    };

    const runSnapshot = await createExtractionRunForSearch(input.supabase, {
      reportId: input.reportId,
      userId: input.userId,
      trigger: "initial_pipeline",
      engine: (() => {
        const raw = String((input.data.extraction_stats || {}).engine || "unknown").toLowerCase();
        if (raw === "llm" || raw === "scripted" || raw === "hybrid" || raw === "manual") return raw;
        return "unknown";
      })(),
      question: input.question,
      normalizedQuery: input.data.normalized_query || null,
      litRequest: input.litRequest,
      litResponse: responsePayload,
      results: input.data.results || [],
      partialResults: input.data.partial_results || [],
      evidenceTable: input.data.evidence_table || [],
      brief: input.data.brief,
      coverage: input.data.coverage,
      stats: input.data.stats,
      extractionStats: input.data.extraction_stats || {},
      extractorVersion: input.data.extraction_metadata?.extractor_version || "unknown",
      promptHash: input.data.extraction_metadata?.prompt_hash ?? null,
      model: input.data.extraction_metadata?.model ?? null,
      deterministicFlag: Boolean(input.data.extraction_metadata?.deterministic_flag),
      pipelineVersionId: input.pipelineVersionId ?? null,
      seed: input.seed ?? 0,
      inputHash: input.runInputHash || hashKey(JSON.stringify({ question: input.question, litRequest: input.litRequest })),
      outputHash: hashKey(JSON.stringify(input.data)),
      configSnapshot: input.configSnapshot || {},
      canonicalPapers: input.data.canonical_papers || [],
    });
    responsePayload.active_run_id = runSnapshot.runId;
    responsePayload.run_version = runSnapshot.runIndex;

    await persistPipelineCompletion(input.supabase, {
      reportId: input.reportId,
      litRequest: input.litRequest,
      responsePayload,
      results: input.data.results || [],
      partialResults: input.data.partial_results || [],
      normalizedQuery: input.data.normalized_query,
      totalPapersSearched: input.data.total_papers_searched || 0,
      openalexCount: input.data.openalex_count || 0,
      semanticScholarCount: input.data.semantic_scholar_count || 0,
      arxivCount: input.data.arxiv_count || 0,
      pubmedCount: input.data.pubmed_count || 0,
      runId: runSnapshot.runId,
      runIndex: runSnapshot.runIndex,
    });

    await writeSearchCache(input.supabase, input.cacheKey, input.litRequest, responsePayload, {
      normalizedQuery: normalizeQueryForCache(input.data.normalized_query || input.question),
      providerHash: input.providerHash,
      ttlHours: resolveQueryCacheTtlHours(),
    });
    await upsertPaperCache(input.supabase, input.data.canonical_papers);
    await recordQueryProcessingEvent(input.supabase, {
      functionName: "research-async",
      mode: input.data.query_pipeline_mode,
      reportId: input.reportId,
      originalQuery: input.question,
      servedQuery: input.data.normalized_query || input.question,
      normalizedQuery: input.data.normalized_query,
      queryProcessing: input.data.query_processing,
      userId: input.userId,
    });

    return { output: { responsePayload } };
  }
}

export async function processPipelineJob(
  supabase: SupabaseClientLike,
  job: ResearchJobRecord,
  metadataRuntime: ReturnType<typeof getMetadataEnrichmentRuntimeConfig>,
  metadataStore: MetadataEnrichmentStore,
  metadataSourceTrust: Record<string, number>,
): Promise<void> {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const reportId = job.report_id;
  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const userId = typeof payload.user_id === "string" ? payload.user_id : "";
  const litRequest = sanitizeSearchRequest(
    (payload.lit_request || defaultSearchRequestFromQuestion(question)) as Partial<SearchRequestPayload>,
  );
  const cacheKey = typeof payload.cache_key === "string"
    ? payload.cache_key
    : hashKey(JSON.stringify(litRequest));
  const providerHash = typeof payload.provider_hash === "string" ? payload.provider_hash : undefined;
  const pipelineVersionId = typeof payload.pipeline_version_id === "string" ? payload.pipeline_version_id : null;
  const seed = Number.isFinite(Number(payload.seed)) ? Math.trunc(Number(payload.seed)) : 0;
  const runInputHash = typeof payload.run_input_hash === "string"
    ? payload.run_input_hash
    : hashKey(JSON.stringify({ question, litRequest, seed }));
  const configSnapshot = (payload.config_snapshot && typeof payload.config_snapshot === "object")
    ? payload.config_snapshot as Record<string, unknown>
    : {};

  if (!question || !userId || !reportId) {
    throw new Error("job payload missing required fields");
  }

  const report = await loadReportForProcessing(supabase, reportId);
  if (!report) {
    throw new Error("report not found");
  }
  if (report.status === "completed") {
    return;
  }

  await markReportProcessing(supabase, reportId);
  const runId = job.id;
  const traceId = runId; // trace_id = run_id per observability contract
  const emitEvent = createResearchRunEventEmitter(supabase, {
    traceId,
    runId,
    reportId,
  });

  const metadataMode = selectEffectiveEnrichmentMode(metadataRuntime);
  const data = await runResearchPipeline(question, litRequest, {
    mode: metadataMode,
    store: metadataStore,
    sourceTrust: metadataSourceTrust,
    userId,
    reportId,
    searchId: reportId,
    retryMax: metadataRuntime.retryMax,
    maxLatencyMs: metadataRuntime.maxLatencyMs,
  }, {
    traceId,
    runId,
    emitEvent,
  });
  const stageCtx = createStageContext({
    traceId,
    runId,
    emitEvent,
    stageTimeoutsMs: { PERSIST: 20_000 },
  });
  await runStage(new PersistPipelineStage(), {
    supabase,
    reportId,
    userId,
    question,
    cacheKey,
    providerHash,
    pipelineVersionId,
    seed,
    runInputHash,
    configSnapshot,
    litRequest,
    data,
  }, stageCtx);

  const dois = (data.results || [])
    .map((result: StudyResult) => result.citation?.doi?.trim())
    .filter((doi: string | undefined): doi is string => Boolean(doi));

  if (dois.length > 0) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const scihubUrl = `${supabaseUrl}/functions/v1/scihub-download`;
    fetch(scihubUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ report_id: reportId, dois, user_id: userId }),
    }).catch((err) => console.error("[research-async] Failed to trigger PDF downloads:", err));
  }
}
