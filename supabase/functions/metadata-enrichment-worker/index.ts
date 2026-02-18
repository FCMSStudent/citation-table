import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  runMetadataEnrichment,
  type EnrichmentInputPaper,
  type EnrichmentResult,
} from "../_shared/metadata-enrichment.ts";
import { MetadataEnrichmentStore, type MetadataEnrichmentJobRecord } from "../_shared/metadata-enrichment-store.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface JobPayload {
  function_name?: string;
  mode?: "offline_apply" | "offline_shadow" | "inline_apply";
  report_id?: string;
  papers?: EnrichmentInputPaper[];
}

function parsePositiveInt(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function buildEnrichedMap(results: EnrichmentResult[]): Map<string, EnrichmentInputPaper> {
  const map = new Map<string, EnrichmentInputPaper>();
  for (const item of results) {
    map.set(item.paper.id, item.paper);
  }
  return map;
}

function applyReportUpdates(
  existingResults: any[],
  enrichedMap: Map<string, EnrichmentInputPaper>,
): { updated: any[]; changed: number } {
  let changed = 0;

  const updated = existingResults.map((study) => {
    if (!study || typeof study !== "object") return study;
    const studyId = String(study.study_id || "");
    if (!studyId) return study;

    const enrichedPaper = enrichedMap.get(studyId);
    if (!enrichedPaper) return study;

    const nextStudy = { ...study };
    const citation = { ...(nextStudy.citation || {}) };

    let touched = false;

    if (enrichedPaper.doi && citation.doi !== enrichedPaper.doi) {
      citation.doi = enrichedPaper.doi;
      touched = true;
    }

    if (typeof enrichedPaper.citationCount === "number" && enrichedPaper.citationCount >= 0) {
      if (typeof nextStudy.citationCount !== "number" || enrichedPaper.citationCount > nextStudy.citationCount) {
        nextStudy.citationCount = enrichedPaper.citationCount;
        touched = true;
      }
    }

    if (enrichedPaper.journal && nextStudy.journal !== enrichedPaper.journal) {
      nextStudy.journal = enrichedPaper.journal;
      touched = true;
    }

    if (touched) {
      nextStudy.citation = citation;
      changed += 1;
    }

    return nextStudy;
  });

  return { updated, changed };
}

async function processJob(
  store: MetadataEnrichmentStore,
  job: MetadataEnrichmentJobRecord,
  sourceTrust: Record<string, number>,
  retryMax: number,
): Promise<{ changed: number }> {
  const payload = (job.payload || {}) as JobPayload;
  const reportId = payload.report_id || job.report_id || undefined;
  const papers = Array.isArray(payload.papers) ? payload.papers : [];

  if (!reportId) {
    throw new Error("job missing report_id");
  }

  if (papers.length === 0) {
    throw new Error("job missing papers");
  }

  const enrichment = await runMetadataEnrichment(papers, {
    mode: "inline_apply",
    functionName: "metadata-enrichment-worker",
    stack: "supabase_edge",
    reportId,
    searchId: job.search_id || reportId,
    userId: job.user_id || undefined,
    store,
    sourceTrust,
    retryMax,
    maxLatencyMs: Math.max(15_000, papers.length * 300),
    applyMutations: true,
  });

  const currentResults = await store.readReportResults(reportId);
  if (!currentResults) {
    throw new Error("report results not found");
  }

  const enrichedMap = buildEnrichedMap(
    enrichment.papers.map((paper, idx) => ({ paper, decision: enrichment.decisions[idx] })).filter((entry) => !!entry.paper),
  );

  const { updated, changed } = applyReportUpdates(currentResults, enrichedMap);
  if (changed > 0) {
    await store.updateReportResults(reportId, updated);
  }

  return { changed };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Supabase service credentials not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const store = new MetadataEnrichmentStore(supabase);

  const defaultBatchSize = parsePositiveInt(Deno.env.get("METADATA_ENRICHMENT_WORKER_BATCH_SIZE"), 20);
  const retryMax = parsePositiveInt(Deno.env.get("METADATA_ENRICHMENT_RETRY_MAX"), 4);

  let requestedBatchSize = defaultBatchSize;
  let requestedStack: MetadataEnrichmentJobRecord["stack"] = "supabase_edge";

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body?.batch_size !== undefined) {
      requestedBatchSize = parsePositiveInt(String(body.batch_size), defaultBatchSize);
    }
    if (body?.stack === "supabase_edge" || body?.stack === "python_api" || body?.stack === "backfill") {
      requestedStack = body.stack;
    }
  }

  const sourceTrust = await store.getSourceTrustMap();
  const jobs = await store.claimQueuedJobs(requestedStack, requestedBatchSize);

  let completed = 0;
  let failed = 0;
  let changedRows = 0;

  for (const job of jobs) {
    try {
      const { changed } = await processJob(store, job, sourceTrust, retryMax);
      changedRows += changed;
      completed += 1;
      await store.markJobCompleted(job.id);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await store.markJobRetryOrFail(job, message);
    }
  }

  return new Response(
    JSON.stringify({
      stack: requestedStack,
      claimed: jobs.length,
      completed,
      failed,
      changed_rows: changedRows,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
