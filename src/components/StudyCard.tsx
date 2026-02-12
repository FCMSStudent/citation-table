import { useMemo, useState, memo } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Info } from 'lucide-react';
import type { StudyResult } from '@/types/research';
import { Card, CardContent, CardHeader } from './ui/card';
import { PreprintBadge } from './PreprintBadge';
import { ReviewTypeBadge } from './ReviewTypeBadge';
import { SourceBadge } from './SourceBadge';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { getScoreBreakdown } from '@/utils/explainScore';
import { highlightTerms } from '@/utils/highlightTerms';
import { cn, sanitizeUrl } from '@/lib/utils';

interface StudyCardProps {
  study: StudyResult;
  query: string;
  relevanceScore: number;
  isLowValue?: boolean;
  showScoreBreakdown?: boolean;
}

function NullValue({ text = 'Not reported' }: { text?: string }) {
  return <span className="null-value">{text}</span>;
}

function renderHighlightedText(text: string, query: string): ReactNode {
  return highlightTerms(text, query).map((part, index) =>
    part.isMatch ? (
      <mark key={`${part.text}-${index}`} className="rounded-sm bg-yellow-200/80 px-0.5 dark:bg-yellow-900/80">
        {part.text}
      </mark>
    ) : (
      <span key={`${part.text}-${index}`}>{part.text}</span>
    ),
  );
}

function getDesignStyle(study: StudyResult): string {
  if (study.review_type === 'Meta-analysis') {
    return 'border-l-4 border-l-emerald-500';
  }

  if (study.study_design === 'RCT') {
    return 'border-l-4 border-l-blue-500';
  }

  if (study.study_design === 'review' || study.review_type === 'Systematic review') {
    return 'border-l-4 border-l-slate-400';
  }

  return 'border-l-4 border-l-muted';
}

function getScoreBadgeClass(score: number): string {
  if (score >= 2) {
    return 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200';
  }

  if (score <= 0) {
    return 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200';
  }

  return 'bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950 dark:text-blue-200';
}

export const StudyCard = memo(({ study, query, relevanceScore, isLowValue = false, showScoreBreakdown = false }: StudyCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSupportingText, setShowSupportingText] = useState(false);
  const hasOutcomes = study.outcomes && study.outcomes.length > 0;

  const scoreBreakdown = useMemo(() => getScoreBreakdown(study, query), [study, query]);

  return (
    <Card
      className={cn(
        'transition-shadow hover:shadow-md',
        getDesignStyle(study),
        relevanceScore >= 2 && 'bg-primary/5',
        isLowValue && 'opacity-60',
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="mb-1 text-base font-bold leading-tight">{renderHighlightedText(study.title, query)}</h3>

            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{study.year}</span>
              {study.sample_size !== null && <span>• N = {study.sample_size.toLocaleString()}</span>}
              {study.citationCount != null && (
                <span>• 📊 {study.citationCount.toLocaleString()} citations</span>
              )}
              {isLowValue && (
                <span className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Low relevance
                </span>
              )}
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded border px-2 py-0.5 text-xs font-medium">{study.review_type === 'Meta-analysis' ? 'Meta-analysis' : study.study_design === 'RCT' ? 'RCT' : study.study_design === 'review' || study.review_type === 'Systematic review' ? 'Review' : 'Unknown'}</span>
              <span className={cn('inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold', getScoreBadgeClass(relevanceScore))}>
                Score: {relevanceScore > 0 ? '+' : ''}{relevanceScore}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="inline-flex" aria-label="How relevance score is computed">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Score based on keyword match + study design weighting. No semantic inference.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </span>
            </div>

            {showScoreBreakdown && (
              <div className="mb-2 rounded border bg-muted/40 px-2 py-1 text-xs">
                Keyword match: {scoreBreakdown.keywordMatch >= 0 ? '+' : ''}{scoreBreakdown.keywordMatch} • Design weight: +{scoreBreakdown.designWeight} • Penalty: {scoreBreakdown.penalty}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              <PreprintBadge status={study.preprint_status} />
              <ReviewTypeBadge reviewType={study.review_type} />
              <SourceBadge source={study.source} citationCount={study.citationCount} />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        <div className="mb-3">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key Outcomes</h4>
          {hasOutcomes ? (
            <div className="space-y-2">
              <ul className="space-y-2 text-sm">
                {study.outcomes.map((outcome, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="text-muted-foreground">•</span>
                    <div className="flex-1">
                      <strong>{renderHighlightedText(outcome.outcome_measured, query)}</strong>
                      <div>
                        {outcome.key_result ? renderHighlightedText(outcome.key_result, query) : <NullValue text="Not reported" />}
                      </div>
                      {showSupportingText && outcome.citation_snippet && (
                        <blockquote className="mt-1 border-l-2 border-primary/30 pl-3 text-xs italic text-muted-foreground">
                          {renderHighlightedText(outcome.citation_snippet, query)}
                        </blockquote>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <Button variant="ghost" size="sm" className="h-auto px-0 text-xs" onClick={() => setShowSupportingText((prev) => !prev)}>
                {showSupportingText ? 'Hide supporting text' : 'Show supporting text'}
              </Button>
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">No outcomes reported</p>
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
          <div className="mt-4 space-y-3 border-t pt-4">
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Citation</h4>
              <p className="text-sm text-foreground">{study.citation.formatted}</p>
              <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                {study.citation.doi && <span>DOI: {study.citation.doi}</span>}
                {study.citation.pubmed_id && <span>PMID: {study.citation.pubmed_id}</span>}
              </div>
            </div>

            {study.population && (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Population (Verbatim)</h4>
                <p className="text-sm text-foreground">{study.population}</p>
              </div>
            )}

            {study.abstract_excerpt && (
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Abstract Excerpt</h4>
                <blockquote className="border-l-2 border-primary/30 pl-3 italic text-sm text-foreground">
                  {renderHighlightedText(study.abstract_excerpt, query)}
                </blockquote>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              {study.citation.doi && (
                <a
                  href={sanitizeUrl(`https://doi.org/${study.citation.doi}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
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
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
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
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View on Semantic Scholar
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {study.source === 'arxiv' && study.study_id && (
                <a
                  href={sanitizeUrl(`https://arxiv.org/abs/${study.study_id}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View on arXiv
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
