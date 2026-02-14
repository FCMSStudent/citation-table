import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSupabase } from '@/integrations/supabase/fallback';

interface UseResearchReturn {
  isLoading: boolean;
  error: string | null;
  search: (question: string) => Promise<void>;
}

export function useResearch(): UseResearchReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const search = useCallback(async (question: string) => {
    if (!question.trim()) {
      setError('Please enter a research question');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const client = getSupabase();

      const { data, error: fnError } = await client.functions.invoke<{ report_id: string }>('research-async', {
        body: { question },
      });

      if (fnError) throw new Error(fnError.message || 'Failed to start search');
      const reportId = data?.report_id;

      if (reportId) {
        navigate(`/reports/${reportId}`);
      } else {
        throw new Error('No report ID returned');
      }
    } catch (err) {
      console.error('Research search error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [navigate]);

  return { isLoading, error, search };
}
