import { describe, expect, it } from 'vitest';
import type { StudyResult } from '@/shared/types/research';
import type { ScoredStudy } from '@/features/studyTable/model/useStudyTableState';
import { buildPaginationWindow, deriveRunPhase, matchesStudyDesignFilter, selectStudies } from '@/features/studyTable/model/studyTableSelectors';

function makeStudy(i: number): ScoredStudy {
  const base: StudyResult = {
    study_id: `study-${i}`,
    title: `Study ${i}`,
    year: 2000 + (i % 20),
    study_design: i % 2 === 0 ? 'RCT' : 'cohort',
    sample_size: 100 + i,
    population: 'Adults',
    outcomes: [{
      outcome_measured: 'Outcome',
      key_result: `Result ${i}`,
      citation_snippet: `Snippet ${i}`,
      intervention: null,
      comparator: null,
      effect_size: null,
      p_value: null,
    }],
    citation: { doi: `10.1000/${i}`, pubmed_id: null, openalex_id: null, formatted: `Author ${i}` },
    abstract_excerpt: `Abstract ${i}`,
    preprint_status: 'Peer-reviewed',
    review_type: 'None',
    source: 'openalex',
  };

  return {
    ...base,
    relevanceScore: 80 - (i % 10),
    completenessTier: i % 3 === 0 ? 'partial' : 'strict',
    stableIndex: i,
  };
}

describe('deriveRunPhase', () => {
  it('maps failed/completed states directly', () => {
    expect(deriveRunPhase({ status: 'failed' }).id).toBe('failed');
    expect(deriveRunPhase({ status: 'completed' }).id).toBe('completed');
  });

  it('derives extracting when extraction is not complete', () => {
    const phase = deriveRunPhase({
      status: 'processing',
      searchStats: { latency_ms: 1, candidates_total: 2, candidates_filtered: 1, retrieved_total: 10 },
      extractionStats: {
        total_inputs: 10,
        extracted_total: 5,
        complete_total: 3,
        partial_total: 2,
        used_pdf: 0,
        used_abstract_fallback: 0,
        failures: 0,
        fallback_reasons: {},
        engine: 'hybrid',
        llm_fallback_applied: false,
        latency_ms: 100,
      },
    });
    expect(phase.id).toBe('extracting');
  });

  it('derives queued/searching/synthesizing states', () => {
    expect(deriveRunPhase({ status: 'processing' }).id).toBe('queued');
    expect(
      deriveRunPhase({
        status: 'processing',
        activeExtractionRunId: 'run-1',
        searchStats: { latency_ms: 10, candidates_total: 10, candidates_filtered: 5, retrieved_total: 0 },
      }).id,
    ).toBe('searching');
    expect(
      deriveRunPhase({
        status: 'processing',
        activeExtractionRunId: 'run-1',
        searchStats: { latency_ms: 10, candidates_total: 10, candidates_filtered: 5, retrieved_total: 5 },
        extractionStats: {
          total_inputs: 5,
          extracted_total: 5,
          complete_total: 5,
          partial_total: 0,
          used_pdf: 1,
          used_abstract_fallback: 0,
          failures: 0,
          fallback_reasons: {},
          engine: 'hybrid',
          llm_fallback_applied: false,
          latency_ms: 10,
        },
      }).id,
    ).toBe('synthesizing');
  });
});

describe('selectStudies', () => {
  it('produces stable ordering across repeated calls', () => {
    const studies = Array.from({ length: 2000 }, (_, i) => makeStudy(i));

    const one = selectStudies({
      studies,
      sortBy: 'relevance',
      studyDesign: 'all',
      explicitOnly: false,
      debouncedFind: '',
    });
    const two = selectStudies({
      studies,
      sortBy: 'relevance',
      studyDesign: 'all',
      explicitOnly: false,
      debouncedFind: '',
    });

    expect(one.mainStudies.length + one.excludedStudies.length).toBe(2000);
    expect(one.mainStudies.map((s) => s.study_id)).toEqual(two.mainStudies.map((s) => s.study_id));
  });

  it('applies filter/search and helper selectors', () => {
    const studies = [makeStudy(1), makeStudy(2), makeStudy(3)];
    studies[0].study_design = 'RCT';
    studies[1].study_design = 'cohort';
    studies[2].study_design = 'unknown';

    expect(matchesStudyDesignFilter(studies[0], 'rct')).toBe(true);
    expect(matchesStudyDesignFilter(studies[1], 'cohort')).toBe(true);
    expect(matchesStudyDesignFilter(studies[2], 'unknown')).toBe(true);
    expect(matchesStudyDesignFilter(studies[0], 'cross-sectional')).toBe(false);

    const selected = selectStudies({
      studies,
      sortBy: 'year',
      studyDesign: 'cohort',
      explicitOnly: false,
      debouncedFind: 'result 2',
    });

    expect(selected.mainStudies.length + selected.excludedStudies.length).toBe(1);
    expect(buildPaginationWindow(4, 10, 5)).toEqual([2, 3, 4, 5, 6]);
  });
});
