import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { StudyResult, ResearchResponse } from '@/types/research';

interface UseResearchReturn {
  results: StudyResult[];
  isLoading: boolean;
  error: string | null;
  query: string;
  totalPapersSearched: number;
  search: (question: string) => Promise<void>;
  clearResults: () => void;
}

export function useResearch(): UseResearchReturn {
  const [results, setResults] = useState<StudyResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [totalPapersSearched, setTotalPapersSearched] = useState(0);

  const search = useCallback(async (question: string) => {
    if (!question.trim()) {
      setError('Please enter a research question');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults([]);
    setQuery(question);

    try {
      const { data, error: fnError } = await supabase.functions.invoke<ResearchResponse>('research', {
        body: { question },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to search');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setResults(data?.results || []);
      setTotalPapersSearched(data?.total_papers_searched || 0);
      
      if (data?.message) {
        setError(data.message);
      }
    } catch (err) {
      console.error('Research search error:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
    setQuery('');
    setTotalPapersSearched(0);
  }, []);

  return {
    results,
    isLoading,
    error,
    query,
    totalPapersSearched,
    search,
    clearResults,
  };
}
