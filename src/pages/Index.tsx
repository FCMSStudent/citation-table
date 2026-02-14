import { SearchInput } from '@/components/SearchInput';
import { ResultsTable } from '@/components/ResultsTable';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { ErrorMessage } from '@/components/ErrorMessage';
import { EmptyState } from '@/components/EmptyState';
import { MedicalDisclaimer } from '@/components/MedicalDisclaimer';
import { QueryNormalizationNotice } from '@/components/QueryNormalizationNotice';
import { useResearch } from '@/hooks/useResearch';
import { BookOpen } from 'lucide-react';

const Index = () => {
  const {
    results,
    isLoading,
    error,
    query,
    normalizedQuery,
    totalPapersSearched,
    openalexCount,
    semanticScholarCount,
    arxivCount,
    search
  } = useResearch();

  const hasResults = results.length > 0;
  const showEmptyState = !isLoading && !hasResults && !error;

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all">

        Skip to main content
      </a>

      {/* Header */}
      <header className="border-b border-border backdrop-blur-sm sticky top-0 z-10 bg-white/0">
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
      <main id="main-content" className="container max-w-7xl mx-auto px-4 py-8">
        {/* Search section */}
        <section className="mb-8">
          <SearchInput onSearch={search} isLoading={isLoading} />
        </section>

        {/* Medical disclaimer - show when results are present */}
        {hasResults &&
        <section className="mb-6">
            <MedicalDisclaimer />
          </section>
        }

        {/* Query normalization notice */}
        {normalizedQuery && query &&
        <section className="mb-6">
            <QueryNormalizationNotice
            originalQuery={query}
            normalizedQuery={normalizedQuery} />

          </section>
        }

        {/* Error message */}
        {error && !hasResults &&
        <section className="mb-8 max-w-4xl mx-auto">
            <ErrorMessage message={error} />
          </section>
        }

        {/* Loading state */}
        {isLoading &&
        <section className="mb-8">
            <LoadingSkeleton />
          </section>
        }

        {/* Results table */}
        {hasResults &&
        <section className="mb-8">
            <ResultsTable
            results={results}
            query={query}
            normalizedQuery={normalizedQuery}
            totalPapersSearched={totalPapersSearched}
            openalexCount={openalexCount}
            semanticScholarCount={semanticScholarCount}
            arxivCount={arxivCount} />

          </section>
        }

        {/* Empty state */}
        {showEmptyState && <EmptyState />}
      </main>

      {/* Footer section */}
      














    </div>);

};

export default Index;