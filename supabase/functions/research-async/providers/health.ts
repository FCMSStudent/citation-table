import { fetchWithTimeout } from "./http.ts";
import { PROVIDER_REGISTRY } from "./catalog.ts";

export async function providerHealthSnapshot() {
  const providers = await Promise.all(PROVIDER_REGISTRY.map(async (provider) => {
    const started = Date.now();
    try {
      const response = await fetchWithTimeout(
        provider.healthUrl,
        {},
        4_000,
        `health-${provider.name}`,
      );
      return {
        provider: provider.name,
        healthy: response.ok,
        latency_ms: Date.now() - started,
        error_rate: response.ok ? 0 : 1,
        last_error: response.ok ? null : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        provider: provider.name,
        healthy: false,
        latency_ms: Date.now() - started,
        error_rate: 1,
        last_error: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  return {
    providers,
    providers_queried: providers.length,
    providers_failed: providers.filter((provider) => !provider.healthy).length,
  };
}
