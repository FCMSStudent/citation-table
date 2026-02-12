// lib/csvExport.ts
import type { StudyResult } from '@/types/research';

export function downloadCSV(studies: StudyResult[], filename: string) {
  const headers = [
    'Title',
    'Authors',
    'Year',
    'DOI',
    'Study Design',
    'Sample Size',
    'Population',
    'Review Type',
    'Preprint Status',
    'Outcomes',
    'Key Results',
    'OpenAlex ID',
  ];

  const rows = studies.map((study) => {
    const authors = extractAuthors(study.citation.formatted);
    const outcomes = study.outcomes?.map((o) => o.outcome_measured).join('; ') || '';
    const results = study.outcomes?.map((o) => o.key_result || '').filter(Boolean).join('; ') || '';

    return [
      escapeCSV(study.title),
      escapeCSV(authors),
      study.year || '',
      study.doi || '',
      study.study_design || '',
      study.sample_size || '',
      escapeCSV(study.population || ''),
      study.review_type || '',
      study.preprint_status || '',
      escapeCSV(outcomes),
      escapeCSV(results),
      study.openalex_id || '',
    ];
  });

  const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function extractAuthors(citation: string | null | undefined): string {
  if (!citation) return 'Unknown';
  // Extract everything before year (in parentheses)
  const match = citation.match(/^(.+?)\s*\(/);
  if (match) {
    return match[1].trim();
  }
  return citation;
}
