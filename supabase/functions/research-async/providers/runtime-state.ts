import type { SearchSource } from "../../_shared/query-processing.ts";
import { sleep } from "./http.ts";
import type { SupabaseClientLike } from "../domain/models/research.ts";
import {
  getProviderRateLimitToken,
  recordProviderResult,
} from "../infrastructure/repositories/stage-orchestration-repository.ts";

export interface ProviderRuntimeConfig {
  maxAcquireWaitMs: number;
  minSleepMs: number;
  maxSleepMs: number;
}

export class ProviderRuntimeController {
  private readonly config: ProviderRuntimeConfig;

  constructor(
    private readonly supabase: SupabaseClientLike,
    config?: Partial<ProviderRuntimeConfig>,
  ) {
    this.config = {
      maxAcquireWaitMs: Math.max(1_000, Math.min(120_000, config?.maxAcquireWaitMs ?? 45_000)),
      minSleepMs: Math.max(50, Math.min(1_000, config?.minSleepMs ?? 100)),
      maxSleepMs: Math.max(200, Math.min(10_000, config?.maxSleepMs ?? 5_000)),
    };
  }

  async beforeCall(provider: SearchSource): Promise<void> {
    const startedAt = Date.now();

    while (true) {
      const acquired = await getProviderRateLimitToken(this.supabase, provider);
      if (acquired.acquired) return;

      const elapsed = Date.now() - startedAt;
      if (elapsed >= this.config.maxAcquireWaitMs) {
        throw new Error(`Provider token acquire timeout for ${provider}`);
      }

      const sleepMs = Math.max(
        this.config.minSleepMs,
        Math.min(this.config.maxSleepMs, Number(acquired.wait_ms || this.config.minSleepMs)),
      );
      await sleep(sleepMs);
    }
  }

  async afterCall(
    provider: SearchSource,
    result: {
      success: boolean;
      statusCode?: number;
      retryAfterSeconds?: number | null;
      latencyMs: number;
      error?: string;
    },
  ): Promise<void> {
    await recordProviderResult(this.supabase, {
      provider,
      success: result.success,
      status: result.statusCode,
      retryAfterSeconds: result.retryAfterSeconds ?? null,
      latencyMs: result.latencyMs,
      error: result.error || null,
    });
  }
}
