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
      const response = await withTimeout(
        fetch(input, init),
        options.timeoutMs,
        `${options.label}-attempt-${attempt + 1}`,
      );

      const retryableStatus = shouldRetryStatus(response.status);
      if (!retryableStatus || attempt === maxRetries) return response;

      const delayMs = getBackoffDelay(attempt, baseDelayMs, maxDelayMs);
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
