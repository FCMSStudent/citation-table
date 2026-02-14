// components/SynthesisView.tsx
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Download, Loader2, AlertTriangle, Quote } from 'lucide-react';
import type { StudyResult } from "@/types/research";
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { getEffectDirection, type EffectDirection } from '@/utils/effectDirection';
import { DirectionBadge } from './ui/direction-badge';

const OUTCOME_NORM_REGEX = /\b(symptoms?|levels?|scores?|measures?|rates?|performance)\b/g;
const AUTHOR_EXTRACT_REGEX = /^([^,(]+)/;
const ET_AL_REGEX = /\set al\.?$/i;

const CAUSAL_MAP: Record<string, string> = {
  'cause': 'was associated with',
  'causes': 'was associated with',
  'caused': 'was associated with',
  'causing': 'was associated with',
  'led to': 'was associated with',
  'leads to': 'was associated with',
  'resulted in': 'showed',
  'results in': 'showed',
  'due to': 'associated with',
  'effect of': 'association with'
};

const CAUSAL_REGEX = /\b(cause[ds]?|causing|led to|leads to|resulted in|results in|due to|effect of)\b/gi;

interface SynthesisViewProps {
  studies: StudyResult[];
  outcomeAggregation: Array<{
    outcome: string;
    studyCount: number;
    studies: Array<{
      study: StudyResult;
      result: string;
    }>;
  }>;
  query: string;
  pdfsByDoi?: Record<string, import('@/types/research').StudyPdf>;
}

interface ThematicGroup {
  theme: string;
  description: string;
  studies: Array<{
    study: StudyResult;
    relevanceScore: number;
  }>;
  keyFindings: string[];
}

function CitationSnippet({ snippet, snippetKey, expandedSnippets, toggleSnippet }: {
  snippet: string;
  snippetKey: string;
  expandedSnippets: Set<string>;
  toggleSnippet: (key: string) => void;
}) {
  if (!snippet) return null;
  const isExpanded = expandedSnippets.has(snippetKey);
  return (
    <div>
      <button
        onClick={() => toggleSnippet(snippetKey)}
        className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Quote className="h-3 w-3" />
        {isExpanded ? 'Hide source' : 'Source'}
      </button>
      {isExpanded && (
        <blockquote className="mt-1 border-l-2 border-muted pl-3 text-xs italic text-muted-foreground">
          {snippet}
        </blockquote>
      )}
    </div>
  );
}

export function SynthesisView({ studies, outcomeAggregation, query, pdfsByDoi = {} }: SynthesisViewProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['group-0']));
  const [expandedOutcomes, setExpandedOutcomes] = useState<Set<string>>(new Set());
  const [expandedSnippets, setExpandedSnippets] = useState<Set<string>>(new Set());

  const toggleOutcome = (outcomeKey: string) => {
    setExpandedOutcomes((prev) => {
      const next = new Set(prev);
      if (next.has(outcomeKey)) next.delete(outcomeKey);
      else next.add(outcomeKey);
      return next;
    });
  };

  const toggleSnippet = (snippetKey: string) => {
    setExpandedSnippets((prev) => {
      const next = new Set(prev);
      if (next.has(snippetKey)) next.delete(snippetKey);
      else next.add(snippetKey);
      return next;
    });
  };

  const thematicGroups = useMemo(() => {
    const groups = new Map<string, ThematicGroup>();

    studies.forEach((study) => {
      const design = study.study_design || 'observational';
      const designCategory = categorizeDesign(design);
      const popType = extractPopulationType(study.population);
      const key = `${designCategory}-${popType}`;

      if (!groups.has(key)) {
        groups.set(key, {
          theme: formatTheme(designCategory, popType),
          description: getThemeDescription(designCategory, popType),
          studies: [],
          keyFindings: []
        });
      }

      groups.get(key)!.studies.push({
        study,
        relevanceScore: (study as any).relevanceScore || 0
      });
    });

    groups.forEach((group) => {
      const findings = new Set<string>();
      group.studies.forEach(({ study }) => {
        study.outcomes?.forEach((outcome) => {
          if (outcome.key_result) {
            const normalized = normalizeOutcome(outcome.outcome_measured);
            findings.add(normalized);
          }
        });
      });
      group.keyFindings = Array.from(findings).slice(0, 4);
    });

    return Array.from(groups.entries())
      .map(([key, group], idx) => ({ ...group, id: `group-${idx}` }))
      .sort((a, b) => b.studies.length - a.studies.length);
  }, [studies]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Outcome-based synthesis */}
      {outcomeAggregation.length > 0 && (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Key Findings by Outcome</h2>
          <div className="space-y-6">
            {outcomeAggregation.slice(0, 10).map(({ outcome, studyCount, studies: outcomeStudies }) => {
              const isOutcomeExpanded = expandedOutcomes.has(outcome);
              const visibleStudies = isOutcomeExpanded ? outcomeStudies : outcomeStudies.slice(0, 3);
              const hiddenCount = outcomeStudies.length - 3;

              return (
                <div key={outcome} className="border-l-2 border-blue-500 pl-4">
                  <h3 className="mb-2 font-medium capitalize">
                    {outcome}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({studyCount} {studyCount === 1 ? 'study' : 'studies'})
                    </span>
                  </h3>
                  <div className="space-y-2 text-sm">
                    {visibleStudies.map(({ study, result }, idx) => {
                      const citation = formatCitation(study);
                      const sanitized = sanitizeResult(result);
                      const direction = getEffectDirection(result);
                      const matchingOutcome = study.outcomes?.find(
                        (o) => o.key_result === result || o.outcome_measured.toLowerCase() === outcome.toLowerCase()
                      );
                      const snippetKey = `outcome-${outcome}-${study.study_id}-${idx}`;

                      return (
                        <div key={study.study_id}>
                          <div className="flex items-start gap-1.5 text-gray-700 dark:text-gray-300">
                            <DirectionBadge direction={direction} variant="icon" />
                            <div>
                              <span className="font-medium">{citation}:</span> {sanitized}
                            </div>
                          </div>
                          {matchingOutcome?.citation_snippet && (
                            <div className="ml-5">
                              <CitationSnippet
                                snippet={matchingOutcome.citation_snippet}
                                snippetKey={snippetKey}
                                expandedSnippets={expandedSnippets}
                                toggleSnippet={toggleSnippet}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {hiddenCount > 0 && (
                      <button
                        onClick={() => toggleOutcome(outcome)}
                        className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {isOutcomeExpanded
                          ? 'Show fewer'
                          : `+${hiddenCount} more ${hiddenCount === 1 ? 'study' : 'studies'}`
                        }
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Study design-based synthesis */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Evidence by Study Design</h2>
        {thematicGroups.map((group) => {
          const isExpanded = expandedGroups.has(group.id);
          return (
            <div key={group.id} className="rounded-lg border bg-card">
              <button
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/50"
              >
                {isExpanded ? (
                  <ChevronDown className="mt-1 h-5 w-5 flex-shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="mt-1 h-5 w-5 flex-shrink-0 text-muted-foreground" />
                )}
                <div className="flex-1">
                  <h3 className="mb-1 font-semibold">
                    {group.theme}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({group.studies.length} {group.studies.length === 1 ? 'study' : 'studies'})
                    </span>
                  </h3>
                  <p className="text-sm text-muted-foreground">{group.description}</p>
                  {group.keyFindings.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {group.keyFindings.map((finding) => (
                        <span key={finding} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                          {finding}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t bg-muted/20 p-4">
                  <div className="space-y-4">
                    {group.studies.map(({ study }) => (
                      <div key={study.study_id} className="rounded-lg border bg-card p-4">
                        <div className="mb-2 flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <h4 className="font-medium leading-tight">{study.title}</h4>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {formatCitation(study)} • {study.study_design || 'Study'}
                              {study.sample_size && ` • n=${study.sample_size}`}
                            </p>
                          </div>
                          <div className="flex gap-1">
                            {study.citation.openalex_id && (
                              <Button variant="ghost" size="sm" asChild>
                                <a href={`https://openalex.org/${study.citation.openalex_id}`} target="_blank" rel="noopener noreferrer" title="View in OpenAlex">
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              </Button>
                            )}
                            {study.citation.doi && (() => {
                              const pdf = pdfsByDoi[study.citation.doi!];
                              if (!pdf) return null;
                              if (pdf.status === 'downloaded' && pdf.public_url) {
                                return (
                                  <Button variant="ghost" size="sm" asChild>
                                    <a href={pdf.public_url} target="_blank" rel="noopener noreferrer" title="Download PDF">
                                      <Download className="h-4 w-4" />
                                    </a>
                                  </Button>
                                );
                              }
                              if (pdf.status === 'pending') {
                                return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
                              }
                              return null;
                            })()}
                          </div>
                        </div>

                        {study.outcomes && study.outcomes.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {study.outcomes
                              .filter((o) => o.key_result)
                              .map((outcome, idx) => {
                                const direction = getEffectDirection(outcome.key_result);
                                const snippetKey = `design-${study.study_id}-${idx}`;
                                return (
                                  <div key={idx} className="text-sm">
                                    <div className="flex items-start gap-1.5">
                                      <DirectionBadge direction={direction} variant="icon" />
                                      <div>
                                        <span className="font-medium text-gray-900 dark:text-gray-100">
                                          {outcome.outcome_measured}:
                                        </span>{' '}
                                        <span className="text-gray-700 dark:text-gray-300">
                                          {sanitizeResult(outcome.key_result || '')}
                                        </span>
                                      </div>
                                    </div>
                                    {outcome.citation_snippet && (
                                      <div className="ml-5">
                                        <CitationSnippet
                                          snippet={outcome.citation_snippet}
                                          snippetKey={snippetKey}
                                          expandedSnippets={expandedSnippets}
                                          toggleSnippet={toggleSnippet}
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Methodological quality note */}
      {thematicGroups.length > 0 && (() => {
        const notes = getQualityNotes(studies);
        return notes.length > 0 ? (
          <div className="rounded-lg border bg-amber-50/50 p-4 dark:bg-amber-950/20">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              Methodological Quality Notes
            </div>
            <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-300">
              {notes.map((note, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-amber-600 dark:text-amber-400">•</span>
                  {note}
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      })()}
    </div>
  );
}

// Helper functions
function categorizeDesign(design: string): string {
  const lower = design.toLowerCase();
  if (lower.includes('randomized') || lower.includes('rct')) return 'rct';
  if (lower.includes('meta-analysis')) return 'meta-analysis';
  if (lower.includes('systematic review') || lower === 'review') return 'systematic-review';
  if (lower.includes('cohort')) return 'cohort';
  if (lower.includes('cross-sectional')) return 'cross-sectional';
  if (lower.includes('case-control')) return 'case-control';
  return 'observational';
}

function extractPopulationType(population: string | null | undefined): string {
  if (!population) return 'general';
  const lower = population.toLowerCase();
  if (lower.includes('child') || lower.includes('adolescent') || lower.includes('pediatric')) return 'pediatric';
  if (lower.includes('elderly') || lower.includes('older adult')) return 'elderly';
  if (lower.includes('adult')) return 'adult';
  if (lower.includes('patient') || lower.includes('clinical')) return 'clinical';
  return 'general';
}

function formatTheme(design: string, popType: string): string {
  const designLabels: Record<string, string> = {
    'rct': 'Randomized Controlled Trials',
    'meta-analysis': 'Meta-Analyses',
    'systematic-review': 'Systematic Reviews',
    'cohort': 'Cohort Studies',
    'cross-sectional': 'Cross-Sectional Studies',
    'case-control': 'Case-Control Studies',
    'observational': 'Observational Studies'
  };
  const popLabels: Record<string, string> = {
    'pediatric': 'in Pediatric Populations',
    'elderly': 'in Elderly Populations',
    'adult': 'in Adult Populations',
    'clinical': 'in Clinical Populations',
    'general': ''
  };
  return `${designLabels[design] || 'Studies'} ${popLabels[popType] || ''}`.trim();
}

function getThemeDescription(design: string, popType: string): string {
  const descriptions: Record<string, string> = {
    'rct': 'Experimental studies with random assignment to treatment groups',
    'meta-analysis': 'Quantitative synthesis of multiple studies',
    'systematic-review': 'Comprehensive review of existing literature',
    'cohort': 'Longitudinal observation of groups over time',
    'cross-sectional': 'Snapshot observation at a single time point',
    'case-control': 'Retrospective comparison of cases and controls',
    'observational': 'Studies without experimental manipulation'
  };
  return descriptions[design] || 'Studies examining the research question';
}

function formatCitation(study: StudyResult): string {
  const author = extractFirstAuthor(study.citation.formatted);
  return study.year ? `${author} (${study.year})` : author;
}

function extractFirstAuthor(citation: string | null | undefined): string {
  if (!citation) return 'Unknown';
  const match = citation.match(AUTHOR_EXTRACT_REGEX);
  if (match) return match[1].replace(ET_AL_REGEX, '').trim();
  return 'Unknown';
}

function normalizeOutcome(outcome: string): string {
  return outcome.toLowerCase().replace(OUTCOME_NORM_REGEX, '').trim();
}

function sanitizeResult(result: string): string {
  return result.replace(CAUSAL_REGEX, (match) => CAUSAL_MAP[match.toLowerCase()] || match);
}

function getQualityNotes(studies: StudyResult[]): string[] {
  const notes: string[] = [];
  const preprintCount = studies.filter(s => s.preprint_status === 'Preprint').length;
  const rctCount = studies.filter(s => s.study_design?.toLowerCase().includes('randomized') || s.study_design?.toLowerCase().includes('rct')).length;
  const metaCount = studies.filter(s => s.study_design?.toLowerCase().includes('meta-analysis')).length;

  if (preprintCount === studies.length) {
    notes.push('All studies are preprints and have not undergone formal peer review');
  } else if (preprintCount > studies.length / 2) {
    notes.push(`${preprintCount} of ${studies.length} studies are preprints`);
  }
  if (metaCount > 0) {
    notes.push(`Includes ${metaCount} meta-${metaCount === 1 ? 'analysis' : 'analyses'} providing systematic evidence synthesis`);
  }
  if (rctCount > 0) {
    notes.push(`${rctCount} ${rctCount === 1 ? 'study uses' : 'studies use'} experimental design with randomization`);
  }
  if (notes.length === 0) {
    notes.push('Evidence is primarily observational; causal interpretations should be made cautiously');
  }
  return notes;
}
