import { useMemo, useState } from 'react';
import { Code, Download, Eye, EyeOff, FileText, Table2, List, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { StudyResult } from '@/types/research';
import { StudyCard } from './StudyCard';
import { SynthesisView } from './SynthesisView'; // NEW
import { TableView } from './TableView'; // NEW
import { Button } from './ui/button';
import { downloadRISFile } from '@/lib/risExport';
import { downloadCSV } from '@/lib/csvExport'; // NEW
import { generateNarrativeSummary } from '@/lib/narrativeSummary';
import { sortByRelevance, isLowValueStudy, getOutcomeText } from '@/utils/relevanceScore';
import { FilterBar, type SortOption, type StudyDesignFilter } from './FilterBar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const OUTCOME_NORM_REGEX = /\b(symptoms?|levels?|scores?)\b/g;

type ViewMode = 'synthesis' | 'table' | 'cards';

interface ResultsTableProps {
  results: StudyResult[];
  query: string;
  normalizedQuery?: string;
  totalPapersSearched: number;
  openalexCount?: number;
  semanticScholarCount?: number;
  arxivCount?: number;
}

export function ResultsTable({
  results,
  query,
  normalizedQuery,
  totalPapersSearched,
  openalexCount,
  semanticScholarCount,
  arxivCount,
}: ResultsTableProps) {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('synthesis');
  const [showExcludedStudies, setShowExcludedStudies] = useState(false);
  const [showJSON, setShowJSON] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // Filter state
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [studyDesign, setStudyDesign] = useState<StudyDesignFilter>('all');
  const [explicitOnly, setExplicitOnly] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);

  const activeQuery = normalizedQuery || query;

  // Scored results - already sorted by relevanceScore descending
  const scoredResults = useMemo(() => sortByRelevance(results, activeQuery), [results, activeQuery]);

  // Combined filtering and splitting into main/excluded studies in a single pass (O(N))
  const { mainStudies, excludedStudies } = useMemo(() => {
    const main: typeof scoredResults = [];
    const excluded: typeof scoredResults = [];

    // Optimization: Only re-sort if explicitly requested by year
    const base = sortBy === 'year'
      ? [...scoredResults].sort((a, b) => b.year - a.year)
      : scoredResults;

    base.forEach((study) => {
      // 1. Study Design Filter
      if (studyDesign !== 'all') {
        const matchesDesign =
          (studyDesign === 'meta' && study.review_type === 'Meta-analysis') ||
          (studyDesign === 'review' && (study.study_design === 'review' || study.review_type === 'Systematic review')) ||
          (studyDesign === 'unknown' && study.study_design === 'unknown');
        if (!matchesDesign) return;
      }

      // 2. Explicit Only Filter
      // getOutcomeText is memoized to avoid redundant processing
      const outcomesText = getOutcomeText(study);
      const isExplicitMatch = (study.outcomes?.length || 0) > 0 && !outcomesText.includes('no outcomes reported');

      if (explicitOnly && !isExplicitMatch) return;

      // 3. Low Value Split (Uses centralized utility for consistency)
      if (isLowValueStudy(study, study.relevanceScore)) {
        excluded.push(study);
      } else {
        main.push(study);
      }
    });

    return { mainStudies: main, excludedStudies: excluded };
  }, [scoredResults, sortBy, studyDesign, explicitOnly]);

  // Narrative summary
  const narrativeSummary = useMemo(() => {
    return generateNarrativeSummary(mainStudies, activeQuery);
  }, [mainStudies, activeQuery]);

  // Outcome aggregation
  const outcomeAggregation = useMemo(() => {
    const outcomeMap = new Map<string, Array<{
      study: StudyResult;
      result: string;
    }>>();

    mainStudies.forEach(study => {
      study.outcomes?.forEach(outcome => {
        if (outcome.key_result) {
          const normalized = outcome.outcome_measured.toLowerCase()
            .replace(OUTCOME_NORM_REGEX, '')
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

  const handleCopySummary = async () => {
    if (!narrativeSummary) return;

    try {
      await navigator.clipboard.writeText(narrativeSummary);
      setCopied(true);
      toast.success('Synthesis summary copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      toast.error('Failed to copy summary');
    }
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
            {(openalexCount !== undefined || semanticScholarCount !== undefined || arxivCount !== undefined) && (
              <span className="ml-2 text-xs">
                ({openalexCount || 0} OpenAlex, {semanticScholarCount || 0} Semantic Scholar, {arxivCount || 0} arXiv)
              </span>
            )}
          </div>
        </div>

        {/* Synthesis Summary - PROMINENT PLACEMENT */}
        <div className="rounded-lg border-l-4 border-l-blue-500 bg-gradient-to-r from-blue-50 to-transparent p-4 dark:from-blue-950/30">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-blue-900 dark:text-blue-100">Research Synthesis</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-blue-900 hover:bg-blue-100 dark:text-blue-100 dark:hover:bg-blue-900"
              onClick={handleCopySummary}
              aria-label="Copy synthesis summary"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
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

            <Button
              onClick={handleExportCSV}
              variant="outline"
              size="sm"
              className="gap-2"
              aria-label="Export all results as CSV"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </Button>

            <Button
              onClick={handleExportRIS}
              variant="outline"
              size="sm"
              className="gap-2"
              aria-label="Export all results as RIS citation file"
            >
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
