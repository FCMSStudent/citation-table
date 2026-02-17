import {
  getMetadataEnrichmentRuntimeConfig,
  selectEffectiveEnrichmentMode,
} from "../../_shared/metadata-enrichment.ts";
import { defaultSearchRequestFromQuestion, sanitizeSearchRequest, type SearchRequestPayload, type SearchResponsePayload } from "../../_shared/lit-search.ts";
import { runResearchPipeline } from "./stages/research-pipeline-stage.ts";
import {
  createExtractionRunForSearch,
  loadReportForProcessing,
  markReportProcessing,
  persistPipelineCompletion,
  upsertPaperCache,
  writeSearchCache,
} from "../infrastructure/repositories/research-repository.ts";
import { recordQueryProcessingEvent } from "../observability/query-processing-events.ts";
import { hashKey, type ResearchJobRecord, type StudyResult, type SupabaseClientLike } from "../domain/models/research.ts";
import type { MetadataEnrichmentStore } from "../../_shared/metadata-enrichment-store.ts";

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
  });

  const responsePayload: SearchResponsePayload = {
    search_id: reportId,
    status: "completed",
    coverage: data.coverage,
    evidence_table: data.evidence_table,
    brief: data.brief,
    stats: data.stats,
  };

  const runSnapshot = await createExtractionRunForSearch(supabase, {
    reportId,
    userId,
    trigger: "initial_pipeline",
    engine: (() => {
      const raw = String((data.extraction_stats || {}).engine || "unknown").toLowerCase();
      if (raw === "llm" || raw === "scripted" || raw === "hybrid" || raw === "manual") return raw;
      return "unknown";
    })(),
    question,
    normalizedQuery: data.normalized_query || null,
    litRequest,
    litResponse: responsePayload,
    results: data.results || [],
    partialResults: data.partial_results || [],
    evidenceTable: data.evidence_table || [],
    brief: data.brief,
    coverage: data.coverage,
    stats: data.stats,
    extractionStats: data.extraction_stats || {},
    canonicalPapers: data.canonical_papers || [],
  });
  responsePayload.active_run_id = runSnapshot.runId;
  responsePayload.run_version = runSnapshot.runIndex;

  await persistPipelineCompletion(supabase, {
    reportId,
    litRequest,
    responsePayload,
    results: data.results || [],
    partialResults: data.partial_results || [],
    normalizedQuery: data.normalized_query,
    totalPapersSearched: data.total_papers_searched || 0,
    openalexCount: data.openalex_count || 0,
    semanticScholarCount: data.semantic_scholar_count || 0,
    arxivCount: data.arxiv_count || 0,
    pubmedCount: data.pubmed_count || 0,
    runId: runSnapshot.runId,
    runIndex: runSnapshot.runIndex,
  });

  await writeSearchCache(supabase, cacheKey, litRequest, responsePayload);
  await upsertPaperCache(supabase, data.canonical_papers);
  await recordQueryProcessingEvent(supabase, {
    functionName: "research-async",
    mode: data.query_pipeline_mode,
    reportId,
    originalQuery: question,
    servedQuery: data.normalized_query || question,
    normalizedQuery: data.normalized_query,
    queryProcessing: data.query_processing,
    userId,
  });

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
