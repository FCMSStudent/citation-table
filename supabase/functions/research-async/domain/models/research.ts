import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import type {
  CanonicalPaper,
  CoverageReport,
  SearchRequestPayload,
  SearchResponsePayload,
  SearchStats,
} from "../../../_shared/lit-search.ts";
import type { QueryProcessingMeta } from "../../../_shared/query-processing.ts";
import type { MetadataEnrichmentStore, MetadataEnrichmentMode } from "../../../_shared/metadata-enrichment-store.ts";

export interface Outcome {
  outcome_measured: string;
  key_result: string | null;
  citation_snippet: string;
  intervention: string | null;
  comparator: string | null;
  effect_size: string | null;
  p_value: string | null;
}

export interface Citation {
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  formatted: string;
}

export interface StudyResult {
  study_id: string;
  title: string;
  year: number;
  study_design: "RCT" | "cohort" | "cross-sectional" | "review" | "unknown";
  sample_size: number | null;
  population: string | null;
  outcomes: Outcome[];
  citation: Citation;
  abstract_excerpt: string;
  preprint_status: "Preprint" | "Peer-reviewed";
  review_type: "None" | "Systematic review" | "Meta-analysis";
  source: "openalex" | "semantic_scholar" | "arxiv" | "pubmed";
  citationCount?: number;
  pdf_url?: string | null;
  landing_page_url?: string | null;
}

export type QueryPipelineMode = "v1" | "v2" | "shadow";
export type ExtractionEngine = "llm" | "scripted" | "hybrid";
export type ResearchJobStatus = "queued" | "leased" | "completed" | "dead";

export interface ResearchJobRecord {
  id: string;
  report_id: string;
  stage: string;
  provider: string;
  payload: Record<string, unknown>;
  status: ResearchJobStatus;
  attempts: number;
  max_attempts: number;
  dedupe_key: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
}

export interface MetadataEnrichmentContext {
  mode: MetadataEnrichmentMode;
  store?: MetadataEnrichmentStore;
  sourceTrust?: Record<string, number>;
  userId?: string;
  reportId?: string;
  searchId?: string;
  retryMax?: number;
  maxLatencyMs?: number;
}

export interface PipelineResult {
  results: StudyResult[];
  partial_results: StudyResult[];
  extraction_stats: Record<string, unknown>;
  extraction_metadata?: {
    extractor_version: string;
    prompt_hash: string | null;
    model: string | null;
    deterministic_flag: boolean;
  };
  evidence_table: SearchResponsePayload["evidence_table"];
  brief: SearchResponsePayload["brief"];
  coverage: CoverageReport;
  stats: SearchStats;
  canonical_papers: CanonicalPaper[];
  normalized_query?: string;
  total_papers_searched: number;
  openalex_count: number;
  semantic_scholar_count: number;
  arxiv_count: number;
  pubmed_count: number;
  query_processing?: QueryProcessingMeta;
  query_pipeline_mode: QueryPipelineMode;
}

export type SupabaseClientLike = ReturnType<typeof createClient>;

export interface ProcessPipelineJobDependencies {
  metadataRuntime: {
    retryMax: number;
    maxLatencyMs: number;
  };
}

export interface ProcessPipelineJobInput {
  supabase: SupabaseClientLike;
  job: ResearchJobRecord;
  metadataRuntime: {
    retryMax: number;
    maxLatencyMs: number;
  };
  metadataStore: MetadataEnrichmentStore;
  metadataSourceTrust: Record<string, number>;
}

export interface StartSearchContext {
  req: Request;
  supabase: SupabaseClientLike;
  userId: string;
  isLitRoute: boolean;
}

export interface StartSearchResult {
  response: Response;
}

export interface ReadSearchContext {
  req: Request;
  supabase: SupabaseClientLike;
  userId: string;
  pathParts: string[];
  isLitRoute: boolean;
}

export interface ReadSearchResult {
  handled: boolean;
  response?: Response;
}

export interface WorkerDrainContext {
  req: Request;
  supabase: SupabaseClientLike;
}

export interface WorkerDrainResult {
  handled: boolean;
  response?: Response;
}

export const RESEARCH_JOB_STAGE_PIPELINE = "pipeline";
export const RESEARCH_JOB_PROVIDER = "research-async";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function hashKey(raw: string): string {
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getPathParts(req: Request): string[] {
  const path = new URL(req.url).pathname
    .replace(/^\/functions\/v1\/research-async\/?/, "")
    .replace(/^\/research-async\/?/, "")
    .replace(/^\/+/, "");
  return path.split("/").filter(Boolean);
}

export function runningSearchResponse(searchId: string): SearchResponsePayload {
  return {
    search_id: searchId,
    status: "running",
    coverage: {
      providers_queried: 0,
      providers_failed: 0,
      failed_provider_names: [],
      degraded: false,
    },
    evidence_table: [],
    brief: { sentences: [] },
    stats: {
      latency_ms: 0,
      candidates_total: 0,
      candidates_filtered: 0,
    },
    run_version: 0,
  };
}

export function mapReportToSearchResponse(report: {
  id?: string;
  status?: string;
  error_message?: string | null;
  active_extraction_run_id?: string | null;
  extraction_run_count?: number | null;
  lit_response?: Partial<SearchResponsePayload> & { error?: string };
}): SearchResponsePayload {
  const payload = report?.lit_response || {};
  const status = report?.status === "failed"
    ? "failed"
    : report?.status === "completed"
      ? "completed"
      : "running";

  return {
    search_id: String(report?.id || payload.search_id || ""),
    status,
    coverage: payload.coverage || {
      providers_queried: 0,
      providers_failed: 0,
      failed_provider_names: [],
      degraded: false,
    },
    evidence_table: payload.evidence_table || [],
    brief: payload.brief || { sentences: [] },
    stats: payload.stats || {
      latency_ms: 0,
      candidates_total: 0,
      candidates_filtered: 0,
    },
    active_run_id: report?.active_extraction_run_id || payload.active_run_id || undefined,
    run_version: report?.extraction_run_count ?? payload.run_version ?? undefined,
    error: report?.error_message || payload.error || undefined,
  };
}

export function buildResearchJobDedupeKey(reportId: string, stage: string, provider: string): string {
  return `${stage}:${provider}:${reportId}`;
}

export type { SearchRequestPayload, SearchResponsePayload, SearchStats, CoverageReport, CanonicalPaper };
