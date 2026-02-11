import type { StudyResult } from '@/types/research';

/**
 * Extract keywords from a research query
 * Simple heuristic: split by common medical research separators
 */
function extractKeywords(query: string): string[] {
  // Split on common separators and remove stop words
  const stopWords = new Set(['and', 'or', 'in', 'on', 'the', 'a', 'an', 'of', 'for', 'with', 'to']);
  
  return query
    .toLowerCase()
    .split(/[\s,;]+/)
    .map(word => word.trim())
    .filter(word => word.length > 2 && !stopWords.has(word));
}

/**
 * Calculate relevance score for a study result based on simple heuristics
 * 
 * Scoring rules:
 * +2: Both exposure and outcome keywords from query appear in extracted outcomes
 * +1: Study design is "Meta-analysis" or "Systematic Review"
 * -2: Outcomes contain "No outcomes reported"
 * 
 * @param study - The study result to score
 * @param query - The original search query
 * @returns Numeric relevance score
 */
export function calculateRelevanceScore(study: StudyResult, query: string): number {
  let score = 0;
  
  // Extract keywords from query
  const keywords = extractKeywords(query);
  
  // Check if outcomes exist
  const hasNoOutcomes = !study.outcomes || study.outcomes.length === 0;
  const outcomesText = study.outcomes?.map(o => 
    `${o.outcome_measured} ${o.key_result || ''}`.toLowerCase()
  ).join(' ') || '';
  
  // Rule 1: -2 if "No outcomes reported" (check both empty array and null values)
  if (hasNoOutcomes || outcomesText.includes('no outcomes reported')) {
    score -= 2;
  }
  
  // Rule 2: +2 if query keywords appear in outcomes
  // For simplicity, check if at least 2 keywords match (representing exposure and outcome)
  if (!hasNoOutcomes && keywords.length >= 2) {
    const matchedKeywords = keywords.filter(keyword => 
      outcomesText.includes(keyword)
    );
    
    if (matchedKeywords.length >= 2) {
      score += 2;
    }
  }
  
  // Rule 3: +1 if study design is Meta-analysis or Systematic Review
  if (study.review_type === 'Meta-analysis' || study.review_type === 'Systematic review') {
    score += 1;
  }
  
  return score;
}

/**
 * Check if a study should be excluded from default view
 * 
 * @param study - The study result to check
 * @returns true if study should be hidden by default
 */
export function isLowValueStudy(study: StudyResult): boolean {
  // Exclude if outcomes contain "No outcomes reported" or outcomes array is empty
  const hasNoOutcomes = !study.outcomes || study.outcomes.length === 0;
  
  if (hasNoOutcomes) {
    return true;
  }
  
  const outcomesText = study.outcomes?.map(o => 
    `${o.outcome_measured} ${o.key_result || ''}`.toLowerCase()
  ).join(' ') || '';
  
  return outcomesText.includes('no outcomes reported');
}

/**
 * Sort studies by relevance score (descending)
 * 
 * @param studies - Array of study results
 * @param query - The original search query
 * @returns Sorted array of studies with scores
 */
export function sortByRelevance(
  studies: StudyResult[], 
  query: string
): Array<StudyResult & { relevanceScore: number }> {
  return studies
    .map(study => ({
      ...study,
      relevanceScore: calculateRelevanceScore(study, query)
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}
