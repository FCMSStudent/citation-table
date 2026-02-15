import type { StudyResult } from '@/shared/types/research';
import { extractKeywords } from './highlightTerms';
import { getOutcomeText } from './relevanceScore';

export interface ScoreBreakdown {
  keywordMatch: number;
  designWeight: number;
  penalty: number;
  total: number;
}

export function getScoreBreakdown(study: StudyResult, query: string): ScoreBreakdown {
  const keywords = extractKeywords(query);
  const outcomesText = getOutcomeText(study);
  const hasNoOutcomes = !study.outcomes || study.outcomes.length === 0;

  const keywordMatch =
    !hasNoOutcomes && keywords.length >= 2 && keywords.filter((keyword) => outcomesText.includes(keyword)).length >= 2
      ? 2
      : 0;

  const designWeight =
    study.review_type === 'Meta-analysis' || study.review_type === 'Systematic review'
      ? 1
      : 0;

  const penalty = hasNoOutcomes || outcomesText.includes('no outcomes reported') ? -2 : 0;

  return {
    keywordMatch,
    designWeight,
    penalty,
    total: keywordMatch + designWeight + penalty,
  };
}
