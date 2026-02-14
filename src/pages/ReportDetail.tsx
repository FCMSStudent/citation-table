import { useParams, Link } from 'react-router-dom';
import { BookOpen, ArrowLeft, FileText } from 'lucide-react';
import { useReport } from '@/hooks/useReport';
import { useStudyPdfs } from '@/hooks/useStudyPdfs';
import { SearchProgress } from '@/components/SearchProgress';
import { ResultsTable } from '@/components/ResultsTable';
import { MedicalDisclaimer } from '@/components/MedicalDisclaimer';
import { QueryNormalizationNotice } from '@/components/QueryNormalizationNotice';
import { PaperChat } from '@/components/PaperChat';
import { Skeleton } from '@/components/ui/skeleton';

const ReportDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { report, isLoading, error } = useReport(id);
  const { pdfs: pdfsByDoi } = useStudyPdfs(id);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border sticky top-0 z-10 bg-background/95 backdrop-blur-sm">
        <div className="container max-w-7xl mx-auto px-4 py-4">
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
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-foreground">{report.question}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Started {new Date(report.created_at).toLocaleString()}
              </p>
            </div>

            {/* Processing state */}
            {report.status === 'processing' && (
              <SearchProgress
                status="processing"
                createdAt={report.created_at}
              />
            )}

            {/* Failed state */}
            {report.status === 'failed' && (
              <SearchProgress
                status="failed"
                createdAt={report.created_at}
                errorMessage={report.error_message}
              />
            )}

            {/* Completed state - show results */}
            {report.status === 'completed' && report.results && (
              <>
                {/* Medical disclaimer */}
                <section className="mb-6">
                  <MedicalDisclaimer />
                </section>

                {/* Query normalization notice */}
                {report.normalized_query && report.question && (
                  <section className="mb-6">
                    <QueryNormalizationNotice
                      originalQuery={report.question}
                      normalizedQuery={report.normalized_query}
                    />
                  </section>
                )}

                {/* Results */}
                <section>
                  <ResultsTable
                    results={report.results}
                    query={report.question}
                    normalizedQuery={report.normalized_query || undefined}
                    totalPapersSearched={report.total_papers_searched}
                    openalexCount={report.openalex_count}
                    semanticScholarCount={report.semantic_scholar_count}
                    arxivCount={report.arxiv_count}
                    pdfsByDoi={pdfsByDoi}
                    reportId={id}
                    cachedSynthesis={(report as any).narrative_synthesis}
                  />
                </section>

                {/* Chat with Papers */}
                <section className="mt-8">
                  <PaperChat reportId={id!} />
                </section>
              </>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
};

export default ReportDetail;
