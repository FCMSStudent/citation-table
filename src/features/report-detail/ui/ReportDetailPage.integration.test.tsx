import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportDetailPage from '@/features/report-detail/ui/ReportDetailPage';

const useReportMock = vi.hoisted(() => vi.fn());
const useStudyPdfsMock = vi.hoisted(() => vi.fn());

vi.mock('@/entities/report/model/useReport', () => ({ useReport: useReportMock }));
vi.mock('@/entities/study/model/useStudyPdfs', () => ({ useStudyPdfs: useStudyPdfsMock }));
vi.mock('@/features/report-detail/ui/ResultsTable', () => ({
  ResultsTable: (props: { results: unknown[]; partialResults?: unknown[] }) => (
    <div data-testid="results-table">results:{props.results.length} partial:{props.partialResults?.length || 0}</div>
  ),
}));
vi.mock('@/features/paper-chat/ui/PaperChat', () => ({ PaperChat: () => <div data-testid="paper-chat" /> }));
vi.mock('@/features/study-management/ui/AddStudyDialog', () => ({ AddStudyDialog: () => <button>Add Study</button> }));

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/reports/r1']}>
      <Routes>
        <Route path="/reports/:id" element={<ReportDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const baseReport = {
  id: 'r1',
  question: 'Does x work?',
  normalized_query: 'does x work',
  total_papers_searched: 50,
  openalex_count: 10,
  semantic_scholar_count: 20,
  arxiv_count: 5,
  pubmed_count: 15,
  error_message: null,
  created_at: '2026-02-18T10:00:00.000Z',
  completed_at: null,
  active_extraction_run_id: 'run-1',
  status: 'processing' as const,
  results: [] as unknown[],
  partial_results: [{ study_id: 'p1' }] as unknown[],
  extraction_stats: null,
  search_stats: null,
  narrative_synthesis: null,
  evidence_table: null,
  brief_json: null,
  coverage_report: { providers_queried: 4, providers_failed: 1 },
};

describe('ReportDetailPage integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStudyPdfsMock.mockReturnValue({ pdfs: {}, isLoading: false, error: null });
  });

  it('shows partial results while processing', () => {
    useReportMock.mockReturnValue({
      report: baseReport,
      isLoading: false,
      isFetching: true,
      dataUpdatedAt: Date.now(),
      error: null,
      refetch: vi.fn(),
    });

    renderRoute();

    expect(screen.getByText(/Run status:/i)).toBeInTheDocument();
    expect(screen.getByTestId('results-table')).toHaveTextContent('results:0 partial:1');
  });

  it('shows failed state with retry affordance', async () => {
    const refetch = vi.fn();
    useReportMock.mockReturnValue({
      report: { ...baseReport, status: 'failed', error_message: 'backend exploded', partial_results: [] },
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: Date.now(),
      error: null,
      refetch,
    });

    renderRoute();

    expect(screen.getByText(/Search failed/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows explicit empty state when no results', () => {
    useReportMock.mockReturnValue({
      report: { ...baseReport, status: 'processing', results: null, partial_results: null },
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: Date.now(),
      error: null,
      refetch: vi.fn(),
    });

    renderRoute();

    expect(screen.getByText(/No results yet/i)).toBeInTheDocument();
  });
});
