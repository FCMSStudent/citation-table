import { describe, it, expect } from 'vitest';
import { calculateRelevanceScore, isLowValueStudy, sortByRelevance } from '../utils/relevanceScore';
import type { StudyResult } from '../shared/types/research';

const picoDefaults = { intervention: null, comparator: null, effect_size: null, p_value: null };

describe('Relevance Scoring', () => {
  const baseStudy: StudyResult = {
    study_id: 'test-1',
    title: 'Test Study',
    year: 2023,
    study_design: 'RCT',
    sample_size: 100,
    population: 'Adults',
    outcomes: [
      { outcome_measured: 'Blood pressure', key_result: 'Reduced by 10 mmHg', citation_snippet: 'Significant reduction in blood pressure', ...picoDefaults }
    ],
    citation: { doi: '10.1234/test', pubmed_id: null, openalex_id: null, formatted: 'Test et al. (2023). Test Study.' },
    abstract_excerpt: 'Test abstract',
    preprint_status: 'Peer-reviewed',
    review_type: 'None',
    source: 'openalex'
  };

  describe('calculateRelevanceScore', () => {
    it('should give +2 for matching query keywords in outcomes', () => {
      const score = calculateRelevanceScore({ ...baseStudy }, 'blood pressure diabetes');
      expect(score).toBeGreaterThanOrEqual(2);
    });

    it('should give +1 for Meta-analysis', () => {
      const score = calculateRelevanceScore({ ...baseStudy, review_type: 'Meta-analysis' as const }, 'unrelated query terms');
      expect(score).toBe(1);
    });

    it('should give +1 for Systematic review', () => {
      const score = calculateRelevanceScore({ ...baseStudy, review_type: 'Systematic review' as const }, 'unrelated query terms');
      expect(score).toBe(1);
    });

    it('should give -2 for no outcomes reported', () => {
      const study: StudyResult = {
        ...baseStudy,
        outcomes: [{ outcome_measured: 'No outcomes reported', key_result: null, citation_snippet: 'No outcomes reported', ...picoDefaults }]
      };
      expect(calculateRelevanceScore(study, 'test query')).toBe(-2);
    });

    it('should give -2 for empty outcomes array', () => {
      expect(calculateRelevanceScore({ ...baseStudy, outcomes: [] }, 'test query')).toBe(-2);
    });

    it('should combine scores correctly', () => {
      const study: StudyResult = {
        ...baseStudy,
        review_type: 'Meta-analysis' as const,
        outcomes: [{ outcome_measured: 'Blood pressure and diabetes outcomes', key_result: 'Improved control', citation_snippet: 'Significant improvements', ...picoDefaults }]
      };
      expect(calculateRelevanceScore(study, 'blood pressure diabetes control')).toBe(3);
    });
  });

  describe('isLowValueStudy', () => {
    it('should return true for studies with no outcomes', () => {
      expect(isLowValueStudy({ ...baseStudy, outcomes: [] }, -2)).toBe(true);
    });

    it('should return true for studies with "No outcomes reported"', () => {
      const study: StudyResult = {
        ...baseStudy,
        outcomes: [{ outcome_measured: 'No outcomes reported', key_result: null, citation_snippet: 'No outcomes reported', ...picoDefaults }]
      };
      expect(isLowValueStudy(study, -2)).toBe(true);
    });

    it('should return false for studies with valid outcomes', () => {
      expect(isLowValueStudy({ ...baseStudy }, 1)).toBe(false);
    });
  });

  describe('sortByRelevance', () => {
    it('should sort studies by relevance score descending', () => {
      const studies: StudyResult[] = [
        { ...baseStudy, study_id: 'low', outcomes: [] },
        { ...baseStudy, study_id: 'high', review_type: 'Meta-analysis', outcomes: [{ outcome_measured: 'Blood pressure diabetes', key_result: 'Improved', citation_snippet: 'Test', ...picoDefaults }] },
        { ...baseStudy, study_id: 'medium' }
      ];
      const sorted = sortByRelevance(studies, 'blood pressure diabetes');
      expect(sorted[0].study_id).toBe('high');
      expect(sorted[0].relevanceScore).toBe(3);
      expect(sorted[2].study_id).toBe('low');
      expect(sorted[2].relevanceScore).toBe(-2);
    });

    it('should include relevanceScore in returned objects', () => {
      const sorted = sortByRelevance([baseStudy], 'test query');
      expect(sorted[0]).toHaveProperty('relevanceScore');
      expect(typeof sorted[0].relevanceScore).toBe('number');
    });
  });
});
