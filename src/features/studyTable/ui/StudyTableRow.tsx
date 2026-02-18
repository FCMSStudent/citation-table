import { Fragment, memo, useMemo } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { Badge } from '@/shared/ui/Badge';
import { StatusChip } from '@/shared/ui/StatusChip';
import { cn, sanitizeUrl } from '@/shared/lib/utils';
import type { ScoredStudy } from '@/features/studyTable/model/useStudyTableState';
import type { StudyPdf } from '@/shared/types/research';

function normalizeOpenAlexStudyUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return sanitizeUrl(value);
  return sanitizeUrl(`https://openalex.org/${value}`);
}

interface StudyTableRowProps {
  study: ScoredStudy;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  highlightedStudyId: string | null;
  pdf?: StudyPdf;
  expandedSnippetIndices: string;
  onToggleSnippet: (key: string) => void;
}

export const StudyTableRow = memo(function StudyTableRow({
  study,
  isExpanded,
  onToggle,
  highlightedStudyId,
  pdf,
  expandedSnippetIndices,
  onToggleSnippet,
}: StudyTableRowProps) {
  const firstOutcomeResult = study.outcomes?.find((o) => o.key_result)?.key_result || '—';
  const openAlexUrl = normalizeOpenAlexStudyUrl(study.citation.openalex_id);
  const doiUrl = study.citation.doi ? sanitizeUrl(`https://doi.org/${study.citation.doi}`) : null;
  const expandedIndices = useMemo(() => new Set(expandedSnippetIndices.split(',')), [expandedSnippetIndices]);

  return (
    <Fragment>
      <div
        id={`study-row-${study.study_id}`}
        className={cn('grid grid-cols-12 gap-3 border-b px-3 py-2 text-sm', highlightedStudyId === study.study_id && 'bg-primary/10')}
        role="row"
      >
        <div className="col-span-4">
          <p className="font-medium text-foreground">{study.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {study.year}
            {study.citation.formatted ? ` • ${study.citation.formatted}` : ''}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
            <StatusChip tone="info">Provider: {study.source}</StatusChip>
            <StatusChip tone={study.relevanceScore >= 70 ? 'success' : study.relevanceScore >= 40 ? 'warning' : 'danger'}>
              Confidence: {Math.max(0, Math.min(100, study.relevanceScore))}%
            </StatusChip>
            {study.citation.doi && <StatusChip>DOI: {study.citation.doi}</StatusChip>}
          </div>
        </div>

        <div className="col-span-2 text-muted-foreground">
          <div className="space-y-1">
            <Badge variant={study.completenessTier === 'strict' ? 'secondary' : 'outline'} className="w-fit text-[10px]">
              {study.completenessTier === 'strict' ? 'Strict' : 'Partial'}
            </Badge>
            <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
              {study.review_type === 'Meta-analysis' ? 'Meta-analysis' : study.study_design || 'Unknown'}
            </span>
            <p className="text-xs">N={study.sample_size?.toLocaleString() || 'NR'}</p>
          </div>
        </div>

        <div className="col-span-2 text-xs text-muted-foreground">
          {study.outcomes?.length ? study.outcomes.map((o) => o.outcome_measured).filter(Boolean).join('; ') : 'Not reported'}
        </div>

        <div className="col-span-2 text-xs text-muted-foreground line-clamp-1">{firstOutcomeResult}</div>

        <div className="col-span-1 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {doiUrl && (
              <a href={doiUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                DOI <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {openAlexUrl && (
              <a href={openAlexUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                OpenAlex <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {pdf?.status === 'downloaded' && pdf.public_url && (
              <a href={sanitizeUrl(pdf.public_url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                PDF <FileText className="h-3 w-3" />
              </a>
            )}
            {pdf?.status === 'pending' && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> PDF
              </span>
            )}
          </div>
        </div>

        <div className="col-span-1 text-right">
          <button
            type="button"
            onClick={() => onToggle(study.study_id)}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-muted"
            aria-expanded={isExpanded}
          >
            {isExpanded ? 'Hide' : 'Show'}
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-b bg-muted/20 px-3 py-3">
          <div className="space-y-3 text-sm">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Result evidence</h4>
              <div className="mt-2 space-y-2">
                {(study.outcomes || []).map((outcome, idx) => {
                  const snippetKey = `${study.study_id}-${idx}`;
                  const snippetOpen = expandedIndices.has(String(idx));
                  return (
                    <div key={snippetKey} className="rounded-md border bg-background p-2">
                      <p className="text-xs font-medium text-foreground">{outcome.outcome_measured || 'Outcome'}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{outcome.key_result || 'Not reported'}</p>
                      {outcome.citation_snippet && (
                        <div className="mt-1">
                          <button type="button" onClick={() => onToggleSnippet(snippetKey)} className="text-[11px] text-primary hover:underline">
                            {snippetOpen ? 'Hide source quote' : 'Show source quote'}
                          </button>
                          {snippetOpen && (
                            <blockquote className="mt-1 border-l-2 border-primary/30 pl-2 text-[11px] italic text-muted-foreground">
                              {outcome.citation_snippet}
                            </blockquote>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </Fragment>
  );
});
