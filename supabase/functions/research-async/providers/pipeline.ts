import type { SearchSource } from "../../_shared/query-processing.ts";
import type { CoverageReport } from "../../_shared/lit-search.ts";
import { expandOpenAlexCitationGraph } from "./openalex.ts";
import { sleep, withTimeout } from "./http.ts";
import { PROVIDER_REGISTRY } from "./catalog.ts";
import type { ExpansionMode, UnifiedPaper } from "./types.ts";

const PROVIDER_TIMEOUT_MS = 8_000;
const PROVIDER_RETRIES = 2;
const RETRIEVAL_BUDGET_MS = 26_000;

export interface ProviderRunResult {
  provider: SearchSource;
  papers: UnifiedPaper[];
  failed: boolean;
  error?: string;
  latencyMs: number;
}

export interface ProviderPipelineOptions {
  query: string;
  maxCandidates: number;
  mode?: ExpansionMode;
  sourceQueryOverrides?: Partial<Record<SearchSource, string>>;
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

async function retryProviderSearch(
  provider: SearchSource,
  fn: () => Promise<UnifiedPaper[]>,
): Promise<ProviderRunResult> {
  const started = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= PROVIDER_RETRIES; attempt += 1) {
    try {
      const papers = await withTimeout(fn(), PROVIDER_TIMEOUT_MS, provider);
      return { provider, papers, failed: false, latencyMs: Date.now() - started };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < PROVIDER_RETRIES) {
        await sleep(250 * (attempt + 1));
      }
    }
  }

  return {
    provider,
    papers: [],
    failed: true,
    error: lastError?.message || `${provider} failed`,
    latencyMs: Date.now() - started,
  };
}

export async function runProviderPipeline({
  query,
  maxCandidates,
  mode = "balanced",
  sourceQueryOverrides = {},
}: ProviderPipelineOptions): Promise<ProviderPipelineResult> {
  const retrievalStartedAt = Date.now();

  const providerRuns = await Promise.all(PROVIDER_REGISTRY.map((provider) =>
    retryProviderSearch(
      provider.name,
      () => provider.search(query, mode, sourceQueryOverrides[provider.name]),
    )
  ));

  const papersByProvider = emptyProviderBuckets();
  for (const run of providerRuns) {
    papersByProvider[run.provider] = run.papers;
  }

  let candidates = providerRuns.flatMap((run) => run.papers);
  const retrievalElapsed = Date.now() - retrievalStartedAt;
  const remainingBudgetMs = RETRIEVAL_BUDGET_MS - retrievalElapsed;

  if (remainingBudgetMs > 1_000 && candidates.length < maxCandidates) {
    const expansionCap = Math.min(400, maxCandidates - candidates.length);
    if (expansionCap > 0) {
      try {
        const expansion = await withTimeout(
          expandOpenAlexCitationGraph(papersByProvider.openalex, expansionCap),
          remainingBudgetMs,
          "openalex-expansion",
        );
        candidates = [...candidates, ...expansion];
      } catch (error) {
        console.warn("[Pipeline] OpenAlex expansion skipped:", error);
      }
    }
  }

  const failedProviders = providerRuns
    .filter((run) => run.failed)
    .map((run) => run.provider);

  const coverage: CoverageReport = {
    providers_queried: providerRuns.length,
    providers_failed: failedProviders.length,
    failed_provider_names: failedProviders,
    degraded: failedProviders.length > 0,
  };

  return {
    providerRuns,
    papersByProvider,
    candidates,
    coverage,
  };
}
