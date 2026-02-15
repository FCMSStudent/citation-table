import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Info,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import type {
  ClaimSentence,
  CoverageReport,
  EvidenceRow,
  ExtractionStats,
  SearchStats,
  StudyPdf,
  StudyResult,
} from '@/shared/types/research';
import { NarrativeSynthesis } from './NarrativeSynthesis';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Switch } from '@/shared/ui/switch';
import { Input } from '@/shared/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu';
import { downloadRISFile } from '@/shared/lib/risExport';
import { downloadCSV } from '@/shared/lib/csvExport';
import { downloadPaperCSV } from '@/shared/lib/csvPaperExport';
import { calculateRelevanceScore, getOutcomeText, isLowValueStudy } from '@/utils/relevanceScore';
import { cn, sanitizeUrl } from '@/shared/lib/utils';

type ViewMode = 'summary' | 'studies';
type SortOption = 'relevance' | 'year';
type StudyDesignFilter = 'all' | 'meta' | 'review' | 'rct' | 'cohort' | 'cross-sectional' | 'unknown';

interface ResultsTableProps {
  results: StudyResult[];
  partialResults?: StudyResult[] | null;
  query: string;
  normalizedQuery?: string;
  totalPapersSearched: number;
  openalexCount?: number;
  semanticScholarCount?: number;
  arxivCount?: number;
  pubmedCount?: number;
  pdfsByDoi?: Record<string, StudyPdf>;
  reportId?: string;
  cachedSynthesis?: string | null;
  evidenceTable?: EvidenceRow[] | null;
  briefSentences?: ClaimSentence[] | null;
  coverageReport?: CoverageReport | null;
  searchStats?: SearchStats | null;
  extractionStats?: ExtractionStats | null;
}

interface ReportViewPreferences {
  activeTab: ViewMode;
  sortBy: SortOption;
  studyDesign: StudyDesignFilter;
  explicitOnly: boolean;
  localFind: string;
}

interface ScoredStudy extends StudyResult {
  relevanceScore: number;
  completenessTier: 'strict' | 'partial';
}

interface SummaryClaim {
  text: string;
  refs: number[];
  refStudyIds: string[];
}

interface SummaryReference {
  number: number;
  studyId: string;
  label: string;
  title: string;
}

const PAGE_SIZE = 25;
const FILTER_DEBOUNCE_MS = 200;

function getPreferencesKey(reportId?: string): string {
  return `report-view-preferences:${reportId || 'default'}`;
}

function loadPreferences(reportId?: string): ReportViewPreferences {
  const defaults: ReportViewPreferences = {
    activeTab: 'summary',
    sortBy: 'relevance',
    studyDesign: 'all',
    explicitOnly: false,
    localFind: '',
  };

  try {
    const raw = localStorage.getItem(getPreferencesKey(reportId));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ReportViewPreferences>;
    return {
      activeTab: parsed.activeTab === 'studies' ? 'studies' : 'summary',
      sortBy: parsed.sortBy === 'year' ? 'year' : 'relevance',
      studyDesign: (
        ['all', 'meta', 'review', 'rct', 'cohort', 'cross-sectional', 'unknown'] as StudyDesignFilter[]
      ).includes(parsed.studyDesign as StudyDesignFilter)
        ? (parsed.studyDesign as StudyDesignFilter)
        : 'all',
      explicitOnly: !!parsed.explicitOnly,
      localFind: typeof parsed.localFind === 'string' ? parsed.localFind : '',
    };
  } catch {
    return defaults;
  }
}

function trackReportEvent(name: string, payload: Record<string, unknown> = {}) {
  const eventPayload = { name, payload, ts: Date.now() };
  window.dispatchEvent(new CustomEvent('report-ui-event', { detail: eventPayload }));
  if (import.meta.env.DEV) {
    console.debug('[report-ui-event]', eventPayload);
  }
}

function getFirstAuthor(citation: string | null | undefined): string {
  if (!citation) return 'Unknown';
  const firstPart = citation.split(',')[0] || citation;
  return firstPart.replace(/\set al\.?$/i, '').trim();
}

function normalizeOpenAlexUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return sanitizeUrl(value);
  return sanitizeUrl(`https://openalex.org/${value}`);
}

function buildSearchBlob(study: StudyResult): string {
  const outcomesText = (study.outcomes || [])
    .map((o) => `${o.outcome_measured || ''} ${o.key_result || ''} ${o.citation_snippet || ''}`)
    .join(' ');

  return [
    study.title,
    study.study_design,
    study.sample_size ?? '',
    study.population ?? '',
    study.abstract_excerpt ?? '',
    study.citation.formatted ?? '',
    outcomesText,
  ]
    .join(' ')
    .toLowerCase();
}

function matchesStudyDesign(study: StudyResult, design: StudyDesignFilter): boolean {
  if (design === 'all') return true;
  if (design === 'meta') return study.review_type === 'Meta-analysis';
  if (design === 'review') return study.study_design === 'review' || study.review_type === 'Systematic review';
  if (design === 'rct') return study.study_design === 'RCT' || study.study_design?.toLowerCase().includes('rct');
  if (design === 'cohort') return study.study_design === 'cohort';
  if (design === 'cross-sectional') return study.study_design === 'cross-sectional';
  return study.study_design === 'unknown';
}

function buildPageWindow(current: number, total: number, windowSize = 5): number[] {
  if (total <= 0) return [];
  const clampedCurrent = Math.min(Math.max(current, 1), total);
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, clampedCurrent - half);
  const end = Math.min(total, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages: number[] = [];
  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }
  return pages;
}

export function ResultsTable({
  results,
  partialResults = [],
  query,
  normalizedQuery,
  totalPapersSearched,
  openalexCount,
  semanticScholarCount,
  arxivCount,
  pubmedCount,
  pdfsByDoi = {},
  reportId,
  cachedSynthesis,
  evidenceTable,
  briefSentences,
  coverageReport,
  searchStats,
  extractionStats,
}: ResultsTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [studyDesign, setStudyDesign] = useState<StudyDesignFilter>('all');
  const [explicitOnly, setExplicitOnly] = useState(false);
  const [findInput, setFindInput] = useState('');
  const [debouncedFind, setDebouncedFind] = useState('');
  const [showExcludedStudies, setShowExcludedStudies] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedSnippets, setExpandedSnippets] = useState<Set<string>>(new Set());
  const [highlightedStudyId, setHighlightedStudyId] = useState<string | null>(null);
  const [pendingScrollStudyId, setPendingScrollStudyId] = useState<string | null>(null);
  const [referenceListOpen, setReferenceListOpen] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [firstInteractionTracked, setFirstInteractionTracked] = useState(false);
  const totalInputStudies = results.length + (partialResults?.length || 0);

  useEffect(() => {
    if (totalInputStudies === 0) return;
    trackReportEvent('report_results_loaded', {
      reportId: reportId || null,
      totalStudies: totalInputStudies,
    });
  }, [totalInputStudies, reportId]);

  useEffect(() => {
    const prefs = loadPreferences(reportId);
    setViewMode(prefs.activeTab);
    setSortBy(prefs.sortBy);
    setStudyDesign(prefs.studyDesign);
    setExplicitOnly(prefs.explicitOnly);
    setFindInput(prefs.localFind);
    setDebouncedFind(prefs.localFind.trim().toLowerCase());
    setPrefsLoaded(true);
  }, [reportId]);

  useEffect(() => {
    if (!prefsLoaded) return;
    const payload: ReportViewPreferences = {
      activeTab: viewMode,
      sortBy,
      studyDesign,
      explicitOnly,
      localFind: findInput,
    };
    localStorage.setItem(getPreferencesKey(reportId), JSON.stringify(payload));
  }, [prefsLoaded, viewMode, sortBy, studyDesign, explicitOnly, findInput, reportId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedFind(findInput.trim().toLowerCase());
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [findInput]);

  const trackFirstInteraction = useCallback((source: string) => {
    if (firstInteractionTracked) return;
    setFirstInteractionTracked(true);
    trackReportEvent('report_first_interaction', { source });
  }, [firstInteractionTracked]);

  const { mainStudies, excludedStudies } = useMemo(() => {
    const scoredById = new Map<string, ScoredStudy>();
    for (const study of results) {
      if (!study?.study_id) continue;
      scoredById.set(study.study_id, {
        ...study,
        relevanceScore: calculateRelevanceScore(study, query),
        completenessTier: 'strict',
      });
    }
    for (const study of partialResults || []) {
      if (!study?.study_id || scoredById.has(study.study_id)) continue;
      scoredById.set(study.study_id, {
        ...study,
        relevanceScore: calculateRelevanceScore(study, query),
        completenessTier: 'partial',
      });
    }
    const scored = Array.from(scoredById.values());

    scored.sort((a, b) => {
      if (a.completenessTier !== b.completenessTier) {
        return a.completenessTier === 'strict' ? -1 : 1;
      }
      if (sortBy === 'year') return b.year - a.year;
      return b.relevanceScore - a.relevanceScore;
    });

    const filtered = scored.filter((study) => {
      if (!matchesStudyDesign(study, studyDesign)) return false;

      const outcomesText = getOutcomeText(study);
      const isExplicitMatch = (study.outcomes?.length || 0) > 0 && !outcomesText.includes('no outcomes reported');
      if (explicitOnly && !isExplicitMatch) return false;

      if (debouncedFind) {
        const haystack = buildSearchBlob(study);
        if (!haystack.includes(debouncedFind)) return false;
      }

      return true;
    });

    const main: ScoredStudy[] = [];
    const excluded: ScoredStudy[] = [];

    for (const study of filtered) {
      if (isLowValueStudy(study, study.relevanceScore)) excluded.push(study);
      else main.push(study);
    }

    return { mainStudies: main, excludedStudies: excluded };
  }, [results, partialResults, query, sortBy, studyDesign, explicitOnly, debouncedFind]);

  const totalPages = Math.max(1, Math.ceil(mainStudies.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const paginatedStudies = useMemo(
    () => mainStudies.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [mainStudies, currentPage],
  );

  const startItem = mainStudies.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(currentPage * PAGE_SIZE, mainStudies.length);

  const summaryData = useMemo(() => {
    const claimsSource = (briefSentences || []).slice(0, 3);
    const studyById = new Map(mainStudies.map((study) => [study.study_id, study]));
    const numberByStudyId = new Map<string, number>();
    const references: SummaryReference[] = [];

    const claims: SummaryClaim[] = claimsSource.map((sentence) => {
      const refNums: number[] = [];
      const refStudyIds: string[] = [];

      for (const citation of sentence.citations || []) {
        const studyId = citation.paper_id;
        const study = studyById.get(studyId);
        if (!study) continue;

        if (!numberByStudyId.has(studyId)) {
          const number = numberByStudyId.size + 1;
          numberByStudyId.set(studyId, number);
          references.push({
            number,
            studyId,
            label: `${getFirstAuthor(study.citation.formatted)} (${study.year})`,
            title: study.title,
          });
        }

        const refNumber = numberByStudyId.get(studyId);
        if (refNumber && !refNums.includes(refNumber)) {
          refNums.push(refNumber);
          refStudyIds.push(studyId);
        }
      }

      return {
        text: sentence.text,
        refs: refNums,
        refStudyIds,
      };
    });

    return { claims, references };
  }, [briefSentences, mainStudies]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (studyDesign !== 'all') count += 1;
    if (explicitOnly) count += 1;
    if (findInput.trim()) count += 1;
    return count;
  }, [studyDesign, explicitOnly, findInput]);

  const handleExportRIS = () => {
    trackFirstInteraction('export_ris');
    trackReportEvent('report_export', { type: 'ris', studies: mainStudies.length });
    downloadRISFile(mainStudies, `research-${Date.now()}.ris`);
  };

  const handleExportCSVOutcomes = () => {
    trackFirstInteraction('export_outcomes_csv');
    trackReportEvent('report_export', { type: 'csv_outcomes', studies: mainStudies.length });
    downloadCSV(mainStudies, `research-outcomes-${Date.now()}.csv`);
  };

  const handleExportCSVPapers = () => {
    trackFirstInteraction('export_papers_csv');
    trackReportEvent('report_export', { type: 'csv_papers', studies: mainStudies.length });
    downloadPaperCSV(mainStudies, `research-papers-${Date.now()}.csv`);
  };

  const handleViewChange = (nextMode: string) => {
    const safeMode: ViewMode = nextMode === 'studies' ? 'studies' : 'summary';
    if (safeMode === viewMode) return;
    trackFirstInteraction('view_switch');
    trackReportEvent('report_view_switch', { from: viewMode, to: safeMode });
    setViewMode(safeMode);
  };

  const handleSortChange = (value: string) => {
    const nextSort: SortOption = value === 'year' ? 'year' : 'relevance';
    trackFirstInteraction('sort_change');
    trackReportEvent('report_filter_change', { key: 'sortBy', value: nextSort });
    setSortBy(nextSort);
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    trackFirstInteraction('reset_filters');
    trackReportEvent('report_filter_reset');
    setSortBy('relevance');
    setStudyDesign('all');
    setExplicitOnly(false);
    setFindInput('');
    setDebouncedFind('');
    setCurrentPage(1);
  };

  const handleReferenceClick = (studyId: string) => {
    trackFirstInteraction('summary_reference_click');
    trackReportEvent('summary_reference_click', { studyId });
    const studyIndex = mainStudies.findIndex((study) => study.study_id === studyId);
    if (studyIndex < 0) return;
    const targetPage = Math.floor(studyIndex / PAGE_SIZE) + 1;
    setViewMode('studies');
    setCurrentPage(targetPage);
    setPendingScrollStudyId(studyId);
  };

  useEffect(() => {
    if (!pendingScrollStudyId || viewMode !== 'studies') return;
    const row = document.getElementById(`study-row-${pendingScrollStudyId}`);
    if (!row) return;

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedStudyId(pendingScrollStudyId);
    setPendingScrollStudyId(null);

    const timer = window.setTimeout(() => {
      setHighlightedStudyId((current) => (current === pendingScrollStudyId ? null : current));
    }, 1700);
    return () => window.clearTimeout(timer);
  }, [pendingScrollStudyId, viewMode, paginatedStudies]);

  const toggleRow = (studyId: string) => {
    trackFirstInteraction('row_expand_toggle');
    trackReportEvent('study_row_toggle', {
      studyId,
      expanded: !expandedRows.has(studyId),
    });
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(studyId)) next.delete(studyId);
      else next.add(studyId);
      return next;
    });
  };

  const toggleSnippet = (key: string) => {
    setExpandedSnippets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (totalInputStudies === 0) return null;

  const pageWindow = buildPageWindow(currentPage, totalPages, 5);

  return (
    <div className="w-full animate-fade-in">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>
          Found <strong>{mainStudies.length}</strong> relevant {mainStudies.length === 1 ? 'study' : 'studies'} from{' '}
          <strong>{totalPapersSearched}</strong> papers
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex items-center rounded text-muted-foreground hover:text-foreground">
              <Info className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[340px]">
            <div className="text-xs">
              <h4 className="mb-2 font-semibold text-foreground">Methodology details</h4>
              <table className="w-full text-left">
                <tbody className="divide-y divide-border/50">
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">OpenAlex</th>
                    <td className="py-1">{openalexCount ?? 0}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">Semantic Scholar</th>
                    <td className="py-1">{semanticScholarCount ?? 0}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">arXiv</th>
                    <td className="py-1">{arxivCount ?? 0}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">PubMed</th>
                    <td className="py-1">{pubmedCount ?? 0}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">Coverage</th>
                    <td className="py-1">
                      {coverageReport
                        ? `${coverageReport.providers_queried - coverageReport.providers_failed}/${coverageReport.providers_queried} healthy`
                        : '—'}
                    </td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">Pipeline latency</th>
                    <td className="py-1">{searchStats ? `${Math.round(searchStats.latency_ms / 1000)}s` : '—'}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">Retrieved total</th>
                    <td className="py-1">{searchStats?.retrieved_total ?? '—'}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">Abstract-eligible</th>
                    <td className="py-1">{searchStats?.abstract_eligible_total ?? '—'}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">Quality-kept</th>
                    <td className="py-1">{searchStats?.quality_kept_total ?? '—'}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">Extraction inputs</th>
                    <td className="py-1">{searchStats?.extraction_input_total ?? extractionStats?.total_inputs ?? '—'}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">Strict complete</th>
                    <td className="py-1">{searchStats?.strict_complete_total ?? extractionStats?.complete_total ?? '—'}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">Partial complete</th>
                    <td className="py-1">{searchStats?.partial_total ?? extractionStats?.partial_total ?? '—'}</td>
                  </tr>
                  <tr>
                    <th className="py-1 pr-3 font-medium text-muted-foreground">Evidence rows</th>
                    <td className="py-1">{evidenceTable?.length ?? 0}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="sticky top-[68px] z-20 mb-4 rounded-lg border bg-background/95 p-2 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tabs value={viewMode} onValueChange={handleViewChange}>
            <TabsList>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="studies">Studies</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              aria-label="Sort studies"
            >
              <option value="relevance">Sort: Relevance</option>
              <option value="year">Sort: Year</option>
            </select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCSVPapers}>CSV (Paper-level)</DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportCSVOutcomes}>CSV (Outcomes)</DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportRIS}>RIS</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                  <Filter className="h-4 w-4" />
                  More filters
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {activeFilterCount}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-[320px] p-3"
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <div className="space-y-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Study design</label>
                    <select
                      value={studyDesign}
                      onChange={(e) => {
                        trackFirstInteraction('study_design_filter');
                        trackReportEvent('report_filter_change', { key: 'studyDesign', value: e.target.value });
                        setStudyDesign(e.target.value as StudyDesignFilter);
                        setCurrentPage(1);
                      }}
                      className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="all">All</option>
                      <option value="rct">RCT</option>
                      <option value="cohort">Cohort</option>
                      <option value="cross-sectional">Cross-sectional</option>
                      <option value="meta">Meta-analysis</option>
                      <option value="review">Review</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <label htmlFor="explicit-only-filter" className="text-sm text-foreground">Explicit outcomes only</label>
                    <Switch
                      id="explicit-only-filter"
                      checked={explicitOnly}
                      onCheckedChange={(checked) => {
                        trackFirstInteraction('explicit_filter');
                        trackReportEvent('report_filter_change', { key: 'explicitOnly', value: checked });
                        setExplicitOnly(checked);
                        setCurrentPage(1);
                      }}
                    />
                  </div>

                  <div>
                    <label htmlFor="find-results-filter" className="text-xs font-medium text-muted-foreground">
                      Find in results
                    </label>
                    <Input
                      id="find-results-filter"
                      value={findInput}
                      onChange={(e) => {
                        trackFirstInteraction('find_filter');
                        setFindInput(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Filter visible fields..."
                      className="mt-1 h-9"
                    />
                  </div>

                  <Button type="button" variant="ghost" size="sm" className="w-full gap-2" onClick={handleResetFilters}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset filters
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {viewMode === 'summary' && (
        <div className="space-y-4">
          {reportId ? (
            <NarrativeSynthesis
              reportId={reportId}
              studies={mainStudies}
              query={normalizedQuery || query}
              cachedSynthesis={cachedSynthesis}
              truncateLines={6}
            />
          ) : (
            <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              Summary generation is unavailable for this report context.
            </div>
          )}

          {summaryData.claims.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground">Key findings</h3>
              <ol className="mt-3 space-y-2">
                {summaryData.claims.map((claim, idx) => (
                  <li key={`${idx}-${claim.text.slice(0, 20)}`} className="text-sm leading-relaxed text-foreground">
                    {claim.text}{' '}
                    <span className="inline-flex flex-wrap gap-1 align-middle">
                      {claim.refs.map((refNumber, refIndex) => {
                        const studyId = claim.refStudyIds[refIndex];
                        return (
                          <button
                            key={`${idx}-${refNumber}`}
                            type="button"
                            onClick={() => handleReferenceClick(studyId)}
                            className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40"
                            aria-label={`Go to reference ${refNumber}`}
                          >
                            [{refNumber}]
                          </button>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ol>

              {summaryData.references.length > 0 && (
                <Collapsible open={referenceListOpen} onOpenChange={setReferenceListOpen} className="mt-3">
                  <CollapsibleTrigger asChild>
                    <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      {referenceListOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      References ({summaryData.references.length})
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-1">
                    {summaryData.references.map((ref) => (
                      <button
                        key={ref.number}
                        type="button"
                        onClick={() => handleReferenceClick(ref.studyId)}
                        className="block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-muted/50"
                      >
                        <span className="font-medium">[{ref.number}]</span> {ref.label} - {ref.title}
                      </button>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}
        </div>
      )}

      {viewMode === 'studies' && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="border-b px-3 py-2 text-left font-medium">Paper</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Methods</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Outcomes</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Result</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Links</th>
                  <th className="border-b px-3 py-2 text-right font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {paginatedStudies.map((study) => {
                  const isExpanded = expandedRows.has(study.study_id);
                  const firstOutcomeResult = study.outcomes?.find((o) => o.key_result)?.key_result || '—';
                  const pdf = study.citation.doi ? pdfsByDoi[study.citation.doi] : undefined;
                  const openAlexUrl = normalizeOpenAlexUrl(study.citation.openalex_id);
                  const doiUrl = study.citation.doi ? sanitizeUrl(`https://doi.org/${study.citation.doi}`) : null;

                  return (
                    <Fragment key={study.study_id}>
                      <tr
                        id={`study-row-${study.study_id}`}
                        className={cn(
                          'border-b transition-colors',
                          highlightedStudyId === study.study_id && 'bg-primary/10',
                        )}
                      >
                        <td className="px-3 py-2 align-top">
                          <p className="font-medium text-foreground">{study.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {study.year}
                            {study.citation.formatted ? ` • ${study.citation.formatted}` : ''}
                          </p>
                        </td>
                        <td className="px-3 py-2 align-top text-muted-foreground">
                          <div className="space-y-1">
                            <Badge variant={study.completenessTier === 'strict' ? 'secondary' : 'outline'} className="w-fit text-[10px]">
                              {study.completenessTier === 'strict' ? 'Strict' : 'Partial'}
                            </Badge>
                            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                              {study.review_type === 'Meta-analysis' ? 'Meta-analysis' : study.study_design || 'Unknown'}
                            </span>
                            <p className="text-xs">N={study.sample_size?.toLocaleString() || 'NR'}</p>
                            <p className="text-xs">{study.population || 'Population not reported'}</p>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-muted-foreground">
                          {study.outcomes?.length ? (
                            <p className="text-xs leading-relaxed">
                              {study.outcomes.map((o) => o.outcome_measured).filter(Boolean).join('; ')}
                            </p>
                          ) : (
                            <span className="text-xs italic">Not reported</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-muted-foreground">
                          <p className="line-clamp-1 text-xs">{firstOutcomeResult}</p>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {doiUrl && (
                              <a href={doiUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                DOI <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {openAlexUrl && (
                              <a href={openAlexUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                OpenAlex <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {pdf?.status === 'downloaded' && pdf.public_url && (
                              <a href={sanitizeUrl(pdf.public_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                PDF <FileText className="h-3 w-3" />
                              </a>
                            )}
                            {pdf?.status === 'pending' && (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                PDF
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-right">
                          <button
                            type="button"
                            onClick={() => toggleRow(study.study_id)}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? 'Hide' : 'Show'}
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="border-b bg-muted/20">
                          <td colSpan={6} className="px-3 py-3">
                            <div className="space-y-3 text-sm">
                              <div>
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Result evidence</h4>
                                <div className="mt-2 space-y-2">
                                  {(study.outcomes || []).map((outcome, idx) => {
                                    const snippetKey = `${study.study_id}-${idx}`;
                                    const snippetOpen = expandedSnippets.has(snippetKey);
                                    return (
                                      <div key={snippetKey} className="rounded-md border bg-background p-2">
                                        <p className="text-xs font-medium text-foreground">{outcome.outcome_measured || 'Outcome'}</p>
                                        <p className="mt-0.5 text-xs text-muted-foreground">{outcome.key_result || 'Not reported'}</p>
                                        {(outcome.effect_size || outcome.p_value) && (
                                          <p className="mt-1 text-[11px] font-mono text-muted-foreground">
                                            {outcome.effect_size || '—'} {outcome.p_value ? `| p=${outcome.p_value}` : ''}
                                          </p>
                                        )}
                                        {outcome.citation_snippet && (
                                          <div className="mt-1">
                                            <button
                                              type="button"
                                              onClick={() => toggleSnippet(snippetKey)}
                                              className="text-[11px] text-primary hover:underline"
                                            >
                                              {snippetOpen ? 'Hide source quote' : 'Show source quote'}
                                            </button>
                                            {snippetOpen && (
                                              <blockquote className="mt-1 border-l-2 border-primary/30 pl-2 text-[11px] italic text-muted-foreground">
                                                {outcome.citation_snippet}
                                              </blockquote>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {(!study.outcomes || study.outcomes.length === 0) && (
                                    <p className="text-xs text-muted-foreground italic">No outcomes reported.</p>
                                  )}
                                </div>
                              </div>

                              <div className="rounded-md border bg-background p-2">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Study metadata</h4>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Design: {study.study_design || 'Unknown'} • Review type: {study.review_type || 'None'} • N={study.sample_size ?? 'NR'}
                                </p>
                                {study.abstract_excerpt && (
                                  <p className="mt-1 text-xs text-muted-foreground">{study.abstract_excerpt}</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {mainStudies.length === 0 && (
            <div className="rounded-lg border py-12 text-center text-muted-foreground">
              <p>No studies match your current filters.</p>
              <p className="mt-2 text-sm">Try widening criteria in More filters.</p>
            </div>
          )}

          {mainStudies.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
              <span className="text-sm text-muted-foreground">
                Showing {startItem}-{endItem} of {mainStudies.length}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => p - 1)}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>

                {pageWindow[0] > 1 && (
                  <>
                    <button type="button" onClick={() => setCurrentPage(1)} className="h-8 min-w-8 rounded border px-2 text-xs">
                      1
                    </button>
                    {pageWindow[0] > 2 && <span className="px-1 text-xs text-muted-foreground">…</span>}
                  </>
                )}

                {pageWindow.map((page) => (
                  <button
                    key={page}
                    type="button"
                    onClick={() => setCurrentPage(page)}
                    className={cn(
                      'h-8 min-w-8 rounded border px-2 text-xs',
                      page === currentPage ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {page}
                  </button>
                ))}

                {pageWindow[pageWindow.length - 1] < totalPages && (
                  <>
                    {pageWindow[pageWindow.length - 1] < totalPages - 1 && <span className="px-1 text-xs text-muted-foreground">…</span>}
                    <button type="button" onClick={() => setCurrentPage(totalPages)} className="h-8 min-w-8 rounded border px-2 text-xs">
                      {totalPages}
                    </button>
                  </>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => p + 1)}
                  className="gap-1"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {excludedStudies.length > 0 && (
            <div className="rounded-lg border pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowExcludedStudies((prev) => !prev);
                  trackReportEvent('excluded_studies_toggle', { open: !showExcludedStudies, count: excludedStudies.length });
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
              >
                <span className="text-muted-foreground">Excluded studies ({excludedStudies.length})</span>
                {showExcludedStudies ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {showExcludedStudies && (
                <div className="border-t p-3">
                  <ul className="space-y-2">
                    {excludedStudies.map((study) => (
                      <li key={`excluded-${study.study_id}`} className="rounded border bg-muted/20 p-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{study.title}</span> ({study.year}) • {study.completenessTier === 'strict' ? 'Strict' : 'Partial'} • Score {study.relevanceScore}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
