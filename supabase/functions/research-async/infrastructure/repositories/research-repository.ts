import {
  defaultSearchRequestFromQuestion,
  sanitizeSearchRequest,
  type SearchRequestPayload,
  type SearchResponsePayload,
} from "../../../_shared/lit-search.ts";
import { persistExtractionRun } from "../../../_shared/extraction-runs.ts";
import type {
  CanonicalPaper,
  QueryPipelineMode,
  ResearchJobRecord,
  StudyResult,
  SupabaseClientLike,
  CoverageReport,
  SearchStats,
} from "../../domain/models/research.ts";
import {
  RESEARCH_JOB_PROVIDER,
  RESEARCH_JOB_STAGE_PIPELINE,
  buildResearchJobDedupeKey,
  hashKey,
} from "../../domain/models/research.ts";

export async function checkRateLimit(
  supabase: SupabaseClientLike,
  functionName: string,
  clientIp: string,
  maxRequests: number,
  windowMinutes: number,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("function_name", functionName)
    .eq("client_ip", clientIp)
    .gte("created_at", windowStart);

  if (error) {
    console.error("[rate-limit] Check failed:", error);
    return true;
  }

  if ((count || 0) >= maxRequests) return false;
  await supabase.from("rate_limits").insert({ function_name: functionName, client_ip: clientIp });
  return true;
}

export async function readCachedSearch(
  supabase: SupabaseClientLike,
  cacheKey: string,
): Promise<SearchResponsePayload | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("lit_query_cache")
    .select("response_payload")
    .eq("cache_key", cacheKey)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (error) {
    console.warn("[cache] read failed:", error.message);
    return null;
  }

  return (data?.response_payload as SearchResponsePayload) || null;
}

export async function writeSearchCache(
  supabase: SupabaseClientLike,
  cacheKey: string,
  requestPayload: SearchRequestPayload,
  responsePayload: SearchResponsePayload,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
  const { error } = await supabase.from("lit_query_cache").upsert({
    cache_key: cacheKey,
    request_payload: requestPayload,
    response_payload: responsePayload,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "cache_key" });

  if (error) {
    console.warn("[cache] write failed:", error.message);
  }
}

export async function createExtractionRunForSearch(
  supabase: SupabaseClientLike,
  params: {
    reportId: string;
    userId?: string;
    trigger: "initial_pipeline" | "initial_pipeline_cached";
    engine: "llm" | "scripted" | "hybrid" | "unknown";
    question: string;
    normalizedQuery?: string;
    litRequest?: SearchRequestPayload;
    litResponse?: SearchResponsePayload;
    results?: StudyResult[];
    partialResults?: StudyResult[];
    evidenceTable?: SearchResponsePayload["evidence_table"];
    brief?: SearchResponsePayload["brief"];
    coverage?: CoverageReport;
    stats?: SearchStats;
    extractionStats?: Record<string, unknown>;
    canonicalPapers?: CanonicalPaper[];
  },
): Promise<{ runId: string; runIndex: number }> {
  const persisted = await persistExtractionRun(supabase, {
    reportId: params.reportId,
    userId: params.userId,
    trigger: params.trigger,
    status: "completed",
    engine: params.engine,
    question: params.question,
    normalizedQuery: params.normalizedQuery ?? null,
    litRequest: (params.litRequest as unknown as Record<string, unknown>) || {},
    litResponse: (params.litResponse as unknown as Record<string, unknown>) || {},
    results: params.results || [],
    partialResults: params.partialResults || [],
    evidenceTable: params.evidenceTable || [],
    briefJson: (params.brief as unknown as Record<string, unknown>) || {},
    coverageReport: (params.coverage as unknown as Record<string, unknown>) || {},
    searchStats: (params.stats as unknown as Record<string, unknown>) || {},
    extractionStats: params.extractionStats || {},
    canonicalPapers: params.canonicalPapers || [],
    completedAt: new Date().toISOString(),
  });

  return { runId: persisted.runId, runIndex: persisted.runIndex };
}

export async function upsertPaperCache(supabase: SupabaseClientLike, papers: CanonicalPaper[]): Promise<void> {
  if (papers.length === 0) return;

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  const payload = papers.slice(0, 500).map((paper) => ({
    paper_id: paper.paper_id,
    paper_payload: paper,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("lit_paper_cache").upsert(payload, { onConflict: "paper_id" });
  if (error) {
    console.warn("[paper-cache] upsert failed:", error.message);
  }
}

export async function enqueueResearchJob(
  supabase: SupabaseClientLike,
  params: {
    reportId: string;
    question: string;
    userId: string;
    litRequest: SearchRequestPayload;
    cacheKey: string;
    stage?: string;
    provider?: string;
    maxAttempts?: number;
  },
): Promise<ResearchJobRecord> {
  const stage = params.stage || RESEARCH_JOB_STAGE_PIPELINE;
  const provider = params.provider || RESEARCH_JOB_PROVIDER;
  const dedupeKey = buildResearchJobDedupeKey(params.reportId, stage, provider);

  const { data, error } = await supabase.rpc("research_jobs_enqueue", {
    p_report_id: params.reportId,
    p_stage: stage,
    p_provider: provider,
    p_payload: {
      report_id: params.reportId,
      question: params.question,
      user_id: params.userId,
      lit_request: params.litRequest,
      cache_key: params.cacheKey,
    },
    p_dedupe_key: dedupeKey,
    p_max_attempts: params.maxAttempts ?? 5,
  });

  if (error) {
    throw new Error(`Failed to enqueue research job: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("Failed to enqueue research job: empty response");
  }

  return row as ResearchJobRecord;
}

export async function claimResearchJobs(
  supabase: SupabaseClientLike,
  workerId: string,
  batchSize: number,
  leaseSeconds: number,
): Promise<ResearchJobRecord[]> {
  const { data, error } = await supabase.rpc("research_jobs_claim", {
    p_worker_id: workerId,
    p_batch_size: batchSize,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    throw new Error(`Failed to claim research jobs: ${error.message}`);
  }
  return Array.isArray(data) ? data as ResearchJobRecord[] : [];
}

export async function completeResearchJob(
  supabase: SupabaseClientLike,
  jobId: string,
  workerId: string,
): Promise<ResearchJobRecord | null> {
  const { data, error } = await supabase.rpc("research_jobs_complete", {
    p_job_id: jobId,
    p_worker_id: workerId,
  });
  if (error) {
    throw new Error(`Failed to complete research job: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ResearchJobRecord | null) || null;
}

export async function failResearchJob(
  supabase: SupabaseClientLike,
  jobId: string,
  workerId: string,
  errorMessage: string,
): Promise<ResearchJobRecord | null> {
  const { data, error } = await supabase.rpc("research_jobs_fail", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_error: errorMessage,
  });
  if (error) {
    throw new Error(`Failed to fail research job: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ResearchJobRecord | null) || null;
}

export function buildLitRequest(rawBody: unknown, isLitRoute: boolean): { litRequest: SearchRequestPayload; question: string } {
  const body = (rawBody || {}) as Record<string, unknown>;
  const legacyQuestion = typeof body.question === "string" ? body.question.trim() : "";
  const litRequest = isLitRoute
    ? sanitizeSearchRequest(body as Partial<SearchRequestPayload>)
    : sanitizeSearchRequest(defaultSearchRequestFromQuestion(legacyQuestion));
  const question = (litRequest.query || legacyQuestion).trim();
  return { litRequest, question };
}

export function buildCacheKey(litRequest: SearchRequestPayload): string {
  return hashKey(JSON.stringify(litRequest));
}

export async function createQueuedReport(
  supabase: SupabaseClientLike,
  question: string,
  userId: string,
): Promise<string> {
  const { data: report, error: insertError } = await supabase
    .from("research_reports")
    .insert({
      question,
      status: "queued",
      user_id: userId,
    })
    .select("id")
    .single();

  if (insertError || !report) {
    console.error("[research-async] Insert error:", insertError);
    throw new Error("Failed to create report");
  }

  return report.id as string;
}

export async function markReportCompletedFromCache(
  supabase: SupabaseClientLike,
  reportId: string,
  runId: string,
  runIndex: number,
  litRequest: SearchRequestPayload,
  replayed: SearchResponsePayload,
): Promise<void> {
  await supabase
    .from("research_reports")
    .update({
      status: "completed",
      active_extraction_run_id: runId,
      extraction_run_count: runIndex,
      lit_request: litRequest,
      lit_response: replayed,
      coverage_report: replayed.coverage,
      evidence_table: replayed.evidence_table,
      brief_json: replayed.brief,
      search_stats: replayed.stats,
      completed_at: new Date().toISOString(),
    })
    .eq("id", reportId);
}

export async function loadReportForProcessing(
  supabase: SupabaseClientLike,
  reportId: string,
): Promise<{ id: string; status: string } | null> {
  const { data: report } = await supabase
    .from("research_reports")
    .select("id,status")
    .eq("id", reportId)
    .maybeSingle();
  return report as { id: string; status: string } | null;
}

export async function markReportProcessing(
  supabase: SupabaseClientLike,
  reportId: string,
): Promise<void> {
  await supabase
    .from("research_reports")
    .update({
      status: "processing",
      error_message: null,
    })
    .eq("id", reportId);
}

export async function markReportQueued(
  supabase: SupabaseClientLike,
  reportId: string,
  errorMessage: string,
): Promise<void> {
  await supabase
    .from("research_reports")
    .update({
      status: "queued",
      error_message: errorMessage,
    })
    .eq("id", reportId);
}

export async function markReportFailed(
  supabase: SupabaseClientLike,
  reportId: string,
  errorMessage: string,
): Promise<void> {
  await supabase
    .from("research_reports")
    .update({
      status: "failed",
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq("id", reportId);
}

export async function persistPipelineCompletion(
  supabase: SupabaseClientLike,
  params: {
    reportId: string;
    litRequest: SearchRequestPayload;
    responsePayload: SearchResponsePayload;
    results: StudyResult[];
    partialResults: StudyResult[];
    normalizedQuery?: string;
    totalPapersSearched: number;
    openalexCount: number;
    semanticScholarCount: number;
    arxivCount: number;
    pubmedCount: number;
    runId: string;
    runIndex: number;
  },
): Promise<void> {
  const { error: updateError } = await supabase
    .from("research_reports")
    .update({
      status: "completed",
      results: [...(params.results || []), ...(params.partialResults || [])],
      normalized_query: params.normalizedQuery || null,
      total_papers_searched: params.totalPapersSearched || 0,
      openalex_count: params.openalexCount || 0,
      semantic_scholar_count: params.semanticScholarCount || 0,
      arxiv_count: params.arxivCount || 0,
      pubmed_count: params.pubmedCount || 0,
      lit_request: params.litRequest,
      lit_response: params.responsePayload,
      coverage_report: params.responsePayload.coverage,
      evidence_table: params.responsePayload.evidence_table,
      brief_json: params.responsePayload.brief,
      search_stats: params.responsePayload.stats,
      active_extraction_run_id: params.runId,
      extraction_run_count: params.runIndex,
      completed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", params.reportId);

  if (updateError) {
    throw new Error(`DB update failed: ${updateError.message}`);
  }
}

export async function loadSearchReport(
  supabase: SupabaseClientLike,
  searchId: string,
  userId: string,
): Promise<{
  id: string;
  status: string;
  error_message?: string | null;
  lit_response?: SearchResponsePayload;
  active_extraction_run_id?: string | null;
  extraction_run_count?: number | null;
} | null> {
  const { data: report } = await supabase
    .from("research_reports")
    .select("id,status,error_message,lit_response,user_id,active_extraction_run_id,extraction_run_count")
    .eq("id", searchId)
    .eq("user_id", userId)
    .maybeSingle();
  return report as {
    id: string;
    status: string;
    error_message?: string | null;
    lit_response?: SearchResponsePayload;
    active_extraction_run_id?: string | null;
    extraction_run_count?: number | null;
  } | null;
}

export async function loadSearchReportForRuns(
  supabase: SupabaseClientLike,
  searchId: string,
  userId: string,
): Promise<{ id: string; user_id: string; active_extraction_run_id?: string | null } | null> {
  const { data: report } = await supabase
    .from("research_reports")
    .select("id,user_id,active_extraction_run_id")
    .eq("id", searchId)
    .eq("user_id", userId)
    .maybeSingle();
  return report as { id: string; user_id: string; active_extraction_run_id?: string | null } | null;
}

export async function loadSearchReportOwner(
  supabase: SupabaseClientLike,
  searchId: string,
  userId: string,
): Promise<{ id: string; user_id: string } | null> {
  const { data: report } = await supabase
    .from("research_reports")
    .select("id,user_id")
    .eq("id", searchId)
    .eq("user_id", userId)
    .maybeSingle();
  return report as { id: string; user_id: string } | null;
}

export async function loadPaperFromCache(
  supabase: SupabaseClientLike,
  paperId: string,
): Promise<{ paper_payload: unknown } | null> {
  const nowIso = new Date().toISOString();
  const { data: paperCache } = await supabase
    .from("lit_paper_cache")
    .select("paper_payload")
    .eq("paper_id", paperId)
    .gt("expires_at", nowIso)
    .maybeSingle();
  return paperCache as { paper_payload: unknown } | null;
}

export { RESEARCH_JOB_PROVIDER, RESEARCH_JOB_STAGE_PIPELINE, sanitizeSearchRequest, defaultSearchRequestFromQuestion, hashKey };
