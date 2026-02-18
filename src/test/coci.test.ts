import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase client module before importing coci
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

import { fetchCociForDoi } from '../features/citations/lib/coci';

// Get the mocked supabase
async function getMockedSupabase() {
  const mod = await import('@/integrations/supabase/client');
  return mod.supabase;
}

describe('COCI Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    import.meta.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
  });

  describe('fetchCociForDoi', () => {
    it('should throw error if not authenticated', async () => {
      const supabase = await getMockedSupabase();
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: null },
        error: null,
      } as any);

      await expect(fetchCociForDoi('10.1000/xyz')).rejects.toThrow(
        'Authentication required'
      );
    });

    it('should throw error if VITE_SUPABASE_URL is not configured', async () => {
      const supabase = await getMockedSupabase();
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null,
      } as any);
      import.meta.env.VITE_SUPABASE_URL = '';

      await expect(fetchCociForDoi('10.1000/xyz')).rejects.toThrow(
        'VITE_SUPABASE_URL is not configured'
      );
    });

    it('should make request to correct endpoint with encoded DOI', async () => {
      const supabase = await getMockedSupabase();
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null,
      } as any);

      const mockResponse = {
        doi: '10.1000/xyz',
        count: 2,
        citations: [
          { citing: '10.1001/abc', cited: '10.1000/xyz', citation_date: '2023-01-01', raw: {}, source: 'coci' as const },
          { citing: '10.1002/def', cited: '10.1000/xyz', citation_date: '2023-02-01', raw: {}, source: 'coci' as const },
        ],
      };

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await fetchCociForDoi('10.1000/xyz');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://test.supabase.co/functions/v1/coci?doi=10.1000%2Fxyz',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
          }),
        })
      );

      expect(result).toEqual(mockResponse);
      expect(result.count).toBe(2);
    });

    it('should include API key in headers if available', async () => {
      const supabase = await getMockedSupabase();
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null,
      } as any);
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-api-key';

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ doi: '10.1000/xyz', count: 0, citations: [] }),
      } as Response);

      await fetchCociForDoi('10.1000/xyz');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            apikey: 'test-api-key',
          }),
        })
      );

      delete import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    });

    it('should throw error on non-ok response', async () => {
      const supabase = await getMockedSupabase();
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null,
      } as any);

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => 'COCI API returned 502',
      } as Response);

      await expect(fetchCociForDoi('10.1000/xyz')).rejects.toThrow(
        'Failed to fetch COCI data (502)'
      );
    });

    it('should handle DOIs with special characters', async () => {
      const supabase = await getMockedSupabase();
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
        error: null,
      } as any);

      const doi = '10.1000/xyz(2023)';
      const encodedDoi = encodeURIComponent(doi);

      vi.mocked(globalThis.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ doi, count: 0, citations: [] }),
      } as Response);

      await fetchCociForDoi(doi);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `https://test.supabase.co/functions/v1/coci?doi=${encodedDoi}`,
        expect.any(Object)
      );
    });
  });
});
