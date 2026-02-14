import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink, FileText, FileX, Download, Loader2 } from 'lucide-react';
import type { StudyResult, StudyPdf } from '@/types/research';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { cn } from '@/lib/utils';

interface PaperResultsTableProps {
  studies: StudyResult[];
  query: string;
  pdfsByDoi?: Record<string, StudyPdf>;
  onExportSelected?: (studies: StudyResult[]) => void;
  onCompare?: (studies: StudyResult[]) => void;
}

type SortField = 'title' | 'year' | 'design' | 'citations';
type SortDirection = 'asc' | 'desc';

function extractAuthors(citation: string | null | undefined): string {
  if (!citation) return 'Unknown';
  const match = citation.match(/^(.+?)\s*\(/);
  return match ? match[1].trim() : citation;
}

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
  if (study.citation.doi) {
    const sciHub = pdfsByDoi[study.citation.doi];
    if (sciHub?.status === 'downloaded' && sciHub.public_url) {
      links.push({ label: 'Sci-Hub', url: sciHub.public_url });
    }
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

  const SortBtn = ({ field, label }: { field: SortField; label: string }) => {
    const active = sortField === field;
    return (
      <button onClick={() => handleSort(field)} className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground rounded px-1 whitespace-nowrap">
        {label}
        {active ? (sortDirection === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {selectedStudies.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-accent/30 p-3">
          <span className="text-sm font-medium">{selectedStudies.size} {selectedStudies.size === 1 ? 'study' : 'studies'} selected</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onCompare?.(getSelected())}>Compare</Button>
            <Button variant="outline" size="sm" onClick={() => onExportSelected?.(getSelected())}>Export Selected</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedStudies(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="border-b p-2.5 text-left w-8">
                <Checkbox checked={selectedStudies.size === studies.length && studies.length > 0} onCheckedChange={toggleAll} aria-label="Select all" />
              </th>
              <th className="border-b p-2.5 text-left min-w-[220px]"><SortBtn field="title" label="Paper" /></th>
              <th className="border-b p-2.5 text-left min-w-[140px]">Study Method</th>
              <th className="border-b p-2.5 text-left min-w-[140px]">Outcomes</th>
              <th className="border-b p-2.5 text-left min-w-[160px]">Results</th>
              <th className="border-b p-2.5 text-left min-w-[120px]">Limitations</th>
              <th className="border-b p-2.5 text-left min-w-[160px]">Conclusion</th>
              <th className="border-b p-2.5 text-left w-28">PDF</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(study => {
              const isSelected = selectedStudies.has(study.study_id);
              const authors = extractAuthors(study.citation.formatted);
              const pdfLinks = getPdfLinks(study, pdfsByDoi);
              const outcomes = study.outcomes || [];
              const sciHubPdf = study.citation.doi ? pdfsByDoi[study.citation.doi] : undefined;

              // Limitations: outcomes mentioning "limit" in key_result
              const limitations = outcomes
                .filter(o => o.key_result && /limit/i.test(o.key_result))
                .map(o => o.key_result!);

              // Conclusion: first key_result or abstract excerpt
              const conclusion = outcomes.find(o => o.key_result)?.key_result || study.abstract_excerpt || '';

              return (
                <tr key={study.study_id} className={cn('border-b transition-colors hover:bg-muted/30', isSelected && 'bg-accent/20')}>
                  <td className="p-2.5 align-top">
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleStudy(study.study_id)} aria-label={`Select ${study.title}`} />
                  </td>

                  {/* Paper Info */}
                  <td className="p-2.5 align-top">
                    <div className="font-medium leading-tight text-foreground">{study.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {authors}, {study.year || '—'}
                      {study.citationCount != null && <span className="ml-1.5">({study.citationCount} cit.)</span>}
                      {study.preprint_status === 'Preprint' && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">Preprint</span>
                      )}
                    </div>
                    <div className="mt-1 flex gap-1">
                      {study.citation.doi && (
                        <a href={`https://doi.org/${study.citation.doi}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
                          DOI <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {study.abstract_excerpt && study.abstract_excerpt.length >= 50 && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Abstract</span>
                      )}
                    </div>
                  </td>

                  {/* Study Method */}
                  <td className="p-2.5 align-top">
                    <ul className="list-disc pl-3.5 space-y-0.5 text-muted-foreground">
                      <li><span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium">{study.study_design || 'Unknown'}</span></li>
                      {study.sample_size && <li>N={study.sample_size.toLocaleString()}</li>}
                      {study.population && <li>{study.population}</li>}
                    </ul>
                  </td>

                  {/* Outcomes */}
                  <td className="p-2.5 align-top">
                    {outcomes.length > 0 ? (
                      <ul className="list-disc pl-3.5 space-y-0.5 text-muted-foreground">
                        {outcomes.map((o, i) => <li key={i}>{o.outcome_measured || '—'}</li>)}
                      </ul>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>

                  {/* Results */}
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

                  {/* Limitations */}
                  <td className="p-2.5 align-top text-muted-foreground">
                    {limitations.length > 0 ? (
                      <ul className="list-disc pl-3.5 space-y-0.5">
                        {limitations.map((l, i) => <li key={i}>{truncate(l, 80)}</li>)}
                      </ul>
                    ) : <span className="text-xs italic">Not reported</span>}
                  </td>

                  {/* Conclusion */}
                  <td className="p-2.5 align-top text-muted-foreground">
                    {truncate(conclusion, 120) || '—'}
                  </td>

                  {/* PDF Available */}
                  <td className="p-2.5 align-top">
                    {pdfLinks.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {pdfLinks.map((link, i) => (
                          <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <FileText className="h-3.5 w-3.5" /> {link.label}
                          </a>
                        ))}
                      </div>
                    ) : sciHubPdf?.status === 'pending' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><FileX className="h-3.5 w-3.5" /> No</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">No studies to display</div>
      )}
    </div>
  );
}
