import { Link } from 'react-router-dom';
import { BookOpen, ArrowLeft, FileText } from 'lucide-react';
import { ReportCard } from '@/components/ReportCard';
import { useReports } from '@/hooks/useReports';
import { Skeleton } from '@/components/ui/skeleton';

const Reports = () => {
  const { reports, isLoading } = useReports();

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
            <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
              New Search
            </Link>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold text-foreground">Reports</h2>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <FileText className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
            <h3 className="font-medium text-foreground">No reports yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Search for a research question to create your first report.
            </p>
            <Link
              to="/"
              className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              Start a search
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => (
              <ReportCard
                key={r.id}
                id={r.id}
                question={r.question}
                status={r.status as 'processing' | 'completed' | 'failed'}
                createdAt={r.created_at}
                resultCount={Array.isArray(r.results) ? r.results.length : undefined}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Reports;
