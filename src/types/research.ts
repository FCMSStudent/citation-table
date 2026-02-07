export interface StudyResult {
  study_id: string;
  title: string;
  year: number;
  study_design: "RCT" | "cohort" | "cross-sectional" | "review" | "unknown";
  sample_size: number | null;
  population: string | null;
  outcome_measured: string;
  key_result: string | null;
  citation: string;
  abstract_excerpt: string;
}

export interface ResearchResponse {
  results: StudyResult[];
  query: string;
  total_papers_searched: number;
  message?: string;
  error?: string;
}

export type SortField = keyof Pick<StudyResult, 'year' | 'sample_size' | 'study_design' | 'title'>;
export type SortDirection = 'asc' | 'desc';
