// components/TableView.tsx
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from 'lucide-react';
import type { StudyResult } from '@/types/research';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { cn } from '@/lib/utils';

interface TableViewProps {
  studies: (StudyResult & { relevanceScore?: number })[];
  query: string;
  showScoreBreakdown?: boolean;
}

type SortField = 'title' | 'year' | 'design' | 'sample_size' | 'relevance';
type SortDirection = 'asc' | 'desc';

export function TableView({ studies, query, showScoreBreakdown = false }: TableViewProps) {
  const [sortField, setSortField] = useState<SortField>('relevance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [selectedStudies, setSelectedStudies] = useState<Set<string>>(new Set());

  const sortedStudies = useMemo(() => {
    const sorted = [...studies].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'title':
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        case 'year':
          aVal = a.year || 0;
          bVal = b.year || 0;
          break;
        case 'design':
          aVal = a.study_design || '';
          bVal = b.study_design || '';
          break;
        case 'sample_size':
          aVal = parseSampleSize(a.sample_size);
          bVal = parseSampleSize(b.sample_size);
          break;
        case 'relevance':
          aVal = a.relevanceScore || 0;
          bVal = b.relevanceScore || 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [studies, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const toggleStudySelection = (studyId: string) => {
    setSelectedStudies((prev) => {
      const next = new Set(prev);
      if (next.has(studyId)) {
        next.delete(studyId);
      } else {
        next.add(studyId);
      }
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

  const SortButton = ({ field, label }: { field: SortField; label: string }) => {
    const isSorted = sortField === field;
    const currentOrder = isSorted ? (sortDirection === 'asc' ? 'ascending' : 'descending') : null;
    const nextOrder = isSorted && sortDirection === 'desc' ? 'ascending' : 'descending';

    const ariaLabel = isSorted
      ? `Sorted by ${label} (${currentOrder}). Click to sort ${nextOrder}.`
      : `Sort by ${label}. Click to sort descending.`;

    return (
      <button
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 font-semibold text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 focus-ring rounded px-1"
        aria-label={ariaLabel}
      >
        {label}
        {isSorted ? (
          sortDirection === 'asc' ? (
            <ArrowUp className="h-4 w-4" />
          ) : (
            <ArrowDown className="h-4 w-4" />
          )
        ) : (
          <ArrowUpDown className="h-4 w-4 opacity-30" />
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {selectedStudies.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-blue-50 p-3 dark:bg-blue-950/30">
          <span className="text-sm font-medium">
            {selectedStudies.size} {selectedStudies.size === 1 ? 'study' : 'studies'} selected
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="focus-ring">
              Compare
            </Button>
            <Button variant="outline" size="sm" className="focus-ring">
              Export Selected
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedStudies(new Set())} className="focus-ring">
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse">
          <thead className="bg-muted/50">
            <tr>
              <th className="border-b p-3 text-left">
                <Checkbox
                  checked={selectedStudies.size === studies.length && studies.length > 0}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all studies"
                />
              </th>
              <th className="border-b p-3 text-left" aria-sort={sortField === 'title' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <SortButton field="title" label="Study" />
              </th>
              <th className="border-b p-3 text-left" aria-sort={sortField === 'year' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <SortButton field="year" label="Year" />
              </th>
              <th className="border-b p-3 text-left" aria-sort={sortField === 'design' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <SortButton field="design" label="Design" />
              </th>
              <th className="border-b p-3 text-left" aria-sort={sortField === 'sample_size' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <SortButton field="sample_size" label="N" />
              </th>
              <th className="border-b p-3 text-left">Key Findings</th>
              {showScoreBreakdown && (
                <th className="border-b p-3 text-left" aria-sort={sortField === 'relevance' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <SortButton field="relevance" label="Score" />
                </th>
              )}
              <th className="border-b p-3 text-left">Links</th>
            </tr>
          </thead>
          <tbody>
            {sortedStudies.map((study) => {
              const isSelected = selectedStudies.has(study.study_id);
              const relevanceScore = study.relevanceScore || 0;

              return (
                <tr
                  key={study.study_id}
                  className={cn(
                    'border-b transition-colors hover:bg-muted/30',
                    isSelected && 'bg-blue-50 dark:bg-blue-950/20',
                  )}
                >
                  <td className="p-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleStudySelection(study.study_id)}
                      aria-label={`Select study: ${study.title}`}
                    />
                  </td>
                  <td className="p-3">
                    <div>
                      <div className="font-medium leading-tight">{study.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {extractFirstAuthor(study.citation.formatted)}
                        {study.preprint_status === 'Preprint' && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                            Preprint
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-sm">{study.year || '—'}</td>
                  <td className="p-3 text-sm">
                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
                      {study.study_design || 'Unknown'}
                    </span>
                  </td>
                  <td className="p-3 text-sm">{study.sample_size || '—'}</td>
                  <td className="max-w-md p-3 text-sm">
                    {study.outcomes && study.outcomes.length > 0 ? (
                      <div className="space-y-1">
                        {study.outcomes
                          .filter((o) => o.key_result)
                          .slice(0, 2)
                          .map((outcome, idx) => (
                            <div key={idx} className="text-gray-700 dark:text-gray-300">
                              <span className="font-medium">{outcome.outcome_measured}:</span>{' '}
                              {truncate(outcome.key_result || '', 80)}
                            </div>
                          ))}
                        {study.outcomes.filter((o) => o.key_result).length > 2 && (
                          <div className="text-xs text-muted-foreground">
                            +{study.outcomes.filter((o) => o.key_result).length - 2} more
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No outcomes reported</span>
                    )}
                  </td>
                  {showScoreBreakdown && (
                    <td className="p-3 text-sm">
                      <span
                        className={cn(
                          'rounded-full px-2 py-1 text-xs font-medium',
                          relevanceScore >= 2
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : relevanceScore >= 0
                              ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
                        )}
                      >
                        {relevanceScore.toFixed(1)}
                      </span>
                    </td>
                  )}
                  <td className="p-3">
                    <div className="flex gap-1">
                      {study.citation.openalex_id && (
                        <Button variant="ghost" size="sm" asChild className="focus-ring">
                          <a
                            href={`https://openalex.org/${study.citation.openalex_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View in OpenAlex"
                            aria-label={`View study "${study.title}" in OpenAlex`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      {study.citation.doi && (
                        <Button variant="ghost" size="sm" asChild className="focus-ring">
                          <a
                            href={`https://doi.org/${study.citation.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View DOI"
                            aria-label={`View DOI for study "${study.title}"`}
                          >
                            DOI
                          </a>
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sortedStudies.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          No studies to display
        </div>
      )}
    </div>
  );
}

// Helper functions
function extractFirstAuthor(citation: string | null | undefined): string {
  if (!citation) return 'Unknown';
  const match = citation.match(/^([^,(]+)/);
  if (match) {
    return match[1].replace(/\set al\.?$/i, '').trim();
  }
  return 'Unknown';
}

function parseSampleSize(size: number | string | null | undefined): number {
  if (typeof size === 'number') return size;
  if (typeof size === 'string') {
    const parsed = parseInt(size.replace(/[^\d]/g, ''));
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
