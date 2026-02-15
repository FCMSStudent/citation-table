import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '@/integrations/supabase/fallback';
import type { CoverageReport, EvidenceRow, QueryProcessingMeta, SearchStats, StudyResult, ClaimSentence, ExtractionStats } from '@/shared/types/research';

interface Report {
  id: string;
  question: string;
  normalized_query: string | null;
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

interface UseReportReturn {
  report: Report | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useReport(reportId: string | undefined): UseReportReturn {
  const [report, setReport] = useState<Report | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    if (!reportId) return;

    try {
      const client = getSupabase();
      const { data: row, error: fetchError } = await client
        .from('research_reports')
        .select('*')
        .eq('id', reportId)
        .single();

      if (fetchError) throw new Error(fetchError.message);
      setReport(row as unknown as Report);
      setError(null);
    } catch (err) {
      console.error('Error fetching report:', err);
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setIsLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    if (!reportId || report?.status !== 'processing') return;
    const interval = setInterval(fetchReport, 3000);
    return () => clearInterval(interval);
  }, [reportId, report?.status, fetchReport]);

  return { report, isLoading, error, refetch: fetchReport };
}
