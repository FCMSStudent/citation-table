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

export function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

export function highlightTerms(text: string, query: string): HighlightSegment[] {
  if (!text || !query) {
    return [{ text, isMatch: false }];
  }

  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    return [{ text, isMatch: false }];
  }

  const pattern = new RegExp(`(${keywords.map(escapeRegExp).join('|')})`, 'gi');

  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      isMatch: keywords.some((keyword) => keyword.toLowerCase() === part.toLowerCase()),
    }));
}
