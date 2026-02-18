import type { SupabaseClientLike } from "../domain/models/research.ts";
import type { StageEvent } from "../application/stages/pipeline-runtime.ts";

export function createResearchRunEventEmitter(
  supabase: SupabaseClientLike,
  params: {
    traceId: string;
    runId: string;
    reportId?: string;
  },
): (event: StageEvent) => Promise<void> {
  return async (event: StageEvent): Promise<void> => {
    const payload = {
      trace_id: params.traceId,
      run_id: params.runId,
      report_id: params.reportId ?? null,
      stage: event.stage,
      status: event.status,
      event_type: event.event_type,
      duration: event.duration ?? null,
      duration_ms: event.duration_ms ?? event.duration ?? null,
      error_category: event.error_category ?? null,
      error_code: event.error_code ?? null,
      input_hash: event.input_hash ?? null,
      output_hash: event.output_hash ?? null,
      message: event.message ?? null,
      event_at: event.at,
    };

    const { error } = await supabase
      .from("research_run_events")
      .insert(payload);
    if (error) {
      console.warn("[research-run-events] Failed to record stage event:", error.message);
    }
  };
}
