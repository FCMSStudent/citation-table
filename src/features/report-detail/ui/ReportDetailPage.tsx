import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BookOpen, ArrowLeft, FileText } from 'lucide-react';
import { useReport } from '@/entities/report/model/useReport';
import { useStudyPdfs } from '@/entities/study/model/useStudyPdfs';
import { SearchProgress } from '@/features/report-detail/ui/SearchProgress';
import { ResultsTable } from '@/features/report-detail/ui/ResultsTable';
import { PaperChat } from '@/features/paper-chat/ui/PaperChat';
import { AddStudyDialog } from '@/features/study-management/ui/AddStudyDialog';
import { Skeleton } from '@/shared/ui/Skeleton';
import type { StudyResult } from '@/shared/types/research';
import { cn } from '@/shared/lib/utils';

const ReportDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { report, isLoading, error, refetch } = useReport(id);
  const { pdfs: pdfsByDoi } = useStudyPdfs(id);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setIsScrolled(window.scrollY > 12);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className={cn(
        "border-b border-border sticky top-0 z-10 bg-background/95 backdrop-blur-sm transition-all duration-200",
        isScrolled ? 'shadow-sm' : ''
      )}>
        <div className={cn(
          "container max-w-7xl mx-auto px-4 transition-all duration-200",
          isScrolled ? 'py-3' : 'py-4',
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <BookOpen className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">Research Assistant</h1>
                <p className="text-xs text-muted-foreground">Citation-grounded evidence extraction</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/reports" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <FileText className="h-4 w-4" />
                All Reports
              </Link>
              <Link to="/app" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ArrowLeft className="h-4 w-4" />
                New Search
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="container max-w-7xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="mx-auto max-w-xl space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-64 w-full rounded-lg" />
          </div>
        ) : error ? (
          <div className="mx-auto max-w-xl rounded-lg border bg-card p-8 text-center">
            <h2 className="text-lg font-semibold text-foreground">Error</h2>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <Link to="/reports" className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline">
              Back to Reports
            </Link>
          </div>
        ) : report ? (
          <div>
            {/* Question header */}
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground">{report.question}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Started {new Date(report.created_at).toLocaleString()}
                </p>
              </div>
              {report.status === 'completed' && id && (
                <AddStudyDialog reportId={id} onStudyAdded={refetch} />
              )}
            </div>

            {/* Processing state */}
            {report.status === 'processing' && (
              <SearchProgress
                status="processing"
                createdAt={report.created_at}
                onRetry={refetch}
              />
            )}

            {/* Failed state */}
            {report.status === 'failed' && (
              <SearchProgress
                status="failed"
                createdAt={report.created_at}
                errorMessage={report.error_message}
                onRetry={refetch}
              />
            )}

            {/* Completed state - show results */}
            {report.status === 'completed' && report.results && (() => {
              return (
              <>
                {/* Results */}
                <section>
                  <ResultsTable
                    results={report.results as unknown as StudyResult[]}
                    query={report.question}
                    normalizedQuery={report.normalized_query || undefined}
                    totalPapersSearched={report.total_papers_searched}
                    openalexCount={report.openalex_count}
                    semanticScholarCount={report.semantic_scholar_count}
                    arxivCount={report.arxiv_count}
                    pubmedCount={report.pubmed_count}
                    pdfsByDoi={pdfsByDoi}
                    reportId={id}
                    cachedSynthesis={report.narrative_synthesis}
                    evidenceTable={report.evidence_table || undefined}
                    briefSentences={report.brief_json?.sentences || undefined}
                    coverageReport={report.coverage_report || undefined}
                    searchStats={report.search_stats || undefined}
                    partialResults={report.partial_results || undefined}
                    extractionStats={report.extraction_stats || undefined}
                  />
                </section>

              </>
              );
            })()}
          </div>
        ) : null}
      </main>

      {report?.status === 'completed' && id && (
        <PaperChat reportId={id} mode="modal" defaultOpen />
      )}
    </div>
  );
};

export default ReportDetail;
