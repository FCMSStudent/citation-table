// Outcome represents a single measured outcome from a study
export interface Outcome {
  outcome_measured: string;
  key_result: string | null;
  citation_snippet: string; // Verbatim text from abstract supporting this outcome
}

// Citation information with structured identifiers
export interface Citation {
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  formatted: string | null; // APA-style formatted citation
}

export interface StudyResult {
  study_id: string;
  title: string;
  year: number;
  study_design: "RCT" | "cohort" | "cross-sectional" | "review" | "unknown";
  sample_size: number | null;
  population: string | null;
  outcomes: Outcome[]; // Changed from flat outcome_measured/key_result to array
  citation: Citation; // Changed from string to structured object
  abstract_excerpt: string;
  preprint_status: "Preprint" | "Peer-reviewed";
  review_type: "None" | "Systematic review" | "Meta-analysis";
  source: "openalex" | "semantic_scholar" | "arxiv"; // Track data source
  citationCount?: number; // Available from Semantic Scholar
}

export interface ResearchResponse {
  results: StudyResult[];
  query: string;
  normalized_query?: string; // Present if query was normalized
  total_papers_searched: number;
  openalex_count?: number; // Breakdown by source
  semantic_scholar_count?: number;
  arxiv_count?: number;
  message?: string;
  error?: string;
}

export type SortField = keyof Pick<StudyResult, 'year' | 'sample_size' | 'study_design' | 'title'>;
export type SortDirection = 'asc' | 'desc';
