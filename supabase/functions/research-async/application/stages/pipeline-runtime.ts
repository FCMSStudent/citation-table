import { hashKey } from "../../domain/models/research.ts";
import { withTimeout } from "../../providers/index.ts";

export type PipelineStageName =
  | "VALIDATE"
  | "PREPARE_QUERY"
  | "RETRIEVE_PROVIDERS"
  | "CANONICALIZE"
  | "QUALITY_FILTER"
  | "DETERMINISTIC_EXTRACT"
  | "LLM_AUGMENT"
  | "PERSIST";

export type StageErrorCategory = "VALIDATION" | "TIMEOUT" | "EXTERNAL" | "TRANSIENT" | "INTERNAL";

export interface StageEvent {
  trace_id: string;
  run_id: string;
  stage: PipelineStageName;
  status: "started" | "completed" | "idempotent" | "failed";
  event_type: "START" | "SUCCESS" | "FAILURE" | "IDEMPOTENT";
  at: string;
  duration?: number;
  duration_ms?: number;
  error_category?: StageErrorCategory;
  error_code?: string;
  message?: string;
  input_hash?: string;
  output_hash?: string;
}

export interface StageContext {
  traceId: string;
  runId: string;
  stageTimeoutsMs: Partial<Record<PipelineStageName, number>>;
  idempotencyCache: Map<string, unknown>;
  emitEvent: (event: StageEvent) => Promise<void> | void;
  now: () => number;
}

export interface StageResult<O> {
  output: O;
  metadata?: Record<string, unknown>;
}

export interface PipelineStage<I, O> {
  name: PipelineStageName;
  execute(input: I, ctx: StageContext): Promise<StageResult<O>>;
}

export class StageError extends Error {
  readonly stage: PipelineStageName;
  readonly category: StageErrorCategory;
  readonly retryable: boolean;

  readonly cause?: unknown;

  constructor(stage: PipelineStageName, category: StageErrorCategory, message: string, retryable = false, options?: { cause?: unknown }) {
    super(message);
    this.name = "StageError";
    this.stage = stage;
    this.category = category;
    this.retryable = retryable;
    this.cause = options?.cause;
  }
}

function toSafeError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown stage error");
}

function normalizeStageError(stage: PipelineStageName, err: unknown): StageError {
  if (err instanceof StageError) return err;
  const base = toSafeError(err);
  const msg = base.message.toLowerCase();
  if (msg.includes("timed out")) return new StageError(stage, "TIMEOUT", base.message, true, { cause: err });
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("temporar")) {
    return new StageError(stage, "TRANSIENT", base.message, true, { cause: err });
  }
  if (msg.includes("invalid") || msg.includes("missing") || msg.includes("required")) {
    return new StageError(stage, "VALIDATION", base.message, false, { cause: err });
  }
  if (msg.includes("fetch") || msg.includes("network") || msg.includes("provider") || msg.includes("db") || msg.includes("supabase")) {
    return new StageError(stage, "EXTERNAL", base.message, true, { cause: err });
  }
  return new StageError(stage, "INTERNAL", base.message, false, { cause: err });
}

function idempotencyKeyFor(stage: PipelineStageName, input: unknown): string {
  return `${stage}:${hashKey(JSON.stringify(input))}`;
}

function defaultEmitEvent(event: StageEvent): void {
  const parts = [
    "[PipelineStage]",
    `trace_id=${event.trace_id}`,
    `run_id=${event.run_id}`,
    `stage=${event.stage}`,
    `event_type=${event.event_type}`,
  ];
  if (typeof event.duration === "number") parts.push(`duration=${event.duration}`);
  if (event.error_category) parts.push(`error_category=${event.error_category}`);
  if (event.message) parts.push(`message=${event.message}`);
  console.log(parts.join(" "));
}

export function createStageContext(params: {
  traceId?: string;
  runId?: string;
  stageTimeoutsMs?: Partial<Record<PipelineStageName, number>>;
  emitEvent?: (event: StageEvent) => Promise<void> | void;
}): StageContext {
  return {
    traceId: params.traceId || crypto.randomUUID(),
    runId: params.runId || crypto.randomUUID(),
    stageTimeoutsMs: params.stageTimeoutsMs || {},
    idempotencyCache: new Map<string, unknown>(),
    emitEvent: params.emitEvent || defaultEmitEvent,
    now: () => Date.now(),
  };
}

export async function runStage<I, O>(stage: PipelineStage<I, O>, input: I, ctx: StageContext): Promise<O> {
  const key = idempotencyKeyFor(stage.name, input);
  const inputHash = key.split(":")[1] || "";
  const at = new Date().toISOString();

  if (ctx.idempotencyCache.has(key)) {
    await ctx.emitEvent({
      trace_id: ctx.traceId,
      run_id: ctx.runId,
      stage: stage.name,
      status: "idempotent",
      event_type: "IDEMPOTENT",
      at,
      input_hash: inputHash,
      message: "cached_result",
    });
    return ctx.idempotencyCache.get(key) as O;
  }

  const startedAt = ctx.now();
  await ctx.emitEvent({
    trace_id: ctx.traceId,
    run_id: ctx.runId,
    stage: stage.name,
    status: "started",
    event_type: "START",
    at,
    input_hash: inputHash,
  });

  const timeoutMs = Math.max(250, ctx.stageTimeoutsMs[stage.name] || 30_000);
  try {
    const result = await withTimeout(stage.execute(input, ctx), timeoutMs, `stage:${stage.name}`);
    ctx.idempotencyCache.set(key, result.output);
    const durationMs = ctx.now() - startedAt;
    const outputHash = hashKey(JSON.stringify(result.output)).slice(0, 12);
    await ctx.emitEvent({
      trace_id: ctx.traceId,
      run_id: ctx.runId,
      stage: stage.name,
      status: "completed",
      event_type: "SUCCESS",
      at: new Date().toISOString(),
      duration: durationMs,
      duration_ms: durationMs,
      input_hash: inputHash,
      output_hash: outputHash,
    });
    return result.output;
  } catch (err) {
    const stageError = normalizeStageError(stage.name, err);
    const durationMs = ctx.now() - startedAt;
    await ctx.emitEvent({
      trace_id: ctx.traceId,
      run_id: ctx.runId,
      stage: stage.name,
      status: "failed",
      event_type: "FAILURE",
      at: new Date().toISOString(),
      duration: durationMs,
      duration_ms: durationMs,
      error_category: stageError.category,
      error_code: `${stageError.category}:${stage.name}`,
      message: stageError.message,
      input_hash: inputHash,
    });
    throw stageError;
  }
}
