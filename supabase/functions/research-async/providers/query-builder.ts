import type { SearchSource } from "../../_shared/query-processing.ts";
import type { ExpansionMode, PreparedSourceQuery } from "./types.ts";

const STOP_WORDS = new Set([
  "what", "are", "is", "the", "a", "an", "of", "for", "with", "to", "in", "on",
  "and", "or", "how", "does", "do", "can", "could", "would", "should", "will",
  "that", "this", "these", "those", "it", "its", "be", "been", "being", "was",
  "were", "has", "have", "had", "not", "no", "but", "by", "from", "at", "as",
  "into", "through", "between", "about", "their", "there", "than",
  "reported", "outcomes", "associated", "effects", "effect", "impact",
  "relationship", "role", "influence", "evidence", "studies", "study",
]);

const BIOMEDICAL_SYNONYMS: Record<string, string[]> = {
  "sleep deprivation": ["sleep restriction", "sleep loss", "partial sleep deprivation"],
  "cognitive performance": ["attention", "working memory", "executive function", "reaction time"],
  "insomnia": ["sleep initiation", "sleep maintenance", "sleeplessness"],
  "anxiety": ["anxious symptoms", "anxiety disorder", "state anxiety"],
  "depression": ["depressive symptoms", "major depressive disorder", "mood symptoms"],
  "blood pressure": ["hypertension", "systolic blood pressure", "diastolic blood pressure"],
};

export function extractSearchKeywords(query: string, mode: ExpansionMode = "balanced"): { originalTerms: string[]; expandedTerms: string[] } {
  const sanitized = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const keywords = sanitized
    .split(/\s+/)
    .filter((word) => word.length >= 1 && !STOP_WORDS.has(word));

  const seen = new Set<string>();
  const originalTerms = keywords
    .filter((word) => {
      if (seen.has(word)) return false;
      seen.add(word);
      return true;
    })
    .slice(0, 8);

  const expandedCandidates: string[] = [];
  for (const [concept, synonyms] of Object.entries(BIOMEDICAL_SYNONYMS)) {
    if (sanitized.includes(concept)) {
      expandedCandidates.push(concept, ...synonyms);
    }
  }

  const expandedSet = new Set<string>();
  for (const term of [...originalTerms, ...expandedCandidates]) {
    if (!term || STOP_WORDS.has(term)) continue;
    expandedSet.add(term);
  }

  const expandedTerms = Array.from(expandedSet).filter((term) => !originalTerms.includes(term));
  const expandedLimit = mode === "broad" ? 12 : 6;
  const limitedExpanded = expandedTerms.slice(0, expandedLimit);

  console.log(
    `[Keywords] mode=${mode} "${query}" -> original="${originalTerms.join(" ")}" expanded="${limitedExpanded.join(" ")}"`,
  );

  return { originalTerms, expandedTerms: limitedExpanded };
}

export function buildSourceQuery(
  query: string,
  source: SearchSource,
  mode: ExpansionMode = "balanced",
): PreparedSourceQuery {
  const { originalTerms, expandedTerms } = extractSearchKeywords(query, mode);
  const originalKeywordQuery = originalTerms.join(" ");
  const expandedKeywordQuery = [...originalTerms, ...expandedTerms].join(" ");

  const quoteIfPhrase = (term: string) => (term.includes(" ") ? `"${term}"` : term);
  let apiQuery = originalKeywordQuery;

  if (source === "semantic_scholar") {
    const semanticExpanded = expandedTerms.slice(0, mode === "broad" ? 10 : 5);
    const origClause = originalTerms.map(quoteIfPhrase).join(" OR ");
    const expandedClause = semanticExpanded.map(quoteIfPhrase).join(" OR ");
    apiQuery = expandedClause ? `(${origClause}) OR (${expandedClause})` : origClause;
  } else {
    const balancedExpanded = expandedTerms.slice(0, mode === "broad" ? 6 : 3);
    apiQuery = [originalKeywordQuery, ...balancedExpanded].filter(Boolean).join(" ");
  }

  return {
    source,
    originalKeywordQuery,
    expandedKeywordQuery,
    apiQuery: apiQuery.trim(),
  };
}

export function resolvePreparedQuery(
  query: string,
  source: SearchSource,
  mode: ExpansionMode,
  precompiledQuery?: string,
): PreparedSourceQuery {
  if (!precompiledQuery?.trim()) return buildSourceQuery(query, source, mode);
  return {
    source,
    originalKeywordQuery: query,
    expandedKeywordQuery: precompiledQuery.trim(),
    apiQuery: precompiledQuery.trim(),
  };
}
