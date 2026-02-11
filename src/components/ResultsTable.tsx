import { useState, useMemo } from 'react';
import { Download, FileText, Code, Eye, EyeOff } from 'lucide-react';
import type { StudyResult } from '@/types/research';
import { StudyCard } from './StudyCard';
import { Button } from './ui/button';
import { downloadRISFile } from '@/lib/risExport';
import { generateNarrativeSummary } from '@/lib/narrativeSummary';
import { sortByRelevance, isLowValueStudy } from '@/utils/relevanceScore';

interface ResultsTableProps {
  results: StudyResult[];
  query: string;
  normalizedQuery?: string;
  totalPapersSearched: number;
  openalexCount?: number;
  semanticScholarCount?: number;
}



export function ResultsTable({ 
  results, 
  query, 
  normalizedQuery,
  totalPapersSearched,
  openalexCount,
  semanticScholarCount,
}: ResultsTableProps) {
  const [showExcludedStudies, setShowExcludedStudies] = useState(false);
  const [showNarrative, setShowNarrative] = useState(false);
  const [showJSON, setShowJSON] = useState(false);

  // Sort results by relevance score (descending)
  const sortedResults = useMemo(() => {
    return sortByRelevance(results, normalizedQuery || query);
  }, [results, query, normalizedQuery]);

  // Filter out low-value studies unless toggle is on
  const filteredResults = useMemo(() => {
    if (showExcludedStudies) {
      return sortedResults;
    }
    return sortedResults.filter(study => !isLowValueStudy(study));
  }, [sortedResults, showExcludedStudies]);

  const excludedCount = sortedResults.length - filteredResults.length;

  const handleExportRIS = () => {
    downloadRISFile(results, `research-${Date.now()}.ris`);
  };

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
            Showing <strong>{filteredResults.length}</strong> {filteredResults.length === 1 ? 'result' : 'results'} from{' '}
            <strong>{totalPapersSearched}</strong> papers searched
            {excludedCount > 0 && !showExcludedStudies && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                ({excludedCount} low-value {excludedCount === 1 ? 'study' : 'studies'} hidden)
              </span>
            )}
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
          {excludedCount > 0 && (
            <Button
              onClick={() => setShowExcludedStudies(!showExcludedStudies)}
              variant={showExcludedStudies ? "default" : "outline"}
              size="sm"
              className="gap-2"
            >
              {showExcludedStudies ? (
                <>
                  <EyeOff className="h-4 w-4" />
                  Hide excluded studies
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4" />
                  Show excluded studies ({excludedCount})
                </>
              )}
            </Button>
          )}
          
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

      {/* Results in card layout */}
      <div className="space-y-4">
        {filteredResults.map((result) => (
          <StudyCard
            key={result.study_id}
            study={result}
            query={normalizedQuery || query}
            relevanceScore={result.relevanceScore}
          />
        ))}
      </div>

      {/* Empty state when all studies are filtered */}
      {filteredResults.length === 0 && results.length > 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p>All studies have been filtered out.</p>
          <Button
            onClick={() => setShowExcludedStudies(true)}
            variant="outline"
            size="sm"
            className="mt-4"
          >
            Show {excludedCount} excluded {excludedCount === 1 ? 'study' : 'studies'}
          </Button>
        </div>
      )}
    </div>
  );
}
