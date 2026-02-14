import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
      if (supabase) {
        const { data, error } = await supabase
          .from('research_reports')
          .select('id, question, status, created_at, results')
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        setReports((data as unknown as ReportSummary[]) || []);
      } else {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://amzlrrrhjsqjndbrdume.supabase.co';
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtemxycnJoanNxam5kYnJkdW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MTQ1NDIsImV4cCI6MjA4NTk5MDU0Mn0.UbmXG7RfWAQjNX9HTkCp50m_wwSFB4P40gfuqCA-f2c';
        const res = await fetch(`${supabaseUrl}/rest/v1/research_reports?select=id,question,status,created_at,results&order=created_at.desc&limit=50`, {
          headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}` },
        });
        if (res.ok) setReports(await res.json());
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    // Poll for status updates
    const interval = setInterval(fetchReports, 5000);
    return () => clearInterval(interval);
  }, []);

  return { reports, isLoading, refetch: fetchReports };
}
