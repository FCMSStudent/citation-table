import type { SearchSource } from "../../_shared/query-processing.ts";
import { searchArxiv } from "./arxiv.ts";
import { searchOpenAlex } from "./openalex.ts";
import { searchPubMed } from "./pubmed.ts";
import { searchSemanticScholar } from "./semantic-scholar.ts";
import type { ExpansionMode, UnifiedPaper } from "./types.ts";

export type ProviderSearchFn = (
  query: string,
  mode: ExpansionMode,
  precompiledQuery?: string,
) => Promise<UnifiedPaper[]>;

export interface ProviderDescriptor {
  name: SearchSource;
  search: ProviderSearchFn;
  healthUrl: string;
}

export const PROVIDER_REGISTRY: readonly ProviderDescriptor[] = [
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
];
