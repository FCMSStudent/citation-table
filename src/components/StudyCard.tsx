import { useState, memo } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Info } from 'lucide-react';
import type { StudyResult } from '@/types/research';
import { Card, CardContent, CardHeader } from './ui/card';
import { StudyBadge } from './StudyBadge';
import { PreprintBadge } from './PreprintBadge';
import { ReviewTypeBadge } from './ReviewTypeBadge';
import { SourceBadge } from './SourceBadge';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { cn, sanitizeUrl } from '@/lib/utils';
import { explainScore, hasNoOutcomesReported } from '@/utils/explainScore';
import { highlightTerms } from '@/utils/highlightTerms';

interface StudyCardProps {
  study: StudyResult;
  query: string;
  relevanceScore?: number;
  showScoreBreakdown?: boolean;
}

function NullValue({ text = 'Not reported' }: { text?: string }) {
  return <span className="null-value">{text}</span>;
}

function renderHighlighted(text: string, query: string) {
  return highlightTerms(text, query).map((segment, idx) =>
    segment.isMatch ? (
      <mark key={`${segment.text}-${idx}`} className="bg-yellow-200 dark:bg-yellow-900 font-medium px-0.5 rounded-sm">
        {segment.text}
      </mark>
    ) : (
      <span key={`${segment.text}-${idx}`}>{segment.text}</span>
    )
  );
}

function getDesignAccent(study: StudyResult): string {
  if (study.review_type === 'Meta-analysis') return 'border-l-4 border-l-emerald-500';
  if (study.study_design === 'RCT') return 'border-l-4 border-l-blue-500';
  if (study.study_design === 'review' || study.review_type === 'Systematic review') return 'border-l-4 border-l-slate-400';
  if (study.study_design === 'unknown') return 'border-l-4 border-l-muted';
  return 'border-l-4 border-l-muted/50';
}

export const StudyCard = memo(({ study, query, relevanceScore, showScoreBreakdown = false }: StudyCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSupportingText, setShowSupportingText] = useState(false);

  const scoreDetails = explainScore(study, query);
  const score = relevanceScore ?? scoreDetails.score;
  const hasOutcomes = study.outcomes && study.outcomes.length > 0;
  const isLowValue = score <= 0 || hasNoOutcomesReported(study);

  return (
    <Card
      className={cn(
        'transition-all hover:shadow-md',
        getDesignAccent(study),
        score >= 2 && 'bg-emerald-50/40 dark:bg-emerald-950/20',
        isLowValue && 'opacity-60'
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base leading-tight mb-1">{renderHighlighted(study.title, query)}</h3>

            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <span>{study.year}</span>
              {study.sample_size !== null && (
                <>
                  <span>•</span>
                  <span>N = {study.sample_size.toLocaleString()}</span>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5 items-center">
              <StudyBadge design={study.study_design} />
              <PreprintBadge status={study.preprint_status} />
              <ReviewTypeBadge reviewType={study.review_type} />
              <SourceBadge source={study.source} citationCount={study.citationCount} />
              <Badge
                variant="outline"
                className={cn(
                  score >= 2 && 'border-emerald-500 text-emerald-700',
                  score > 0 && score < 2 && 'border-blue-500 text-blue-700',
                  score <= 0 && 'border-amber-600 text-amber-700'
                )}
              >
                Score: {score > 0 ? '+' : ''}{score}
              </Badge>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" aria-label="Scoring details" className="text-muted-foreground hover:text-foreground">
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Score based on keyword match + study design weighting. No semantic inference.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {isLowValue && (
                <Badge variant="secondary" className="bg-muted text-muted-foreground">
                  Low relevance
                </Badge>
              )}
            </div>
            {showScoreBreakdown && (
              <div className="mt-2 text-xs text-muted-foreground">
                Keyword match: {scoreDetails.keywordMatch > 0 ? '+' : ''}{scoreDetails.keywordMatch} • Design weight: {scoreDetails.designWeight > 0 ? '+' : ''}{scoreDetails.designWeight} • Penalty: {scoreDetails.penalty}
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        <div className="mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Key Outcomes</h4>
          {hasOutcomes ? (
            <ul className="space-y-2 text-sm">
              {study.outcomes.map((outcome, idx) => (
                <li key={idx} className="space-y-1">
                  <div className="flex gap-2">
                    <span className="text-muted-foreground">•</span>
                    <div className="flex-1">
                      <strong className="font-semibold">{renderHighlighted(outcome.outcome_measured, query)}</strong>
                      {outcome.key_result ? (
                        <div className="text-sm">→ {renderHighlighted(outcome.key_result, query)}</div>
                      ) : (
                        <div className="text-sm">→ <NullValue text="Not reported" /></div>
                      )}
                    </div>
                  </div>
                  {showSupportingText && (
                    <blockquote className="ml-5 border-l-2 border-primary/20 pl-3 italic text-xs text-foreground/90">
                      "{renderHighlighted(outcome.citation_snippet, query)}"
                    </blockquote>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic">No outcomes reported</p>
          )}
          {hasOutcomes && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSupportingText(!showSupportingText)}
              className="px-0 text-xs h-auto mt-2"
            >
              {showSupportingText ? 'Hide supporting text' : 'Show supporting text'}
            </Button>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full justify-between hover:bg-secondary/50"
        >
          <span className="text-xs font-medium">{isExpanded ? 'Hide details' : 'Show details'}</span>
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>

        {isExpanded && (
          <div className="mt-4 pt-4 border-t space-y-3">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Citation</h4>
              <p className="text-sm text-foreground">{study.citation.formatted}</p>
              <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                {study.citation.doi && <span>DOI: {study.citation.doi}</span>}
                {study.citation.pubmed_id && <span>PMID: {study.citation.pubmed_id}</span>}
              </div>
            </div>

            {study.population && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Population (Verbatim)</h4>
                <p className="text-sm text-foreground">{study.population}</p>
              </div>
            )}

            {study.abstract_excerpt && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Abstract Excerpt</h4>
                <blockquote className="border-l-2 border-primary/30 pl-3 italic text-sm text-foreground">
                  "{renderHighlighted(study.abstract_excerpt, query)}"
                </blockquote>
              </div>
            )}

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

              {study.source === 'semantic_scholar' && (
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
