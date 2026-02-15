export type MetadataEnrichmentMode = "offline_shadow" | "offline_apply" | "inline_apply";

export type MetadataEnrichmentOutcome = "accepted" | "deferred" | "rejected" | "not_found" | "error";

export interface MetadataEnrichmentCacheRecord {
  id?: string;
  lookup_key: string;
  lookup_kind: "doi" | "title";
  doi_norm?: string | null;
  title_fingerprint?: string | null;
  resolved_metadata: Record<string, unknown>;
  provider_payloads: Record<string, unknown>;
  confidence?: number | null;
  status: MetadataEnrichmentOutcome;
  reason_codes: string[];
  fetched_at?: string;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
}

export interface MetadataEnrichmentEventInput {
  stack: "supabase_edge" | "python_api" | "backfill";
  function_name: string;
  mode: MetadataEnrichmentMode;
  report_id?: string | null;
  search_id?: string | null;
  paper_id?: string | null;
  lookup_key?: string | null;
  providers_attempted?: string[];
  provider_statuses?: Record<string, unknown>;
  outcome: MetadataEnrichmentOutcome;
  confidence?: number | null;
  reason_codes?: string[];
  fields_applied?: Record<string, unknown>;
  latency_ms?: number | null;
  used_cache?: boolean;
  user_id?: string | null;
}

export interface MetadataEnrichmentJobInput {
  stack: "supabase_edge" | "python_api" | "backfill";
  report_id?: string | null;
  search_id?: string | null;
  user_id?: string | null;
  payload: Record<string, unknown>;
  max_attempts?: number;
  next_run_at?: string;
}

export interface MetadataEnrichmentJobRecord {
  id: string;
  stack: "supabase_edge" | "python_api" | "backfill";
  status: "queued" | "processing" | "completed" | "failed";
  report_id: string | null;
  search_id: string | null;
  user_id: string | null;
  payload: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  next_run_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}

const DEFAULT_SOURCE_TRUST: Record<string, number> = {
  pubmed: 0.98,
  openalex: 0.92,
  semantic_scholar: 0.9,
  crossref: 0.89,
  arxiv: 0.84,
  unknown: 0.5,
};

function backoffDelayMs(attemptCount: number): number {
  const capped = Math.max(1, Math.min(attemptCount, 7));
  return Math.min(60_000, 1_000 * (2 ** (capped - 1)));
}

export class MetadataEnrichmentStore {
  constructor(private readonly client: any) {}

  async getSourceTrustMap(): Promise<Record<string, number>> {
    const { data, error } = await this.client
      .from("dedup_source_priority")
      .select("source,trust_score");

    if (error || !Array.isArray(data)) {
      if (error) console.warn("[metadata-enrichment] source trust read failed:", error.message);
      return { ...DEFAULT_SOURCE_TRUST };
    }

    const merged = { ...DEFAULT_SOURCE_TRUST };
    for (const row of data) {
      const source = String(row.source || "unknown").toLowerCase();
      const trust = Number(row.trust_score);
      if (!Number.isNaN(trust)) merged[source] = trust;
    }
    return merged;
  }

  async getCacheByLookupKey(lookupKey: string): Promise<MetadataEnrichmentCacheRecord | null> {
    const { data, error } = await this.client
      .from("metadata_enrichment_cache")
      .select("*")
      .eq("lookup_key", lookupKey)
      .maybeSingle();

    if (error) {
      console.warn("[metadata-enrichment] cache read failed:", error.message);
      return null;
    }

    return data ?? null;
  }

  async upsertCache(record: MetadataEnrichmentCacheRecord): Promise<void> {
    const payload = {
      lookup_key: record.lookup_key,
      lookup_kind: record.lookup_kind,
      doi_norm: record.doi_norm ?? null,
      title_fingerprint: record.title_fingerprint ?? null,
      resolved_metadata: record.resolved_metadata ?? {},
      provider_payloads: record.provider_payloads ?? {},
      confidence: record.confidence ?? null,
      status: record.status,
      reason_codes: record.reason_codes ?? [],
      fetched_at: record.fetched_at ?? new Date().toISOString(),
      expires_at: record.expires_at,
    };

    const { error } = await this.client
      .from("metadata_enrichment_cache")
      .upsert(payload, { onConflict: "lookup_key" });

    if (error) {
      console.warn("[metadata-enrichment] cache upsert failed:", error.message);
    }
  }

  async insertEvent(event: MetadataEnrichmentEventInput): Promise<void> {
    const payload = {
      stack: event.stack,
      function_name: event.function_name,
      mode: event.mode,
      report_id: event.report_id ?? null,
      search_id: event.search_id ?? null,
      paper_id: event.paper_id ?? null,
      lookup_key: event.lookup_key ?? null,
      providers_attempted: event.providers_attempted ?? [],
      provider_statuses: event.provider_statuses ?? {},
      outcome: event.outcome,
      confidence: event.confidence ?? null,
      reason_codes: event.reason_codes ?? [],
      fields_applied: event.fields_applied ?? {},
      latency_ms: event.latency_ms ?? null,
      used_cache: event.used_cache ?? false,
      user_id: event.user_id ?? null,
    };

    const { error } = await this.client.from("metadata_enrichment_events").insert(payload);
    if (error) {
      console.warn("[metadata-enrichment] event insert failed:", error.message);
    }
  }

  async enqueueJob(job: MetadataEnrichmentJobInput): Promise<void> {
    const payload = {
      stack: job.stack,
      status: "queued",
      report_id: job.report_id ?? null,
      search_id: job.search_id ?? null,
      user_id: job.user_id ?? null,
      payload: job.payload,
      max_attempts: job.max_attempts ?? 5,
      next_run_at: job.next_run_at ?? new Date().toISOString(),
    };

    const { error } = await this.client.from("metadata_enrichment_jobs").insert(payload);
    if (error) {
      console.warn("[metadata-enrichment] enqueue failed:", error.message);
    }
  }

  async claimQueuedJobs(stack: MetadataEnrichmentJobRecord["stack"], batchSize: number): Promise<MetadataEnrichmentJobRecord[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from("metadata_enrichment_jobs")
      .select("*")
      .eq("stack", stack)
      .eq("status", "queued")
      .lte("next_run_at", nowIso)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (error || !Array.isArray(data)) {
      if (error) console.warn("[metadata-enrichment] claim read failed:", error.message);
      return [];
    }

    const claimed: MetadataEnrichmentJobRecord[] = [];

    for (const row of data) {
      const nextAttempt = Number(row.attempt_count || 0) + 1;
      const { data: picked, error: claimError } = await this.client
        .from("metadata_enrichment_jobs")
        .update({
          status: "processing",
          attempt_count: nextAttempt,
          started_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id)
        .eq("status", "queued")
        .select("*")
        .maybeSingle();

      if (claimError || !picked) {
        continue;
      }
      claimed.push(picked as MetadataEnrichmentJobRecord);
    }

    return claimed;
  }

  async markJobCompleted(jobId: string): Promise<void> {
    const { error } = await this.client
      .from("metadata_enrichment_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", jobId)
      .eq("status", "processing");

    if (error) {
      console.warn("[metadata-enrichment] complete failed:", error.message);
    }
  }

  async markJobRetryOrFail(job: MetadataEnrichmentJobRecord, lastError: string): Promise<void> {
    const exhausted = job.attempt_count >= job.max_attempts;
    if (exhausted) {
      const { error } = await this.client
        .from("metadata_enrichment_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          last_error: lastError,
        })
        .eq("id", job.id)
        .eq("status", "processing");
      if (error) {
        console.warn("[metadata-enrichment] fail-mark failed:", error.message);
      }
      return;
    }

    const nextRunAt = new Date(Date.now() + backoffDelayMs(job.attempt_count)).toISOString();
    const { error } = await this.client
      .from("metadata_enrichment_jobs")
      .update({
        status: "queued",
        next_run_at: nextRunAt,
        last_error: lastError,
      })
      .eq("id", job.id)
      .eq("status", "processing");

    if (error) {
      console.warn("[metadata-enrichment] retry-mark failed:", error.message);
    }
  }

  async readReportResults(reportId: string): Promise<any[] | null> {
    const { data, error } = await this.client
      .from("research_reports")
      .select("results")
      .eq("id", reportId)
      .maybeSingle();

    if (error) {
      console.warn("[metadata-enrichment] report read failed:", error.message);
      return null;
    }

    return Array.isArray(data?.results) ? data.results : [];
  }

  async updateReportResults(reportId: string, results: any[]): Promise<void> {
    const { error } = await this.client
      .from("research_reports")
      .update({ results })
      .eq("id", reportId);

    if (error) {
      console.warn("[metadata-enrichment] report update failed:", error.message);
    }
  }
}
