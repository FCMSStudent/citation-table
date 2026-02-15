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
  source: "openalex" | "semantic_scholar" | "arxiv" | "pubmed"; // Track data source
  citationCount?: number; // Available from Semantic Scholar
  pdf_url?: string | null; // Open-access PDF URL
  landing_page_url?: string | null; // Publisher or S2 landing page URL
}

export interface ProviderProvenance {
  provider: "openalex" | "semantic_scholar" | "arxiv" | "pubmed" | "crossref";
  external_id: string;
  rank_signal: number;
  metadata_confidence: number;
}

export interface QualityScoreBreakdown {
  source_authority: number;
  study_design_strength: number;
  methods_transparency: number;
  citation_impact: number;
  recency_fit: number;
  q_total: number;
  hard_rejected: boolean;
  reject_reason: string | null;
}

export interface CitationAnchor {
  paper_id: string;
  section: "abstract";
  page: number | null;
  char_start: number;
  char_end: number;
  snippet_hash: string;
}

export interface ClaimSentence {
  text: string;
  citations: CitationAnchor[];
  stance: "positive" | "negative" | "neutral" | "mixed" | "conflicting";
}

export interface EvidenceRow {
  rank: number;
  paper_id: string;
  title: string;
  year: number | null;
  authors: string[];
  venue: string;
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  arxiv_id: string | null;
  abstract_snippet: string;
  proposition_label: string;
  quality: QualityScoreBreakdown;
  provenance: ProviderProvenance[];
}

export interface CoverageReport {
  providers_queried: number;
  providers_failed: number;
  failed_provider_names: string[];
  degraded: boolean;
}

export interface SearchStats {
  latency_ms: number;
  candidates_total: number;
  candidates_filtered: number;
}

export interface LiteratureSearchResponse {
  search_id: string;
  status: "running" | "completed" | "failed";
  coverage: CoverageReport;
  evidence_table: EvidenceRow[];
  brief: {
    sentences: ClaimSentence[];
  };
  stats: SearchStats;
  error?: string;
}

export interface QueryProcessingMeta {
  version: "v2";
  deterministic_confidence: number;
  used_llm_fallback: boolean;
  processing_ms: number;
  reason_codes: string[];
  source_queries: {
    semantic_scholar: string;
    openalex: string;
    pubmed: string;
    arxiv: string;
  };
}

export interface ExtractionStats {
  total_inputs: number;
  extracted_total: number;
  complete_total: number;
  partial_total: number;
  used_pdf: number;
  used_abstract_fallback: number;
  failures: number;
  fallback_reasons: Record<string, number>;
  engine: "llm" | "scripted" | "hybrid";
  llm_fallback_applied: boolean;
  latency_ms: number;
}

export interface ResearchResponse {
  results: StudyResult[];
  partial_results?: StudyResult[];
  extraction_stats?: ExtractionStats;
  query: string;
  normalized_query?: string; // Present if query was normalized
  query_processing?: QueryProcessingMeta;
  evidence_table?: EvidenceRow[];
  brief?: { sentences: ClaimSentence[] };
  coverage?: CoverageReport;
  stats?: SearchStats;
  total_papers_searched: number;
  openalex_count?: number; // Breakdown by source
  semantic_scholar_count?: number;
  arxiv_count?: number;
  pubmed_count?: number;
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

// Elicit-style narrative synthesis (new format)
export interface NarrativeSynthesisData {
  narrative: string;
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
