import { useQuery } from '@tanstack/react-query';
import { fetchReports, hasProcessingReports, reportKeys, type ReportListParams } from '@/entities/report/api/report.queries';

const DEFAULT_PARAMS: ReportListParams = { limit: 50 };

export function useReports(params: ReportListParams = DEFAULT_PARAMS) {
  const query = useQuery({
    queryKey: reportKeys.list(params),
    queryFn: () => fetchReports(params),
    refetchInterval: ({ state }) => (hasProcessingReports(state.data) ? 5000 : false),
  });

  return {
    reports: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
