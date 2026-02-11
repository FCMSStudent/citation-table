import type { StudyResult } from '@/types/research';

const MIN_KEYWORD_MATCHES = 2;
const STOP_WORDS = new Set(['and', 'or', 'in', 'on', 'the', 'a', 'an', 'of', 'for', 'with', 'to']);

export interface ScoreBreakdown {
  score: number;
  keywordMatch: number;
  designWeight: number;
  penalty: number;
}

export function extractQueryKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

export function hasNoOutcomesReported(study: StudyResult): boolean {
  if (!study.outcomes || study.outcomes.length === 0) {
    return true;
  }

  const outcomesText = study.outcomes
    .map((outcome) => `${outcome.outcome_measured} ${outcome.key_result || ''}`.toLowerCase())
    .join(' ');

  return outcomesText.includes('no outcomes reported');
}

export function explainScore(study: StudyResult, query: string): ScoreBreakdown {
  const keywords = extractQueryKeywords(query);
  const outcomesText = study.outcomes
    ?.map((outcome) => `${outcome.outcome_measured} ${outcome.key_result || ''}`.toLowerCase())
    .join(' ') || '';

  let keywordMatch = 0;
  let designWeight = 0;
  let penalty = 0;

  const matchedKeywords = keywords.filter((keyword) => outcomesText.includes(keyword));
  if (!hasNoOutcomesReported(study) && keywords.length >= MIN_KEYWORD_MATCHES && matchedKeywords.length >= MIN_KEYWORD_MATCHES) {
    keywordMatch = 2;
  }

  if (study.review_type === 'Meta-analysis' || study.review_type === 'Systematic review') {
    designWeight = 1;
  }

  if (hasNoOutcomesReported(study)) {
    penalty = -2;
  }

  return {
    score: keywordMatch + designWeight + penalty,
    keywordMatch,
    designWeight,
    penalty,
  };
}
