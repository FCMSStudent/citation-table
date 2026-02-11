import { useState, memo } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import type { StudyResult } from '@/types/research';
import { Card, CardContent, CardHeader } from './ui/card';
import { StudyBadge } from './StudyBadge';
import { PreprintBadge } from './PreprintBadge';
import { ReviewTypeBadge } from './ReviewTypeBadge';
import { SourceBadge } from './SourceBadge';
import { Button } from './ui/button';
import { cn, sanitizeUrl } from '@/lib/utils';

interface StudyCardProps {
  study: StudyResult;
  query: string;
  relevanceScore?: number;
}

/**
 * Highlight matched query terms in text
 */
function highlightQueryTerms(text: string, query: string): React.ReactNode {
  if (!query || !text) return text;
  
  // Extract keywords from query
  const keywords = query
    .toLowerCase()
    .split(/[\s,;]+/)
    .map(word => word.trim())
    .filter(word => word.length > 2);
  
  if (keywords.length === 0) return text;
  
  // Create regex pattern for all keywords
  const pattern = new RegExp(`(${keywords.join('|')})`, 'gi');
  const parts = text.split(pattern);
  
  return parts.map((part, i) => {
    const isMatch = keywords.some(kw => 
      part.toLowerCase() === kw.toLowerCase()
    );
    
    return isMatch ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-900 font-medium">
        {part}
      </mark>
    ) : (
      part
    );
  });
}

function NullValue({ text = "Not reported" }: { text?: string }) {
  return <span className="null-value">{text}</span>;
}

/**
 * StudyCard component displays a study result in a card layout
 * Optimized with memo to prevent unnecessary re-renders
 */
export const StudyCard = memo(({ study, query, relevanceScore }: StudyCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const hasOutcomes = study.outcomes && study.outcomes.length > 0;
  
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {/* Title */}
            <h3 className="font-bold text-base leading-tight mb-1">
              {highlightQueryTerms(study.title, query)}
            </h3>
            
            {/* Year and metadata row */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <span>{study.year}</span>
              {study.sample_size !== null && (
                <>
                  <span>•</span>
                  <span>N = {study.sample_size.toLocaleString()}</span>
                </>
              )}
              {relevanceScore !== undefined && (
                <>
                  <span>•</span>
                  <span className="text-xs">
                    Score: {relevanceScore > 0 ? '+' : ''}{relevanceScore}
                  </span>
                </>
              )}
            </div>
            
            {/* Badges */}
            <div className="flex flex-wrap gap-1.5">
              <StudyBadge design={study.study_design} />
              <PreprintBadge status={study.preprint_status} />
              <ReviewTypeBadge reviewType={study.review_type} />
              <SourceBadge source={study.source} citationCount={study.citationCount} />
            </div>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pb-4">
        {/* Outcomes */}
        <div className="mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Key Outcomes
          </h4>
          {hasOutcomes ? (
            <ul className="space-y-1.5 text-sm">
              {study.outcomes.map((outcome, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  <div className="flex-1">
                    <strong className="font-medium">
                      {highlightQueryTerms(outcome.outcome_measured, query)}:
                    </strong>{' '}
                    {outcome.key_result ? (
                      highlightQueryTerms(outcome.key_result, query)
                    ) : (
                      <NullValue text="Not reported" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No outcomes reported
            </p>
          )}
        </div>
        
        {/* Expand/Collapse button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full justify-between hover:bg-secondary/50"
        >
          <span className="text-xs font-medium">
            {isExpanded ? 'Hide details' : 'Show details'}
          </span>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
        
        {/* Expanded details */}
        {isExpanded && (
          <div className="mt-4 pt-4 border-t space-y-3">
            {/* Citation */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Citation
              </h4>
              <p className="text-sm text-foreground">{study.citation.formatted}</p>
              <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                {study.citation.doi && (
                  <span>DOI: {study.citation.doi}</span>
                )}
                {study.citation.pubmed_id && (
                  <span>PMID: {study.citation.pubmed_id}</span>
                )}
              </div>
            </div>
            
            {/* Population */}
            {study.population && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Population (Verbatim)
                </h4>
                <p className="text-sm text-foreground">{study.population}</p>
              </div>
            )}
            
            {/* Supporting text */}
            {hasOutcomes && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Supporting Text (Per Outcome)
                </h4>
                {study.outcomes.map((outcome, idx) => (
                  <blockquote
                    key={idx}
                    className="border-l-2 border-primary/30 pl-3 italic text-sm text-foreground mb-2"
                  >
                    <div className="text-xs font-medium not-italic mb-1">
                      {outcome.outcome_measured}:
                    </div>
                    "{outcome.citation_snippet}"
                  </blockquote>
                ))}
              </div>
            )}
            
            {/* Abstract excerpt */}
            {study.abstract_excerpt && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Abstract Excerpt
                </h4>
                <blockquote className="border-l-2 border-primary/30 pl-3 italic text-sm text-foreground">
                  "{study.abstract_excerpt}"
                </blockquote>
              </div>
            )}
            
            {/* Links */}
            <div className="flex flex-wrap gap-3">
              {study.citation.doi && (
                <a
                  href={sanitizeUrl(`https://doi.org/${study.citation.doi}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                >
                  View DOI
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              
              {study.citation.openalex_id && (
                <a
                  href={sanitizeUrl(study.citation.openalex_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                >
                  View on OpenAlex
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              
              {study.source === "semantic_scholar" && (
                <a
                  href={sanitizeUrl(`https://www.semanticscholar.org/paper/${study.study_id}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                >
                  View on Semantic Scholar
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

StudyCard.displayName = 'StudyCard';
