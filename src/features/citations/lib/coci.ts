/**
 * COCI (Citations in Context - OpenCitations) integration
 * 
 * This module provides a TypeScript helper to call the Supabase Edge Function
 * that queries the OpenCitations COCI API for citation data.
 */

export interface CociCitation {
  citing: string;
  cited: string;
  citation_date: string | null;
  raw: Record<string, unknown>;
  source: "coci";
}

export interface CociResponse {
  doi: string;
  count: number;
  citations: CociCitation[];
}

/**
 * Fetch citation data from the COCI API via Supabase Edge Function
 * 
 * @param doi - The DOI to query (can include doi.org prefix or not)
 * @returns Promise resolving to citation data
 * @throws Error if the request fails or VITE_SUPABASE_URL is not configured
 */
export async function fetchCociForDoi(doi: string): Promise<CociResponse> {
  const { supabase } = await import("@/integrations/supabase/client");
  
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Authentication required. Please sign in to use citation lookup.");
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("VITE_SUPABASE_URL is not configured. Please set it in your .env.local file.");
  }

  const apiKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 
                 import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
                 import.meta.env.VITE_SUPABASE_ANON_KEY;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${session.access_token}`,
  };

  if (apiKey) {
    headers["apikey"] = apiKey;
  }

  const encodedDoi = encodeURIComponent(doi);
  const url = `${supabaseUrl}/functions/v1/coci?doi=${encodedDoi}`;

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch COCI data (${response.status}): ${errorText}`);
  }

  return response.json();
}
