import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitizes a URL to prevent XSS via javascript: or other insecure schemes.
 */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return "";

  const trimmedUrl = url.trim();

  // Prevent javascript:, data:, and vbscript: protocols
  const isBlockedProtocol = /^(javascript|data|vbscript):/i.test(trimmedUrl);

  if (isBlockedProtocol) {
    console.warn(`Blocked potentially malicious URL: ${trimmedUrl}`);
    return "about:blank";
  }

  return trimmedUrl;
}
