import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CociCitation {
  citing: string;
  cited: string;
  creation?: string;
  timespan?: string;
  journal_sc?: string;
  author_sc?: string;
  [key: string]: unknown;
}

interface CociResponse {
  doi: string;
  count: number;
  citations: Array<{
    citing: string;
    cited: string;
    citation_date: string | null;
    raw: CociCitation;
    source: "coci";
  }>;
}

// Normalize DOI by removing common prefixes
function normalizeDoi(doi: string): string {
  return doi
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "")
    .trim();
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract DOI from query parameter or path
    const url = new URL(req.url);
    let doi = url.searchParams.get("doi");

    // If no query parameter, try to extract from path (e.g., /coci/10.1000/xyz)
    if (!doi) {
      const pathParts = url.pathname.split("/");
      // Look for DOI pattern in path
      const doiIndex = pathParts.findIndex((part) => part.startsWith("10."));
      if (doiIndex >= 0) {
        doi = pathParts.slice(doiIndex).join("/");
      }
    }

    if (!doi) {
      return new Response(
        JSON.stringify({ error: "Missing DOI parameter. Use ?doi=... or include DOI in path." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Normalize the DOI
    const normalizedDoi = normalizeDoi(doi);

    // Call OpenCitations COCI API
    const cociUrl = `https://opencitations.net/index/coci/api/v1/citations/${normalizedDoi}`;
    const cociResponse = await fetch(cociUrl);

    if (!cociResponse.ok) {
      return new Response(
        JSON.stringify({
          error: `COCI API returned ${cociResponse.status}: ${cociResponse.statusText}`,
          doi: normalizedDoi,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const cociData: CociCitation[] = await cociResponse.json();

    // Normalize the response
    const response: CociResponse = {
      doi: normalizedDoi,
      count: cociData.length,
      citations: cociData.map((citation) => ({
        citing: citation.citing,
        cited: citation.cited,
        citation_date: citation.creation || null,
        raw: citation,
        source: "coci" as const,
      })),
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("COCI function error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
