import { describe, expect, it } from 'vitest';
import { axe } from 'jest-axe';
import { render, screen } from '@testing-library/react';
import { StudyTableVirtualized } from '@/features/studyTable/ui/StudyTableVirtualized';
import { RunStatusTimeline } from '@/features/report-detail/ui/RunStatusTimeline';
import type { StudyResult } from '@/shared/types/research';
import { renderWithQueryClient } from '@/test/renderWithProviders';

function makeStudy(i: number): StudyResult {
  return {
    study_id: `study-${i}`,
    title: `Study ${i}`,
    year: 2020,
    study_design: 'RCT',
    sample_size: 120,
    population: 'Adults',
    outcomes: [
      {
        outcome_measured: 'blood pressure',
        key_result: 'decrease',
        citation_snippet: 'BP reduced',
        intervention: null,
        comparator: null,
        effect_size: null,
        p_value: null,
      },
    ],
    citation: { doi: `10.1000/${i}`, pubmed_id: null, openalex_id: null, formatted: 'A et al.' },
    abstract_excerpt: 'abstract',
    preprint_status: 'Peer-reviewed',
    review_type: 'None',
    source: 'openalex',
  };
}

describe('a11y checks', () => {
  it('RunStatusTimeline has no critical axe violations', async () => {
    const { container } = render(
      <RunStatusTimeline status="processing" isFetching dataUpdatedAt={Date.now()} activeExtractionRunId="run-1" />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('StudyTableVirtualized renders table semantics and passes axe', async () => {
    localStorage.setItem(
      'report-view-preferences:r1',
      JSON.stringify({ activeTab: 'studies', sortBy: 'relevance', studyDesign: 'all', explicitOnly: false, localFind: '' }),
    );

    const { container } = renderWithQueryClient(
      <StudyTableVirtualized
        results={[makeStudy(1), makeStudy(2)]}
        query="bp"
        normalizedQuery="blood pressure"
        reportId="r1"
        totalPapersSearched={100}
      />,
    );

    expect(screen.getByText('Paper')).toBeInTheDocument();
    expect(screen.getByText('Result')).toHaveAttribute('aria-sort', 'none');

    const results = await axe(container, {
      rules: {
        // Radix tab ids include ":" in jsdom; axe flags this although runtime browsers accept it.
        'aria-valid-attr-value': { enabled: false },
      },
    });
    expect(results).toHaveNoViolations();
  });
});
