import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCociForDoi } from '../lib/coci';

// Mock global fetch
global.fetch = vi.fn();

describe('COCI Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up mock environment variable
    import.meta.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
  });

  describe('fetchCociForDoi', () => {
    it('should throw error if VITE_SUPABASE_URL is not configured', async () => {
      import.meta.env.VITE_SUPABASE_URL = '';
      
      await expect(fetchCociForDoi('10.1000/xyz')).rejects.toThrow(
        'VITE_SUPABASE_URL is not configured'
      );
    });

    it('should make request to correct endpoint with encoded DOI', async () => {
      const mockResponse = {
        doi: '10.1000/xyz',
        count: 2,
        citations: [
          {
            citing: '10.1001/abc',
            cited: '10.1000/xyz',
            citation_date: '2023-01-01',
            raw: {},
            source: 'coci' as const,
          },
          {
            citing: '10.1002/def',
            cited: '10.1000/xyz',
            citation_date: '2023-02-01',
            raw: {},
            source: 'coci' as const,
          },
        ],
      };

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCociForDoi('10.1000/xyz');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://test.supabase.co/functions/v1/coci?doi=10.1000%2Fxyz',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );

      expect(result).toEqual(mockResponse);
      expect(result.count).toBe(2);
      expect(result.citations).toHaveLength(2);
    });

    it('should include API key in headers if available', async () => {
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-api-key';

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ doi: '10.1000/xyz', count: 0, citations: [] }),
      } as Response);

      await fetchCociForDoi('10.1000/xyz');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            apikey: 'test-api-key',
          }),
        })
      );

      // Clean up
      delete import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    });

    it('should throw error on non-ok response', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => 'COCI API returned 502',
      } as Response);

      await expect(fetchCociForDoi('10.1000/xyz')).rejects.toThrow(
        'Failed to fetch COCI data (502)'
      );
    });

    it('should handle DOIs with special characters', async () => {
      const doi = '10.1000/xyz(2023)';
      const encodedDoi = encodeURIComponent(doi);

      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ doi, count: 0, citations: [] }),
      } as Response);

      await fetchCociForDoi(doi);

      expect(global.fetch).toHaveBeenCalledWith(
        `https://test.supabase.co/functions/v1/coci?doi=${encodedDoi}`,
        expect.any(Object)
      );
    });
  });
});
