import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudyTableVirtualized } from '@/features/studyTable/ui/StudyTableVirtualized';
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
        key_result: `result-${i}`,
        citation_snippet: 'snippet',
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

describe('keyboard navigation', () => {
  it('supports keyboard pagination on studies tab', async () => {
    localStorage.setItem(
      'report-view-preferences:r-keyboard',
      JSON.stringify({ activeTab: 'studies', sortBy: 'relevance', studyDesign: 'all', explicitOnly: false, localFind: '' }),
    );

    const studies = Array.from({ length: 30 }, (_, i) => makeStudy(i + 1));
    renderWithQueryClient(
      <StudyTableVirtualized
        results={studies}
        query="bp"
        reportId="r-keyboard"
        totalPapersSearched={200}
      />,
    );

    expect(screen.getByText(/Showing 1-25 of 30/i)).toBeInTheDocument();

    const next = screen.getByRole('button', { name: /next/i });
    next.focus();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByText(/Showing 26-30 of 30/i)).toBeInTheDocument();
  });
});
