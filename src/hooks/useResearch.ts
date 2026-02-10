import { useState, useCallback } from 'react';
import { supabaseClient, isSupabaseConfigured } from '@/lib/supabase';
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

      if (isSupabaseConfigured && supabaseClient) {
        // Use Supabase client when configured
        const { data: responseData, error: fnError } = await supabaseClient.functions.invoke<ResearchResponse>('research', {
          body: { question },
        });

        if (fnError) {
          throw new Error(fnError.message || 'Failed to search');
        }

        data = responseData;
      } else {
        // Direct fetch to edge function when Supabase not configured
        // This works because edge functions are publicly accessible via their URL
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
        
        if (!SUPABASE_URL) {
          throw new Error('Cannot search: VITE_SUPABASE_URL is not set. Please configure your environment variables.');
        }

        const response = await fetch(`${SUPABASE_URL}/functions/v1/research`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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
