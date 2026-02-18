import { getSupabase } from '@/integrations/supabase/fallback';
import type {
  ClaimSentence,
  CoverageReport,
  EvidenceRow,
  ExtractionStats,
  QueryProcessingMeta,
  SearchStats,
  StudyResult,
} from '@/shared/types/research';

export interface ReportListParams {
  limit?: number;
}

export interface Report {
  id: string;
  question: string;
  normalized_query: string | null;
  active_extraction_run_id?: string | null;
  extraction_run_count?: number | null;
  status: 'processing' | 'completed' | 'failed';
  results: StudyResult[] | null;
  partial_results?: StudyResult[] | null;
  extraction_stats?: ExtractionStats | null;
  total_papers_searched: number;
  openalex_count: number;
  semantic_scholar_count: number;
  arxiv_count: number;
  pubmed_count: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  narrative_synthesis?: string | null;
  query_processing_meta?: QueryProcessingMeta | null;
  coverage_report?: CoverageReport | null;
  evidence_table?: EvidenceRow[] | null;
  brief_json?: { sentences: ClaimSentence[] } | null;
  search_stats?: SearchStats | null;
  lit_response?: unknown;
}

export interface ReportSummary {
  id: string;
  question: string;
  status: 'processing' | 'completed' | 'failed';
  created_at: string;
  results: unknown[] | null;
}

export interface ExtractionRun {
  id: string;
  report_id: string;
  run_index: number;
  status: string;
  trigger: string;
  created_at: string;
  completed_at: string | null;
}

export const reportKeys = {
  all: ['reports'] as const,
  lists: () => ['reports', 'list'] as const,
  list: (params: ReportListParams) => ['reports', 'list', params] as const,
  detail: (reportId: string) => ['reports', 'detail', reportId] as const,
  extractionRuns: (reportId: string) => ['reports', 'extractionRuns', reportId] as const,
  studyPdfs: (reportId: string) => ['reports', 'studyPdfs', reportId] as const,
  summary: (reportId: string) => ['reports', 'summary', reportId] as const,
};

export async function fetchReports(params: ReportListParams = {}): Promise<ReportSummary[]> {
  const client = getSupabase();
  const limit = params.limit ?? 50;

  const { data, error } = await client
    .from('research_reports')
    .select('id, question, status, created_at, results')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data as unknown as ReportSummary[]) ?? [];
}

export async function fetchReport(reportId: string): Promise<Report> {
  const client = getSupabase();

  const { data, error } = await client
    .from('research_reports')
    .select('*')
    .eq('id', reportId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as unknown as Report;
}

export async function fetchExtractionRuns(reportId: string): Promise<ExtractionRun[]> {
  const client = getSupabase();

  const { data, error } = await client
    .from('extraction_runs')
    .select('id, report_id, run_index, status, trigger, created_at, completed_at')
    .eq('report_id', reportId)
    .order('run_index', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data as unknown as ExtractionRun[]) ?? [];
}

export async function fetchReportSummary(reportId: string): Promise<string | null> {
  const client = getSupabase();

  const { data, error } = await client
    .from('research_reports')
    .select('narrative_synthesis')
    .eq('id', reportId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data?.narrative_synthesis ?? null;
}

export function isReportProcessing(report: Pick<Report, 'status'> | null | undefined): boolean {
  return report?.status === 'processing';
}

export function hasProcessingReports(reports: Pick<ReportSummary, 'status'>[] | null | undefined): boolean {
  return !!reports?.some((report) => report.status === 'processing');
}
