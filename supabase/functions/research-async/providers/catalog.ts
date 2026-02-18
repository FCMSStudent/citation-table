import type { SearchSource } from "../../_shared/query-processing.ts";
import { searchArxiv } from "./arxiv.ts";
import { searchOpenAlex } from "./openalex.ts";
import { searchPubMed } from "./pubmed.ts";
import { searchSemanticScholar } from "./semantic-scholar.ts";
import type {
  ExpansionMode,
  ProviderAdapter,
  ProviderHttpErrorLike,
  ProviderQueryResult,
  ProviderSearchResponse,
} from "./types.ts";

export type ProviderSearchFn = (
  query: string,
  mode: ExpansionMode,
  precompiledQuery?: string,
) => Promise<ProviderQueryResult>;

interface ProviderDescriptor {
  name: SearchSource;
  search: ProviderSearchFn;
  healthUrl: string;
}

function toProviderAdapter(descriptor: ProviderDescriptor): ProviderAdapter {
  return {
    name: descriptor.name,
    healthUrl: descriptor.healthUrl,
    async search(
      query: string,
      mode: ExpansionMode,
      precompiledQuery?: string,
      context?: Parameters<ProviderAdapter["search"]>[3],
    ): Promise<ProviderSearchResponse> {
      const startedAt = Date.now();
      const startedIso = new Date().toISOString();
      try {
        await context?.runtime?.beforeCall(descriptor.name);
        const result = await descriptor.search(query, mode, precompiledQuery);
        const latencyMs = Date.now() - startedAt;
        await context?.runtime?.afterCall(descriptor.name, {
          success: true,
          statusCode: result.statusCode,
          retryAfterSeconds: result.retryAfterSeconds,
          retryCount: result.retryCount,
          latencyMs,
        });
        await context?.onProviderSpan?.({
          provider: descriptor.name,
          startedAt: startedIso,
          endedAt: new Date().toISOString(),
          durationMs: latencyMs,
          success: true,
          retryCount: result.retryCount || 0,
          statusCode: result.statusCode,
        });
        return {
          papers: result.papers,
          latencyMs,
          degraded: false,
          retryCount: result.retryCount,
          statusCode: result.statusCode,
          retryAfterSeconds: result.retryAfterSeconds,
        };
      } catch (error) {
        const err = error as ProviderHttpErrorLike;
        const message = error instanceof Error ? error.message : String(error);
        const latencyMs = Date.now() - startedAt;
        await context?.runtime?.afterCall(descriptor.name, {
          success: false,
          statusCode: err?.status,
          retryAfterSeconds: err?.retryAfterSeconds ?? null,
          latencyMs,
          error: message,
        }).catch((runtimeError) => {
          console.warn(`[Provider:${descriptor.name}] runtime state update failed`, runtimeError);
        });
        await context?.onProviderSpan?.({
          provider: descriptor.name,
          startedAt: startedIso,
          endedAt: new Date().toISOString(),
          durationMs: latencyMs,
          success: false,
          retryCount: 0,
          statusCode: err?.status,
          error: message,
        }).catch(() => undefined);
        console.error(`[Provider:${descriptor.name}] Search failed`, error);
        return {
          papers: [],
          latencyMs,
          degraded: true,
          error: message,
          statusCode: err?.status,
          retryAfterSeconds: err?.retryAfterSeconds ?? null,
        };
      }
    },
  };
}

export const PROVIDER_REGISTRY: readonly ProviderAdapter[] = [
  {
    name: "semantic_scholar",
    search: searchSemanticScholar,
    healthUrl: "https://api.semanticscholar.org/graph/v1/paper/search?query=health&limit=1&fields=paperId",
  },
  {
    name: "openalex",
    search: searchOpenAlex,
    healthUrl: "https://api.openalex.org/works?search=health&per-page=1",
  },
  {
    name: "arxiv",
    search: searchArxiv,
    healthUrl: "https://export.arxiv.org/api/query?search_query=all:health&max_results=1",
  },
  {
    name: "pubmed",
    search: searchPubMed,
    healthUrl: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=health&retmax=1&retmode=json",
  },
].map(toProviderAdapter);
