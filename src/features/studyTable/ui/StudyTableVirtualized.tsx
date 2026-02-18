import { useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type {
  ClaimSentence,
  CoverageReport,
  EvidenceRow,
  ExtractionStats,
  SearchStats,
  StudyPdf,
  StudyResult,
} from '@/shared/types/research';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/Collapsible';
import { NarrativeSynthesis } from '@/features/report-detail/ui/NarrativeSynthesis';
import { StudyTableProvider, useStudyTableContext } from '@/features/studyTable/ui/StudyTableContext';
import { StudyFiltersBar } from '@/features/studyTable/ui/StudyFiltersBar';
import { StudyPagination } from '@/features/studyTable/ui/StudyPagination';
import { StudyTableHeader } from '@/features/studyTable/ui/StudyTableHeader';
import { StudyTableRow } from '@/features/studyTable/ui/StudyTableRow';
import { useStudyTableState } from '@/features/studyTable/model/useStudyTableState';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';
import { TableHeaderCell } from '@/shared/ui/TablePrimitives';

interface StudyTableVirtualizedProps {
  results: StudyResult[];
  partialResults?: StudyResult[] | null;
  query: string;
  normalizedQuery?: string;
  activeExtractionRunId?: string | null;
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

function StudyRowsVirtualList({ pdfsByDoi }: { pdfsByDoi: Record<string, StudyPdf> }) {
  const state = useStudyTableContext();
  const parentRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(() => state.paginatedStudies, [state.paginatedStudies]);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
  });

  useEffect(() => {
    if (!state.pendingScrollStudyId || state.viewMode !== 'studies') return;
    const row = document.getElementById(`study-row-${state.pendingScrollStudyId}`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    state.setHighlightedStudyId(state.pendingScrollStudyId);
    state.setPendingScrollStudyId(null);
  }, [state, rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border py-12 text-center text-muted-foreground">
        <p>No studies match your current filters.</p>
        <p className="mt-2 text-sm">Try widening criteria in More filters.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border" aria-label="Studies table">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Filtered studies with methods, outcomes, results and source links.</caption>
        <thead className="bg-muted/50">
          <tr>
            <TableHeaderCell scope="col" aria-sort={state.sortBy === 'relevance' ? 'descending' : 'none'}>Paper</TableHeaderCell>
            <TableHeaderCell scope="col">Methods</TableHeaderCell>
            <TableHeaderCell scope="col">Outcomes</TableHeaderCell>
            <TableHeaderCell scope="col" aria-sort={state.sortBy === 'year' ? 'descending' : 'none'}>Result</TableHeaderCell>
            <TableHeaderCell scope="col">Links</TableHeaderCell>
            <TableHeaderCell scope="col" className="text-right">Details</TableHeaderCell>
          </tr>
        </thead>
      </table>

      <div ref={parentRef} className="h-[640px] overflow-auto">
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualItem) => {
            const study = rows[virtualItem.index];
            return (
              <div
                key={study.study_id}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualItem.start}px)` }}
              >
                <StudyTableRow
                  study={study}
                  isExpanded={state.expandedRows.has(study.study_id)}
                  onToggle={state.toggleRow}
                  highlightedStudyId={state.highlightedStudyId}
                  pdf={study.citation.doi ? pdfsByDoi[study.citation.doi] : undefined}
                  expandedSnippetIndices={Array.from(state.expandedSnippets)
                    .filter((id) => id.startsWith(`${study.study_id}-`))
                    .map((id) => id.split('-').pop())
                    .join(',')}
                  onToggleSnippet={state.toggleSnippet}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StudyTableInner(props: Omit<StudyTableVirtualizedProps, 'results' | 'partialResults' | 'query'> & { results: StudyResult[]; partialResults?: StudyResult[] | null; query: string }) {
  const state = useStudyTableContext();

  if (state.totalInputStudies === 0) {
    return <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">No studies available for this report yet.</div>;
  }

  return (
    <div className="w-full animate-fade-in motion-reduce:animate-none">
      <StudyTableHeader
        totalPapersSearched={props.totalPapersSearched}
        openalexCount={props.openalexCount}
        semanticScholarCount={props.semanticScholarCount}
        arxivCount={props.arxivCount}
        pubmedCount={props.pubmedCount}
        coverageReport={props.coverageReport}
        searchStats={props.searchStats}
        extractionStats={props.extractionStats}
        evidenceTable={props.evidenceTable}
      />

      <ErrorBoundary title="Table controls failed">
        <StudyFiltersBar />
      </ErrorBoundary>

      {state.viewMode === 'summary' && (
        <div className="space-y-4">
          {props.reportId ? (
            <ErrorBoundary title="Narrative synthesis failed">
              <NarrativeSynthesis reportId={props.reportId} studies={state.mainStudies} query={props.normalizedQuery || props.query} cachedSynthesis={props.cachedSynthesis} truncateLines={6} />
            </ErrorBoundary>
          ) : (
            <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Summary generation is unavailable for this report context.</div>
          )}

          {state.summaryData.claims.length > 0 && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="text-sm font-semibold text-foreground">Key findings</h3>
              <ol className="mt-3 space-y-2">
                {state.summaryData.claims.map((claim, idx) => (
                  <li key={`${idx}-${claim.text.slice(0, 20)}`} className="text-sm leading-relaxed text-foreground">
                    {claim.text}{' '}
                    <span className="inline-flex flex-wrap gap-1 align-middle">
                      {claim.refs.map((refNumber, refIndex) => {
                        const studyId = claim.refStudyIds[refIndex];
                        return (
                          <button key={`${idx}-${refNumber}`} type="button" onClick={() => state.handleReferenceClick(studyId)} className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground" aria-label={`Go to reference ${refNumber}`}>
                            [{refNumber}]
                          </button>
                        );
                      })}
                    </span>
                  </li>
                ))}
              </ol>

              {state.summaryData.references.length > 0 && (
                <Collapsible open={state.referenceListOpen} onOpenChange={state.setReferenceListOpen} className="mt-3">
                  <CollapsibleTrigger asChild>
                    <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      {state.referenceListOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} References ({state.summaryData.references.length})
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-1">
                    {state.summaryData.references.map((ref) => (
                      <button key={ref.number} type="button" onClick={() => state.handleReferenceClick(ref.studyId)} className="block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-muted/50">
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

      {state.viewMode === 'studies' && (
        <div className="space-y-4">
          <StudyRowsVirtualList pdfsByDoi={props.pdfsByDoi} />
          <StudyPagination />
          {state.excludedStudies.length > 0 && (
            <div className="rounded-lg border pt-2">
              <button
                type="button"
                onClick={() => state.setShowExcludedStudies((prev) => !prev)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
              >
                <span className="text-muted-foreground">Excluded studies ({state.excludedStudies.length})</span>
                {state.showExcludedStudies ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {state.showExcludedStudies && (
                <div className="border-t p-3">
                  <ul className="space-y-2">
                    {state.excludedStudies.map((study) => (
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

export function StudyTableVirtualized(props: StudyTableVirtualizedProps) {
  const state = useStudyTableState({
    results: props.results,
    partialResults: props.partialResults,
    query: props.query,
    normalizedQuery: props.normalizedQuery,
    reportId: props.reportId,
    activeExtractionRunId: props.activeExtractionRunId,
    briefSentences: props.briefSentences,
    searchStats: props.searchStats,
    extractionStats: props.extractionStats,
    coverageReport: props.coverageReport,
    evidenceTable: props.evidenceTable,
  });

  return (
    <StudyTableProvider value={state}>
      <StudyTableInner {...props} pdfsByDoi={props.pdfsByDoi || {}} />
    </StudyTableProvider>
  );
}
