import {
  hashKey,
  type ResearchJobRecord,
  type SupabaseClientLike,
} from "../../domain/models/research.ts";

export interface PipelineVersionRecord {
  id: string;
  prompt_manifest_hash: string;
  extractor_bundle_hash: string;
  config_hash: string;
  seed: number;
  config_snapshot: Record<string, unknown>;
}

export interface StageOutputRecord {
  id: string;
  report_id: string;
  stage: string;
  input_hash: string;
  output_hash: string;
  payload: Record<string, unknown>;
  pipeline_version_id: string | null;
  producer_job_id: string | null;
  created_at: string;
}

export interface ProviderAcquireResult {
  acquired: boolean;
  wait_ms: number;
  circuit_state: "closed" | "open" | "half_open";
  blocked_until: string | null;
  tokens_remaining: number;
  in_flight: number;
}

export function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

export function hashPayload(value: unknown): string {
  return hashKey(stableJson(value));
}

export async function resolvePipelineVersion(
  supabase: SupabaseClientLike,
  params: {
    promptManifestHash: string;
    extractorBundleHash: string;
    seed: number;
    configSnapshot: Record<string, unknown>;
  },
): Promise<PipelineVersionRecord> {
  const configHash = hashPayload(params.configSnapshot);
  const payload = {
    prompt_manifest_hash: params.promptManifestHash,
    extractor_bundle_hash: params.extractorBundleHash,
    config_hash: configHash,
    seed: params.seed,
    config_snapshot: params.configSnapshot,
  };

  const { data: upserted, error: upsertError } = await supabase
    .from("pipeline_versions")
    .upsert(payload, {
      onConflict: "prompt_manifest_hash,extractor_bundle_hash,config_hash,seed",
    })
    .select("id,prompt_manifest_hash,extractor_bundle_hash,config_hash,seed,config_snapshot")
    .maybeSingle();

  if (upsertError) {
    throw new Error(`Failed to upsert pipeline version: ${upsertError.message}`);
  }

  if (upserted) return upserted as PipelineVersionRecord;

  const { data, error } = await supabase
    .from("pipeline_versions")
    .select("id,prompt_manifest_hash,extractor_bundle_hash,config_hash,seed,config_snapshot")
    .eq("prompt_manifest_hash", params.promptManifestHash)
    .eq("extractor_bundle_hash", params.extractorBundleHash)
    .eq("config_hash", configHash)
    .eq("seed", params.seed)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to resolve pipeline version: ${error?.message || "missing row"}`);
  }

  return data as PipelineVersionRecord;
}

export async function loadStageOutputById(
  supabase: SupabaseClientLike,
  stageOutputId: string,
): Promise<StageOutputRecord | null> {
  const { data, error } = await supabase
    .from("research_stage_outputs")
    .select("id,report_id,stage,input_hash,output_hash,payload,pipeline_version_id,producer_job_id,created_at")
    .eq("id", stageOutputId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load stage output: ${error.message}`);
  }

  return (data as StageOutputRecord | null) || null;
}

export async function loadStageOutputByInputHash(
  supabase: SupabaseClientLike,
  reportId: string,
  stage: string,
  inputHash: string,
): Promise<StageOutputRecord | null> {
  const { data, error } = await supabase
    .from("research_stage_outputs")
    .select("id,report_id,stage,input_hash,output_hash,payload,pipeline_version_id,producer_job_id,created_at")
    .eq("report_id", reportId)
    .eq("stage", stage)
    .eq("input_hash", inputHash)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load stage output by hash: ${error.message}`);
  }

  return (data as StageOutputRecord | null) || null;
}

export async function writeImmutableStageOutput(
  supabase: SupabaseClientLike,
  params: {
    reportId: string;
    stage: string;
    inputHash: string;
    outputHash: string;
    payload: Record<string, unknown>;
    pipelineVersionId?: string | null;
    producerJobId?: string | null;
  },
): Promise<StageOutputRecord> {
  const existing = await loadStageOutputByInputHash(supabase, params.reportId, params.stage, params.inputHash);
  if (existing) return existing;

  const insertPayload = {
    report_id: params.reportId,
    stage: params.stage,
    input_hash: params.inputHash,
    output_hash: params.outputHash,
    payload: params.payload,
    pipeline_version_id: params.pipelineVersionId || null,
    producer_job_id: params.producerJobId || null,
  };

  const { error: insertError } = await supabase
    .from("research_stage_outputs")
    .insert(insertPayload);

  if (insertError && !/duplicate|unique/i.test(insertError.message)) {
    throw new Error(`Failed to insert stage output: ${insertError.message}`);
  }

  const row = await loadStageOutputByInputHash(supabase, params.reportId, params.stage, params.inputHash);
  if (!row) {
    throw new Error("Failed to resolve stage output after insert");
  }
  return row;
}

export async function emitMetricSample(
  supabase: SupabaseClientLike,
  params: {
    metricName: string;
    value: number;
    unit?: string;
    tags?: Record<string, unknown>;
    reportId?: string | null;
    runId?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("research_metrics_samples").insert({
    metric_name: params.metricName,
    metric_value: params.value,
    unit: params.unit || null,
    tags: params.tags || {},
    report_id: params.reportId || null,
    run_id: params.runId || null,
    observed_at: new Date().toISOString(),
  });

  if (error) {
    console.warn("[metrics] failed to emit sample:", error.message);
  }
}

export async function emitTraceSpan(
  supabase: SupabaseClientLike,
  params: {
    traceId: string;
    runId: string;
    reportId?: string | null;
    spanName: string;
    stage?: string | null;
    provider?: string | null;
    status: "started" | "completed" | "failed";
    retryCount?: number;
    startedAt: string;
    endedAt?: string | null;
    durationMs?: number | null;
    attributes?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("research_trace_spans").insert({
    trace_id: params.traceId,
    run_id: params.runId,
    report_id: params.reportId || null,
    span_name: params.spanName,
    stage: params.stage || null,
    provider: params.provider || null,
    status: params.status,
    retry_count: params.retryCount || 0,
    started_at: params.startedAt,
    ended_at: params.endedAt || null,
    duration_ms: params.durationMs ?? null,
    attributes: params.attributes || {},
  });

  if (error) {
    console.warn("[trace] failed to emit span:", error.message);
  }
}

export async function recordCacheEvent(
  supabase: SupabaseClientLike,
  params: {
    cacheName: "query" | "doi" | "extraction" | "canonical_record";
    eventType: "hit" | "miss" | "write" | "invalidate";
    keyHash?: string;
    reportId?: string | null;
    runId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("research_cache_events").insert({
    cache_name: params.cacheName,
    event_type: params.eventType,
    key_hash: params.keyHash || null,
    report_id: params.reportId || null,
    run_id: params.runId || null,
    metadata: params.metadata || {},
  });

  if (error) {
    console.warn("[cache-events] failed to record event:", error.message);
  }
}

export async function getProviderRateLimitToken(
  supabase: SupabaseClientLike,
  provider: string,
): Promise<ProviderAcquireResult> {
  const { data, error } = await supabase.rpc("provider_rate_limit_try_acquire", {
    p_provider: provider,
    p_tokens: 1,
  });

  if (error) {
    throw new Error(`Failed provider acquire RPC: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("Failed provider acquire RPC: empty response");
  }

  return row as ProviderAcquireResult;
}

export async function recordProviderResult(
  supabase: SupabaseClientLike,
  params: {
    provider: string;
    success: boolean;
    status?: number;
    retryAfterSeconds?: number | null;
    latencyMs?: number | null;
    error?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.rpc("provider_rate_limit_record_result", {
    p_provider: params.provider,
    p_success: params.success,
    p_status: params.status ?? null,
    p_retry_after_seconds: params.retryAfterSeconds ?? null,
    p_latency_ms: params.latencyMs ?? null,
    p_error: params.error ?? null,
  });

  if (error) {
    throw new Error(`Failed provider record RPC: ${error.message}`);
  }
}

export async function fetchDoiCache(
  supabase: SupabaseClientLike,
  normalizedDois: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const nowIso = new Date().toISOString();
  const unique = Array.from(new Set(normalizedDois.filter(Boolean)));
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from("doi_cache")
    .select("normalized_doi,payload,hit_count")
    .in("normalized_doi", unique)
    .gt("expires_at", nowIso);

  if (error) {
    console.warn("[doi-cache] read failed:", error.message);
    return new Map();
  }

  const updates = (data || []).map((row: { normalized_doi: string; hit_count?: number }) => ({
    normalized_doi: row.normalized_doi,
    hit_count: (row.hit_count || 0) + 1,
    last_hit_at: nowIso,
    updated_at: nowIso,
  }));

  if (updates.length > 0) {
    await supabase.from("doi_cache").upsert(updates, { onConflict: "normalized_doi" });
  }

  const out = new Map<string, Record<string, unknown>>();
  for (const row of data || []) {
    if (row.normalized_doi) {
      out.set(row.normalized_doi, (row.payload || {}) as Record<string, unknown>);
    }
  }
  return out;
}

export async function upsertDoiCache(
  supabase: SupabaseClientLike,
  entries: Array<{ normalizedDoi: string; payload: Record<string, unknown>; source?: string }>,
): Promise<void> {
  if (entries.length === 0) return;

  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString();
  const payload = entries.map((entry) => ({
    normalized_doi: entry.normalizedDoi,
    payload: entry.payload,
    source: entry.source || null,
    cache_version: "v1",
    expires_at: expires,
    updated_at: now.toISOString(),
  }));

  const { error } = await supabase.from("doi_cache").upsert(payload, { onConflict: "normalized_doi" });
  if (error) {
    console.warn("[doi-cache] upsert failed:", error.message);
  }
}

export async function fetchCanonicalRecordCache(
  supabase: SupabaseClientLike,
  fingerprints: string[],
): Promise<Map<string, { payload: Record<string, unknown>; payloadHash: string }>> {
  const nowIso = new Date().toISOString();
  const unique = Array.from(new Set(fingerprints.filter(Boolean)));
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from("canonical_record_cache")
    .select("fingerprint,payload,payload_hash,hit_count")
    .in("fingerprint", unique)
    .gt("expires_at", nowIso);

  if (error) {
    console.warn("[canonical-cache] read failed:", error.message);
    return new Map();
  }

  const nowIsoTs = new Date().toISOString();
  const updates = (data || []).map((row: { fingerprint: string; hit_count?: number }) => ({
    fingerprint: row.fingerprint,
    hit_count: (row.hit_count || 0) + 1,
    last_hit_at: nowIsoTs,
    updated_at: nowIsoTs,
  }));
  if (updates.length > 0) {
    await supabase.from("canonical_record_cache").upsert(updates, { onConflict: "fingerprint" });
  }

  const out = new Map<string, { payload: Record<string, unknown>; payloadHash: string }>();
  for (const row of data || []) {
    out.set(String(row.fingerprint), {
      payload: (row.payload || {}) as Record<string, unknown>,
      payloadHash: String(row.payload_hash || ""),
    });
  }
  return out;
}

export async function upsertCanonicalRecordCache(
  supabase: SupabaseClientLike,
  entries: Array<{ fingerprint: string; payload: Record<string, unknown> }>,
): Promise<void> {
  if (entries.length === 0) return;

  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60_000).toISOString();
  const payload = entries.map((entry) => ({
    fingerprint: entry.fingerprint,
    payload: entry.payload,
    payload_hash: hashPayload(entry.payload),
    cache_version: "v1",
    expires_at: expires,
    updated_at: now.toISOString(),
  }));

  const { error } = await supabase
    .from("canonical_record_cache")
    .upsert(payload, { onConflict: "fingerprint" });

  if (error) {
    console.warn("[canonical-cache] upsert failed:", error.message);
  }
}

export interface ExtractionCacheEntry {
  cacheKey: string;
  studyId: string;
  extractorVersion: string;
  promptHash: string;
  model: string;
  outputPayload: Record<string, unknown>;
  outputHash: string;
}

export function extractionCacheKey(parts: {
  studyId: string;
  extractorVersion: string;
  promptHash: string;
  model: string;
}): string {
  return hashPayload(parts);
}

export async function fetchExtractionCacheByKeys(
  supabase: SupabaseClientLike,
  keys: string[],
): Promise<Map<string, ExtractionCacheEntry>> {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  if (uniqueKeys.length === 0) return new Map();

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("extraction_cache")
    .select("cache_key,study_id,extractor_version,prompt_hash,model,output_payload,output_hash,hit_count,expires_at")
    .in("cache_key", uniqueKeys);

  if (error) {
    console.warn("[extraction-cache] read failed:", error.message);
    return new Map();
  }

  const filtered = (data || []).filter((row: { expires_at?: string | null }) => {
    if (!row.expires_at) return true;
    return row.expires_at > nowIso;
  });

  const updates = filtered.map((row: { cache_key: string; hit_count?: number }) => ({
    cache_key: row.cache_key,
    hit_count: (row.hit_count || 0) + 1,
    last_hit_at: nowIso,
    updated_at: nowIso,
  }));

  if (updates.length > 0) {
    await supabase.from("extraction_cache").upsert(updates, { onConflict: "cache_key" });
  }

  const out = new Map<string, ExtractionCacheEntry>();
  for (const row of filtered) {
    out.set(String(row.cache_key), {
      cacheKey: String(row.cache_key),
      studyId: String(row.study_id),
      extractorVersion: String(row.extractor_version),
      promptHash: String(row.prompt_hash),
      model: String(row.model),
      outputPayload: (row.output_payload || {}) as Record<string, unknown>,
      outputHash: String(row.output_hash || ""),
    });
  }
  return out;
}

export async function upsertExtractionCache(
  supabase: SupabaseClientLike,
  entries: ExtractionCacheEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  const nowIso = new Date().toISOString();
  const payload = entries.map((entry) => ({
    cache_key: entry.cacheKey,
    study_id: entry.studyId,
    extractor_version: entry.extractorVersion,
    prompt_hash: entry.promptHash,
    model: entry.model,
    output_payload: entry.outputPayload,
    output_hash: entry.outputHash,
    cache_version: "v1",
    expires_at: null,
    updated_at: nowIso,
  }));

  const { error } = await supabase
    .from("extraction_cache")
    .upsert(payload, {
      onConflict: "cache_key",
    });

  if (error) {
    console.warn("[extraction-cache] upsert failed:", error.message);
  }
}

export async function recordQueueDepthMetrics(
  supabase: SupabaseClientLike,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("research_jobs")
    .select("stage,status,next_run_at")
    .in("status", ["queued", "leased"])
    .limit(5000);

  if (error) {
    console.warn("[queue-metrics] failed to read queue rows:", error.message);
    return;
  }

  const rows = Array.isArray(data) ? data as Array<{ stage: string; status: string; next_run_at: string | null }> : [];
  const depthByStage = new Map<string, number>();
  let oldestAgeSec = 0;

  for (const row of rows) {
    depthByStage.set(row.stage, (depthByStage.get(row.stage) || 0) + 1);
    if (row.next_run_at) {
      const ageSec = Math.max(0, Math.trunc((Date.now() - new Date(row.next_run_at).getTime()) / 1000));
      oldestAgeSec = Math.max(oldestAgeSec, ageSec);
    }
  }

  const metricsPayload = [
    {
      metric_name: "queue_depth",
      metric_value: rows.length,
      unit: "jobs",
      tags: { scope: "global" },
      observed_at: nowIso,
    },
    {
      metric_name: "queue_oldest_age_seconds",
      metric_value: oldestAgeSec,
      unit: "seconds",
      tags: { scope: "global" },
      observed_at: nowIso,
    },
    ...Array.from(depthByStage.entries()).map(([stage, depth]) => ({
      metric_name: "queue_depth",
      metric_value: depth,
      unit: "jobs",
      tags: { stage },
      observed_at: nowIso,
    })),
  ];

  await supabase.from("research_metrics_samples").insert(metricsPayload).then(() => undefined).catch(() => undefined);
}

export async function markReportPipelineVersion(
  supabase: SupabaseClientLike,
  reportId: string,
  pipelineVersionId: string,
): Promise<void> {
  await supabase
    .from("research_reports")
    .update({ pipeline_version: pipelineVersionId })
    .eq("id", reportId);
}

export function stageSpanName(stage: string): string {
  return `stage:${stage}`;
}

export function providerSpanName(provider: string): string {
  return `provider:${provider}`;
}

export function buildStageInputHash(
  stage: string,
  payload: Record<string, unknown>,
): string {
  return hashPayload({ stage, payload });
}

export function buildStageOutputHash(
  stage: string,
  output: unknown,
): string {
  return hashPayload({ stage, output });
}

export function parseJobPayload(job: ResearchJobRecord): Record<string, unknown> {
  return (job.payload || {}) as Record<string, unknown>;
}
