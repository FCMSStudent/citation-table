// components/TableView.tsx
import { useMemo, useState } from 'react';
import { ExternalLink, Download, Loader2 } from 'lucide-react';
import type { StudyResult, StudyPdf, Outcome } from '@/types/research';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { cn } from '@/lib/utils';
import { getEffectDirection, type EffectDirection } from '@/utils/effectDirection';
import { DataTable, DataTableHeader, DataTableRow, SortButton, SelectionToolbar } from './ui/data-table';
import { StudyMeta } from './ui/study-meta';
import { DirectionBadge } from './ui/direction-badge';

interface TableViewProps {
  studies: StudyResult[];
  query: string;
  showScoreBreakdown?: boolean;
  pdfsByDoi?: Record<string, StudyPdf>;
  onExportSelected?: (studies: StudyResult[]) => void;
  onCompare?: (studies: StudyResult[]) => void;
}

interface OutcomeRow {
  study: StudyResult;
  outcome: Outcome;
  isFirstOfStudy: boolean;
  outcomeCount: number;
}

type SortField = 'paper' | 'population' | 'intervention' | 'comparator' | 'outcome' | 'effect_size' | 'direction' | 'p_value' | 'design';
type SortDirection = 'asc' | 'desc';

const directionOrder: Record<EffectDirection, number> = { positive: 3, mixed: 2, negative: 1, neutral: 0 };

export function TableView({ studies, query, showScoreBreakdown = false, pdfsByDoi = {}, onExportSelected, onCompare }: TableViewProps) {
  const [sortField, setSortField] = useState<SortField>('paper');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedStudies, setSelectedStudies] = useState<Set<string>>(new Set());

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
        rows.push({ study, outcome, isFirstOfStudy: idx === 0, outcomeCount: outcomes.length });
      });
    }
    return rows;
  }, [studies]);

  const sortedRows = useMemo(() => {
    return [...outcomeRows].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortField) {
        case 'paper': aVal = a.study.title.toLowerCase(); bVal = b.study.title.toLowerCase(); break;
        case 'population': aVal = (a.study.population || '').toLowerCase(); bVal = (b.study.population || '').toLowerCase(); break;
        case 'intervention': aVal = (a.outcome.intervention || '').toLowerCase(); bVal = (b.outcome.intervention || '').toLowerCase(); break;
        case 'comparator': aVal = (a.outcome.comparator || '').toLowerCase(); bVal = (b.outcome.comparator || '').toLowerCase(); break;
        case 'outcome': aVal = a.outcome.outcome_measured.toLowerCase(); bVal = b.outcome.outcome_measured.toLowerCase(); break;
        case 'effect_size': aVal = (a.outcome.effect_size || '').toLowerCase(); bVal = (b.outcome.effect_size || '').toLowerCase(); break;
        case 'direction': aVal = directionOrder[getEffectDirection(a.outcome.key_result)]; bVal = directionOrder[getEffectDirection(b.outcome.key_result)]; break;
        case 'p_value': aVal = (a.outcome.p_value || '').toLowerCase(); bVal = (b.outcome.p_value || '').toLowerCase(); break;
        case 'design': aVal = (a.study.study_design || '').toLowerCase(); bVal = (b.study.study_design || '').toLowerCase(); break;
        default: return 0;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [outcomeRows, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };

  const toggleStudySelection = (studyId: string) => {
    setSelectedStudies(prev => {
      const next = new Set(prev);
      next.has(studyId) ? next.delete(studyId) : next.add(studyId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedStudies.size === studies.length) setSelectedStudies(new Set());
    else setSelectedStudies(new Set(studies.map(s => s.study_id)));
  };

  const getSelectedStudyObjects = () => studies.filter(s => selectedStudies.has(s.study_id));

  return (
    <div className="space-y-4">
      <SelectionToolbar
        count={selectedStudies.size}
        onCompare={() => onCompare?.(getSelectedStudyObjects())}
        onExport={() => onExportSelected?.(getSelectedStudyObjects())}
        onClear={() => setSelectedStudies(new Set())}
      />

      <DataTable>
        <DataTableHeader>
          <tr>
            <th className="border-b p-2.5 text-left w-8">
              <Checkbox checked={selectedStudies.size === studies.length && studies.length > 0} onCheckedChange={toggleSelectAll} aria-label="Select all studies" />
            </th>
            <th className="border-b p-2.5 text-left min-w-[200px]"><SortButton field="paper" label="Paper" activeField={sortField} direction={sortDirection} onSort={handleSort} /></th>
            <th className="border-b p-2.5 text-left min-w-[120px]"><SortButton field="population" label="Population" activeField={sortField} direction={sortDirection} onSort={handleSort} /></th>
            <th className="border-b p-2.5 text-left min-w-[120px]"><SortButton field="intervention" label="Intervention" activeField={sortField} direction={sortDirection} onSort={handleSort} /></th>
            <th className="border-b p-2.5 text-left min-w-[120px]"><SortButton field="comparator" label="Comparator" activeField={sortField} direction={sortDirection} onSort={handleSort} /></th>
            <th className="border-b p-2.5 text-left min-w-[120px]"><SortButton field="outcome" label="Outcome" activeField={sortField} direction={sortDirection} onSort={handleSort} /></th>
            <th className="border-b p-2.5 text-left min-w-[100px]"><SortButton field="effect_size" label="Effect Size" activeField={sortField} direction={sortDirection} onSort={handleSort} /></th>
            <th className="border-b p-2.5 text-left w-24"><SortButton field="direction" label="Direction" activeField={sortField} direction={sortDirection} onSort={handleSort} /></th>
            <th className="border-b p-2.5 text-left min-w-[80px]"><SortButton field="p_value" label="P-value" activeField={sortField} direction={sortDirection} onSort={handleSort} /></th>
            <th className="border-b p-2.5 text-left w-24"><SortButton field="design" label="Design" activeField={sortField} direction={sortDirection} onSort={handleSort} /></th>
            <th className="border-b p-2.5 text-left w-20">Links</th>
          </tr>
        </DataTableHeader>
        <tbody>
          {sortedRows.map((row, idx) => {
            const { study, outcome, isFirstOfStudy } = row;
            const isSelected = selectedStudies.has(study.study_id);
            const pdf = study.citation.doi ? pdfsByDoi[study.citation.doi] : undefined;
            const direction = getEffectDirection(outcome.key_result);
            const showStudyInfo = isFirstOfStudy || sortField !== 'paper';

            return (
              <DataTableRow
                key={`${study.study_id}-${idx}`}
                isSelected={isSelected}
                className={cn(!isFirstOfStudy && sortField === 'paper' && 'border-t-0')}
              >
                <td className="p-2.5 align-top">
                  {showStudyInfo && (
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleStudySelection(study.study_id)} aria-label={`Select study: ${study.title}`} />
                  )}
                </td>

                <td className="p-2.5 align-top">
                  {showStudyInfo ? (
                    <StudyMeta title={study.title} citation={study.citation.formatted} year={study.year} preprintStatus={study.preprint_status} />
                  ) : (
                    <span className="text-muted-foreground pl-2">—</span>
                  )}
                </td>

                <td className="p-2.5 align-top text-muted-foreground">
                  {showStudyInfo ? (study.population || '—') : ''}
                </td>
                <td className="p-2.5 align-top">{outcome.intervention || '—'}</td>
                <td className="p-2.5 align-top">{outcome.comparator || '—'}</td>
                <td className="p-2.5 align-top font-medium">{outcome.outcome_measured}</td>
                <td className="p-2.5 align-top font-mono text-xs">{outcome.effect_size || '—'}</td>
                <td className="p-2.5 align-top">
                  <DirectionBadge direction={direction} />
                </td>
                <td className="p-2.5 align-top font-mono text-xs">{outcome.p_value || '—'}</td>
                <td className="p-2.5 align-top">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                    {study.study_design || 'Unknown'}
                  </span>
                </td>

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
                          <a href={`https://doi.org/${study.citation.doi}`} target="_blank" rel="noopener noreferrer" title="DOI">DOI</a>
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
              </DataTableRow>
            );
          })}
        </tbody>
      </DataTable>

      {sortedRows.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">No studies to display</div>
      )}
    </div>
  );
}
