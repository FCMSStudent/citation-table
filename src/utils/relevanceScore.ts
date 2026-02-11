import type { StudyResult } from '@/types/research';
import { explainScore, hasNoOutcomesReported } from '@/utils/explainScore';

/**
 * Calculate relevance score for a study result based on simple heuristics
 */
export function calculateRelevanceScore(study: StudyResult, query: string): number {
  return explainScore(study, query).score;
}

/**
 * Check if a study should be excluded from default view
 */
export function isLowValueStudy(study: StudyResult, query: string): boolean {
  const score = calculateRelevanceScore(study, query);
  const isLowValue = score <= 0 || hasNoOutcomesReported(study);
  return isLowValue;
}

/**
 * Sort studies by relevance score (descending)
 */
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
