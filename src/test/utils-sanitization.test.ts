import { describe, it, expect } from 'vitest';
import { sanitizeUrl } from '../shared/lib/utils';

describe('sanitizeUrl', () => {
  it('should allow safe URLs', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    expect(sanitizeUrl('http://example.com/path?query=1')).toBe('http://example.com/path?query=1');
    expect(sanitizeUrl('//example.com')).toBe('//example.com');
  });

  it('should block javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('about:blank');
    expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBe('about:blank');
    expect(sanitizeUrl('  javascript:alert(1)')).toBe('about:blank');
  });

  it('should block data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<html>')).toBe('about:blank');
    expect(sanitizeUrl('DATA:image/png;base64,...')).toBe('about:blank');
  });

  it('should block vbscript: URLs', () => {
    expect(sanitizeUrl('vbscript:msgbox("hi")')).toBe('about:blank');
  });

  it('should remove control characters and whitespace', () => {
    expect(sanitizeUrl('https://example.com\n')).toBe('https://example.com');
    expect(sanitizeUrl('https://ex\x00ample.com')).toBe('https://example.com');
  });

  it('should handle null, undefined and empty strings', () => {
    expect(sanitizeUrl(null)).toBe('about:blank');
    expect(sanitizeUrl(undefined)).toBe('about:blank');
    expect(sanitizeUrl('')).toBe('about:blank');
  });
});
