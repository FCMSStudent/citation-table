import { useState, useEffect } from 'react';
import { getSupabase } from '@/integrations/supabase/fallback';

interface ReportSummary {
  id: string;
  question: string;
  status: 'processing' | 'completed' | 'failed';
  created_at: string;
  results: unknown[] | null;
}

export function useReports() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchReports = async () => {
    try {
      const client = getSupabase();
      const { data, error } = await client
        .from('research_reports')
        .select('id, question, status, created_at, results')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setReports((data as unknown as ReportSummary[]) || []);
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    const interval = setInterval(fetchReports, 5000);
    return () => clearInterval(interval);
  }, []);

  return { reports, isLoading, refetch: fetchReports };
}
