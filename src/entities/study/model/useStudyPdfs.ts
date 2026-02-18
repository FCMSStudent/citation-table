import { useQuery } from '@tanstack/react-query';
import { fetchStudyPdfs, hasPendingStudyPdfs, reportKeys } from '@/entities/study/api/studyPdf.queries';
import type { StudyPdf } from '@/shared/types/research';

interface UseStudyPdfsResult {
  pdfs: Record<string, StudyPdf>;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useStudyPdfs(reportId: string | undefined): UseStudyPdfsResult {
  const query = useQuery({
    queryKey: reportId ? reportKeys.studyPdfs(reportId) : reportKeys.studyPdfs(''),
    queryFn: () => fetchStudyPdfs(reportId as string),
    enabled: !!reportId,
    refetchInterval: ({ state }) => (hasPendingStudyPdfs(state.data) ? 5000 : false),
  });

  return {
    pdfs: query.data ?? {},
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
