import {
  getMetadataEnrichmentRuntimeConfig,
  selectEffectiveEnrichmentMode,
} from "../../_shared/metadata-enrichment.ts";
import {
  defaultSearchRequestFromQuestion,
  sanitizeSearchRequest,
  type SearchRequestPayload,
  type SearchResponsePayload,
} from "../../_shared/lit-search.ts";
import type { MetadataEnrichmentStore } from "../../_shared/metadata-enrichment-store.ts";
import {
  createStageContext,
  type StageContext,
} from "./stages/pipeline-runtime.ts";
import {
  DETERMINISTIC_EXTRACTOR_VERSION,
  LLM_MODEL,
  runCompileReportStage,
  runDedupeStage,
  runDeterministicExtractStage,
  runIngestProviderStage,
  runLlmAugmentStage,
  runNormalizeStage,
  runQualityFilterStage,
  type StageCanonicalized,
  type StageDeterministicExtracted,
  type StageLlmAugmented,
  type StageQualityFiltered,
  type StageRetrieved,
} from "./stages/research-pipeline-stage.ts";
import {
  createExtractionRunForSearch,
  enqueueResearchJob,
  loadReportForProcessing,
  markReportProcessing,
  persistPipelineCompletion,
  upsertPaperCache,
  writeSearchCache,
  normalizeQueryForCache,
  resolveQueryCacheTtlHours,
  sanitizeSearchRequest as sanitizeLitRequest,
} from "../infrastructure/repositories/research-repository.ts";
import {
  buildStageInputHash,
  buildStageOutputHash,
  emitMetricSample,
  emitTraceSpan,
  extractionCacheKey,
  fetchCanonicalRecordCache,
  fetchDoiCache,
  markReportPipelineVersion,
  parseJobPayload,
  recordCacheEvent,
  recordQueueDepthMetrics,
  resolvePipelineVersion,
  stageSpanName,
  upsertCanonicalRecordCache,
  upsertDoiCache,
  upsertExtractionCache,
  writeImmutableStageOutput,
  loadStageOutputById,
  loadStageOutputByInputHash,
  hashPayload,
  fetchExtractionCacheByKeys,
  type StageOutputRecord,
} from "../infrastructure/repositories/stage-orchestration-repository.ts";
import {
  RESEARCH_JOB_PROVIDER,
  RESEARCH_QUEUE_STAGE_COMPILE_REPORT,
  RESEARCH_QUEUE_STAGE_DEDUPE,
  RESEARCH_QUEUE_STAGE_DETERMINISTIC_EXTRACT,
  RESEARCH_QUEUE_STAGE_INGEST_PROVIDER,
  RESEARCH_QUEUE_STAGE_LLM_AUGMENT,
  RESEARCH_QUEUE_STAGE_NORMALIZE,
  RESEARCH_QUEUE_STAGE_QUALITY_FILTER,
  type ResearchJobRecord,
  type ResearchQueueStage,
  type StudyResult,
  type SupabaseClientLike,
} from "../domain/models/research.ts";
import { createResearchRunEventEmitter } from "../observability/research-run-events.ts";
import { normalizeDoi } from "../providers/normalization.ts";
import { ProviderRuntimeController } from "../providers/runtime-state.ts";
import { HttpStatusError, sleep } from "../providers/http.ts";

const STAGE_SEQUENCE: readonly ResearchQueueStage[] = [
  RESEARCH_QUEUE_STAGE_INGEST_PROVIDER,
  RESEARCH_QUEUE_STAGE_NORMALIZE,
  RESEARCH_QUEUE_STAGE_DEDUPE,
  RESEARCH_QUEUE_STAGE_QUALITY_FILTER,
  RESEARCH_QUEUE_STAGE_DETERMINISTIC_EXTRACT,
  RESEARCH_QUEUE_STAGE_LLM_AUGMENT,
  RESEARCH_QUEUE_STAGE_COMPILE_REPORT,
] as const;

const STAGE_TIMEOUTS_MS = {
  VALIDATE: 2_000,
  PREPARE_QUERY: 5_000,
  RETRIEVE_PROVIDERS: 45_000,
  CANONICALIZE: 8_000,
  QUALITY_FILTER: 8_000,
  DETERMINISTIC_EXTRACT: 90_000,
  LLM_AUGMENT: 90_000,
  PERSIST: 4_000,
} as const;

interface StageRunContext {
  reportId: string;
  stage: ResearchQueueStage;
  stageCtx: StageContext;
  traceId: string;
  runId: string;
  emitStageSpan: (status: "started" | "completed" | "failed", attrs?: Record<string, unknown>) => Promise<void>;
}

function isQueueStage(stage: string): stage is ResearchQueueStage {
  return (STAGE_SEQUENCE as readonly string[]).includes(stage);
}

function nextStage(stage: ResearchQueueStage): ResearchQueueStage | null {
  const idx = STAGE_SEQUENCE.indexOf(stage);
  if (idx < 0 || idx >= STAGE_SEQUENCE.length - 1) return null;
  return STAGE_SEQUENCE[idx + 1];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseStagePayload(stage: ResearchQueueStage, payload: Record<string, unknown>): {
  question?: string;
  userId?: string;
  cacheKey?: string;
  providerHash?: string;
  pipelineStartedAt?: number;
  pipelineVersionId?: string;
  runInputHash?: string;
  seed?: number;
  litRequest?: SearchRequestPayload;
  stageOutputId?: string;
  configSnapshot?: Record<string, unknown>;
  providerProfile?: Array<"openalex" | "semantic_scholar" | "arxiv" | "pubmed">;
  disableDedupe?: boolean;
  extractionEngineOverride?: "llm" | "scripted" | "hybrid";
  simulation?: {
    provider429BurstRate?: number;
    providerTimeoutRate?: number;
    dbContentionMs?: number;
  };
} {
  const litRequest = sanitizeSearchRequest(
    (payload.lit_request || payload.request_payload || defaultSearchRequestFromQuestion(String(payload.question || ""))) as Partial<SearchRequestPayload>,
  );
  const simulationRaw = asRecord(payload.simulation);
  const provider429BurstRate = asNumber(simulationRaw.provider_429_burst_rate) ?? asNumber(simulationRaw.provider429BurstRate) ?? 0;
  const providerTimeoutRate = asNumber(simulationRaw.provider_timeout_rate) ?? asNumber(simulationRaw.providerTimeoutRate) ?? 0;
  const dbContentionMs = asNumber(simulationRaw.db_contention_ms) ?? asNumber(simulationRaw.dbContentionMs) ?? 0;
  const experiment = asRecord(payload.experiment);
  const providerProfileRaw = Array.isArray(payload.provider_profile)
    ? payload.provider_profile
    : Array.isArray(experiment.provider_profile)
      ? experiment.provider_profile as unknown[]
      : [];
  const providerProfile = providerProfileRaw
    .map((provider) => String(provider || "").trim())
    .filter((provider): provider is "openalex" | "semantic_scholar" | "arxiv" | "pubmed" => {
      return provider === "openalex" || provider === "semantic_scholar" || provider === "arxiv" || provider === "pubmed";
    });
  const disableDedupe = Boolean(experiment.disable_dedupe ?? experiment.disableDedupe ?? false);
  const extractionEngineRaw = String(experiment.extraction_engine ?? experiment.extractionEngine ?? "").toLowerCase();
  const extractionEngineOverride = extractionEngineRaw === "llm" || extractionEngineRaw === "scripted" || extractionEngineRaw === "hybrid"
    ? extractionEngineRaw
    : undefined;

  return {
    question: asString(payload.question) || litRequest.query,
    userId: asString(payload.user_id),
    cacheKey: asString(payload.cache_key),
    providerHash: asString(payload.provider_hash),
    pipelineStartedAt: asNumber(payload.pipeline_started_at) || Date.now(),
    pipelineVersionId: asString(payload.pipeline_version_id),
    runInputHash: asString(payload.run_input_hash),
    seed: asNumber(payload.seed) || 0,
    litRequest,
    stageOutputId: asString(payload.stage_output_id),
    configSnapshot: asRecord(payload.config_snapshot),
    providerProfile,
    disableDedupe,
    extractionEngineOverride,
    simulation: {
      provider429BurstRate: Math.max(0, Math.min(1, provider429BurstRate)),
      providerTimeoutRate: Math.max(0, Math.min(1, providerTimeoutRate)),
      dbContentionMs: Math.max(0, Math.min(10_000, dbContentionMs)),
    },
  };
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
    provider_profile: ["openalex", "semantic_scholar", "arxiv", "pubmed"],
  };

  return {
    promptManifestHash: hashPayload({
      deterministic_extractor_version: DETERMINISTIC_EXTRACTOR_VERSION,
      llm_model: LLM_MODEL,
      query_pipeline_mode: configSnapshot.query_pipeline_mode,
      extraction_engine: configSnapshot.extraction_engine,
    }),
    extractorBundleHash: hashPayload({
      deterministic_extractor_version: DETERMINISTIC_EXTRACTOR_VERSION,
      bundle: Deno.env.get("EXTRACTOR_BUNDLE_VERSION") || "bundle_v1",
    }),
    configSnapshot,
  };
}

async function enqueueNextStage(
  supabase: SupabaseClientLike,
  params: {
    reportId: string;
    currentStage: ResearchQueueStage;
    currentOutput: StageOutputRecord;
    pipelineVersionId?: string | null;
    pipelineStartedAt?: number;
  },
): Promise<void> {
  const next = nextStage(params.currentStage);
  if (!next) return;

  await enqueueResearchJob(supabase, {
    reportId: params.reportId,
    stage: next,
    provider: RESEARCH_JOB_PROVIDER,
    maxAttempts: 5,
    inputHash: params.currentOutput.output_hash,
    payload: {
      report_id: params.reportId,
      stage_output_id: params.currentOutput.id,
      pipeline_version_id: params.pipelineVersionId || null,
      pipeline_started_at: params.pipelineStartedAt || Date.now(),
    },
  });
}

async function createStageRunContext(
  supabase: SupabaseClientLike,
  job: ResearchJobRecord,
): Promise<StageRunContext> {
  const traceId = job.id;
  const runId = job.id;
  const stageName = job.stage as ResearchQueueStage;
  const emitEvent = createResearchRunEventEmitter(supabase, {
    traceId,
    runId,
    reportId: job.report_id,
  });

  const stageCtx = createStageContext({
    traceId,
    runId,
    emitEvent,
    stageTimeoutsMs: STAGE_TIMEOUTS_MS,
  });

  const stageStartAt = new Date().toISOString();
  await emitTraceSpan(supabase, {
    traceId,
    runId,
    reportId: job.report_id,
    spanName: stageSpanName(stageName),
    stage: stageName,
    status: "started",
    startedAt: stageStartAt,
    attributes: { queue_stage: stageName },
  });

  return {
    reportId: job.report_id,
    stage: stageName,
    stageCtx,
    traceId,
    runId,
    emitStageSpan: async (status, attrs) => {
      await emitTraceSpan(supabase, {
        traceId,
        runId,
        reportId: job.report_id,
        spanName: stageSpanName(stageName),
        stage: stageName,
        status,
        startedAt: stageStartAt,
        endedAt: status === "started" ? null : new Date().toISOString(),
        durationMs: status === "started" ? null : Date.now() - new Date(stageStartAt).getTime(),
        attributes: attrs || {},
      });
    },
  };
}

async function applyDoiCacheToRetrieved(
  supabase: SupabaseClientLike,
  retrieved: StageRetrieved,
  reportId: string,
  runId: string,
): Promise<StageRetrieved> {
  const doiList = (retrieved.providerCandidates || [])
    .map((paper) => normalizeDoi(paper.doi))
    .filter((doi): doi is string => Boolean(doi));

  if (doiList.length === 0) return retrieved;

  const cache = await fetchDoiCache(supabase, doiList);
  let hitCount = 0;

  const providerCandidates = (retrieved.providerCandidates || []).map((paper) => {
    const key = normalizeDoi(paper.doi);
    if (!key || !cache.has(key)) return paper;
    hitCount += 1;
    const cached = cache.get(key) || {};
    return {
      ...paper,
      doi: (cached.doi as string | null) ?? paper.doi,
      pubmed_id: (cached.pubmed_id as string | null) ?? paper.pubmed_id,
      openalex_id: (cached.openalex_id as string | null) ?? paper.openalex_id,
      title: (cached.title as string) || paper.title,
      abstract: (cached.abstract as string) || paper.abstract,
      venue: (cached.venue as string) || paper.venue,
      year: Number(cached.year || paper.year || new Date().getUTCFullYear()),
      citationCount: Number(cached.citation_count || paper.citationCount || 0),
    };
  });

  if (hitCount > 0) {
    await recordCacheEvent(supabase, {
      cacheName: "doi",
      eventType: "hit",
      keyHash: hashPayload({ reportId, runId, hitCount }),
      reportId,
      runId,
      metadata: { hits: hitCount, lookups: doiList.length },
    });
    await emitMetricSample(supabase, {
      metricName: "cache_hit_rate",
      value: hitCount / Math.max(1, doiList.length),
      unit: "ratio",
      tags: { cache: "doi" },
      reportId,
      runId,
    });
  }

  return {
    ...retrieved,
    providerCandidates,
    papersWithAbstracts: providerCandidates.filter((paper) => (paper.abstract || "").length > 50),
  };
}

async function applyCanonicalCacheHints(
  supabase: SupabaseClientLike,
  state: StageRetrieved,
  reportId: string,
  runId: string,
): Promise<StageRetrieved> {
  const fingerprints = (state.providerCandidates || []).map((paper) =>
    hashPayload({
      title: (paper.title || "").toLowerCase().trim(),
      year: paper.year || null,
      doi: normalizeDoi(paper.doi),
    })
  );

  const cache = await fetchCanonicalRecordCache(supabase, fingerprints);
  if (cache.size === 0) {
    await recordCacheEvent(supabase, {
      cacheName: "canonical_record",
      eventType: "miss",
      keyHash: hashPayload({ reportId, runId, looked_up: fingerprints.length }),
      reportId,
      runId,
      metadata: { lookups: fingerprints.length },
    });
    return state;
  }

  let hitCount = 0;
  const providerCandidates = (state.providerCandidates || []).map((paper) => {
    const fp = hashPayload({
      title: (paper.title || "").toLowerCase().trim(),
      year: paper.year || null,
      doi: normalizeDoi(paper.doi),
    });
    const cached = cache.get(fp)?.payload;
    if (!cached) return paper;
    hitCount += 1;
    return {
      ...paper,
      doi: (cached.doi as string | null) ?? paper.doi,
      title: (cached.title as string) || paper.title,
      abstract: (cached.abstract as string) || paper.abstract,
      venue: (cached.venue as string) || paper.venue,
      year: Number(cached.year || paper.year || new Date().getUTCFullYear()),
      citationCount: Number(cached.citation_count || paper.citationCount || 0),
      pubmed_id: (cached.pubmed_id as string | null) ?? paper.pubmed_id,
      openalex_id: (cached.openalex_id as string | null) ?? paper.openalex_id,
    };
  });

  await recordCacheEvent(supabase, {
    cacheName: "canonical_record",
    eventType: "hit",
    keyHash: hashPayload({ reportId, runId, hitCount }),
    reportId,
    runId,
    metadata: { hits: hitCount, lookups: fingerprints.length },
  });

  await emitMetricSample(supabase, {
    metricName: "cache_hit_rate",
    value: hitCount / Math.max(1, fingerprints.length),
    unit: "ratio",
    tags: { cache: "canonical_record" },
    reportId,
    runId,
  });

  return {
    ...state,
    providerCandidates,
    papersWithAbstracts: providerCandidates.filter((paper) => (paper.abstract || "").length > 50),
  };
}

async function writeDeterministicExtractionCache(
  supabase: SupabaseClientLike,
  state: StageDeterministicExtracted,
): Promise<void> {
  const entries = (state.deterministicMerged || []).map((study) => {
    const cacheKey = extractionCacheKey({
      studyId: study.study_id,
      extractorVersion: DETERMINISTIC_EXTRACTOR_VERSION,
      promptHash: "deterministic",
      model: "deterministic",
    });
    return {
      cacheKey,
      studyId: study.study_id,
      extractorVersion: DETERMINISTIC_EXTRACTOR_VERSION,
      promptHash: "deterministic",
      model: "deterministic",
      outputPayload: study as unknown as Record<string, unknown>,
      outputHash: hashPayload(study),
    };
  });

  await upsertExtractionCache(supabase, entries);
}

async function hydrateLlmAugmentFromCache(
  supabase: SupabaseClientLike,
  state: StageDeterministicExtracted,
  reportId: string,
  runId: string,
): Promise<StageDeterministicExtracted> {
  const keys = (state.deterministicMerged || []).map((study) => extractionCacheKey({
    studyId: study.study_id,
    extractorVersion: DETERMINISTIC_EXTRACTOR_VERSION,
    promptHash: "deterministic",
    model: "deterministic",
  }));

  const cache = await fetchExtractionCacheByKeys(supabase, keys);
  if (cache.size === 0) {
    await recordCacheEvent(supabase, {
      cacheName: "extraction",
      eventType: "miss",
      keyHash: hashPayload({ reportId, runId, lookups: keys.length }),
      reportId,
      runId,
      metadata: { lookups: keys.length },
    });
    return state;
  }

  const cachedStudies = new Map<string, StudyResult>();
  for (const entry of cache.values()) {
    cachedStudies.set(entry.studyId, entry.outputPayload as unknown as StudyResult);
  }

  const merged = (state.deterministicMerged || []).map((study) => cachedStudies.get(study.study_id) || study);
  const hitCount = merged.filter((study) => cachedStudies.has(study.study_id)).length;

  await recordCacheEvent(supabase, {
    cacheName: "extraction",
    eventType: "hit",
    keyHash: hashPayload({ reportId, runId, hitCount }),
    reportId,
    runId,
    metadata: { hits: hitCount, lookups: keys.length },
  });

  await emitMetricSample(supabase, {
    metricName: "cache_hit_rate",
    value: hitCount / Math.max(1, keys.length),
    unit: "ratio",
    tags: { cache: "extraction" },
    reportId,
    runId,
  });

  return {
    ...state,
    deterministicMerged: merged,
  };
}

async function maybeComputeOrLoadStageOutput<TInput, TOutput extends Record<string, unknown>>(
  supabase: SupabaseClientLike,
  params: {
    reportId: string;
    stage: ResearchQueueStage;
    pipelineVersionId?: string | null;
    producerJobId: string;
    inputForHash: TInput;
    compute: () => Promise<TOutput>;
  },
): Promise<StageOutputRecord> {
  const inputHash = buildStageInputHash(params.stage, toSerializable(params.inputForHash));
  const existing = await loadStageOutputByInputHash(supabase, params.reportId, params.stage, inputHash);
  if (existing) return existing;

  const output = await params.compute();
  const serializedOutput = toSerializable(output);
  const outputHash = buildStageOutputHash(params.stage, serializedOutput);
  return await writeImmutableStageOutput(supabase, {
    reportId: params.reportId,
    stage: params.stage,
    inputHash,
    outputHash,
    payload: serializedOutput,
    pipelineVersionId: params.pipelineVersionId || null,
    producerJobId: params.producerJobId,
  });
}

async function assertPrevStage(
  supabase: SupabaseClientLike,
  reportId: string,
  expectedStage: ResearchQueueStage,
  stageOutputId: string | null,
): Promise<StageOutputRecord> {
  if (!stageOutputId) {
    throw new Error(`Missing stage_output_id for ${expectedStage}`);
  }

  const prev = await loadStageOutputById(supabase, stageOutputId);
  if (!prev || prev.report_id !== reportId) {
    throw new Error(`Stage output not found for report ${reportId}`);
  }

  const expectedPrev = STAGE_SEQUENCE[STAGE_SEQUENCE.indexOf(expectedStage) - 1];
  if (prev.stage !== expectedPrev) {
    throw new Error(`Invalid stage chain: expected previous stage ${expectedPrev}, got ${prev.stage}`);
  }

  return prev;
}

async function persistCompileStage(
  supabase: SupabaseClientLike,
  job: ResearchJobRecord,
  stageState: StageLlmAugmented,
  compiled: Awaited<ReturnType<typeof runCompileReportStage>>,
): Promise<void> {
  const reportId = job.report_id;
  const question = stageState.question || "";
  const userId = stageState.userId || "";
  const litRequest = sanitizeLitRequest(stageState.requestPayload as Partial<SearchRequestPayload>);
  const cacheKey = stageState.cacheKey || hashPayload({ reportId, litRequest });

  const pipelineVersionId = stageState.pipelineVersionId || null;
  const seed = Number(stageState.seed || 0);
  const inputHash = stageState.runInputHash || hashPayload({
    question,
    litRequest,
    seed,
  });

  const responsePayload: SearchResponsePayload = {
    search_id: reportId,
    status: "completed",
    coverage: compiled.coverage,
    evidence_table: compiled.evidence_table,
    brief: compiled.brief,
    stats: compiled.stats,
  };

  const runSnapshot = await createExtractionRunForSearch(supabase, {
    reportId,
    userId,
    trigger: "initial_pipeline",
    engine: (() => {
      const raw = String((compiled.extraction_stats || {}).engine || "unknown").toLowerCase();
      if (raw === "llm" || raw === "scripted" || raw === "hybrid" || raw === "manual") return raw;
      return "unknown";
    })(),
    question,
    normalizedQuery: compiled.normalized_query || null,
    litRequest,
    litResponse: responsePayload,
    results: compiled.results || [],
    partialResults: compiled.partial_results || [],
    evidenceTable: compiled.evidence_table || [],
    brief: compiled.brief,
    coverage: compiled.coverage,
    stats: compiled.stats,
    extractionStats: compiled.extraction_stats || {},
    extractorVersion: compiled.extraction_metadata?.extractor_version || DETERMINISTIC_EXTRACTOR_VERSION,
    promptHash: compiled.extraction_metadata?.prompt_hash ?? null,
    model: compiled.extraction_metadata?.model ?? null,
    deterministicFlag: Boolean(compiled.extraction_metadata?.deterministic_flag),
    canonicalPapers: compiled.canonical_papers || [],
    pipelineVersionId,
    seed,
    inputHash,
    outputHash: hashPayload(compiled),
    configSnapshot: stageState.configSnapshot || {},
    promptManifestHash: null,
    extractorBundleHash: null,
  });

  responsePayload.active_run_id = runSnapshot.runId;
  responsePayload.run_version = runSnapshot.runIndex;

  await persistPipelineCompletion(supabase, {
    reportId,
    litRequest,
    responsePayload,
    results: compiled.results || [],
    partialResults: compiled.partial_results || [],
    normalizedQuery: compiled.normalized_query,
    totalPapersSearched: compiled.total_papers_searched || 0,
    openalexCount: compiled.openalex_count || 0,
    semanticScholarCount: compiled.semantic_scholar_count || 0,
    arxivCount: compiled.arxiv_count || 0,
    pubmedCount: compiled.pubmed_count || 0,
    runId: runSnapshot.runId,
    runIndex: runSnapshot.runIndex,
  });

  const normalizedQuery = normalizeQueryForCache(compiled.normalized_query || question);
  await writeSearchCache(supabase, cacheKey, litRequest, responsePayload, {
    normalizedQuery,
    providerHash: stageState.providerHash,
    ttlHours: resolveQueryCacheTtlHours(),
  });
  await upsertPaperCache(supabase, compiled.canonical_papers);

  await upsertDoiCache(
    supabase,
    (compiled.canonical_papers || [])
      .map((paper) => {
        const doi = normalizeDoi(paper.doi);
        if (!doi) return null;
        return {
          normalizedDoi: doi,
          payload: paper as unknown as Record<string, unknown>,
          source: (paper.provenance || [])[0]?.provider,
        };
      })
      .filter((entry): entry is { normalizedDoi: string; payload: Record<string, unknown>; source?: string } => Boolean(entry)),
  );

  const canonicalEntries = (compiled.canonical_papers || []).map((paper) => ({
    fingerprint: hashPayload({
      title: (paper.title || "").toLowerCase().trim(),
      year: paper.year || null,
      doi: normalizeDoi(paper.doi),
    }),
    payload: paper as unknown as Record<string, unknown>,
  }));
  await upsertCanonicalRecordCache(supabase, canonicalEntries);

  const fallbackRate = Number((compiled.extraction_stats || {}).llmFallbackApplied ? 1 : 0);
  await emitMetricSample(supabase, {
    metricName: "run_success_rate",
    value: 1,
    unit: "ratio",
    tags: { stage: "compile_report" },
    reportId,
    runId: job.id,
  });
  await emitMetricSample(supabase, {
    metricName: "extraction_fallback_rate",
    value: fallbackRate,
    unit: "ratio",
    tags: {},
    reportId,
    runId: job.id,
  });

  const providerSuccess = (compiled.coverage.providers_queried - compiled.coverage.providers_failed) / Math.max(1, compiled.coverage.providers_queried);
  await emitMetricSample(supabase, {
    metricName: "provider_success_rate",
    value: providerSuccess,
    unit: "ratio",
    tags: {},
    reportId,
    runId: job.id,
  });

  const estimatedCost = Number(((compiled.extraction_stats || {}).llm_batches || 0)) * Number(Deno.env.get("LLM_COST_PER_BATCH_USD") || 0.0025);
  await emitMetricSample(supabase, {
    metricName: "cost_per_report",
    value: estimatedCost,
    unit: "usd",
    tags: { model: compiled.extraction_metadata?.model || "none" },
    reportId,
    runId: job.id,
  });

  const dois = (compiled.results || [])
    .map((result: StudyResult) => result.citation?.doi?.trim())
    .filter((doi: string | undefined): doi is string => Boolean(doi));

  if (dois.length > 0 && userId) {
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

export async function processQueueDrivenStageJob(
  supabase: SupabaseClientLike,
  job: ResearchJobRecord,
  metadataRuntime: ReturnType<typeof getMetadataEnrichmentRuntimeConfig>,
  metadataStore: MetadataEnrichmentStore,
  metadataSourceTrust: Record<string, number>,
): Promise<void> {
  if (!isQueueStage(job.stage)) {
    throw new Error(`Unsupported queue stage: ${job.stage}`);
  }

  const payload = parseJobPayload(job);
  const parsed = parseStagePayload(job.stage, payload);
  const report = await loadReportForProcessing(supabase, job.report_id);
  if (!report) {
    throw new Error("report not found");
  }

  if (report.status === "completed" && job.stage !== RESEARCH_QUEUE_STAGE_COMPILE_REPORT) {
    return;
  }

  const runtime = createStageRunContext(supabase, job);
  const runCtx = await runtime;

  try {
    await recordQueueDepthMetrics(supabase);

    let pipelineVersionId = parsed.pipelineVersionId;
    if (!pipelineVersionId) {
      const manifest = buildPipelineManifestHashes();
      const version = await resolvePipelineVersion(supabase, {
        promptManifestHash: manifest.promptManifestHash,
        extractorBundleHash: manifest.extractorBundleHash,
        seed: parsed.seed || 0,
        configSnapshot: manifest.configSnapshot,
      });
      pipelineVersionId = version.id;
      await markReportPipelineVersion(supabase, job.report_id, version.id);
    }

    const metadataMode = selectEffectiveEnrichmentMode(metadataRuntime);
    const enrichmentContext = {
      mode: metadataMode,
      store: metadataStore,
      sourceTrust: metadataSourceTrust,
      userId: parsed.userId,
      reportId: job.report_id,
      searchId: job.report_id,
      retryMax: metadataRuntime.retryMax,
      maxLatencyMs: metadataRuntime.maxLatencyMs,
    };

    const providerRuntime = new ProviderRuntimeController(supabase);

    if (job.stage === RESEARCH_QUEUE_STAGE_INGEST_PROVIDER) {
      const question = (parsed.question || "").trim();
      const userId = parsed.userId || "";
      const litRequest = parsed.litRequest || sanitizeSearchRequest(defaultSearchRequestFromQuestion(question));
      const cacheKey = parsed.cacheKey || hashPayload({ question, litRequest, report: job.report_id });
      const providerHash = parsed.providerHash || hashPayload(["openalex", "semantic_scholar", "arxiv", "pubmed"]);
      const pipelineStartedAt = parsed.pipelineStartedAt || Date.now();
      const simulation = parsed.simulation || {};

      if (!question || !userId) {
        throw new Error("job payload missing required fields");
      }

      await markReportProcessing(supabase, job.report_id);
      if ((simulation.dbContentionMs || 0) > 0) {
        await sleep(Math.trunc(simulation.dbContentionMs || 0));
      }

      const stageOutput = await maybeComputeOrLoadStageOutput(supabase, {
        reportId: job.report_id,
        stage: RESEARCH_QUEUE_STAGE_INGEST_PROVIDER,
        pipelineVersionId,
        producerJobId: job.id,
        inputForHash: {
          report_id: job.report_id,
          question,
          user_id: userId,
          lit_request: litRequest,
          provider_hash: providerHash,
          seed: parsed.seed || 0,
        },
        compute: async () => {
          const state = await runIngestProviderStage({
            question,
            requestPayload: litRequest,
            enrichmentContext,
            pipelineStartedAt,
            userId,
            cacheKey,
            providerHash,
            pipelineVersionId,
            seed: parsed.seed || 0,
            runInputHash: parsed.runInputHash || hashPayload({ question, litRequest, seed: parsed.seed || 0 }),
            configSnapshot: parsed.configSnapshot || buildPipelineManifestHashes().configSnapshot,
            providerProfile: parsed.providerProfile,
            disableDedupe: parsed.disableDedupe,
            extractionEngineOverride: parsed.extractionEngineOverride,
            providerExecution: {
              runtime: {
                beforeCall: async (provider) => {
                  if (Math.random() < (simulation.provider429BurstRate || 0)) {
                    throw new HttpStatusError(`Simulated 429 burst for ${provider}`, 429, 2);
                  }
                  if (Math.random() < (simulation.providerTimeoutRate || 0)) {
                    await sleep(Math.min(30_000, metadataRuntime.maxLatencyMs + 500));
                    throw new Error(`Simulated timeout for ${provider}`);
                  }
                  await providerRuntime.beforeCall(provider);
                },
                afterCall: async (provider, result) => {
                  await providerRuntime.afterCall(provider, {
                    success: result.success,
                    statusCode: result.statusCode,
                    retryAfterSeconds: result.retryAfterSeconds,
                    latencyMs: result.latencyMs,
                    error: result.error,
                  });
                },
              },
              onProviderSpan: async (event) => {
                await emitTraceSpan(supabase, {
                  traceId: runCtx.traceId,
                  runId: runCtx.runId,
                  reportId: job.report_id,
                  spanName: `provider:${event.provider}`,
                  stage: job.stage,
                  provider: event.provider,
                  status: event.success ? "completed" : "failed",
                  retryCount: event.retryCount,
                  startedAt: event.startedAt,
                  endedAt: event.endedAt,
                  durationMs: event.durationMs,
                  attributes: {
                    status_code: event.statusCode || null,
                    error: event.error || null,
                  },
                });

                await emitMetricSample(supabase, {
                  metricName: "provider_latency_ms",
                  value: event.durationMs,
                  unit: "ms",
                  tags: { provider: event.provider },
                  reportId: job.report_id,
                  runId: job.id,
                });
                await emitMetricSample(supabase, {
                  metricName: "provider_success_rate",
                  value: event.success ? 1 : 0,
                  unit: "ratio",
                  tags: { provider: event.provider },
                  reportId: job.report_id,
                  runId: job.id,
                });
              },
            },
          }, runCtx.stageCtx);

          return state as unknown as Record<string, unknown>;
        },
      });

      const ingestState = stageOutput.payload as unknown as StageRetrieved;
      const providerLatencies = (ingestState.providerRuns || [])
        .map((run) => Number(run.latencyMs || 0))
        .filter((latency) => Number.isFinite(latency) && latency >= 0)
        .sort((a, b) => a - b);
      if (providerLatencies.length > 0) {
        const p50 = providerLatencies[Math.floor((providerLatencies.length - 1) * 0.5)];
        const p95 = providerLatencies[Math.floor((providerLatencies.length - 1) * 0.95)];
        await emitMetricSample(supabase, {
          metricName: "provider_latency_p50_ms",
          value: p50,
          unit: "ms",
          tags: {},
          reportId: job.report_id,
          runId: job.id,
        });
        await emitMetricSample(supabase, {
          metricName: "provider_latency_p95_ms",
          value: p95,
          unit: "ms",
          tags: {},
          reportId: job.report_id,
          runId: job.id,
        });
      }

      await enqueueNextStage(supabase, {
        reportId: job.report_id,
        currentStage: RESEARCH_QUEUE_STAGE_INGEST_PROVIDER,
        currentOutput: stageOutput,
        pipelineVersionId,
        pipelineStartedAt,
      });

      await runCtx.emitStageSpan("completed", { output_hash: stageOutput.output_hash });
      return;
    }

    if (job.stage === RESEARCH_QUEUE_STAGE_NORMALIZE) {
      const prev = await assertPrevStage(supabase, job.report_id, RESEARCH_QUEUE_STAGE_NORMALIZE, parsed.stageOutputId || null);
      const prevState = prev.payload as unknown as StageRetrieved;

      const stageOutput = await maybeComputeOrLoadStageOutput(supabase, {
        reportId: job.report_id,
        stage: RESEARCH_QUEUE_STAGE_NORMALIZE,
        pipelineVersionId,
        producerJobId: job.id,
        inputForHash: { prev_output_hash: prev.output_hash },
        compute: async () => {
          const withDoiCache = await applyDoiCacheToRetrieved(supabase, prevState, job.report_id, job.id);
          const normalized = await runNormalizeStage(withDoiCache);
          return normalized as unknown as Record<string, unknown>;
        },
      });

      await enqueueNextStage(supabase, {
        reportId: job.report_id,
        currentStage: RESEARCH_QUEUE_STAGE_NORMALIZE,
        currentOutput: stageOutput,
        pipelineVersionId,
        pipelineStartedAt: parsed.pipelineStartedAt || Date.now(),
      });

      await runCtx.emitStageSpan("completed", { output_hash: stageOutput.output_hash });
      return;
    }

    if (job.stage === RESEARCH_QUEUE_STAGE_DEDUPE) {
      const prev = await assertPrevStage(supabase, job.report_id, RESEARCH_QUEUE_STAGE_DEDUPE, parsed.stageOutputId || null);
      const prevState = prev.payload as unknown as StageRetrieved;

      const stageOutput = await maybeComputeOrLoadStageOutput(supabase, {
        reportId: job.report_id,
        stage: RESEARCH_QUEUE_STAGE_DEDUPE,
        pipelineVersionId,
        producerJobId: job.id,
        inputForHash: { prev_output_hash: prev.output_hash },
        compute: async () => {
          const withCanonicalHints = await applyCanonicalCacheHints(supabase, prevState, job.report_id, job.id);
          const deduped = await runDedupeStage(withCanonicalHints, runCtx.stageCtx);
          return deduped as unknown as Record<string, unknown>;
        },
      });

      const dedupeState = stageOutput.payload as unknown as StageCanonicalized;
      await upsertCanonicalRecordCache(
        supabase,
        (dedupeState.canonicalCandidates || []).map((paper) => ({
          fingerprint: hashPayload({
            title: (paper.title || "").toLowerCase().trim(),
            year: paper.year || null,
            doi: normalizeDoi(paper.doi),
          }),
          payload: paper as unknown as Record<string, unknown>,
        })),
      );

      await enqueueNextStage(supabase, {
        reportId: job.report_id,
        currentStage: RESEARCH_QUEUE_STAGE_DEDUPE,
        currentOutput: stageOutput,
        pipelineVersionId,
        pipelineStartedAt: parsed.pipelineStartedAt || Date.now(),
      });

      await runCtx.emitStageSpan("completed", { output_hash: stageOutput.output_hash });
      return;
    }

    if (job.stage === RESEARCH_QUEUE_STAGE_QUALITY_FILTER) {
      const prev = await assertPrevStage(supabase, job.report_id, RESEARCH_QUEUE_STAGE_QUALITY_FILTER, parsed.stageOutputId || null);
      const prevState = prev.payload as unknown as StageCanonicalized;

      const stageOutput = await maybeComputeOrLoadStageOutput(supabase, {
        reportId: job.report_id,
        stage: RESEARCH_QUEUE_STAGE_QUALITY_FILTER,
        pipelineVersionId,
        producerJobId: job.id,
        inputForHash: { prev_output_hash: prev.output_hash },
        compute: async () => {
          const quality = await runQualityFilterStage(prevState, runCtx.stageCtx);
          return quality as unknown as Record<string, unknown>;
        },
      });

      await enqueueNextStage(supabase, {
        reportId: job.report_id,
        currentStage: RESEARCH_QUEUE_STAGE_QUALITY_FILTER,
        currentOutput: stageOutput,
        pipelineVersionId,
        pipelineStartedAt: parsed.pipelineStartedAt || Date.now(),
      });

      await runCtx.emitStageSpan("completed", { output_hash: stageOutput.output_hash });
      return;
    }

    if (job.stage === RESEARCH_QUEUE_STAGE_DETERMINISTIC_EXTRACT) {
      const prev = await assertPrevStage(supabase, job.report_id, RESEARCH_QUEUE_STAGE_DETERMINISTIC_EXTRACT, parsed.stageOutputId || null);
      const prevState = prev.payload as unknown as StageQualityFiltered;

      const stageOutput = await maybeComputeOrLoadStageOutput(supabase, {
        reportId: job.report_id,
        stage: RESEARCH_QUEUE_STAGE_DETERMINISTIC_EXTRACT,
        pipelineVersionId,
        producerJobId: job.id,
        inputForHash: { prev_output_hash: prev.output_hash },
        compute: async () => {
          const deterministic = await runDeterministicExtractStage(prevState, runCtx.stageCtx);
          await writeDeterministicExtractionCache(supabase, deterministic);
          return deterministic as unknown as Record<string, unknown>;
        },
      });

      await enqueueNextStage(supabase, {
        reportId: job.report_id,
        currentStage: RESEARCH_QUEUE_STAGE_DETERMINISTIC_EXTRACT,
        currentOutput: stageOutput,
        pipelineVersionId,
        pipelineStartedAt: parsed.pipelineStartedAt || Date.now(),
      });

      await runCtx.emitStageSpan("completed", { output_hash: stageOutput.output_hash });
      return;
    }

    if (job.stage === RESEARCH_QUEUE_STAGE_LLM_AUGMENT) {
      const prev = await assertPrevStage(supabase, job.report_id, RESEARCH_QUEUE_STAGE_LLM_AUGMENT, parsed.stageOutputId || null);
      const prevStateRaw = prev.payload as unknown as StageDeterministicExtracted;
      const prevState = await hydrateLlmAugmentFromCache(supabase, prevStateRaw, job.report_id, job.id);

      const stageOutput = await maybeComputeOrLoadStageOutput(supabase, {
        reportId: job.report_id,
        stage: RESEARCH_QUEUE_STAGE_LLM_AUGMENT,
        pipelineVersionId,
        producerJobId: job.id,
        inputForHash: { prev_output_hash: prev.output_hash },
        compute: async () => {
          const llm = await runLlmAugmentStage(prevState, runCtx.stageCtx);

          await upsertExtractionCache(
            supabase,
            (llm.deterministicMerged || []).map((study) => {
              const cacheKey = extractionCacheKey({
                studyId: study.study_id,
                extractorVersion: llm.extraction_metadata.extractor_version || DETERMINISTIC_EXTRACTOR_VERSION,
                promptHash: llm.extraction_metadata.prompt_hash || "deterministic",
                model: llm.extraction_metadata.model || "deterministic",
              });
              return {
                cacheKey,
                studyId: study.study_id,
                extractorVersion: llm.extraction_metadata.extractor_version || DETERMINISTIC_EXTRACTOR_VERSION,
                promptHash: llm.extraction_metadata.prompt_hash || "deterministic",
                model: llm.extraction_metadata.model || "deterministic",
                outputPayload: study as unknown as Record<string, unknown>,
                outputHash: hashPayload(study),
              };
            }),
          );

          return llm as unknown as Record<string, unknown>;
        },
      });

      await enqueueNextStage(supabase, {
        reportId: job.report_id,
        currentStage: RESEARCH_QUEUE_STAGE_LLM_AUGMENT,
        currentOutput: stageOutput,
        pipelineVersionId,
        pipelineStartedAt: parsed.pipelineStartedAt || Date.now(),
      });

      await runCtx.emitStageSpan("completed", { output_hash: stageOutput.output_hash });
      return;
    }

    if (job.stage === RESEARCH_QUEUE_STAGE_COMPILE_REPORT) {
      const prev = await assertPrevStage(supabase, job.report_id, RESEARCH_QUEUE_STAGE_COMPILE_REPORT, parsed.stageOutputId || null);
      const prevState = prev.payload as unknown as StageLlmAugmented;

      const stageOutput = await maybeComputeOrLoadStageOutput(supabase, {
        reportId: job.report_id,
        stage: RESEARCH_QUEUE_STAGE_COMPILE_REPORT,
        pipelineVersionId,
        producerJobId: job.id,
        inputForHash: { prev_output_hash: prev.output_hash },
        compute: async () => {
          const compiled = await runCompileReportStage(prevState, runCtx.stageCtx);
          await persistCompileStage(supabase, job, prevState, compiled);
          return compiled as unknown as Record<string, unknown>;
        },
      });

      await runCtx.emitStageSpan("completed", { output_hash: stageOutput.output_hash });
      return;
    }

    throw new Error(`Unhandled queue stage: ${job.stage}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await runCtx.emitStageSpan("failed", { error: message });
    throw error;
  }
}
