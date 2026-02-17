import { getMetadataEnrichmentRuntimeConfig } from "../../../_shared/metadata-enrichment.ts";
import { MetadataEnrichmentStore } from "../../../_shared/metadata-enrichment-store.ts";
import { corsHeaders, type SupabaseClientLike } from "../../domain/models/research.ts";
import {
  claimResearchJobs,
  completeResearchJob,
  failResearchJob,
  markReportFailed,
  markReportQueued,
} from "../../infrastructure/repositories/research-repository.ts";
import { processPipelineJob } from "../orchestrate-research-job.ts";

export async function maybeHandleWorkerDrainRoute(
  req: Request,
  supabase: SupabaseClientLike,
  isLitRoute: boolean,
  pathParts: string[],
): Promise<Response | null> {
  const isWorkerDrainRoute = req.method === "POST" && isLitRoute && pathParts[2] === "jobs" && pathParts[3] === "drain";
  if (!isWorkerDrainRoute) return null;

  const workerToken = Deno.env.get("RESEARCH_JOB_WORKER_TOKEN");
  const suppliedToken = req.headers.get("x-research-worker-token");
  if (!workerToken || suppliedToken !== workerToken) {
    return new Response(JSON.stringify({ error: "Unauthorized worker request" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const batchSizeRaw = Number(body?.batch_size ?? 1);
  const leaseSecondsRaw = Number(body?.lease_seconds ?? 120);
  const batchSize = Number.isFinite(batchSizeRaw) ? Math.min(25, Math.max(1, Math.trunc(batchSizeRaw))) : 1;
  const leaseSeconds = Number.isFinite(leaseSecondsRaw) ? Math.min(900, Math.max(30, Math.trunc(leaseSecondsRaw))) : 120;
  const workerId = typeof body?.worker_id === "string" && body.worker_id.trim().length > 0
    ? body.worker_id.trim()
    : `research-worker-${crypto.randomUUID()}`;

  const metadataRuntime = getMetadataEnrichmentRuntimeConfig();
  const metadataStore = new MetadataEnrichmentStore(supabase);
  const metadataSourceTrust = await metadataStore.getSourceTrustMap();

  const jobs = await claimResearchJobs(supabase, workerId, batchSize, leaseSeconds);
  let completed = 0;
  let retried = 0;
  let dead = 0;
  const failures: Array<{ job_id: string; error: string }> = [];

  for (const job of jobs) {
    try {
      await processPipelineJob(supabase, job, metadataRuntime, metadataStore, metadataSourceTrust);
      await completeResearchJob(supabase, job.id, workerId);
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      failures.push({ job_id: job.id, error: message });
      const updated = await failResearchJob(supabase, job.id, workerId, message);

      if (updated?.status === "dead") {
        dead += 1;
        await markReportFailed(supabase, job.report_id, message);
      } else {
        retried += 1;
        await markReportQueued(supabase, job.report_id, message);
      }
    }
  }

  return new Response(JSON.stringify({
    worker_id: workerId,
    claimed: jobs.length,
    completed,
    retried,
    dead,
    failures,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
