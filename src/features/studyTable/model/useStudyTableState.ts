import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadCSV } from '@/shared/lib/csvExport';
import { downloadPaperCSV } from '@/shared/lib/csvPaperExport';
import { downloadRISFile } from '@/shared/lib/risExport';
import { calculateRelevanceScore } from '@/utils/relevanceScore';
import type {
  ClaimSentence,
  CoverageReport,
  EvidenceRow,
  ExtractionStats,
  SearchStats,
  StudyResult,
} from '@/shared/types/research';
import { buildPaginationWindow, selectStudies } from '@/features/studyTable/model/studyTableSelectors';

export type ViewMode = 'summary' | 'studies';
export type SortOption = 'relevance' | 'year';
export type StudyDesignFilter = 'all' | 'meta' | 'review' | 'rct' | 'cohort' | 'cross-sectional' | 'unknown';

export interface StudyTableStateInput {
  results: StudyResult[];
  partialResults?: StudyResult[] | null;
  query: string;
  normalizedQuery?: string;
  reportId?: string;
  activeExtractionRunId?: string | null;
  briefSentences?: ClaimSentence[] | null;
  searchStats?: SearchStats | null;
  extractionStats?: ExtractionStats | null;
  coverageReport?: CoverageReport | null;
  evidenceTable?: EvidenceRow[] | null;
}

interface ReportViewPreferences {
  activeTab: ViewMode;
  sortBy: SortOption;
  studyDesign: StudyDesignFilter;
  explicitOnly: boolean;
  localFind: string;
}

export interface ScoredStudy extends StudyResult {
  relevanceScore: number;
  completenessTier: 'strict' | 'partial';
  stableIndex: number;
}

export interface SummaryReference {
  number: number;
  studyId: string;
  label: string;
  title: string;
}

export interface SummaryClaim {
  text: string;
  refs: number[];
  refStudyIds: string[];
}

const PAGE_SIZE = 25;
const FILTER_DEBOUNCE_MS = 200;
const DESIGNS: StudyDesignFilter[] = ['all', 'meta', 'review', 'rct', 'cohort', 'cross-sectional', 'unknown'];

function storageKey(reportId?: string): string {
  return `report-view-preferences:${reportId || 'default'}`;
}

function trackReportEvent(name: string, payload: Record<string, unknown> = {}) {
  const eventPayload = { name, payload, ts: Date.now() };
  window.dispatchEvent(new CustomEvent('report-ui-event', { detail: eventPayload }));
  if (import.meta.env.DEV) console.debug('[report-ui-event]', eventPayload);
}

function loadPrefs(reportId?: string): ReportViewPreferences {
  const defaults: ReportViewPreferences = {
    activeTab: 'summary',
    sortBy: 'relevance',
    studyDesign: 'all',
    explicitOnly: false,
    localFind: '',
  };

  try {
    const raw = localStorage.getItem(storageKey(reportId));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<ReportViewPreferences>;
    return {
      activeTab: parsed.activeTab === 'studies' ? 'studies' : 'summary',
      sortBy: parsed.sortBy === 'year' ? 'year' : 'relevance',
      studyDesign: DESIGNS.includes(parsed.studyDesign as StudyDesignFilter)
        ? (parsed.studyDesign as StudyDesignFilter)
        : 'all',
      explicitOnly: !!parsed.explicitOnly,
      localFind: typeof parsed.localFind === 'string' ? parsed.localFind : '',
    };
  } catch {
    return defaults;
  }
}

function extractCitationFirstAuthor(citation: string | null | undefined): string {
  if (!citation) return 'Unknown';
  const firstPart = citation.split(',')[0] || citation;
  return firstPart.replace(/\set al\.?$/i, '').trim();
}

export function useStudyTableState(input: StudyTableStateInput) {
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

  const totalInputStudies = input.results.length + (input.partialResults?.length || 0);

  useEffect(() => {
    if (totalInputStudies === 0) return;
    trackReportEvent('report_results_loaded', { reportId: input.reportId || null, totalStudies: totalInputStudies });
  }, [totalInputStudies, input.reportId]);

  useEffect(() => {
    const prefs = loadPrefs(input.reportId);
    setViewMode(prefs.activeTab);
    setSortBy(prefs.sortBy);
    setStudyDesign(prefs.studyDesign);
    setExplicitOnly(prefs.explicitOnly);
    setFindInput(prefs.localFind);
    setDebouncedFind(prefs.localFind.trim().toLowerCase());
    setPrefsLoaded(true);
  }, [input.reportId]);

  useEffect(() => {
    if (!prefsLoaded) return;
    localStorage.setItem(storageKey(input.reportId), JSON.stringify({
      activeTab: viewMode,
      sortBy,
      studyDesign,
      explicitOnly,
      localFind: findInput,
    } satisfies ReportViewPreferences));
  }, [prefsLoaded, viewMode, sortBy, studyDesign, explicitOnly, findInput, input.reportId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedFind(findInput.trim().toLowerCase()), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [findInput]);

  const trackFirstInteraction = useCallback((source: string) => {
    if (firstInteractionTracked) return;
    setFirstInteractionTracked(true);
    trackReportEvent('report_first_interaction', { source });
  }, [firstInteractionTracked]);

  const normalizedStudies = useMemo(() => {
    const byId = new Map<string, ScoredStudy>();
    let stableIndex = 0;
    for (const study of input.results) {
      if (!study?.study_id) continue;
      byId.set(study.study_id, {
        ...study,
        relevanceScore: calculateRelevanceScore(study, input.query),
        completenessTier: 'strict',
        stableIndex: stableIndex++,
      });
    }
    for (const study of input.partialResults || []) {
      if (!study?.study_id || byId.has(study.study_id)) continue;
      byId.set(study.study_id, {
        ...study,
        relevanceScore: calculateRelevanceScore(study, input.query),
        completenessTier: 'partial',
        stableIndex: stableIndex++,
      });
    }
    return byId;
  }, [input.results, input.partialResults, input.query]);

  const { mainStudies, excludedStudies } = useMemo(
    () => selectStudies({
      studies: Array.from(normalizedStudies.values()),
      sortBy,
      studyDesign,
      explicitOnly,
      debouncedFind,
    }),
    [normalizedStudies, sortBy, studyDesign, explicitOnly, debouncedFind],
  );

  const totalPages = Math.max(1, Math.ceil(mainStudies.length / PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const paginatedStudies = useMemo(
    () => mainStudies.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [mainStudies, currentPage],
  );

  const summaryData = useMemo(() => {
    const claimsSource = (input.briefSentences || []).slice(0, 3);
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
            label: `${extractCitationFirstAuthor(study.citation.formatted)} (${study.year})`,
            title: study.title,
          });
        }
        const refNumber = numberByStudyId.get(studyId);
        if (refNumber && !refNums.includes(refNumber)) {
          refNums.push(refNumber);
          refStudyIds.push(studyId);
        }
      }
      return { text: sentence.text, refs: refNums, refStudyIds };
    });

    return { claims, references };
  }, [input.briefSentences, mainStudies]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (studyDesign !== 'all') count += 1;
    if (explicitOnly) count += 1;
    if (findInput.trim()) count += 1;
    return count;
  }, [studyDesign, explicitOnly, findInput]);

  const handleExportRIS = useCallback(() => {
    trackFirstInteraction('export_ris');
    trackReportEvent('report_export', { type: 'ris', studies: mainStudies.length });
    downloadRISFile(mainStudies, `research-${Date.now()}.ris`);
  }, [trackFirstInteraction, mainStudies]);

  const handleExportCSVOutcomes = useCallback(() => {
    trackFirstInteraction('export_outcomes_csv');
    trackReportEvent('report_export', { type: 'csv_outcomes', studies: mainStudies.length });
    downloadCSV(mainStudies, `research-outcomes-${Date.now()}.csv`);
  }, [trackFirstInteraction, mainStudies]);

  const handleExportCSVPapers = useCallback(() => {
    trackFirstInteraction('export_papers_csv');
    trackReportEvent('report_export', { type: 'csv_papers', studies: mainStudies.length });
    downloadPaperCSV(mainStudies, `research-papers-${Date.now()}.csv`);
  }, [trackFirstInteraction, mainStudies]);

  const handleExportManifest = useCallback(() => {
    const manifest = {
      reportId: input.reportId || null,
      activeExtractionRunId: input.activeExtractionRunId || null,
      query: input.query,
      normalizedQuery: input.normalizedQuery || null,
      filters: { sortBy, studyDesign, explicitOnly, localFind: findInput },
      totals: {
        visible: mainStudies.length,
        excluded: excludedStudies.length,
        totalInputStudies,
      },
      searchStats: input.searchStats || null,
      extractionStats: input.extractionStats || null,
      coverageReport: input.coverageReport || null,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `study-export-manifest-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [
    input.reportId,
    input.activeExtractionRunId,
    input.query,
    input.normalizedQuery,
    sortBy,
    studyDesign,
    explicitOnly,
    findInput,
    mainStudies.length,
    excludedStudies.length,
    totalInputStudies,
    input.searchStats,
    input.extractionStats,
    input.coverageReport,
  ]);

  const toggleRow = useCallback((studyId: string) => {
    trackFirstInteraction('row_expand_toggle');
    trackReportEvent('study_row_toggle', { studyId });
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(studyId)) next.delete(studyId);
      else next.add(studyId);
      return next;
    });
  }, [trackFirstInteraction]);

  const toggleSnippet = useCallback((key: string) => {
    setExpandedSnippets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return {
    PAGE_SIZE,
    totalInputStudies,
    viewMode,
    setViewMode,
    sortBy,
    setSortBy,
    studyDesign,
    setStudyDesign,
    explicitOnly,
    setExplicitOnly,
    findInput,
    setFindInput,
    showExcludedStudies,
    setShowExcludedStudies,
    currentPage,
    setCurrentPage,
    expandedRows,
    expandedSnippets,
    highlightedStudyId,
    setHighlightedStudyId,
    pendingScrollStudyId,
    setPendingScrollStudyId,
    referenceListOpen,
    setReferenceListOpen,
    trackFirstInteraction,
    mainStudies,
    excludedStudies,
    paginatedStudies,
    summaryData,
    activeFilterCount,
    totalPages,
    pageWindow: buildPaginationWindow(currentPage, totalPages, 5),
    startItem: mainStudies.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1,
    endItem: Math.min(currentPage * PAGE_SIZE, mainStudies.length),
    handleExportRIS,
    handleExportCSVOutcomes,
    handleExportCSVPapers,
    handleExportManifest,
    handleResetFilters: () => {
      trackFirstInteraction('reset_filters');
      trackReportEvent('report_filter_reset');
      setSortBy('relevance');
      setStudyDesign('all');
      setExplicitOnly(false);
      setFindInput('');
      setDebouncedFind('');
      setCurrentPage(1);
    },
    handleReferenceClick: (studyId: string) => {
      trackFirstInteraction('summary_reference_click');
      trackReportEvent('summary_reference_click', { studyId });
      const studyIndex = mainStudies.findIndex((study) => study.study_id === studyId);
      if (studyIndex < 0) return;
      const targetPage = Math.floor(studyIndex / PAGE_SIZE) + 1;
      setViewMode('studies');
      setCurrentPage(targetPage);
      setPendingScrollStudyId(studyId);
    },
    toggleRow,
    toggleSnippet,
  };
}
