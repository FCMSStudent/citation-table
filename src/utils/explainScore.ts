import type { StudyResult } from '@/shared/types/research';
import { extractKeywords } from './highlightTerms';
import { getOutcomeText } from './relevanceScore';

export interface ScoreBreakdown {
  keywordMatch: number;
  designWeight: number;
  penalty: number;
  titleMatch: number;
  sampleSizeBonus: number;
  total: number;
}

export function getScoreBreakdown(study: StudyResult, query: string): ScoreBreakdown {
  const keywords = extractKeywords(query);
  const outcomesText = getOutcomeText(study);
  const hasNoOutcomes = !study.outcomes || study.outcomes.length === 0;

  // Graduated keyword matching: +1 for 1 match, +2 for 2+
  let keywordMatch = 0;
  if (!hasNoOutcomes && keywords.length >= 1) {
    const matchCount = keywords.filter((kw) => outcomesText.includes(kw)).length;
    if (matchCount >= 2) keywordMatch = 2;
    else if (matchCount >= 1) keywordMatch = 1;
  }

  // +1 for high-level reviews, +0.5 for any known design
  let designWeight = 0;
  if (study.review_type === 'Meta-analysis' || study.review_type === 'Systematic review') {
    designWeight = 1;
  } else if (study.study_design && study.study_design !== 'unknown') {
    designWeight = 0.5;
  }

  const penalty = hasNoOutcomes || outcomesText.includes('no outcomes reported') ? -2 : 0;

  // +0.5 if any query keyword appears in the title
  let titleMatch = 0;
  if (study.title && keywords.length >= 1) {
    const titleLower = study.title.toLowerCase();
    if (keywords.some((kw) => titleLower.includes(kw))) {
      titleMatch = 0.5;
    }
  }

  // +0.5 if sample size data is present
  const sampleSizeBonus = study.sample_size ? 0.5 : 0;

  return {
    keywordMatch,
    designWeight,
    penalty,
    titleMatch,
    sampleSizeBonus,
    total: keywordMatch + designWeight + penalty + titleMatch + sampleSizeBonus,
  };
}
