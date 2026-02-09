import type { StudyResult } from '@/types/research';

/**
 * Generate a narrative summary paragraph from study results
 * Per meta prompt: single long paragraph, paraphrasing only, inline citations,
 * no causal/comparative/interpretive language
 */
export function generateNarrativeSummary(studies: StudyResult[], query: string): string {
  if (studies.length === 0) {
    return "No studies were retrieved for this query.";
  }
  
  // Count preprints vs peer-reviewed
  const peerReviewed = studies.filter(s => s.preprint_status === "Peer-reviewed").length;
  const preprints = studies.filter(s => s.preprint_status === "Preprint").length;
  
  // Start with study count
  let summary = `This search retrieved ${studies.length} ${studies.length === 1 ? 'study' : 'studies'}`;
  
  // Add breakdown
  if (preprints > 0 && peerReviewed > 0) {
    summary += ` (${peerReviewed} peer-reviewed, ${preprints} ${preprints === 1 ? 'preprint' : 'preprints'})`;
  } else if (preprints > 0) {
    summary += ` (all preprints)`;
  } else {
    summary += ` (all peer-reviewed)`;
  }
  
  summary += ` addressing the query "${query}". `;
  
  // Paraphrase findings from each study with inline citations
  const findings = studies.map((study, idx) => {
    const author = extractFirstAuthor(study.citation.formatted);
    const year = study.year;
    const citation = `${author}, ${year}`;
    
    // Describe study
    let finding = '';
    
    if (study.population) {
      finding += `A ${study.study_design === 'unknown' ? 'study' : study.study_design} involving ${study.population}`;
      if (study.sample_size) {
        finding += ` (n=${study.sample_size})`;
      }
    } else {
      finding += `A ${study.study_design === 'unknown' ? 'study' : study.study_design}`;
      if (study.sample_size) {
        finding += ` with ${study.sample_size} participants`;
      }
    }
    
    finding += ` (${citation})`;
    
    // Add outcomes - paraphrase without causal language
    if (study.outcomes?.length > 0) {
      const outcomeDescriptions = study.outcomes
        .filter(o => o.key_result)
        .map(o => {
          // Sanitize to remove causal claims - be specific to avoid matching "because"
          let result = o.key_result || '';
          const causalRegex = /\b(cause|caused|causes|causing|led to|leads to|resulted in|results in)\b/gi;
          result = result.replace(causalRegex, 'was associated with');
          return `${o.outcome_measured}: ${result}`;
        });
      
      if (outcomeDescriptions.length > 0) {
        finding += ` reported ${outcomeDescriptions.join('; ')}`;
      }
    }
    
    return finding;
  });
  
  summary += findings.join('. ') + '.';
  
  return summary;
}

/**
 * Extract first author from formatted citation
 */
function extractFirstAuthor(citation: string | null | undefined): string {
  // Handle null/undefined citations
  if (!citation) {
    return 'Unknown';
  }
  
  // Extract first author before first comma or "et al."
  // Handle formats like "Smith et al. (2023)" or "Smith, J. (2023)"
  const match = citation.match(/^([^,(]+)/);
  if (match) {
    let author = match[1].trim();
    // Remove "et al." if present
    author = author.replace(/\set al\.?$/i, '').trim();
    return author;
  }
  return 'Unknown';
}
