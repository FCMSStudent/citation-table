import { useEffect, useState } from 'react';
import { getSupabase } from '@/integrations/supabase/fallback';
import type { StudyPdf } from '@/types/research';

interface UseStudyPdfsResult {
  pdfs: Record<string, StudyPdf>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to fetch and poll study PDF download status for a given report
 * @param reportId - The ID of the research report
 * @returns Object containing PDFs indexed by DOI, loading state, and error
 */
export function useStudyPdfs(reportId: string | undefined): UseStudyPdfsResult {
  const [pdfs, setPdfs] = useState<Record<string, StudyPdf>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const fetchPdfs = async () => {
      try {
        const client = getSupabase();
        const { data, error: fetchError } = await client
          .from('study_pdfs')
          .select('*')
          .eq('report_id', reportId);

        if (fetchError) throw fetchError;

        if (isMounted && data) {
          // Index PDFs by DOI for easy lookup
          const pdfsByDoi: Record<string, StudyPdf> = {};
          data.forEach((pdf) => {
            pdfsByDoi[pdf.doi] = pdf as unknown as StudyPdf;
          });
          setPdfs(pdfsByDoi);
          setIsLoading(false);

          // Check if any PDFs are still pending
          const hasPending = data.length > 0 && data.some(pdf => pdf.status === 'pending');
          
          // Stop polling if no PDFs or no pending PDFs
          if ((!hasPending || data.length === 0) && pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch PDFs');
          setIsLoading(false);
          // Stop polling on error
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }
      }
    };

    // Initial fetch
    fetchPdfs();

    // Poll every 5 seconds for status updates
    pollInterval = setInterval(fetchPdfs, 5000);

    return () => {
      isMounted = false;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [reportId]);

  return { pdfs, isLoading, error };
}
