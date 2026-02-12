import { useMemo, useState } from 'react';
import { Code, Download, Eye, EyeOff, FileText, Table2, List } from 'lucide-react';
import type { StudyResult } from '@/types/research';
import { StudyCard } from './StudyCard';
import { SynthesisView } from './SynthesisView'; // NEW
import { TableView } from './TableView'; // NEW
import { Button } from './ui/button';
import { downloadRISFile } from '@/lib/risExport';
import { downloadCSV } from '@/lib/csvExport'; // NEW
import { generateNarrativeSummary } from '@/lib/narrativeSummary';
import { isLowValueStudy, sortByRelevance } from '@/utils/relevanceScore';
import { FilterBar, type SortOption, type StudyDesignFilter } from './FilterBar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

type ViewMode = 'synthesis' | 'table' | 'cards';

interface ResultsTableProps {
  results: StudyResult[];
  query: string;
  normalizedQuery?: string;
  totalPapersSearched: number;
  openalexCount?: number;
  semanticScholarCount?: number;
}

export function ResultsTable({
  results,
  query,
  normalizedQuery,
  totalPapersSearched,
  openalexCount,
  semanticScholarCount,
}: ResultsTableProps) {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('synthesis');
  const [showExcludedStudies, setShowExcludedStudies] = useState(false);
  const [showJSON, setShowJSON] = useState(false);
  
  // Filter state
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [studyDesign, setStudyDesign] = useState<StudyDesignFilter>('all');
  const [explicitOnly, setExplicitOnly] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);

  const activeQuery = normalizedQuery || query;

  // Scored and filtered results
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

  // Narrative summary
  const narrativeSummary = useMemo(() => {
    return generateNarrativeSummary(mainStudies, activeQuery);
  }, [mainStudies, activeQuery]);

  // Outcome aggregation
  const outcomeAggregation = useMemo(() => {
    const outcomeMap = new Map<string, Array<{
      study: StudyResult;
      result: string;
    }>();

    mainStudies.forEach(study => {
      study.outcomes?.forEach(outcome => {
        if (outcome.key_result) {
          const normalized = outcome.outcome_measured.toLowerCase()
            .replace(/\b(symptoms?|levels?|scores?)\b/g, '')
            .trim();
          
          if (!outcomeMap.has(normalized)) {
            outcomeMap.set(normalized, []);
          }
          
          outcomeMap.get(normalized)!.push({
            study,
            result: outcome.key_result
          });
        }
      });
    });

    return Array.from(outcomeMap.entries())
      .map(([outcome, studies]) => ({
        outcome,
        studyCount: studies.length,
        studies
      }))
      .sort((a, b) => b.studyCount - a.studyCount);
  }, [mainStudies]);

  // Export handlers
  const handleExportRIS = () => {
    downloadRISFile(mainStudies, `research-${Date.now()}.ris`);
  };

  const handleExportCSV = () => {
    downloadCSV(mainStudies, `research-${Date.now()}.csv`);
  };

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="w-full animate-fade-in">
      {/* Header with stats */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <div>
            Found <strong>{mainStudies.length}</strong> relevant {mainStudies.length === 1 ? 'study' : 'studies'} from{' '}
            <strong>{totalPapersSearched}</strong> papers
            {(openalexCount !== undefined || semanticScholarCount !== undefined) && (
              <span className="ml-2 text-xs">
                ({openalexCount || 0} OpenAlex, {semanticScholarCount || 0} Semantic Scholar)
              </span>
            )}
          </div>
        </div>

        {/* Synthesis Summary - PROMINENT PLACEMENT */}
        <div className="rounded-lg border-l-4 border-l-blue-500 bg-gradient-to-r from-blue-50 to-transparent p-4 dark:from-blue-950/30">
          <h3 className="mb-2 font-semibold text-blue-900 dark:text-blue-100">Research Synthesis</h3>
          <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            {narrativeSummary}
          </p>
          
          {/* Key outcomes summary */}
          {outcomeAggregation.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {outcomeAggregation.slice(0, 5).map(({ outcome, studyCount }) => (
                <span
                  key={outcome}
                  className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                >
                  {outcome} <span className="ml-1 text-blue-600 dark:text-blue-400">({studyCount})</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Filters */}
        <FilterBar
          sortBy={sortBy}
          onSortByChange={setSortBy}
          studyDesign={studyDesign}
          onStudyDesignChange={setStudyDesign}
          explicitOnly={explicitOnly}
          onExplicitOnlyChange={setExplicitOnly}
        />

        {/* View mode and actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="synthesis" className="gap-2">
                <FileText className="h-4 w-4" />
                Synthesis
              </TabsTrigger>
              <TabsTrigger value="table" className="gap-2">
                <Table2 className="h-4 w-4" />
                Table
              </TabsTrigger>
              <TabsTrigger value="cards" className="gap-2">
                <List className="h-4 w-4" />
                Cards
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2">
            {excludedStudies.length > 0 && (
              <Button
                onClick={() => setShowExcludedStudies(!showExcludedStudies)}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                {showExcludedStudies ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showExcludedStudies ? 'Hide' : 'Show'} excluded ({excludedStudies.length})
              </Button>
            )}

            <Button onClick={handleExportCSV} variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>

            <Button onClick={handleExportRIS} variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Export RIS
            </Button>

            {import.meta.env.DEV && (
              <>
                <Button onClick={() => setShowJSON(!showJSON)} variant="outline" size="sm" className="gap-2">
                  <Code className="h-4 w-4" />
                  JSON
                </Button>
                <Button onClick={() => setShowScoreBreakdown(!showScoreBreakdown)} variant="outline" size="sm">
                  Scores
                </Button>
              </>
            )}
          </div>
        </div>

        {showJSON && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <pre className="overflow-x-auto text-xs">
              {JSON.stringify(mainStudies, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Content based on view mode */}
      {viewMode === 'synthesis' && (
        <SynthesisView
          studies={mainStudies}
          outcomeAggregation={outcomeAggregation}
          query={activeQuery}
        />
      )}

      {viewMode === 'table' && (
        <TableView
          studies={mainStudies}
          query={activeQuery}
          showScoreBreakdown={showScoreBreakdown}
        />
      )}

      {viewMode === 'cards' && (
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
      )}

      {/* Excluded studies */}
      {showExcludedStudies && excludedStudies.length > 0 && (
        <div className="mt-8 space-y-4 border-t pt-8">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Excluded Studies ({excludedStudies.length})
          </h3>
          <div className="space-y-3">
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
        </div>
      )}

      {mainStudies.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          <p>No studies match your current filters.</p>
          <p className="mt-2 text-sm">Try adjusting your filters or search query.</p>
        </div>
      )}
    </div>
  );
}
