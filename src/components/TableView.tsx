// components/TableView.tsx
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, Download, Loader2, TrendingUp, TrendingDown, Minus, ArrowLeftRight } from 'lucide-react';
import type { StudyResult, StudyPdf, Outcome } from '@/types/research';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { cn } from '@/lib/utils';
import { getEffectDirection, type EffectDirection } from '@/utils/effectDirection';

interface TableViewProps {
  studies: StudyResult[];
  query: string;
  showScoreBreakdown?: boolean;
  pdfsByDoi?: Record<string, StudyPdf>;
  onExportSelected?: (studies: StudyResult[]) => void;
  onCompare?: (studies: StudyResult[]) => void;
}

// Flattened row: one outcome from one study
interface OutcomeRow {
  study: StudyResult;
  outcome: Outcome;
  isFirstOfStudy: boolean; // true for the first outcome row of a study
  outcomeCount: number;    // total outcomes for this study
}

type SortField = 'paper' | 'population' | 'intervention' | 'comparator' | 'outcome' | 'effect_size' | 'direction' | 'p_value' | 'design';
type SortDirection = 'asc' | 'desc';

const directionOrder: Record<EffectDirection, number> = { positive: 3, mixed: 2, negative: 1, neutral: 0 };

export function TableView({ studies, query, showScoreBreakdown = false, pdfsByDoi = {}, onExportSelected, onCompare }: TableViewProps) {
  const [sortField, setSortField] = useState<SortField>('paper');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedStudies, setSelectedStudies] = useState<Set<string>>(new Set());

  // Flatten studies into outcome-level rows
  const outcomeRows = useMemo<OutcomeRow[]>(() => {
    const rows: OutcomeRow[] = [];
    for (const study of studies) {
      const outcomes = study.outcomes?.length ? study.outcomes : [{
        outcome_measured: 'Not reported',
        key_result: null,
        citation_snippet: '',
        intervention: null,
        comparator: null,
        effect_size: null,
        p_value: null,
      } as Outcome];
      outcomes.forEach((outcome, idx) => {
        rows.push({
          study,
          outcome,
          isFirstOfStudy: idx === 0,
          outcomeCount: outcomes.length,
        });
      });
    }
    return rows;
  }, [studies]);

  const sortedRows = useMemo(() => {
    return [...outcomeRows].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'paper':
          aVal = a.study.title.toLowerCase();
          bVal = b.study.title.toLowerCase();
          break;
        case 'population':
          aVal = (a.study.population || '').toLowerCase();
          bVal = (b.study.population || '').toLowerCase();
          break;
        case 'intervention':
          aVal = (a.outcome.intervention || '').toLowerCase();
          bVal = (b.outcome.intervention || '').toLowerCase();
          break;
        case 'comparator':
          aVal = (a.outcome.comparator || '').toLowerCase();
          bVal = (b.outcome.comparator || '').toLowerCase();
          break;
        case 'outcome':
          aVal = a.outcome.outcome_measured.toLowerCase();
          bVal = b.outcome.outcome_measured.toLowerCase();
          break;
        case 'effect_size':
          aVal = (a.outcome.effect_size || '').toLowerCase();
          bVal = (b.outcome.effect_size || '').toLowerCase();
          break;
        case 'direction':
          aVal = directionOrder[getEffectDirection(a.outcome.key_result)];
          bVal = directionOrder[getEffectDirection(b.outcome.key_result)];
          break;
        case 'p_value':
          aVal = (a.outcome.p_value || '').toLowerCase();
          bVal = (b.outcome.p_value || '').toLowerCase();
          break;
        case 'design':
          aVal = (a.study.study_design || '').toLowerCase();
          bVal = (b.study.study_design || '').toLowerCase();
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [outcomeRows, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleStudySelection = (studyId: string) => {
    setSelectedStudies((prev) => {
      const next = new Set(prev);
      if (next.has(studyId)) next.delete(studyId);
      else next.add(studyId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedStudies.size === studies.length) {
      setSelectedStudies(new Set());
    } else {
      setSelectedStudies(new Set(studies.map((s) => s.study_id)));
    }
  };

  const getSelectedStudyObjects = () =>
    studies.filter((s) => selectedStudies.has(s.study_id));

  const SortButton = ({ field, label }: { field: SortField; label: string }) => {
    const isSorted = sortField === field;
    return (
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground focus-ring rounded px-1 whitespace-nowrap"
      >
        {label}
        {isSorted ? (
          sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {selectedStudies.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-accent/30 p-3">
          <span className="text-sm font-medium">
            {selectedStudies.size} {selectedStudies.size === 1 ? 'study' : 'studies'} selected
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onCompare?.(getSelectedStudyObjects())}>Compare</Button>
            <Button variant="outline" size="sm" onClick={() => onExportSelected?.(getSelectedStudyObjects())}>Export Selected</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedStudies(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="border-b p-2.5 text-left w-8">
                <Checkbox
                  checked={selectedStudies.size === studies.length && studies.length > 0}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all studies"
                />
              </th>
              <th className="border-b p-2.5 text-left min-w-[200px]"><SortButton field="paper" label="Paper" /></th>
              <th className="border-b p-2.5 text-left min-w-[120px]"><SortButton field="population" label="Population" /></th>
              <th className="border-b p-2.5 text-left min-w-[120px]"><SortButton field="intervention" label="Intervention" /></th>
              <th className="border-b p-2.5 text-left min-w-[120px]"><SortButton field="comparator" label="Comparator" /></th>
              <th className="border-b p-2.5 text-left min-w-[120px]"><SortButton field="outcome" label="Outcome" /></th>
              <th className="border-b p-2.5 text-left min-w-[100px]"><SortButton field="effect_size" label="Effect Size" /></th>
              <th className="border-b p-2.5 text-left w-24"><SortButton field="direction" label="Direction" /></th>
              <th className="border-b p-2.5 text-left min-w-[80px]"><SortButton field="p_value" label="P-value" /></th>
              <th className="border-b p-2.5 text-left w-24"><SortButton field="design" label="Design" /></th>
              <th className="border-b p-2.5 text-left w-20">Links</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, idx) => {
              const { study, outcome, isFirstOfStudy, outcomeCount } = row;
              const isSelected = selectedStudies.has(study.study_id);
              const pdf = study.citation.doi ? pdfsByDoi[study.citation.doi] : undefined;
              const direction = getEffectDirection(outcome.key_result);

              // Determine if this is a continuation row (same study, not first outcome)
              const showStudyInfo = isFirstOfStudy || sortField !== 'paper';

              return (
                <tr
                  key={`${study.study_id}-${idx}`}
                  className={cn(
                    'border-b transition-colors hover:bg-muted/30',
                    isSelected && 'bg-accent/20',
                    !isFirstOfStudy && sortField === 'paper' && 'border-t-0',
                  )}
                >
                  {/* Checkbox — only on first row of each study when grouped */}
                  <td className="p-2.5 align-top">
                    {showStudyInfo && (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleStudySelection(study.study_id)}
                        aria-label={`Select study: ${study.title}`}
                      />
                    )}
                  </td>

                  {/* Paper */}
                  <td className="p-2.5 align-top">
                    {showStudyInfo ? (
                      <div>
                        <div className="font-medium leading-tight text-foreground">{study.title}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {extractFirstAuthor(study.citation.formatted)}, {study.year || '—'}
                          {study.preprint_status === 'Preprint' && (
                            <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                              Preprint
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground pl-2">—</span>
                    )}
                  </td>

                  {/* Population */}
                  <td className="p-2.5 align-top text-muted-foreground">
                    {showStudyInfo ? (study.population || '—') : ''}
                  </td>

                  {/* Intervention */}
                  <td className="p-2.5 align-top">{outcome.intervention || '—'}</td>

                  {/* Comparator */}
                  <td className="p-2.5 align-top">{outcome.comparator || '—'}</td>

                  {/* Outcome */}
                  <td className="p-2.5 align-top font-medium">{outcome.outcome_measured}</td>

                  {/* Effect Size */}
                  <td className="p-2.5 align-top font-mono text-xs">{outcome.effect_size || '—'}</td>

                  {/* Direction */}
                  <td className="p-2.5 align-top">
                    <DirectionBadge direction={direction} />
                  </td>

                  {/* P-value */}
                  <td className="p-2.5 align-top font-mono text-xs">{outcome.p_value || '—'}</td>

                  {/* Study Design */}
                  <td className="p-2.5 align-top">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {study.study_design || 'Unknown'}
                    </span>
                  </td>

                  {/* Links */}
                  <td className="p-2.5 align-top">
                    {showStudyInfo && (
                      <div className="flex gap-0.5">
                        {study.citation.openalex_id && (
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                            <a href={`https://openalex.org/${study.citation.openalex_id}`} target="_blank" rel="noopener noreferrer" title="OpenAlex">
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                        {study.citation.doi && (
                          <Button variant="ghost" size="sm" className="h-7 px-1.5 text-xs" asChild>
                            <a href={`https://doi.org/${study.citation.doi}`} target="_blank" rel="noopener noreferrer" title="DOI">
                              DOI
                            </a>
                          </Button>
                        )}
                        {pdf?.status === 'downloaded' && pdf.public_url && (
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                            <a href={pdf.public_url} target="_blank" rel="noopener noreferrer" title="PDF">
                              <Download className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                        {pdf?.status === 'pending' && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sortedRows.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">No studies to display</div>
      )}
    </div>
  );
}

// Direction badge component
function DirectionBadge({ direction }: { direction: EffectDirection }) {
  const config: Record<EffectDirection, { icon: React.ReactNode; label: string; className: string }> = {
    positive: {
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      label: 'Positive',
      className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
    },
    negative: {
      icon: <TrendingDown className="h-3.5 w-3.5" />,
      label: 'Negative',
      className: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
    },
    neutral: {
      icon: <Minus className="h-3.5 w-3.5" />,
      label: 'Neutral',
      className: 'bg-muted text-muted-foreground',
    },
    mixed: {
      icon: <ArrowLeftRight className="h-3.5 w-3.5" />,
      label: 'Mixed',
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
    },
  };

  const { icon, label, className } = config[direction];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', className)}>
      {icon} {label}
    </span>
  );
}

// Helper
function extractFirstAuthor(citation: string | null | undefined): string {
  if (!citation) return 'Unknown';
  const match = citation.match(/^([^,(]+)/);
  return match ? match[1].replace(/\set al\.?$/i, '').trim() : 'Unknown';
}
