import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import type { ScoredStudy } from '@/features/studyTable/model/useStudyTableState';
import { deriveRunPhase, selectStudies } from '@/features/studyTable/model/studyTableSelectors';
import type { StudyResult } from '@/shared/types/research';

function makeStudy(i: number): ScoredStudy {
  const base: StudyResult = {
    study_id: `study-${i}`,
    title: `Study ${i}`,
    year: 1990 + (i % 35),
    study_design: i % 2 === 0 ? 'RCT' : 'cohort',
    sample_size: 100 + i,
    population: i % 3 === 0 ? 'Adults with hypertension' : 'General adults',
    outcomes: [{
      outcome_measured: i % 2 === 0 ? 'blood pressure' : 'cholesterol',
      key_result: i % 2 === 0 ? 'improved systolic bp' : 'improved LDL',
      citation_snippet: `snippet ${i}`,
      intervention: null,
      comparator: null,
      effect_size: null,
      p_value: null,
    }],
    citation: { doi: `10.1000/${i}`, pubmed_id: null, openalex_id: `W${i}`, formatted: `Author ${i}` },
    abstract_excerpt: `Abstract excerpt ${i}`,
    preprint_status: 'Peer-reviewed',
    review_type: i % 10 === 0 ? 'Meta-analysis' : 'None',
    source: i % 4 === 0 ? 'semantic_scholar' : 'openalex',
  };

  return {
    ...base,
    relevanceScore: 90 - (i % 30),
    completenessTier: i % 5 === 0 ? 'partial' : 'strict',
    stableIndex: i,
  };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

describe('Phase 2 stress simulation', () => {
  it('handles 2000 studies under rapid filter typing with stable memory/CPU profile', () => {
    const studies = Array.from({ length: 2000 }, (_, i) => makeStudy(i));
    const reports = Array.from({ length: 100 }, (_, i) => ({ id: `r-${i}`, status: i % 4 === 0 ? 'processing' : 'completed' as const }));
    const filterInputs = ['b', 'bl', 'blo', 'bloo', 'blood', 'blood p', 'blood pr', 'blood pressure', 'chol', 'cholesterol'];

    const startMem = process.memoryUsage().heapUsed;
    const durations: number[] = [];

    let cpuSpikeMs = 0;

    for (let i = 0; i < 150; i += 1) {
      const t0 = performance.now();
      const query = filterInputs[i % filterInputs.length];

      const selected = selectStudies({
        studies,
        sortBy: i % 2 === 0 ? 'relevance' : 'year',
        studyDesign: 'all',
        explicitOnly: false,
        debouncedFind: query,
      });

      // Simulate background polling lifecycle derivation for 100 reports.
      for (const report of reports) {
        deriveRunPhase({
          status: report.status as "completed" | "failed" | "processing",
          searchStats: { latency_ms: 1200, candidates_total: 5000, candidates_filtered: 2500, retrieved_total: 1200 },
          extractionStats: {
            total_inputs: 1200,
            extracted_total: 900,
            complete_total: 700,
            partial_total: 200,
            used_pdf: 200,
            used_abstract_fallback: 100,
            failures: 5,
            fallback_reasons: {},
            engine: 'hybrid',
            llm_fallback_applied: false,
            latency_ms: 2000,
          },
          activeExtractionRunId: 'run-x',
        });
      }

      // Simulate scroll frame work over virtual list window.
      const _visibleWindow = selected.mainStudies.slice((i * 7) % Math.max(1, selected.mainStudies.length - 50), ((i * 7) % Math.max(1, selected.mainStudies.length - 50)) + 50);

      // Simulate buffered chat commit cadence.
      let chatBuffer = '';
      for (let token = 0; token < 80; token += 1) {
        chatBuffer += `t${token}`;
        if (token % 10 === 0) {
          const _commit = chatBuffer;
          void _commit;
        }
      }

      const dt = performance.now() - t0;
      durations.push(dt);
      cpuSpikeMs = Math.max(cpuSpikeMs, dt);
    }

    const endMem = process.memoryUsage().heapUsed;
    const memDeltaMb = (endMem - startMem) / (1024 * 1024);
    const p95 = percentile(durations, 95);

    // eslint-disable-next-line no-console
    console.log(`[phase2-stress] filter_response_p95_ms=${p95.toFixed(2)} cpu_spike_ms=${cpuSpikeMs.toFixed(2)} memory_delta_mb=${memDeltaMb.toFixed(2)}`);

    // Keep guardrails loose enough for CI variance while still catching pathological regressions.
    expect(p95).toBeLessThan(120);
    expect(cpuSpikeMs).toBeLessThan(180);
    expect(memDeltaMb).toBeLessThan(200);
  });
});
