import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '@/integrations/supabase/fallback';
import type { CoverageReport, EvidenceRow, QueryProcessingMeta, SearchStats, StudyResult, ClaimSentence, ExtractionStats } from '@/shared/types/research';

interface Report {
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

interface UseReportReturn {
  report: Report | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const POLL_INTERVAL_MS = 3000;
const CLIENT_TIMEOUT_MS = 10 * 60 * 1000;
const CLIENT_TIMEOUT_MESSAGE = 'Search timed out after 10 minutes. Please retry.';

function applyClientTimeout(report: Report): Report {
  if (report.status !== 'processing') {
    return report;
  }

  const elapsedMs = Date.now() - new Date(report.created_at).getTime();
  if (elapsedMs < CLIENT_TIMEOUT_MS) {
    return report;
  }

  return {
    ...report,
    status: 'failed',
    error_message: CLIENT_TIMEOUT_MESSAGE,
  };
}

export function useReport(reportId: string | undefined): UseReportReturn {
  const [report, setReport] = useState<Report | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeoutOverrideUntil, setTimeoutOverrideUntil] = useState<number | null>(null);

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
      const rawReport = row as unknown as Report;
      const canBypassTimeout = timeoutOverrideUntil !== null && Date.now() < timeoutOverrideUntil;
      const nextReport = canBypassTimeout ? rawReport : applyClientTimeout(rawReport);
      setReport(nextReport);

      if (rawReport.status !== 'processing' && timeoutOverrideUntil !== null) {
        setTimeoutOverrideUntil(null);
      }
      setError(null);
    } catch (err) {
      console.error('Error fetching report:', err);
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setIsLoading(false);
    }
  }, [reportId, timeoutOverrideUntil]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    if (!reportId || report?.status !== 'processing') return;
    const interval = setInterval(fetchReport, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [reportId, report?.status, fetchReport]);

  const refetch = useCallback(() => {
    if (report?.status === 'failed' && report.error_message === CLIENT_TIMEOUT_MESSAGE) {
      setTimeoutOverrideUntil(Date.now() + CLIENT_TIMEOUT_MS);
    }
    void fetchReport();
  }, [report?.status, report?.error_message, fetchReport]);

  return { report, isLoading, error, refetch };
}
