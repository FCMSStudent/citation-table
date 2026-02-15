import type { StudyResult } from '@/shared/types/research';

/**
 * Generate RIS formatted citation string for a single study
 * RIS format: https://en.wikipedia.org/wiki/RIS_(file_format)
 */
function generateRISEntry(study: StudyResult): string {
  const lines: string[] = [];
  
  // Type of reference - default to journal article
  lines.push('TY  - JOUR');
  
  // Title
  if (study.title) {
    lines.push(`TI  - ${study.title}`);
  }
  
  // Authors - extract from formatted citation if possible
  const citation = study.citation.formatted;
  if (citation) {
    const authorMatch = citation.match(/^([^(]+)\(/);
    if (authorMatch) {
      const authorsStr = authorMatch[1].trim();
      // Split by comma and "et al."
      const authors = authorsStr.split(/,|\set al\./).map(a => a.trim()).filter(a => a.length > 0);
      authors.forEach(author => {
        if (author && author !== 'et al.') {
          lines.push(`AU  - ${author}`);
        }
      });
    }
  }
  
  // Publication year
  if (study.year) {
    lines.push(`PY  - ${study.year}`);
  }
  
  // DOI
  if (study.citation.doi) {
    lines.push(`DO  - ${study.citation.doi}`);
  }
  
  // URLs
  if (study.citation.openalex_id) {
    lines.push(`UR  - ${study.citation.openalex_id}`);
  }
  
  // PubMed ID
  if (study.citation.pubmed_id) {
    lines.push(`PM  - ${study.citation.pubmed_id}`);
  }
  
  // Abstract
  if (study.abstract_excerpt) {
    lines.push(`AB  - ${study.abstract_excerpt}`);
  }
  
  // Keywords/Notes - include study design and outcomes
  lines.push(`KW  - Study Design: ${study.study_design}`);
  if (study.sample_size) {
    lines.push(`KW  - Sample Size: ${study.sample_size}`);
  }
  study.outcomes.forEach((outcome, idx) => {
    lines.push(`KW  - Outcome ${idx + 1}: ${outcome.outcome_measured}`);
  });
  
  // End of reference
  lines.push('ER  - ');
  lines.push(''); // Blank line between entries
  
  return lines.join('\n');
}

/**
 * Generate RIS file content for all studies
 */
export function generateRISFile(studies: StudyResult[]): string {
  return studies.map(study => generateRISEntry(study)).join('\n');
}

/**
 * Download RIS file
 */
export function downloadRISFile(studies: StudyResult[], filename: string = 'citations.ris'): void {
  const risContent = generateRISFile(studies);
  const blob = new Blob([risContent], { type: 'application/x-research-info-systems' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up the URL object
  URL.revokeObjectURL(url);
}
