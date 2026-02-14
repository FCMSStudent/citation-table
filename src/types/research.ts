// Outcome represents a single measured outcome from a study
export interface Outcome {
  outcome_measured: string;
  key_result: string | null;
  citation_snippet: string; // Verbatim text from abstract supporting this outcome
  intervention: string | null;    // Treatment/exposure studied
  comparator: string | null;      // Control/comparison group
  effect_size: string | null;     // Verbatim effect size (e.g., "d = 0.45", "OR = 2.3")
  p_value: string | null;         // Verbatim p-value or CI
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
  pdf_url?: string | null; // Open-access PDF URL
  landing_page_url?: string | null; // Publisher or S2 landing page URL
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

// Structured narrative synthesis types
export interface SynthesisClaim {
  text: string;
  citations: string[]; // e.g. ["study-0", "study-3"]
  confidence: 'high' | 'moderate' | 'low';
}

export interface SynthesisSection {
  heading: string;
  claims: SynthesisClaim[];
}

export interface SynthesisWarning {
  type: 'gap' | 'quality';
  text: string;
}

export interface SynthesisData {
  sections: SynthesisSection[];
  warnings: SynthesisWarning[];
}

export type SortField = keyof Pick<StudyResult, 'year' | 'sample_size' | 'study_design' | 'title'>;
export type SortDirection = 'asc' | 'desc';

// Study PDF download status and information
export interface StudyPdf {
  id: string;
  report_id: string;
  doi: string;
  status: "pending" | "downloaded" | "not_found" | "failed";
  storage_path: string | null;
  public_url: string | null;
  created_at: string;
}
