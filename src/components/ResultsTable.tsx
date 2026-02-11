import { useMemo, useState } from 'react';
import { Code, Download, Eye, EyeOff, FileText } from 'lucide-react';
import type { StudyResult } from '@/types/research';
import { StudyCard } from './StudyCard';
import { Button } from './ui/button';
import { downloadRISFile } from '@/lib/risExport';
import { generateNarrativeSummary } from '@/lib/narrativeSummary';
import { isLowValueStudy, sortByRelevance } from '@/utils/relevanceScore';
import { FilterBar, type SortOption, type StudyDesignFilter } from './FilterBar';

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

interface ResultsTableProps {
  results: StudyResult[];
  query: string;
  normalizedQuery?: string;
  totalPapersSearched: number;
  openalexCount?: number;
  semanticScholarCount?: number;
}

type ScoredStudy = StudyResult & { relevanceScore: number };

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
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [studyDesign, setStudyDesign] = useState<StudyDesignFilter>('all');
  const [explicitOnly, setExplicitOnly] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);

  const activeQuery = normalizedQuery || query;

  const scoredResults = useMemo(() => sortByRelevance(results, activeQuery), [results, activeQuery]);

  const explicitMatches = useMemo(
    () =>
      scoredResults.filter((study) => {
        const outcomesText = study.outcomes
          ?.map((outcome) => `${outcome.outcome_measured} ${outcome.key_result || ''}`.toLowerCase())
          .join(' ') || '';

        return study.outcomes.length > 0 && !outcomesText.includes('no outcomes reported');
      }),
    [scoredResults],
  );

  const withFilters = useMemo(() => {
    let filtered = [...scoredResults];

    if (explicitOnly) {
      filtered = filtered.filter((study) => explicitMatches.some((match) => match.study_id === study.study_id));
    }

    if (studyDesign !== 'all') {
      filtered = filtered.filter((study) => {
        if (studyDesign === 'meta') return study.review_type === 'Meta-analysis';
        if (studyDesign === 'review') return study.study_design === 'review' || study.review_type === 'Systematic review';
        return study.study_design === 'unknown';
      });
    }

    if (sortBy === 'year') {
      filtered.sort((a, b) => b.year - a.year);
    } else {
      filtered.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    return filtered;
  }, [explicitMatches, explicitOnly, scoredResults, sortBy, studyDesign]);

  const mainStudies = useMemo(
    () => withFilters.filter((study) => !isLowValueStudy(study, study.relevanceScore)),
    [withFilters],
  );

  const excludedStudies = useMemo(
    () => withFilters.filter((study) => isLowValueStudy(study, study.relevanceScore)),
    [withFilters],
  );

  const handleExportRIS = () => {
    downloadRISFile(results, `research-${Date.now()}.ris`);
  };

  const narrativeSummary = useMemo(() => {
    return generateNarrativeSummary(results, activeQuery);
  }, [results, activeQuery]);

  const outcomeSummary = useMemo(() => {
    const highRelevance = explicitMatches.filter((study) => study.relevanceScore >= 2).length;
    const lowRelevance = explicitMatches.filter((study) => study.relevanceScore <= 0).length;

    return {
      found: explicitMatches.length,
      highRelevance,
      lowRelevance,
    };
  }, [explicitMatches]);

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="w-full animate-fade-in">
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <div>
            Showing <strong>{mainStudies.length}</strong> {pluralize(mainStudies.length, 'result', 'results')} from{' '}
            <strong>{totalPapersSearched}</strong> papers searched
            {(openalexCount !== undefined || semanticScholarCount !== undefined) && (
              <span className="ml-2">({openalexCount || 0} OpenAlex, {semanticScholarCount || 0} Semantic Scholar)</span>
            )}
          </div>
          <div>
            Query: <em>"{activeQuery}"</em>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <strong>Cognitive performance outcomes found in {outcomeSummary.found} studies.</strong>
          <span className="ml-3">High relevance: {outcomeSummary.highRelevance}</span>
          <span className="ml-3">Low relevance: {outcomeSummary.lowRelevance}</span>
        </div>

        <FilterBar
          sortBy={sortBy}
          onSortByChange={setSortBy}
          studyDesign={studyDesign}
          onStudyDesignChange={setStudyDesign}
          explicitOnly={explicitOnly}
          onExplicitOnlyChange={setExplicitOnly}
        />

        <div className="flex flex-wrap items-center gap-2">
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
              onClick={() => setShowScoreBreakdown((prev) => !prev)}
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
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
            <h3 className="mb-2 text-sm font-semibold text-blue-900 dark:text-blue-100">Narrative Summary</h3>
            <p className="text-sm leading-relaxed text-blue-900 dark:text-blue-100">{narrativeSummary}</p>
          </div>
        )}

        {showJSON && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950">
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-100">Structured JSON Output</h3>
            <pre className="overflow-x-auto rounded border border-gray-200 bg-white p-2 text-xs dark:border-gray-700 dark:bg-gray-900">
              {JSON.stringify(results, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {mainStudies.map((study) => (
          <StudyCard
            key={study.study_id}
            study={study}
            query={activeQuery}
            relevanceScore={study.relevanceScore}
            showScoreBreakdown={showScoreBreakdown}
          />
        ))}
      </div>

      {showExcludedStudies && excludedStudies.length > 0 && (
        <div className="mt-6 space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Excluded Studies</h3>
          {excludedStudies.map((study) => (
            <StudyCard
              key={`excluded-${study.study_id}`}
              study={study}
              query={activeQuery}
              relevanceScore={study.relevanceScore}
              isLowValue
              showScoreBreakdown={showScoreBreakdown}
            />
          ))}
        </div>
      )}

      {mainStudies.length === 0 && results.length > 0 && (
        <div className="py-8 text-center text-muted-foreground">
          <p>No studies match your current filters.</p>
        </div>
      )}
    </div>
  );
}
