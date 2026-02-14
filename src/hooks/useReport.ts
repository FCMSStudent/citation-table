import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { StudyResult } from '@/types/research';

interface Report {
  id: string;
  question: string;
  normalized_query: string | null;
  status: 'processing' | 'completed' | 'failed';
  results: StudyResult[] | null;
  total_papers_searched: number;
  openalex_count: number;
  semantic_scholar_count: number;
  arxiv_count: number;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface UseReportReturn {
  report: Report | null;
  isLoading: boolean;
  error: string | null;
}

export function useReport(reportId: string | undefined): UseReportReturn {
  const [report, setReport] = useState<Report | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    if (!reportId || !supabase) return;

    try {
      const { data: row, error: fetchError } = await supabase
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

  return { report, isLoading, error };
}
