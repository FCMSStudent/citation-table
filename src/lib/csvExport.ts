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
    'Intervention',
    'Comparator',
    'Outcome',
    'Effect Size',
    'P-value',
    'Key Result',
    'Review Type',
    'Preprint Status',
    'OpenAlex ID',
  ];

  // One row per outcome (PICO grid)
  const rows: string[][] = [];
  for (const study of studies) {
    const authors = extractAuthors(study.citation.formatted);
    const outcomes = study.outcomes?.length ? study.outcomes : [{ outcome_measured: '', key_result: null, citation_snippet: '', intervention: null, comparator: null, effect_size: null, p_value: null }];
    for (const o of outcomes) {
      rows.push([
        escapeCSV(study.title),
        escapeCSV(authors),
        String(study.year || ''),
        study.citation.doi || '',
        study.study_design || '',
        String(study.sample_size || ''),
        escapeCSV(study.population || ''),
        escapeCSV(o.intervention || ''),
        escapeCSV(o.comparator || ''),
        escapeCSV(o.outcome_measured || ''),
        escapeCSV(o.effect_size || ''),
        escapeCSV(o.p_value || ''),
        escapeCSV(o.key_result || ''),
        study.review_type || '',
        study.preprint_status || '',
        study.citation.openalex_id || '',
      ]);
    }
  }

  const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

export function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function extractAuthors(citation: string | null | undefined): string {
  if (!citation) return 'Unknown';
  // Extract everything before year (in parentheses)
  const match = citation.match(/^(.+?)\s*\(/);
  if (match) {
    return match[1].trim();
  }
  return citation;
}
