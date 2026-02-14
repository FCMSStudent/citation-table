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
    if (!reportId) return;

    try {
      let data: Report | null = null;

      if (supabase) {
        const { data: row, error: fetchError } = await supabase
          .from('research_reports')
          .select('*')
          .eq('id', reportId)
          .single();

        if (fetchError) throw new Error(fetchError.message);
        data = row as unknown as Report;
      } else {
        // Fallback: direct REST call
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://amzlrrrhjsqjndbrdume.supabase.co';
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtemxycnJoanNxam5kYnJkdW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTQ1NDIsImV4cCI6MjA4NTk5MDU0Mn0.UbmXG7RfWAQjNX9HTkCp50m_wwSFB4P40gfuqCA-f2c';
        const res = await fetch(`${supabaseUrl}/rest/v1/research_reports?id=eq.${reportId}&select=*`, {
          headers: {
            'apikey': anonKey,
            'Authorization': `Bearer ${anonKey}`,
          },
        });
        if (!res.ok) throw new Error('Failed to fetch report');
        const rows = await res.json();
        data = rows[0] || null;
      }

      if (!data) {
        setError('Report not found');
        return;
      }

      setReport(data);
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

  // Poll while processing
  useEffect(() => {
    if (!reportId || report?.status !== 'processing') return;

    const interval = setInterval(fetchReport, 3000);
    return () => clearInterval(interval);
  }, [reportId, report?.status, fetchReport]);

  return { report, isLoading, error };
}
