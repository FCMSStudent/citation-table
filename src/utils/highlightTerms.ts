import { extractQueryKeywords } from './explainScore';

export interface HighlightSegment {
  text: string;
  isMatch: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightTerms(text: string, query: string): HighlightSegment[] {
  if (!text || !query) {
    return [{ text, isMatch: false }];
  }

  const keywords = Array.from(new Set(extractQueryKeywords(query)));
  if (keywords.length === 0) {
    return [{ text, isMatch: false }];
  }

  const pattern = new RegExp(`(${keywords.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern).filter((part) => part.length > 0);

  return parts.map((part) => ({
    text: part,
    isMatch: keywords.some((keyword) => keyword.toLowerCase() === part.toLowerCase()),
  }));
}
