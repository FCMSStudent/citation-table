import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { StudyResult, ResearchResponse } from '@/types/research';

interface UseResearchReturn {
  results: StudyResult[];
  isLoading: boolean;
  error: string | null;
  query: string;
  normalizedQuery: string | undefined;
  totalPapersSearched: number;
  openalexCount: number | undefined;
  semanticScholarCount: number | undefined;
  search: (question: string) => Promise<void>;
  clearResults: () => void;
}

export function useResearch(): UseResearchReturn {
  const [results, setResults] = useState<StudyResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [normalizedQuery, setNormalizedQuery] = useState<string | undefined>(undefined);
  const [totalPapersSearched, setTotalPapersSearched] = useState(0);
  const [openalexCount, setOpenalexCount] = useState<number | undefined>(undefined);
  const [semanticScholarCount, setSemanticScholarCount] = useState<number | undefined>(undefined);

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
      let data: ResearchResponse | null = null;

      if (supabase) {
        const { data: responseData, error: fnError } = await supabase.functions.invoke<ResearchResponse>('research', {
          body: { question },
        });

        if (fnError) {
          throw new Error(fnError.message || 'Failed to search');
        }

        data = responseData;
      } else {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error('Cannot search: backend is not configured.');
        }

        const response = await fetch(`${supabaseUrl}/functions/v1/research`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Search failed: ${response.statusText}`);
        }

        data = await response.json();
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setResults(data?.results || []);
      setTotalPapersSearched(data?.total_papers_searched || 0);
      setNormalizedQuery(data?.normalized_query);
      setOpenalexCount(data?.openalex_count);
      setSemanticScholarCount(data?.semantic_scholar_count);
      
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
    setNormalizedQuery(undefined);
    setTotalPapersSearched(0);
    setOpenalexCount(undefined);
    setSemanticScholarCount(undefined);
  }, []);

  return {
    results,
    isLoading,
    error,
    query,
    normalizedQuery,
    totalPapersSearched,
    openalexCount,
    semanticScholarCount,
    search,
    clearResults,
  };
}
