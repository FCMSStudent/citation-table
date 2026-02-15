import { useMemo, useState } from 'react';
import { ExternalLink, FileText, FileX, Download, Loader2 } from 'lucide-react';
import type { StudyResult, StudyPdf } from '@/types/research';
import { Checkbox } from './ui/checkbox';
import { cn } from '@/lib/utils';
import { DataTable, DataTableHeader, DataTableRow, SortButton, SelectionToolbar } from './ui/data-table';
import { StudyMeta } from './ui/study-meta';
import { PdfLink } from './ui/pdf-link';

interface PaperResultsTableProps {
  studies: StudyResult[];
  query: string;
  pdfsByDoi?: Record<string, StudyPdf>;
  onExportSelected?: (studies: StudyResult[]) => void;
  onCompare?: (studies: StudyResult[]) => void;
}

type SortField = 'title' | 'year' | 'design' | 'citations';
type SortDirection = 'asc' | 'desc';

function getPdfLinks(study: StudyResult, pdfsByDoi: Record<string, StudyPdf>): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];

  if (study.pdf_url) {
    links.push({ label: 'PDF', url: study.pdf_url });
  }
  if (study.landing_page_url) {
    links.push({ label: 'Landing page', url: study.landing_page_url });
  }
  if (study.source === 'arxiv' && study.study_id) {
    const arxivId = study.study_id.replace(/^arxiv-/, '');
    links.push({ label: 'arXiv PDF', url: `https://arxiv.org/pdf/${arxivId}` });
  }

  return links;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

export function PaperResultsTable({ studies, query, pdfsByDoi = {}, onExportSelected, onCompare }: PaperResultsTableProps) {
  const [sortField, setSortField] = useState<SortField>('title');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedStudies, setSelectedStudies] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    return [...studies].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      switch (sortField) {
        case 'title':
          aVal = a.title.toLowerCase(); bVal = b.title.toLowerCase(); break;
        case 'year':
          aVal = a.year || 0; bVal = b.year || 0; break;
        case 'design':
          aVal = (a.study_design || '').toLowerCase(); bVal = (b.study_design || '').toLowerCase(); break;
        case 'citations':
          aVal = a.citationCount || 0; bVal = b.citationCount || 0; break;
        default: return 0;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [studies, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('asc'); }
  };

  const toggleStudy = (id: string) => {
    setSelectedStudies(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedStudies.size === studies.length) setSelectedStudies(new Set());
    else setSelectedStudies(new Set(studies.map(s => s.study_id)));
  };

  const getSelected = () => studies.filter(s => selectedStudies.has(s.study_id));

  return (
    <div className="space-y-4">
      <SelectionToolbar
        count={selectedStudies.size}
        onCompare={() => onCompare?.(getSelected())}
        onExport={() => onExportSelected?.(getSelected())}
        onClear={() => setSelectedStudies(new Set())}
      />

      <DataTable>
        <DataTableHeader>
          <tr>
            <th className="border-b p-2.5 text-left w-8">
              <Checkbox checked={selectedStudies.size === studies.length && studies.length > 0} onCheckedChange={toggleAll} aria-label="Select all" />
            </th>
            <th className="border-b p-2.5 text-left min-w-[220px]"><SortButton field="title" label="Paper" activeField={sortField} direction={sortDirection} onSort={handleSort} /></th>
            <th className="border-b p-2.5 text-left min-w-[140px]">Study Method</th>
            <th className="border-b p-2.5 text-left min-w-[140px]">Outcomes</th>
            <th className="border-b p-2.5 text-left min-w-[160px]">Results</th>
            <th className="border-b p-2.5 text-left min-w-[120px]">Limitations</th>
            <th className="border-b p-2.5 text-left min-w-[160px]">Conclusion</th>
            <th className="border-b p-2.5 text-left w-28">PDF</th>
          </tr>
        </DataTableHeader>
        <tbody>
          {sorted.map(study => {
            const isSelected = selectedStudies.has(study.study_id);
            const pdfLinks = getPdfLinks(study, pdfsByDoi);
            const outcomes = study.outcomes || [];
            const sciHubPdf = study.citation.doi ? pdfsByDoi[study.citation.doi] : undefined;

            const limitations = outcomes
              .filter(o => o.key_result && /limit/i.test(o.key_result))
              .map(o => o.key_result!);

            const conclusion = study.abstract_excerpt ? truncate(study.abstract_excerpt, 120) : '—';

            return (
              <DataTableRow key={study.study_id} isSelected={isSelected}>
                <td className="p-2.5 align-top">
                  <Checkbox checked={isSelected} onCheckedChange={() => toggleStudy(study.study_id)} aria-label={`Select ${study.title}`} />
                </td>

                <td className="p-2.5 align-top">
                  <StudyMeta
                    title={study.title}
                    citation={study.citation.formatted}
                    year={study.year}
                    citationCount={study.citationCount ?? 0}
                    preprintStatus={study.preprint_status}
                    doi={study.citation.doi}
                  />
                  {study.abstract_excerpt && study.abstract_excerpt.length >= 50 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground mt-1 inline-block">Abstract</span>
                  )}
                </td>

                <td className="p-2.5 align-top">
                  <ul className="list-disc pl-3.5 space-y-0.5 text-muted-foreground">
                    <li><span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium">{study.study_design || 'Unknown'}</span></li>
                    {study.sample_size && <li>N={study.sample_size.toLocaleString()}</li>}
                    {study.population && <li>{study.population}</li>}
                  </ul>
                </td>

                <td className="p-2.5 align-top">
                  {outcomes.length > 0 ? (
                    <ul className="list-disc pl-3.5 space-y-0.5 text-muted-foreground">
                      {outcomes.map((o, i) => <li key={i}>{o.outcome_measured || '—'}</li>)}
                    </ul>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>

                <td className="p-2.5 align-top">
                  {outcomes.some(o => o.key_result) ? (
                    <ul className="list-disc pl-3.5 space-y-0.5 text-muted-foreground">
                      {outcomes.filter(o => o.key_result).map((o, i) => (
                        <li key={i}>
                          {o.key_result}
                          {(o.effect_size || o.p_value) && (
                            <span className="ml-1 font-mono text-xs">
                              {o.effect_size && `(${o.effect_size})`}
                              {o.p_value && ` p=${o.p_value}`}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : <span className="text-muted-foreground">—</span>}
                </td>

                <td className="p-2.5 align-top text-muted-foreground">
                  {limitations.length > 0 ? (
                    <ul className="list-disc pl-3.5 space-y-0.5">
                      {limitations.map((l, i) => <li key={i}>{truncate(l, 80)}</li>)}
                    </ul>
                  ) : <span className="text-xs italic">Not explicitly reported</span>}
                </td>

                <td className="p-2.5 align-top text-muted-foreground">
                  {conclusion}
                </td>

                <td className="p-2.5 align-top">
                  <PdfLink links={pdfLinks} pdfData={sciHubPdf} />
                </td>
              </DataTableRow>
            );
          })}
        </tbody>
      </DataTable>

      {sorted.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">No studies to display</div>
      )}
    </div>
  );
}
