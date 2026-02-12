import type { StudyResult } from '@/types/research';

interface ThematicGroup {
  theme: string;
  studies: Array<{ study: StudyResult; idx: number }>;
}

/**
 * Generate an Elicit-style narrative summary from study results
 * Groups findings thematically and synthesizes across studies
 */
export function generateNarrativeSummary(studies: StudyResult[], query: string): string {
  if (studies.length === 0) {
    return "No studies were retrieved for this query.";
  }
  
  // Build opening context
  const opening = buildOpeningContext(studies, query);
  
  // Group studies by thematic similarity (outcomes/population)
  const groups = groupStudiesThematically(studies);
  
  // Generate synthesis for each theme
  const syntheses = groups.map(group => synthesizeGroup(group));
  
  // Add evidence quality note if relevant
  const qualityNote = assessEvidenceQuality(studies);
  
  return [opening, ...syntheses, qualityNote].filter(Boolean).join(' ');
}

/**
 * Build contextual opening (corpus overview)
 */
function buildOpeningContext(studies: StudyResult[], query: string): string {
  const total = studies.length;
  const peerReviewed = studies.filter(s => s.preprint_status === "Peer-reviewed").length;
  const preprints = studies.filter(s => s.preprint_status === "Preprint").length;
  
  let context = `This synthesis draws from ${total} ${total === 1 ? 'study' : 'studies'}`;
  
  if (preprints > 0 && peerReviewed > 0) {
    context += ` (${peerReviewed} peer-reviewed, ${preprints} ${preprints === 1 ? 'preprint' : 'preprints'})`;
  } else if (preprints > 0) {
    context += `, all of which ${preprints === 1 ? 'is a preprint' : 'are preprints'}`;
  }
  
  context += ` examining ${query.toLowerCase()}.`;
  return context;
}

/**
 * Group studies by thematic similarity (simple grouping by study design + population)
 */
function groupStudiesThematically(studies: StudyResult[]): ThematicGroup[] {
  const groups: Map<string, ThematicGroup> = new Map();
  
  studies.forEach((study, idx) => {
    // Create theme key based on study design and population type
    const designKey = study.study_design || 'observational';
    const popKey = extractPopulationType(study.population);
    const themeKey = `${designKey}-${popKey}`;
    
    if (!groups.has(themeKey)) {
      groups.set(themeKey, {
        theme: formatTheme(designKey, popKey),
        studies: []
      });
    }
    
    groups.get(themeKey)!.studies.push({ study, idx });
  });
  
  return Array.from(groups.values());
}

/**
 * Extract general population type for grouping
 */
function extractPopulationType(population: string | null | undefined): string {
  if (!population) return 'general';
  
  const lower = population.toLowerCase();
  if (lower.includes('child') || lower.includes('adolescent')) return 'pediatric';
  if (lower.includes('adult') || lower.includes('elderly')) return 'adult';
  if (lower.includes('patient') || lower.includes('clinical')) return 'clinical';
  return 'general';
}

/**
 * Format theme for narrative flow
 */
function formatTheme(design: string, popType: string): string {
  const designMap: Record<string, string> = {
    'randomized controlled trial': 'Experimental evidence from randomized trials',
    'cohort study': 'Longitudinal cohort evidence',
    'cross-sectional': 'Cross-sectional evidence',
    'meta-analysis': 'Meta-analytic evidence',
    'case-control': 'Case-control evidence',
    'observational': 'Observational evidence'
  };
  
  return designMap[design.toLowerCase()] || 'Evidence';
}

/**
 * Synthesize a thematic group of studies
 */
function synthesizeGroup(group: ThematicGroup): string {
  const { theme, studies: groupStudies } = group;
  
  if (groupStudies.length === 0) return '';
  
  // Collect all outcomes across this group
  const allOutcomes: Array<{
    outcome: string;
    result: string;
    citation: string;
  }> = [];
  
  groupStudies.forEach(({ study }) => {
    const citation = formatCitation(study);
    study.outcomes?.forEach(outcome => {
      if (outcome.key_result) {
        allOutcomes.push({
          outcome: outcome.outcome_measured || 'outcome',
          result: sanitizeCausalLanguage(outcome.key_result),
          citation
        });
      }
    });
  });
  
  // Build synthesis
  let synthesis = theme;
  
  // Add sample characteristics
  if (groupStudies.length === 1) {
    const { study } = groupStudies[0];
    synthesis += ` involving ${study.population || 'participants'}`;
    if (study.sample_size) {
      synthesis += ` (n=${study.sample_size})`;
    }
  } else {
    const totalN = groupStudies
      .map(({ study }) => study.sample_size)
      .filter(Boolean)
      .reduce((sum, n) => sum + (typeof n === 'number' ? n : parseInt(n) || 0), 0);
    
    if (totalN > 0) {
      synthesis += ` across ${groupStudies.length} studies (combined n=${totalN})`;
    } else {
      synthesis += ` from ${groupStudies.length} studies`;
    }
  }
  
  // Synthesize findings
  if (allOutcomes.length > 0) {
    // Group by similar outcomes
    const outcomeMap = new Map<string, Array<typeof allOutcomes[0]>>();
    allOutcomes.forEach(item => {
      const key = normalizeOutcomeName(item.outcome);
      if (!outcomeMap.has(key)) {
        outcomeMap.set(key, []);
      }
      outcomeMap.get(key)!.push(item);
    });
    
    synthesis += ' ';
    const synthesizedOutcomes = Array.from(outcomeMap.entries()).map(([outcome, items]) => {
      if (items.length === 1) {
        return `reported ${items[0].result} for ${outcome} (${items[0].citation})`;
      } else {
        // Multiple studies on same outcome - synthesize
        const citations = items.map(i => i.citation).join('; ');
        return `consistently reported associations with ${outcome} (${citations})`;
      }
    });
    
    synthesis += synthesizedOutcomes.join(', and ');
  }
  
  synthesis += '.';
  return synthesis;
}

/**
 * Normalize outcome names for grouping (e.g., "anxiety symptoms" → "anxiety")
 */
function normalizeOutcomeName(outcome: string): string {
  return outcome
    .toLowerCase()
    .replace(/\b(symptoms?|levels?|scores?|measures?|rates?)\b/g, '')
    .trim();
}

/**
 * Format citation for inline use
 */
function formatCitation(study: StudyResult): string {
  const author = extractFirstAuthor(study.citation.formatted);
  return study.year ? `${author}, ${study.year}` : author;
}

/**
 * Remove causal language, replacing with correlational terms
 */
function sanitizeCausalLanguage(text: string): string {
  return text
    .replace(/\b(cause[ds]?|causing)\b/gi, 'was associated with')
    .replace(/\b(led to|leads to)\b/gi, 'was associated with')
    .replace(/\b(resulted in|results in)\b/gi, 'showed')
    .replace(/\b(due to)\b/gi, 'associated with')
    .replace(/\beffect of\b/gi, 'association with');
}

/**
 * Assess overall evidence quality
 */
function assessEvidenceQuality(studies: StudyResult[]): string | null {
  const hasRCTs = studies.some(s => 
    s.study_design?.toLowerCase().includes('randomized')
  );
  const allPreprints = studies.every(s => s.preprint_status === "Preprint");
  const hasMetaAnalysis = studies.some(s =>
    s.study_design?.toLowerCase().includes('meta-analysis')
  );
  
  if (allPreprints && studies.length > 1) {
    return 'All included studies are preprints and have not undergone formal peer review.';
  }
  
  if (hasMetaAnalysis) {
    return 'The evidence includes systematic synthesis of multiple studies.';
  }
  
  if (hasRCTs) {
    return 'The evidence base includes experimental studies with randomization.';
  }
  
  return null;
}

/**
 * Extract first author from formatted citation
 */
function extractFirstAuthor(citation: string | null | undefined): string {
  if (!citation) return 'Unknown';
  
  const match = citation.match(/^([^,(]+)/);
  if (match) {
    return match[1].replace(/\set al\.?$/i, '').trim();
  }
  return 'Unknown';
}
