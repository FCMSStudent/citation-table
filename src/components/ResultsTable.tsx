import { useState, useMemo } from 'react';
import { Download, FileText, Code, Eye, EyeOff } from 'lucide-react';
import type { StudyResult } from '@/types/research';
import { StudyCard } from './StudyCard';
import { Button } from './ui/button';
import { downloadRISFile } from '@/lib/risExport';
import { generateNarrativeSummary } from '@/lib/narrativeSummary';
import { sortByRelevance } from '@/utils/relevanceScore';
import { FilterBar, type DesignFilterOption, type SortOption } from './FilterBar';
import { hasNoOutcomesReported } from '@/utils/explainScore';

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

const COGNITIVE_TERMS = ['cognit', 'memory', 'executive', 'attention', 'learning', 'processing speed'];

interface ScoredStudy extends StudyResult {
  relevanceScore: number;
}

interface ResultsTableProps {
  results: StudyResult[];
  query: string;
  normalizedQuery?: string;
  totalPapersSearched: number;
  openalexCount?: number;
  semanticScholarCount?: number;
}

function hasExplicitCognitiveOutcome(study: StudyResult): boolean {
  if (!study.outcomes?.length) return false;

  return study.outcomes.some((outcome) => {
    const combined = `${outcome.outcome_measured} ${outcome.key_result || ''}`.toLowerCase();
    return COGNITIVE_TERMS.some((term) => combined.includes(term));
  });
}

function matchesDesignFilter(study: StudyResult, designFilter: DesignFilterOption): boolean {
  if (designFilter === 'all') return true;
  if (designFilter === 'meta') return study.review_type === 'Meta-analysis';
  if (designFilter === 'review') return study.review_type === 'Systematic review' || study.study_design === 'review';
  if (designFilter === 'unknown') return study.study_design === 'unknown';
  return true;
}

function sortResults(studies: ScoredStudy[], sortBy: SortOption): ScoredStudy[] {
  if (sortBy === 'year') {
    return [...studies].sort((a, b) => b.year - a.year || b.relevanceScore - a.relevanceScore);
  }

  return [...studies].sort((a, b) => b.relevanceScore - a.relevanceScore || b.year - a.year);
}

export function ResultsTable({
  results,
  query,
  normalizedQuery,
  totalPapersSearched,
  openalexCount,
  semanticScholarCount,
}: ResultsTableProps) {
  const [showExcludedStudies, setShowExcludedStudies] = useState(false);
  const [showNarrative, setShowNarrative] = useState(false);
  const [showJSON, setShowJSON] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [designFilter, setDesignFilter] = useState<DesignFilterOption>('all');
  const [cognitiveOnly, setCognitiveOnly] = useState(false);

  const scoredResults = useMemo(() => {
    return sortByRelevance(results, normalizedQuery || query);
  }, [results, query, normalizedQuery]);

  const includedStudies = useMemo(() => {
    return scoredResults.filter((study) => {
      const isLowValue = study.relevanceScore <= 0 || hasNoOutcomesReported(study);
      if (isLowValue) return false;
      if (!matchesDesignFilter(study, designFilter)) return false;
      if (cognitiveOnly && !hasExplicitCognitiveOutcome(study)) return false;
      return true;
    });
  }, [scoredResults, designFilter, cognitiveOnly]);

  const excludedStudies = useMemo(() => {
    return scoredResults.filter((study) => {
      const isLowValue = study.relevanceScore <= 0 || hasNoOutcomesReported(study);
      if (!isLowValue) return false;
      if (!matchesDesignFilter(study, designFilter)) return false;
      if (cognitiveOnly && !hasExplicitCognitiveOutcome(study)) return false;
      return true;
    });
  }, [scoredResults, designFilter, cognitiveOnly]);

  const visibleIncludedStudies = useMemo(() => sortResults(includedStudies, sortBy), [includedStudies, sortBy]);
  const visibleExcludedStudies = useMemo(() => sortResults(excludedStudies, sortBy), [excludedStudies, sortBy]);

  const displayedResults = showExcludedStudies
    ? [...visibleIncludedStudies, ...visibleExcludedStudies]
    : visibleIncludedStudies;

  const handleExportRIS = () => {
    downloadRISFile(results, `research-${Date.now()}.ris`);
  };

  const narrativeSummary = useMemo(() => {
    return generateNarrativeSummary(results, normalizedQuery || query);
  }, [results, query, normalizedQuery]);

  const explicitOutcomeStudies = useMemo(
    () => scoredResults.filter((study) => !hasNoOutcomesReported(study)),
    [scoredResults]
  );
  const highRelevanceCount = explicitOutcomeStudies.filter((study) => study.relevanceScore >= 2).length;
  const lowRelevanceCount = explicitOutcomeStudies.filter((study) => study.relevanceScore <= 0).length;

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="w-full animate-fade-in">
      <div className="mb-4 space-y-3">
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <span className="font-medium">Cognitive performance outcomes found in {explicitOutcomeStudies.length} studies.</span>{' '}
          <span className="text-muted-foreground">
            High relevance: {highRelevanceCount} • Low relevance: {lowRelevanceCount}
          </span>
        </div>

        <FilterBar
          sortBy={sortBy}
          designFilter={designFilter}
          cognitiveOnly={cognitiveOnly}
          onSortByChange={setSortBy}
          onDesignFilterChange={setDesignFilter}
          onCognitiveOnlyChange={setCognitiveOnly}
        />

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-muted-foreground">
            Showing <strong>{displayedResults.length}</strong> {pluralize(displayedResults.length, 'result', 'results')} from{' '}
            <strong>{totalPapersSearched}</strong> papers searched
            {!showExcludedStudies && excludedStudies.length > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                ({excludedStudies.length} excluded {pluralize(excludedStudies.length, 'study', 'studies')} hidden)
              </span>
            )}
            {(openalexCount !== undefined || semanticScholarCount !== undefined) && (
              <span className="ml-2">
                ({openalexCount || 0} OpenAlex, {semanticScholarCount || 0} Semantic Scholar)
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            Query: <em>"{normalizedQuery || query}"</em>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {excludedStudies.length > 0 && (
            <Button
              onClick={() => setShowExcludedStudies(!showExcludedStudies)}
              variant={showExcludedStudies ? 'default' : 'outline'}
              size="sm"
              className="gap-2"
            >
              {showExcludedStudies ? (
                <>
                  <EyeOff className="h-4 w-4" />
                  Hide excluded studies
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4" />
                  Show excluded studies ({excludedStudies.length})
                </>
              )}
            </Button>
          )}

          {import.meta.env.DEV && (
            <Button
              onClick={() => setShowScoreBreakdown(!showScoreBreakdown)}
              variant="outline"
              size="sm"
            >
              {showScoreBreakdown ? 'Hide' : 'Show'} score breakdown
            </Button>
          )}

          <Button onClick={handleExportRIS} variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Export Citations (RIS)
          </Button>

          <Button onClick={() => setShowNarrative(!showNarrative)} variant="outline" size="sm" className="gap-2">
            <FileText className="h-4 w-4" />
            {showNarrative ? 'Hide' : 'Show'} Narrative Summary
          </Button>

          <Button onClick={() => setShowJSON(!showJSON)} variant="outline" size="sm" className="gap-2">
            <Code className="h-4 w-4" />
            {showJSON ? 'Hide' : 'View'} JSON
          </Button>
        </div>

        {showNarrative && (
          <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
            <h3 className="text-sm font-semibold mb-2 text-blue-900 dark:text-blue-100">Narrative Summary</h3>
            <p className="text-sm leading-relaxed text-blue-900 dark:text-blue-100">{narrativeSummary}</p>
          </div>
        )}

        {showJSON && (
          <div className="p-4 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg">
            <h3 className="text-sm font-semibold mb-2 text-gray-900 dark:text-gray-100">Structured JSON Output</h3>
            <pre className="text-xs overflow-x-auto p-2 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
              {JSON.stringify(results, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {visibleIncludedStudies.map((result) => (
          <StudyCard
            key={result.study_id}
            study={result}
            query={normalizedQuery || query}
            relevanceScore={result.relevanceScore}
            showScoreBreakdown={showScoreBreakdown}
          />
        ))}

        {showExcludedStudies && visibleExcludedStudies.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Excluded Studies</h3>
            {visibleExcludedStudies.map((result) => (
              <StudyCard
                key={`excluded-${result.study_id}`}
                study={result}
                query={normalizedQuery || query}
                relevanceScore={result.relevanceScore}
                showScoreBreakdown={showScoreBreakdown}
              />
            ))}
          </div>
        )}
      </div>

      {displayedResults.length === 0 && results.length > 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>No studies match the active filters.</p>
          {excludedStudies.length > 0 && (
            <Button onClick={() => setShowExcludedStudies(true)} variant="outline" size="sm" className="mt-4">
              Show {excludedStudies.length} excluded {pluralize(excludedStudies.length, 'study', 'studies')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
