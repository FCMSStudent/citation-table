import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, ExternalLink } from 'lucide-react';
import type { StudyResult, SortField, SortDirection } from '@/types/research';
import { StudyBadge } from './StudyBadge';
import { cn } from '@/lib/utils';

interface ResultsTableProps {
  results: StudyResult[];
  query: string;
  totalPapersSearched: number;
}

function NullValue({ text = "Not reported" }: { text?: string }) {
  return <span className="null-value">{text}</span>;
}

function SortableHeader({ 
  label, 
  field, 
  currentSort, 
  currentDirection, 
  onSort 
}: { 
  label: string; 
  field: SortField; 
  currentSort: SortField | null; 
  currentDirection: SortDirection; 
  onSort: (field: SortField) => void;
}) {
  const isActive = currentSort === field;
  
  return (
    <th 
      className="cursor-pointer select-none hover:bg-secondary/50 transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive && (
          currentDirection === 'asc' 
            ? <ChevronUp className="h-4 w-4" />
            : <ChevronDown className="h-4 w-4" />
        )}
      </div>
    </th>
  );
}

export function ResultsTable({ results, query, totalPapersSearched }: ResultsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedResults = useMemo(() => {
    if (!sortField) return results;
    
    return [...results].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      
      // Handle nulls
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      
      // Compare
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      
      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();
      return sortDirection === 'asc' 
        ? strA.localeCompare(strB) 
        : strB.localeCompare(strA);
    });
  }, [results, sortField, sortDirection]);

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="w-full animate-fade-in">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing <strong>{results.length}</strong> extracted results from{' '}
          <strong>{totalPapersSearched}</strong> papers searched
        </p>
        <p className="text-sm text-muted-foreground">
          Query: <em>"{query}"</em>
        </p>
      </div>

      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="results-table">
            <thead>
              <tr>
                <th className="w-8"></th>
                <SortableHeader 
                  label="Title" 
                  field="title" 
                  currentSort={sortField} 
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader 
                  label="Year" 
                  field="year" 
                  currentSort={sortField} 
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader 
                  label="Design" 
                  field="study_design" 
                  currentSort={sortField} 
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <SortableHeader 
                  label="N" 
                  field="sample_size" 
                  currentSort={sortField} 
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <th>Outcome</th>
                <th>Key Result</th>
              </tr>
            </thead>
            <tbody>
              {sortedResults.map((result) => {
                const isExpanded = expandedRows.has(result.study_id);
                
                return (
                  <>
                    <tr 
                      key={result.study_id}
                      className="cursor-pointer"
                      onClick={() => toggleRow(result.study_id)}
                    >
                      <td className="w-8">
                        <ChevronRight 
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform",
                            isExpanded && "rotate-90"
                          )} 
                        />
                      </td>
                      <td className="max-w-md">
                        <div className="line-clamp-2 font-medium">
                          {result.title}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">{result.year}</td>
                      <td>
                        <StudyBadge design={result.study_design} />
                      </td>
                      <td className="whitespace-nowrap">
                        {result.sample_size !== null 
                          ? result.sample_size.toLocaleString() 
                          : <NullValue />}
                      </td>
                      <td className="max-w-xs">
                        <div className="line-clamp-2">{result.outcome_measured}</div>
                      </td>
                      <td className="max-w-sm">
                        {result.key_result 
                          ? <div className="line-clamp-2">{result.key_result}</div>
                          : <NullValue />}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${result.study_id}-expanded`}>
                        <td colSpan={7} className="p-0">
                          <div className="citation-panel">
                            <div className="space-y-3">
                              <div>
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                  Citation
                                </h4>
                                <p className="text-foreground">{result.citation}</p>
                              </div>
                              
                              {result.population && (
                                <div>
                                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                    Population
                                  </h4>
                                  <p className="text-foreground">{result.population}</p>
                                </div>
                              )}
                              
                              {result.abstract_excerpt && (
                                <div>
                                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                    Supporting Text
                                  </h4>
                                  <blockquote className="border-l-2 border-primary/30 pl-3 italic text-foreground">
                                    "{result.abstract_excerpt}"
                                  </blockquote>
                                </div>
                              )}
                              
                              {result.study_id.startsWith('https://') && (
                                <a 
                                  href={result.study_id}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  View on OpenAlex
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
