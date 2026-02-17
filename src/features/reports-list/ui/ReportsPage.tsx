import { Link } from 'react-router-dom';
import { ArrowLeft, FileText, LogOut } from 'lucide-react';
import { ReportCard } from '@/features/reports-list/ui/ReportCard';
import { useReports } from '@/entities/report/model/useReports';
import { useAuth } from '@/features/auth/model/useAuth';
import { Skeleton } from '@/shared/ui/Skeleton';
import { Button } from '@/shared/ui/Button';
import { PageShell } from '@/shared/ui/PageShell';
import { PageHeader } from '@/shared/ui/PageHeader';

const Reports = () => {
  const { signOut } = useAuth();
  const { reports, isLoading } = useReports();

  return (
    <PageShell>
      <PageHeader>
        <Link to="/app" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          New Search
        </Link>
        <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
          <LogOut className="h-4 w-4" />
        </Button>
      </PageHeader>

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
              to="/app"
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
    </PageShell>
  );
};

export default Reports;
