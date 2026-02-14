import { useMemo, useState } from 'react';
import { Code, Download, Eye, EyeOff, FileText, Table2, List, ChevronLeft, ChevronRight, Grid3X3 } from 'lucide-react';
import type { StudyResult, StudyPdf } from '@/types/research';
import { StudyCard } from './StudyCard';
import { SynthesisView } from './SynthesisView';
import { TableView } from './TableView';
import { PaperResultsTable } from './PaperResultsTable';
import { CompareDialog } from './CompareDialog';
import { NarrativeSynthesis } from './NarrativeSynthesis';
import { Button } from './ui/button';
import { downloadRISFile } from '@/lib/risExport';
import { downloadCSV } from '@/lib/csvExport';
import { downloadPaperCSV } from '@/lib/csvPaperExport';
import { sortByRelevance, isLowValueStudy, getOutcomeText } from '@/utils/relevanceScore';
import { FilterBar, type SortOption, type StudyDesignFilter } from './FilterBar';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

const OUTCOME_NORM_REGEX = /\b(symptoms?|levels?|scores?)\b/g;
const PAGE_SIZE = 25;

type ViewMode = 'synthesis' | 'table' | 'pico' | 'cards';

interface ResultsTableProps {
  results: StudyResult[];
  query: string;
  normalizedQuery?: string;
  totalPapersSearched: number;
  openalexCount?: number;
  semanticScholarCount?: number;
  arxivCount?: number;
  pdfsByDoi?: Record<string, StudyPdf>;
  reportId?: string;
  cachedSynthesis?: string | null;
}

export function ResultsTable({
  results,
  query,
  normalizedQuery,
  totalPapersSearched,
  openalexCount,
  semanticScholarCount,
  arxivCount,
  pdfsByDoi = {},
  reportId,
  cachedSynthesis,
}: ResultsTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('synthesis');
  const [showExcludedStudies, setShowExcludedStudies] = useState(false);
  const [showJSON, setShowJSON] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [studyDesign, setStudyDesign] = useState<StudyDesignFilter>('all');
  const [explicitOnly, setExplicitOnly] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [compareStudies, setCompareStudies] = useState<StudyResult[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const activeQuery = normalizedQuery || query;

  const filteredByAbstract = useMemo(() =>
    results.filter(s => s.abstract_excerpt && s.abstract_excerpt.trim().length >= 50),
    [results]
  );

  const scoredResults = useMemo(() => sortByRelevance(filteredByAbstract, activeQuery), [filteredByAbstract, activeQuery]);

  const { mainStudies, excludedStudies } = useMemo(() => {
    const main: typeof scoredResults = [];
    const excluded: typeof scoredResults = [];

    const base = sortBy === 'year'
      ? [...scoredResults].sort((a, b) => b.year - a.year)
      : scoredResults;

    base.forEach((study) => {
      if (studyDesign !== 'all') {
        const matchesDesign =
          (studyDesign === 'meta' && study.review_type === 'Meta-analysis') ||
          (studyDesign === 'review' && (study.study_design === 'review' || study.review_type === 'Systematic review')) ||
          (studyDesign === 'rct' && (study.study_design === 'RCT' || study.study_design?.toLowerCase().includes('rct'))) ||
          (studyDesign === 'cohort' && study.study_design === 'cohort') ||
          (studyDesign === 'cross-sectional' && study.study_design === 'cross-sectional') ||
          (studyDesign === 'unknown' && study.study_design === 'unknown');
        if (!matchesDesign) return;
      }

      const outcomesText = getOutcomeText(study);
      const isExplicitMatch = (study.outcomes?.length || 0) > 0 && !outcomesText.includes('no outcomes reported');
      if (explicitOnly && !isExplicitMatch) return;

      if (isLowValueStudy(study, study.relevanceScore)) {
        excluded.push(study);
      } else {
        main.push(study);
      }
    });

    return { mainStudies: main, excludedStudies: excluded };
  }, [scoredResults, sortBy, studyDesign, explicitOnly]);

  // Reset page when filters change
  useMemo(() => setCurrentPage(1), [studyDesign, explicitOnly, sortBy]);

  const totalPages = Math.ceil(mainStudies.length / PAGE_SIZE);
  const paginatedStudies = mainStudies.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // narrativeSummary removed -- replaced by LLM-generated NarrativeSynthesis component

  const outcomeAggregation = useMemo(() => {
    const outcomeMap = new Map<string, Array<{ study: StudyResult; result: string }>>();
    mainStudies.forEach(study => {
      study.outcomes?.forEach(outcome => {
        if (outcome.key_result) {
          const normalized = outcome.outcome_measured.toLowerCase().replace(OUTCOME_NORM_REGEX, '').trim();
          if (!outcomeMap.has(normalized)) outcomeMap.set(normalized, []);
          outcomeMap.get(normalized)!.push({ study, result: outcome.key_result });
        }
      });
    });
    return Array.from(outcomeMap.entries())
      .map(([outcome, studies]) => ({ outcome, studyCount: studies.length, studies }))
      .sort((a, b) => b.studyCount - a.studyCount);
  }, [mainStudies]);

  const handleExportRIS = () => downloadRISFile(mainStudies, `research-${Date.now()}.ris`);
  const handleExportCSVOutcomes = () => downloadCSV(mainStudies, `research-outcomes-${Date.now()}.csv`);
  const handleExportCSVPapers = () => downloadPaperCSV(mainStudies, `research-papers-${Date.now()}.csv`);
  const handleExportSelected = (selected: StudyResult[]) => downloadCSV(selected, `selected-${Date.now()}.csv`);
  const handleCompare = (selected: StudyResult[]) => {
    setCompareStudies(selected);
    setCompareOpen(true);
  };

  if (results.length === 0) return null;

  const showPagination = totalPages > 1;
  const startItem = (currentPage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(currentPage * PAGE_SIZE, mainStudies.length);

  return (
    <div className="w-full animate-fade-in">
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

        {reportId ? (
          <NarrativeSynthesis
            reportId={reportId}
            studies={mainStudies}
            query={activeQuery}
            cachedSynthesis={cachedSynthesis}
          />
        ) : (
          <div className="rounded-lg border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent p-4">
            <h3 className="mb-2 font-semibold text-foreground">Research Synthesis</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {mainStudies.length} studies found across {totalPapersSearched} papers searched.
            </p>
          </div>
        )}

        <FilterBar
          sortBy={sortBy}
          onSortByChange={setSortBy}
          studyDesign={studyDesign}
          onStudyDesignChange={setStudyDesign}
          explicitOnly={explicitOnly}
          onExplicitOnlyChange={setExplicitOnly}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="synthesis" className="gap-2">
                <FileText className="h-4 w-4" />Synthesis
              </TabsTrigger>
              <TabsTrigger value="table" className="gap-2">
                <Table2 className="h-4 w-4" />Table
              </TabsTrigger>
              <TabsTrigger value="pico" className="gap-2">
                <Grid3X3 className="h-4 w-4" />PICO Table
              </TabsTrigger>
              <TabsTrigger value="cards" className="gap-2">
                <List className="h-4 w-4" />Cards
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2">
            {excludedStudies.length > 0 && (
              <Button onClick={() => setShowExcludedStudies(!showExcludedStudies)} variant="outline" size="sm" className="gap-2">
                {showExcludedStudies ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {showExcludedStudies ? 'Hide' : 'Show'} excluded ({excludedStudies.length})
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="h-4 w-4" />Export CSV
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCSVPapers}>CSV (Paper-level)</DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportCSVOutcomes}>CSV (Outcomes)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={handleExportRIS} variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />Export RIS
            </Button>
            {import.meta.env.DEV && (
              <>
                <Button onClick={() => setShowJSON(!showJSON)} variant="outline" size="sm" className="gap-2">
                  <Code className="h-4 w-4" />JSON
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
            <pre className="overflow-x-auto text-xs">{JSON.stringify(mainStudies, null, 2)}</pre>
          </div>
        )}
      </div>

      {viewMode === 'synthesis' && (
        <SynthesisView
          studies={paginatedStudies}
          outcomeAggregation={outcomeAggregation}
          query={activeQuery}
          pdfsByDoi={pdfsByDoi}
        />
      )}

      {viewMode === 'table' && (
        <PaperResultsTable
          studies={paginatedStudies}
          query={activeQuery}
          pdfsByDoi={pdfsByDoi}
          onExportSelected={handleExportSelected}
          onCompare={handleCompare}
        />
      )}

      {viewMode === 'pico' && (
        <TableView
          studies={paginatedStudies}
          query={activeQuery}
          showScoreBreakdown={showScoreBreakdown}
          pdfsByDoi={pdfsByDoi}
          onExportSelected={handleExportSelected}
          onCompare={handleCompare}
        />
      )}

      {viewMode === 'cards' && (
        <div className="space-y-4">
          {paginatedStudies.map((study) => (
            <StudyCard
              key={study.study_id}
              study={study}
              query={activeQuery}
              relevanceScore={study.relevanceScore}
              showScoreBreakdown={showScoreBreakdown}
              pdfData={study.citation.doi ? pdfsByDoi[study.citation.doi] : undefined}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {showPagination && (
        <div className="mt-6 flex items-center justify-between rounded-lg border bg-card p-3">
          <span className="text-sm text-muted-foreground">
            Showing {startItem}–{endItem} of {mainStudies.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="gap-1"
            >
              Next<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

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
                pdfData={study.citation.doi ? pdfsByDoi[study.citation.doi] : undefined}
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

      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} studies={compareStudies} />
    </div>
  );
}
