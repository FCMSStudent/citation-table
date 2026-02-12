import type { StudyResult } from '@/types/research';

function escapeCsv(value: string | null | undefined): string {
  if (!value) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadCSV(studies: StudyResult[], filename: string = 'research.csv'): void {
  const headers = ['Title', 'Year', 'Study Design', 'Review Type', 'Sample Size', 'Population', 'Outcomes', 'Key Results', 'DOI', 'PubMed ID', 'Source', 'Preprint Status'];

  const rows = studies.map(study => [
    escapeCsv(study.title),
    String(study.year),
    escapeCsv(study.study_design),
    escapeCsv(study.review_type),
    study.sample_size != null ? String(study.sample_size) : '',
    escapeCsv(study.population),
    escapeCsv(study.outcomes.map(o => o.outcome_measured).join('; ')),
    escapeCsv(study.outcomes.map(o => o.key_result || '').filter(Boolean).join('; ')),
    escapeCsv(study.citation.doi),
    escapeCsv(study.citation.pubmed_id),
    escapeCsv(study.source),
    escapeCsv(study.preprint_status),
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
