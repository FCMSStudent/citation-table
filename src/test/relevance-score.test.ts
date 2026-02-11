import { describe, it, expect } from 'vitest';
import { calculateRelevanceScore, isLowValueStudy, sortByRelevance } from '../utils/relevanceScore';
import type { StudyResult } from '../types/research';

describe('Relevance Scoring', () => {
  const baseStudy: StudyResult = {
    study_id: 'test-1',
    title: 'Test Study',
    year: 2023,
    study_design: 'RCT',
    sample_size: 100,
    population: 'Adults',
    outcomes: [
      {
        outcome_measured: 'Blood pressure',
        key_result: 'Reduced by 10 mmHg',
        citation_snippet: 'Significant reduction in blood pressure'
      }
    ],
    citation: {
      doi: '10.1234/test',
      pubmed_id: null,
      openalex_id: null,
      formatted: 'Test et al. (2023). Test Study.'
    },
    abstract_excerpt: 'Test abstract',
    preprint_status: 'Peer-reviewed',
    review_type: 'None',
    source: 'openalex'
  };

  describe('calculateRelevanceScore', () => {
    it('should give +2 for matching query keywords in outcomes', () => {
      const study = { ...baseStudy };
      const query = 'blood pressure diabetes';
      
      // Only 1 keyword matches (blood, pressure count as separate but both in outcomes)
      const score = calculateRelevanceScore(study, query);
      
      // Should match "blood" and "pressure" from outcomes
      expect(score).toBeGreaterThanOrEqual(2);
    });

    it('should give +1 for Meta-analysis', () => {
      const study = { ...baseStudy, review_type: 'Meta-analysis' as const };
      const query = 'unrelated query terms';
      
      const score = calculateRelevanceScore(study, query);
      
      expect(score).toBe(1); // Only the +1 for meta-analysis
    });

    it('should give +1 for Systematic review', () => {
      const study = { ...baseStudy, review_type: 'Systematic review' as const };
      const query = 'unrelated query terms';
      
      const score = calculateRelevanceScore(study, query);
      
      expect(score).toBe(1); // Only the +1 for systematic review
    });

    it('should give -2 for no outcomes reported', () => {
      const study = {
        ...baseStudy,
        outcomes: [
          {
            outcome_measured: 'No outcomes reported',
            key_result: null,
            citation_snippet: 'No outcomes reported'
          }
        ]
      };
      const query = 'test query';
      
      const score = calculateRelevanceScore(study, query);
      
      expect(score).toBe(-2);
    });

    it('should give -2 for empty outcomes array', () => {
      const study = { ...baseStudy, outcomes: [] };
      const query = 'test query';
      
      const score = calculateRelevanceScore(study, query);
      
      expect(score).toBe(-2);
    });

    it('should combine scores correctly', () => {
      const study = {
        ...baseStudy,
        review_type: 'Meta-analysis' as const,
        outcomes: [
          {
            outcome_measured: 'Blood pressure and diabetes outcomes',
            key_result: 'Improved control',
            citation_snippet: 'Significant improvements'
          }
        ]
      };
      const query = 'blood pressure diabetes control';
      
      const score = calculateRelevanceScore(study, query);
      
      // Should get +2 for keyword match + +1 for meta-analysis = 3
      expect(score).toBe(3);
    });
  });

  describe('isLowValueStudy', () => {
    it('should return true for studies with no outcomes', () => {
      const study = { ...baseStudy, outcomes: [] };
      
      expect(isLowValueStudy(study, -2)).toBe(true);
    });

    it('should return true for studies with "No outcomes reported"', () => {
      const study = {
        ...baseStudy,
        outcomes: [
          {
            outcome_measured: 'No outcomes reported',
            key_result: null,
            citation_snippet: 'No outcomes reported'
          }
        ]
      };
      
      expect(isLowValueStudy(study, -2)).toBe(true);
    });

    it('should return false for studies with valid outcomes', () => {
      const study = { ...baseStudy };
      
      expect(isLowValueStudy(study, 1)).toBe(false);
    });
  });

  describe('sortByRelevance', () => {
    it('should sort studies by relevance score descending', () => {
      const studies: StudyResult[] = [
        { ...baseStudy, study_id: 'low', outcomes: [] }, // Score: -2
        { 
          ...baseStudy, 
          study_id: 'high', 
          review_type: 'Meta-analysis',
          outcomes: [
            {
              outcome_measured: 'Blood pressure diabetes',
              key_result: 'Improved',
              citation_snippet: 'Test'
            }
          ]
        }, // Score: 3 (keyword match + meta-analysis)
        { ...baseStudy, study_id: 'medium' } // Score: 0 (no matches)
      ];
      
      const sorted = sortByRelevance(studies, 'blood pressure diabetes');
      
      expect(sorted[0].study_id).toBe('high');
      expect(sorted[0].relevanceScore).toBe(3);
      expect(sorted[1].study_id).toBe('medium');
      expect(sorted[2].study_id).toBe('low');
      expect(sorted[2].relevanceScore).toBe(-2);
    });

    it('should include relevanceScore in returned objects', () => {
      const studies: StudyResult[] = [baseStudy];
      
      const sorted = sortByRelevance(studies, 'test query');
      
      expect(sorted[0]).toHaveProperty('relevanceScore');
      expect(typeof sorted[0].relevanceScore).toBe('number');
    });
  });
});
