import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Performance Optimization (String Processing): Define static Regular Expressions outside of
// high-frequency functions to prevent unnecessary re-instantiation.
const CONTROL_CHARS_REGEX = /[^\x20-\x7E]/g;
const MALICIOUS_SCHEMES_REGEX = /^(?:javascript|data|vbscript):/i;

/**
 * Sanitizes a URL to prevent XSS attacks via malicious URI schemes.
 * Specifically filters out javascript:, data:, and vbscript: schemes.
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return 'about:blank';

  // Remove whitespace and control characters that could be used to bypass filters
  const sanitizedUrl = url.replace(CONTROL_CHARS_REGEX, '').trim();

  // Combine multiple .test() calls into a single unified regex to reduce string iterations.
  if (MALICIOUS_SCHEMES_REGEX.test(sanitizedUrl)) {
    console.warn(`[Security] Blocked potentially malicious URL: ${sanitizedUrl.slice(0, 50)}...`);
    return 'about:blank';
  }

  return sanitizedUrl;
}
