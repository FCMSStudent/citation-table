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
  pipeline_id: string;
  stage: PipelineStageName;
  status: "started" | "completed" | "idempotent" | "failed";
  at: string;
  duration_ms?: number;
  error_category?: StageErrorCategory;
  message?: string;
}

export interface StageContext {
  pipelineId: string;
  stageTimeoutsMs: Partial<Record<PipelineStageName, number>>;
  idempotencyCache: Map<string, unknown>;
  emitEvent: (event: StageEvent) => void;
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

  constructor(stage: PipelineStageName, category: StageErrorCategory, message: string, retryable = false, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StageError";
    this.stage = stage;
    this.category = category;
    this.retryable = retryable;
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
    `pipeline=${event.pipeline_id}`,
    `stage=${event.stage}`,
    `status=${event.status}`,
  ];
  if (typeof event.duration_ms === "number") parts.push(`duration_ms=${event.duration_ms}`);
  if (event.error_category) parts.push(`error_category=${event.error_category}`);
  if (event.message) parts.push(`message=${event.message}`);
  console.log(parts.join(" "));
}

export function createStageContext(params: {
  pipelineId: string;
  stageTimeoutsMs?: Partial<Record<PipelineStageName, number>>;
  emitEvent?: (event: StageEvent) => void;
}): StageContext {
  return {
    pipelineId: params.pipelineId,
    stageTimeoutsMs: params.stageTimeoutsMs || {},
    idempotencyCache: new Map<string, unknown>(),
    emitEvent: params.emitEvent || defaultEmitEvent,
    now: () => Date.now(),
  };
}

export async function runStage<I, O>(stage: PipelineStage<I, O>, input: I, ctx: StageContext): Promise<O> {
  const key = idempotencyKeyFor(stage.name, input);
  const at = new Date().toISOString();

  if (ctx.idempotencyCache.has(key)) {
    ctx.emitEvent({
      pipeline_id: ctx.pipelineId,
      stage: stage.name,
      status: "idempotent",
      at,
      message: "cached_result",
    });
    return ctx.idempotencyCache.get(key) as O;
  }

  const startedAt = ctx.now();
  ctx.emitEvent({
    pipeline_id: ctx.pipelineId,
    stage: stage.name,
    status: "started",
    at,
  });

  const timeoutMs = Math.max(250, ctx.stageTimeoutsMs[stage.name] || 30_000);
  try {
    const result = await withTimeout(stage.execute(input, ctx), timeoutMs, `stage:${stage.name}`);
    ctx.idempotencyCache.set(key, result.output);
    ctx.emitEvent({
      pipeline_id: ctx.pipelineId,
      stage: stage.name,
      status: "completed",
      at: new Date().toISOString(),
      duration_ms: ctx.now() - startedAt,
    });
    return result.output;
  } catch (err) {
    const stageError = normalizeStageError(stage.name, err);
    ctx.emitEvent({
      pipeline_id: ctx.pipelineId,
      stage: stage.name,
      status: "failed",
      at: new Date().toISOString(),
      duration_ms: ctx.now() - startedAt,
      error_category: stageError.category,
      message: stageError.message,
    });
    throw stageError;
  }
}
