import type { QueryProcessingMeta } from "../../_shared/query-processing.ts";
import type { QueryPipelineMode, SupabaseClientLike } from "../domain/models/research.ts";

export async function recordQueryProcessingEvent(
  supabase: SupabaseClientLike,
  params: {
    functionName: string;
    mode: QueryPipelineMode;
    reportId?: string;
    originalQuery: string;
    servedQuery: string;
    normalizedQuery?: string;
    queryProcessing?: QueryProcessingMeta;
    userId?: string;
  },
): Promise<void> {
  if (!params.queryProcessing) return;

  const payload = {
    function_name: params.functionName,
    mode: params.mode,
    user_id: params.userId ?? null,
    report_id: params.reportId ?? null,
    original_query: params.originalQuery,
    served_query: params.servedQuery,
    normalized_query: params.normalizedQuery ?? null,
    deterministic_confidence: params.queryProcessing.deterministic_confidence,
    used_llm_fallback: params.queryProcessing.used_llm_fallback,
    processing_ms: params.queryProcessing.processing_ms,
    reason_codes: params.queryProcessing.reason_codes,
    source_queries: params.queryProcessing.source_queries,
  };

  const { error } = await supabase.from("query_processing_events").insert(payload);
  if (error) {
    console.warn("[query-processing] Failed to record event:", error.message);
  }
}
