import type { StudyResult } from '@/types/research';
import { getScoreBreakdown } from './explainScore';

function getOutcomeText(study: StudyResult): string {
  return study.outcomes
    ?.map((outcome) => `${outcome.outcome_measured} ${outcome.key_result || ''}`.toLowerCase())
    .join(' ') || '';
}

export function calculateRelevanceScore(study: StudyResult, query: string): number {
  return getScoreBreakdown(study, query).total;
}

/**
 * Check if a study should be excluded from default view
 */
export function isLowValueStudy(study: StudyResult, relevanceScore: number): boolean {
  const outcomesText = getOutcomeText(study);
  return relevanceScore <= 0 || outcomesText.includes('no outcomes reported');
}

export function sortByRelevance(
  studies: StudyResult[],
  query: string
): Array<StudyResult & { relevanceScore: number }> {
  return studies
    .map((study) => ({
      ...study,
      relevanceScore: calculateRelevanceScore(study, query),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}
