/**
 * Split text into highlightable segments based on query terms.
 */
interface HighlightSegment {
  text: string;
  isMatch: boolean;
}

const STOP_WORDS = new Set(['and', 'or', 'in', 'on', 'the', 'a', 'an', 'of', 'for', 'with', 'to']);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Optimization: Cache results of extractKeywords and generated patterns
const keywordsCache = new Map<string, string[]>();
const lowerKeywordsCache = new Map<string, Set<string>>();
const patternCache = new Map<string, RegExp>();

export function extractKeywords(query: string): string[] {
  const cached = keywordsCache.get(query);
  if (cached) return cached;

  const keywords = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  keywordsCache.set(query, keywords);
  return keywords;
}

export function highlightTerms(text: string, query: string): HighlightSegment[] {
  if (!text || !query) {
    return [{ text, isMatch: false }];
  }

  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    return [{ text, isMatch: false }];
  }

  let pattern = patternCache.get(query);
  if (!pattern) {
    pattern = new RegExp(`(${keywords.map(escapeRegExp).join('|')})`, 'gi');
    patternCache.set(query, pattern);
  }

  let lowerKeywords = lowerKeywordsCache.get(query);
  if (!lowerKeywords) {
    lowerKeywords = new Set(keywords.map((k) => k.toLowerCase()));
    lowerKeywordsCache.set(query, lowerKeywords);
  }

  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      isMatch: lowerKeywords!.has(part.toLowerCase()),
    }));
}
