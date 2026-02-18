import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useReport } from '@/entities/report/model/useReport';
import { useReports } from '@/entities/report/model/useReports';
import { useStudyPdfs } from '@/entities/study/model/useStudyPdfs';

const reportApi = vi.hoisted(() => ({
  fetchReport: vi.fn(),
  fetchReports: vi.fn(),
  isReportProcessing: vi.fn(() => false),
  hasProcessingReports: vi.fn(() => false),
  reportKeys: {
    detail: (id: string) => ['reports', 'detail', id],
    list: (params: unknown) => ['reports', 'list', params],
    studyPdfs: (id: string) => ['reports', 'studyPdfs', id],
  },
}));

const studyPdfApi = vi.hoisted(() => ({
  fetchStudyPdfs: vi.fn(),
  hasPendingStudyPdfs: vi.fn(() => false),
  reportKeys: {
    studyPdfs: (id: string) => ['reports', 'studyPdfs', id],
  },
}));

vi.mock('@/entities/report/api/report.queries', () => reportApi);
vi.mock('@/entities/study/api/studyPdf.queries', () => studyPdfApi);

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('query hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useReport returns report payload and no error', async () => {
    reportApi.fetchReport.mockResolvedValue({ id: 'r1', status: 'completed' });

    const { result } = renderHook(() => useReport('r1'), { wrapper });

    await waitFor(() => expect(result.current.report).toEqual({ id: 'r1', status: 'completed' }));
    expect(result.current.error).toBeNull();
    expect(reportApi.fetchReport).toHaveBeenCalledWith('r1');
    result.current.refetch();
  });

  it('useReports maps error to message', async () => {
    reportApi.fetchReports.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useReports({ limit: 1 }), { wrapper });

    await waitFor(() => expect(result.current.error).toBe('network down'));
    expect(result.current.reports).toEqual([]);
    result.current.refetch();
  });

  it('useStudyPdfs returns by-doi map', async () => {
    studyPdfApi.fetchStudyPdfs.mockResolvedValue({
      '10.1000/1': { doi: '10.1000/1', status: 'downloaded' },
    });

    const { result } = renderHook(() => useStudyPdfs('r1'), { wrapper });

    await waitFor(() => expect(Object.keys(result.current.pdfs)).toEqual(['10.1000/1']));
    expect(result.current.error).toBeNull();
    result.current.refetch();
  });
});
