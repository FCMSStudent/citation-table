import type { StudyResult } from '@/types/research';
import { extractKeywords } from './highlightTerms';

export interface ScoreBreakdown {
  keywordMatch: number;
  designWeight: number;
  penalty: number;
  total: number;
}

function getOutcomeText(study: StudyResult): string {
  return study.outcomes
    ?.map((outcome) => `${outcome.outcome_measured} ${outcome.key_result || ''}`.toLowerCase())
    .join(' ') || '';
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
