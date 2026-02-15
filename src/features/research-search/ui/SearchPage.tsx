import { Link } from 'react-router-dom';
import { SearchInput } from '@/features/research-search/ui/SearchInput';
import { ErrorMessage } from '@/features/research-search/ui/ErrorMessage';
import { EmptyState } from '@/features/research-search/ui/EmptyState';
import { useResearch } from '@/features/research-search/model/useResearch';
import { useAuth } from '@/features/auth/model/useAuth';
import { FileText, LogOut } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { PageShell } from '@/shared/ui/page-shell';
import { PageHeader } from '@/shared/ui/page-header';

const Index = () => {
  const { user, signOut } = useAuth();
  const { isLoading, error, search } = useResearch();

  return (
    <PageShell>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
      >
        Skip to main content
      </a>

      <PageHeader>
        <Link
          to="/reports"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <FileText className="h-4 w-4" />
          Reports
        </Link>
        <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
          <LogOut className="h-4 w-4" />
        </Button>
      </PageHeader>

      <main id="main-content" className="container max-w-7xl mx-auto px-4 py-8">
        <section className="mb-8">
          <SearchInput onSearch={search} isLoading={isLoading} />
        </section>

        {error && (
          <section className="mb-8 max-w-4xl mx-auto">
            <ErrorMessage message={error} />
          </section>
        )}

        {!isLoading && !error && <EmptyState />}
      </main>
    </PageShell>
  );
};

export default Index;
