import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitizes a URL to prevent XSS attacks via malicious URI schemes.
 * Specifically filters out javascript:, data:, and vbscript: schemes.
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return 'about:blank';

  // Remove whitespace and control characters that could be used to bypass filters
  const sanitizedUrl = url.replace(/[^\x20-\x7E]/g, '').trim();

  if (
    /^javascript:/i.test(sanitizedUrl) ||
    /^data:/i.test(sanitizedUrl) ||
    /^vbscript:/i.test(sanitizedUrl)
  ) {
    console.warn(`[Security] Blocked potentially malicious URL: ${sanitizedUrl.slice(0, 50)}...`);
    return 'about:blank';
  }

  return sanitizedUrl;
}
