import type { SearchSource } from "../../_shared/query-processing.ts";

export type ExpansionMode = "balanced" | "broad";

export interface PreparedSourceQuery {
  source: SearchSource;
  originalKeywordQuery: string;
  expandedKeywordQuery: string;
  apiQuery: string;
}

export interface OpenAlexWork {
  id: string;
  title: string;
  publication_year: number;
  abstract_inverted_index?: Record<string, number[]>;
  authorships?: Array<{ author: { display_name: string } }>;
  primary_location?: { source?: { display_name: string } };
  best_oa_location?: { pdf_url?: string; landing_page_url?: string };
  doi?: string;
  type?: string;
  cited_by_count?: number;
  referenced_works?: string[];
  is_retracted?: boolean;
}

export interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract: string | null;
  year: number | null;
  authors: Array<{ authorId: string; name: string }>;
  venue: string;
  citationCount: number;
  publicationTypes: string[] | null;
  externalIds: { DOI?: string; PubMed?: string };
  openAccessPdf?: { url: string } | null;
  url?: string;
  isRetracted?: boolean;
  references?: Array<{ paperId: string }>;
}

export interface UnifiedPaper {
  id: string;
  title: string;
  year: number;
  abstract: string;
  authors: string[];
  venue: string;
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  source: "openalex" | "semantic_scholar" | "arxiv" | "pubmed";
  citationCount?: number;
  publicationTypes?: string[];
  journal?: string;
  pdfUrl?: string | null;
  landingPageUrl?: string | null;
  referenced_ids?: string[];
  is_retracted?: boolean;
  preprint_status?: "Preprint" | "Peer-reviewed";
  rank_signal?: number;
}

export interface ProviderSearchResponse {
  papers: UnifiedPaper[];
  latencyMs: number;
  degraded: boolean;
  error?: string;
  retryCount?: number;
  statusCode?: number;
  retryAfterSeconds?: number | null;
}

export interface ProviderAdapter {
  name: SearchSource;
  healthUrl: string;
  search: (
    query: string,
    mode: ExpansionMode,
    precompiledQuery?: string,
    context?: {
      runtime?: {
        beforeCall: (provider: SearchSource) => Promise<void>;
        afterCall: (
          provider: SearchSource,
          result: {
            success: boolean;
            statusCode?: number;
            retryAfterSeconds?: number | null;
            retryCount?: number;
            latencyMs: number;
            error?: string;
          },
        ) => Promise<void>;
      };
      onProviderSpan?: (event: {
        provider: SearchSource;
        startedAt: string;
        endedAt: string;
        durationMs: number;
        success: boolean;
        retryCount: number;
        statusCode?: number;
        error?: string;
      }) => Promise<void>;
    },
  ) => Promise<ProviderSearchResponse>;
}

export interface ProviderQueryResult {
  papers: UnifiedPaper[];
  retryCount: number;
  statusCode?: number;
  retryAfterSeconds?: number | null;
}

export interface ProviderHttpErrorLike extends Error {
  status?: number;
  retryAfterSeconds?: number | null;
}
