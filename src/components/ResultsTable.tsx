import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, ChevronRight, ExternalLink, Download, FileText, Code } from 'lucide-react';
import type { StudyResult, SortField, SortDirection } from '@/types/research';
import { StudyBadge } from './StudyBadge';
import { PreprintBadge } from './PreprintBadge';
import { ReviewTypeBadge } from './ReviewTypeBadge';
import { SourceBadge } from './SourceBadge';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { downloadRISFile } from '@/lib/risExport';
import { generateNarrativeSummary } from '@/lib/narrativeSummary';

interface ResultsTableProps {
  results: StudyResult[];
  query: string;
  normalizedQuery?: string;
  totalPapersSearched: number;
  openalexCount?: number;
  semanticScholarCount?: number;
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

export function ResultsTable({ 
  results, 
  query, 
  normalizedQuery,
  totalPapersSearched,
  openalexCount,
  semanticScholarCount,
}: ResultsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showNarrative, setShowNarrative] = useState(false);
  const [showJSON, setShowJSON] = useState(false);

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

  const handleExportRIS = () => {
    downloadRISFile(results, `research-${Date.now()}.ris`);
  };

  const sortedResults = useMemo(() => {
    if (!sortField) return results;
    
    return [...results].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      
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

  const narrativeSummary = useMemo(() => {
    return generateNarrativeSummary(results, normalizedQuery || query);
  }, [results, query, normalizedQuery]);

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="w-full animate-fade-in">
      {/* Header with stats and actions */}
      <div className="mb-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm text-muted-foreground">
            Showing <strong>{results.length}</strong> extracted results from{' '}
            <strong>{totalPapersSearched}</strong> papers searched
            {(openalexCount !== undefined || semanticScholarCount !== undefined) && (
              <span className="ml-2">
                ({openalexCount || 0} OpenAlex, {semanticScholarCount || 0} Semantic Scholar)
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            Query: <em>"{normalizedQuery || query}"</em>
          </div>
        </div>
        
        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={handleExportRIS}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Export Citations (RIS)
          </Button>
          
          <Button
            onClick={() => setShowNarrative(!showNarrative)}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            {showNarrative ? 'Hide' : 'Show'} Narrative Summary
          </Button>
          
          <Button
            onClick={() => setShowJSON(!showJSON)}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Code className="h-4 w-4" />
            {showJSON ? 'Hide' : 'View'} JSON
          </Button>
        </div>
        
        {/* Narrative summary */}
        {showNarrative && (
          <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
            <h3 className="text-sm font-semibold mb-2 text-blue-900 dark:text-blue-100">
              Narrative Summary
            </h3>
            <p className="text-sm leading-relaxed text-blue-900 dark:text-blue-100">
              {narrativeSummary}
            </p>
          </div>
        )}
        
        {/* JSON view */}
        {showJSON && (
          <div className="p-4 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg">
            <h3 className="text-sm font-semibold mb-2 text-gray-900 dark:text-gray-100">
              Structured JSON Output
            </h3>
            <pre className="text-xs overflow-x-auto p-2 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
              {JSON.stringify(results, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Results table */}
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
                <th>Status</th>
                <SortableHeader 
                  label="N" 
                  field="sample_size" 
                  currentSort={sortField} 
                  currentDirection={sortDirection}
                  onSort={handleSort}
                />
                <th>Outcomes & Results</th>
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
                      <td>
                        <div className="flex flex-col gap-1">
                          <PreprintBadge status={result.preprint_status} />
                          <ReviewTypeBadge reviewType={result.review_type} />
                          <SourceBadge source={result.source} citationCount={result.citationCount} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        {result.sample_size !== null 
                          ? result.sample_size.toLocaleString() 
                          : <NullValue />}
                      </td>
                      <td className="max-w-2xl">
                        {result.outcomes.length > 0 ? (
                          <ul className="list-disc list-inside space-y-1 text-sm">
                            {result.outcomes.map((outcome, idx) => (
                              <li key={idx}>
                                <strong>{outcome.outcome_measured}:</strong>{' '}
                                {outcome.key_result || <NullValue text="Not reported" />}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <NullValue text="No outcomes reported" />
                        )}
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
                                <p className="text-foreground">{result.citation.formatted}</p>
                                <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                                  {result.citation.doi && (
                                    <span>DOI: {result.citation.doi}</span>
                                  )}
                                  {result.citation.pubmed_id && (
                                    <span>PMID: {result.citation.pubmed_id}</span>
                                  )}
                                </div>
                              </div>
                              
                              {result.population && (
                                <div>
                                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                    Population (Verbatim)
                                  </h4>
                                  <p className="text-foreground">{result.population}</p>
                                </div>
                              )}
                              
                              {result.outcomes.length > 0 && (
                                <div>
                                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                    Supporting Text (Per Outcome)
                                  </h4>
                                  {result.outcomes.map((outcome, idx) => (
                                    <blockquote 
                                      key={idx} 
                                      className="border-l-2 border-primary/30 pl-3 italic text-foreground mb-2"
                                    >
                                      <div className="text-xs font-medium not-italic mb-1">
                                        {outcome.outcome_measured}:
                                      </div>
                                      "{outcome.citation_snippet}"
                                    </blockquote>
                                  ))}
                                </div>
                              )}
                              
                              {result.abstract_excerpt && (
                                <div>
                                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                    Abstract Excerpt
                                  </h4>
                                  <blockquote className="border-l-2 border-primary/30 pl-3 italic text-foreground">
                                    "{result.abstract_excerpt}"
                                  </blockquote>
                                </div>
                              )}
                              
                              <div className="flex gap-3">
                                {result.citation.doi && (
                                  <a 
                                    href={`https://doi.org/${result.citation.doi}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    View DOI
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                                
                                {result.citation.openalex_id && (
                                  <a 
                                    href={result.citation.openalex_id}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    View on OpenAlex
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                                
                                {result.source === "semantic_scholar" && (
                                  <a 
                                    href={`https://www.semanticscholar.org/paper/${result.study_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    View on Semantic Scholar
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
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
