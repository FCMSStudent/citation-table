import type { SearchSource } from "../../_shared/query-processing.ts";
import type { CoverageReport } from "../../_shared/lit-search.ts";
import { expandOpenAlexCitationGraph } from "./openalex.ts";
import { PROVIDER_REGISTRY } from "./catalog.ts";
import type { ExpansionMode, UnifiedPaper } from "./types.ts";

const RETRIEVAL_BUDGET_MS = 26_000;

export interface ProviderRunResult {
  provider: SearchSource;
  papers: UnifiedPaper[];
  failed: boolean;
  degraded: boolean;
  error?: string;
  latencyMs: number;
  retryCount: number;
  statusCode?: number;
  retryAfterSeconds?: number | null;
}

export interface ProviderPipelineOptions {
  query: string;
  maxCandidates: number;
  mode?: ExpansionMode;
  sourceQueryOverrides?: Partial<Record<SearchSource, string>>;
  providers?: SearchSource[];
  providerExecution?: Parameters<(typeof PROVIDER_REGISTRY)[number]["search"]>[3];
}

export interface ProviderPipelineResult {
  providerRuns: ProviderRunResult[];
  papersByProvider: Record<SearchSource, UnifiedPaper[]>;
  candidates: UnifiedPaper[];
  coverage: CoverageReport;
}

function emptyProviderBuckets(): Record<SearchSource, UnifiedPaper[]> {
  return {
    semantic_scholar: [],
    openalex: [],
    arxiv: [],
    pubmed: [],
  };
}

export async function runProviderPipeline({
  query,
  maxCandidates,
  mode = "balanced",
  sourceQueryOverrides = {},
  providers,
  providerExecution,
}: ProviderPipelineOptions): Promise<ProviderPipelineResult> {
  const retrievalStartedAt = Date.now();
  const selectedProviders = Array.isArray(providers) && providers.length > 0
    ? PROVIDER_REGISTRY.filter((provider) => providers.includes(provider.name))
    : PROVIDER_REGISTRY;

  const providerRuns = await Promise.all(selectedProviders.map((provider) =>
    provider.search(query, mode, sourceQueryOverrides[provider.name], providerExecution).then((response) => {
      console.log(
        `[Provider:${provider.name}] latency=${response.latencyMs}ms papers=${response.papers.length} degraded=${response.degraded} retries=${response.retryCount || 0}${response.error ? ` error=${response.error}` : ""}`,
      );
      return {
        provider: provider.name,
        papers: response.papers,
        failed: response.degraded,
        degraded: response.degraded,
        error: response.error,
        latencyMs: response.latencyMs,
        retryCount: response.retryCount || 0,
        statusCode: response.statusCode,
        retryAfterSeconds: response.retryAfterSeconds ?? null,
      };
    })
  ));

  const papersByProvider = emptyProviderBuckets();
  for (const run of providerRuns) {
    papersByProvider[run.provider] = run.papers;
  }

  let candidates = providerRuns.flatMap((run) => run.papers);
  const retrievalElapsed = Date.now() - retrievalStartedAt;
  const remainingBudgetMs = RETRIEVAL_BUDGET_MS - retrievalElapsed;
  let expansionDegraded = false;

  if (remainingBudgetMs > 1_000 && candidates.length < maxCandidates) {
    const expansionCap = Math.min(400, maxCandidates - candidates.length);
    if (expansionCap > 0) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remainingBudgetMs);
      try {
        const expansion = await expandOpenAlexCitationGraph(
          papersByProvider.openalex,
          expansionCap,
          controller.signal,
        );
        candidates = [...candidates, ...expansion];
      } catch (error) {
        expansionDegraded = true;
        console.error("[Pipeline] OpenAlex expansion failed:", error);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  const failedProviders = providerRuns
    .filter((run) => run.failed)
    .map((run) => run.provider);

  const coverage: CoverageReport = {
    providers_queried: selectedProviders.length,
    providers_failed: failedProviders.length,
    failed_provider_names: failedProviders,
    degraded: failedProviders.length > 0 || expansionDegraded,
  };

  return {
    providerRuns,
    papersByProvider,
    candidates,
    coverage,
  };
}
