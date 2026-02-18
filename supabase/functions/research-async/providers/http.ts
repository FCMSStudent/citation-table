export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs) as unknown as ReturnType<typeof setTimeout>;
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}

export class HttpStatusError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.trunc(seconds);
  const parsedDate = Date.parse(value);
  if (!Number.isFinite(parsedDate)) return null;
  const diffMs = parsedDate - Date.now();
  if (diffMs <= 0) return 0;
  return Math.trunc(diffMs / 1000);
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`${label} timed out after ${timeoutMs}ms`));
  }, timeoutMs) as unknown as ReturnType<typeof setTimeout>;

  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) forwardAbort();
    else upstreamSignal.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", forwardAbort);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchRetryOptions {
  label: string;
  timeoutMs: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetryStatus?: (status: number) => boolean;
  shouldRetryError?: (error: unknown) => boolean;
  onRetry?: (args: { attempt: number; delayMs: number; reason: string }) => void;
}

function defaultRetryStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

function defaultRetryError(_error: unknown): boolean {
  return true;
}

function getBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
}

function applyRetryAfterFloor(defaultDelayMs: number, response: Response): number {
  if (response.status !== 429) return defaultDelayMs;
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
  if (retryAfterSeconds === null) return defaultDelayMs;
  return Math.max(defaultDelayMs, retryAfterSeconds * 1000);
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options: FetchRetryOptions,
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 4;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 4_000;
  const shouldRetryStatus = options.shouldRetryStatus ?? defaultRetryStatus;
  const shouldRetryError = options.shouldRetryError ?? defaultRetryError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(
        input,
        init,
        options.timeoutMs,
        `${options.label}-attempt-${attempt + 1}`,
      );

      const retryableStatus = shouldRetryStatus(response.status);
      if (!retryableStatus || attempt === maxRetries) return response;

      const delayMs = applyRetryAfterFloor(
        getBackoffDelay(attempt, baseDelayMs, maxDelayMs),
        response,
      );
      options.onRetry?.({
        attempt: attempt + 1,
        delayMs,
        reason: `status ${response.status}`,
      });
      await sleep(delayMs);
    } catch (error) {
      const retryableError = shouldRetryError(error);
      if (!retryableError || attempt === maxRetries) throw error;

      const delayMs = getBackoffDelay(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.({
        attempt: attempt + 1,
        delayMs,
        reason: error instanceof Error ? error.message : String(error),
      });
      await sleep(delayMs);
    }
  }

  throw new Error(`${options.label} failed after retry exhaustion`);
}
