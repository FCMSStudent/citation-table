import { SearchInput } from '@/components/SearchInput';
import { ResultsTable } from '@/components/ResultsTable';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { ErrorMessage } from '@/components/ErrorMessage';
import { EmptyState } from '@/components/EmptyState';
import { useResearch } from '@/hooks/useResearch';
import { BookOpen } from 'lucide-react';

const Index = () => {
  const { results, isLoading, error, query, totalPapersSearched, search } = useResearch();
  
  const hasResults = results.length > 0;
  const showEmptyState = !isLoading && !hasResults && !error;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Research Assistant</h1>
              <p className="text-xs text-muted-foreground">Citation-grounded evidence extraction</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container max-w-7xl mx-auto px-4 py-8">
        {/* Search section */}
        <section className="mb-8">
          <SearchInput onSearch={search} isLoading={isLoading} />
        </section>

        {/* Error message */}
        {error && !hasResults && (
          <section className="mb-8 max-w-4xl mx-auto">
            <ErrorMessage message={error} />
          </section>
        )}

        {/* Loading state */}
        {isLoading && (
          <section className="mb-8">
            <LoadingSkeleton />
          </section>
        )}

        {/* Results table */}
        {hasResults && (
          <section className="mb-8">
            <ResultsTable 
              results={results} 
              query={query} 
              totalPapersSearched={totalPapersSearched} 
            />
          </section>
        )}

        {/* Empty state */}
        {showEmptyState && <EmptyState />}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-auto">
        <div className="container max-w-7xl mx-auto px-4">
          <p className="text-center text-sm text-muted-foreground">
            Powered by OpenAlex • All data extracted from paper abstracts • 
            <span className="font-medium"> No inference beyond explicit text</span>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
