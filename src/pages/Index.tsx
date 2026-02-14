import { Link } from 'react-router-dom';
import { SearchInput } from '@/components/SearchInput';
import { ErrorMessage } from '@/components/ErrorMessage';
import { EmptyState } from '@/components/EmptyState';
import { useResearch } from '@/hooks/useResearch';
import { useAuth } from '@/hooks/useAuth';
import { BookOpen, FileText, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Index = () => {
  const { user, signOut } = useAuth();
  const { isLoading, error, search } = useResearch();

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
      >
        Skip to main content
      </a>

      {/* Header */}
      <header className="border-b border-border backdrop-blur-sm sticky top-0 z-10 bg-background/95">
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
            <div className="flex items-center gap-3">
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
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main id="main-content" className="container max-w-7xl mx-auto px-4 py-8">
        {/* Search section */}
        <section className="mb-8">
          <SearchInput onSearch={search} isLoading={isLoading} />
        </section>

        {/* Error message */}
        {error && (
          <section className="mb-8 max-w-4xl mx-auto">
            <ErrorMessage message={error} />
          </section>
        )}

        {/* Empty state */}
        {!isLoading && !error && <EmptyState />}
      </main>
    </div>
  );
};

export default Index;
