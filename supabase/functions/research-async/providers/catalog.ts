import type { SearchSource } from "../../_shared/query-processing.ts";
import { searchArxiv } from "./arxiv.ts";
import { searchOpenAlex } from "./openalex.ts";
import { searchPubMed } from "./pubmed.ts";
import { searchSemanticScholar } from "./semantic-scholar.ts";
import type { ExpansionMode, ProviderAdapter, ProviderSearchResponse, UnifiedPaper } from "./types.ts";

export type ProviderSearchFn = (
  query: string,
  mode: ExpansionMode,
  precompiledQuery?: string,
) => Promise<UnifiedPaper[]>;

interface ProviderDescriptor {
  name: SearchSource;
  search: ProviderSearchFn;
  healthUrl: string;
}

function toProviderAdapter(descriptor: ProviderDescriptor): ProviderAdapter {
  return {
    name: descriptor.name,
    healthUrl: descriptor.healthUrl,
    async search(query: string, mode: ExpansionMode, precompiledQuery?: string): Promise<ProviderSearchResponse> {
      const startedAt = Date.now();
      try {
        const papers = await descriptor.search(query, mode, precompiledQuery);
        return {
          papers,
          latencyMs: Date.now() - startedAt,
          degraded: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Provider:${descriptor.name}] Search failed`, error);
        return {
          papers: [],
          latencyMs: Date.now() - startedAt,
          degraded: true,
          error: message,
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
