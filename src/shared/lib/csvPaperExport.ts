import type { StudyResult } from '@/shared/types/research';
import { escapeCSV, extractAuthors } from './csvExport';

export function downloadPaperCSV(studies: StudyResult[], filename: string) {
  const headers = [
    'Title', 'Authors', 'Year', 'DOI', 'Citation Count',
    'Study Design', 'Sample Size', 'Population',
    'Outcomes', 'Results', 'Effect Sizes', 'P-values',
    'Review Type', 'Preprint Status',
    'PDF URL', 'Landing Page URL', 'OpenAlex ID',
  ];

  const rows = studies.map(study => {
    const authors = extractAuthors(study.citation.formatted);
    const outcomes = study.outcomes || [];

    // First available legal OA link
    let pdfUrl = '';
    if (study.pdf_url) pdfUrl = study.pdf_url;
    else if (study.source === 'arxiv' && study.study_id) {
      pdfUrl = `https://arxiv.org/pdf/${study.study_id.replace(/^arxiv-/, '')}`;
    }

    return [
      escapeCSV(study.title),
      escapeCSV(authors),
      String(study.year || ''),
      study.citation.doi || '',
      String(study.citationCount ?? ''),
      study.study_design || '',
      String(study.sample_size || ''),
      escapeCSV(study.population || ''),
      escapeCSV(outcomes.map(o => o.outcome_measured).join('; ')),
      escapeCSV(outcomes.map(o => o.key_result || '').filter(Boolean).join('; ')),
      escapeCSV(outcomes.map(o => o.effect_size || '').filter(Boolean).join('; ')),
      escapeCSV(outcomes.map(o => o.p_value || '').filter(Boolean).join('; ')),
      study.review_type || '',
      study.preprint_status || '',
      pdfUrl,
      study.landing_page_url || '',
      study.citation.openalex_id || '',
    ];
  });

  const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
