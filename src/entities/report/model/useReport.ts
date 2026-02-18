import { useQuery } from '@tanstack/react-query';
import { fetchReport, isReportProcessing, reportKeys, type Report } from '@/entities/report/api/report.queries';

interface UseReportReturn {
  report: Report | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useReport(reportId: string | undefined): UseReportReturn {
  const query = useQuery({
    queryKey: reportId ? reportKeys.detail(reportId) : reportKeys.detail(''),
    queryFn: () => fetchReport(reportId as string),
    enabled: !!reportId,
    refetchInterval: ({ state }) => (isReportProcessing(state.data) ? 3000 : false),
  });

  return {
    report: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
