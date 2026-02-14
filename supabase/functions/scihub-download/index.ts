import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sci-Hub mirrors to try in order
const SCIHUB_MIRRORS = [
  "https://sci-hub.se",
  "https://sci-hub.st",
  "https://sci-hub.ru",
];

interface DownloadRequest {
  report_id: string;
  dois: string[];
}

/**
 * Normalize DOI by removing common prefixes
 */
function normalizeDoi(doi: string): string {
  return doi
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
}

/**
 * Extract PDF URL from Sci-Hub HTML response
 */
function extractPdfUrl(html: string, baseUrl: string): string | null {
  // Look for PDF embed/iframe with src
  const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+\.pdf[^"']*)["']/i);
  if (iframeMatch && iframeMatch[1]) {
    const url = iframeMatch[1];
    return url.startsWith("http") ? url : new URL(url, baseUrl).toString();
  }

  // Look for direct PDF link
  const linkMatch = html.match(/<a[^>]+href=["']([^"']+\.pdf[^"']*)["']/i);
  if (linkMatch && linkMatch[1]) {
    const url = linkMatch[1];
    return url.startsWith("http") ? url : new URL(url, baseUrl).toString();
  }

  // Look for PDF button/download link
  const buttonMatch = html.match(/onclick="location\.href='([^']+\.pdf[^']*)'/i);
  if (buttonMatch && buttonMatch[1]) {
    const url = buttonMatch[1];
    return url.startsWith("http") ? url : new URL(url, baseUrl).toString();
  }

  return null;
}

/**
 * Try to download PDF from Sci-Hub for a given DOI
 */
async function downloadPdfFromScihub(doi: string): Promise<{ success: boolean; pdfData?: ArrayBuffer; error?: string }> {
  const normalizedDoi = normalizeDoi(doi);
  
  for (const mirror of SCIHUB_MIRRORS) {
    try {
      console.log(`[scihub-download] Trying ${mirror} for DOI: ${normalizedDoi}`);
      
      // First, fetch the Sci-Hub page
      const pageUrl = `${mirror}/${normalizedDoi}`;
      const pageResponse = await fetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!pageResponse.ok) {
        console.log(`[scihub-download] Page fetch failed: ${pageResponse.status}`);
        continue;
      }

      const html = await pageResponse.text();
      
      // Extract PDF URL from HTML
      const pdfUrl = extractPdfUrl(html, mirror);
      
      if (!pdfUrl) {
        console.log(`[scihub-download] No PDF URL found in HTML from ${mirror}`);
        continue;
      }

      console.log(`[scihub-download] Found PDF URL: ${pdfUrl}`);

      // Download the PDF
      const pdfResponse = await fetch(pdfUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      });

      if (!pdfResponse.ok) {
        console.log(`[scihub-download] PDF download failed: ${pdfResponse.status}`);
        continue;
      }

      const pdfData = await pdfResponse.arrayBuffer();
      
      // Basic validation - PDF files should start with %PDF
      const pdfHeader = new TextDecoder().decode(pdfData.slice(0, 5));
      if (!pdfHeader.startsWith("%PDF")) {
        console.log(`[scihub-download] Invalid PDF format from ${mirror}`);
        continue;
      }

      console.log(`[scihub-download] Successfully downloaded PDF (${pdfData.byteLength} bytes)`);
      return { success: true, pdfData };

    } catch (err) {
      console.error(`[scihub-download] Error with ${mirror}:`, err);
      continue;
    }
  }

  return { success: false, error: "PDF not found in any mirror" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { report_id, dois }: DownloadRequest = await req.json();

    if (!report_id || !dois || !Array.isArray(dois)) {
      return new Response(
        JSON.stringify({ error: "Invalid request: report_id and dois array required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[scihub-download] Processing ${dois.length} DOIs for report ${report_id}`);

    // Insert pending entries for all DOIs
    const pendingEntries = dois
      .filter(doi => doi && doi.trim())
      .map(doi => ({
        report_id,
        doi: normalizeDoi(doi),
        status: "pending",
      }));

    if (pendingEntries.length > 0) {
      const { error: insertError } = await supabase
        .from("study_pdfs")
        .insert(pendingEntries);

      if (insertError) {
        console.error("[scihub-download] Failed to insert pending entries:", insertError);
      }
    }

    // Process downloads in background
    const backgroundWork = (async () => {
      for (const doi of dois) {
        if (!doi || !doi.trim()) continue;

        const normalizedDoi = normalizeDoi(doi);
        
        try {
          console.log(`[scihub-download] Processing DOI: ${normalizedDoi}`);
          
          const result = await downloadPdfFromScihub(normalizedDoi);

          if (result.success && result.pdfData) {
            // Upload to storage
            const filename = `${report_id}/${normalizedDoi.replace(/\//g, "_")}.pdf`;
            
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from("papers")
              .upload(filename, result.pdfData, {
                contentType: "application/pdf",
                upsert: true,
              });

            if (uploadError) {
              console.error(`[scihub-download] Upload failed for ${normalizedDoi}:`, uploadError);
              
              await supabase
                .from("study_pdfs")
                .update({ status: "failed" })
                .eq("report_id", report_id)
                .eq("doi", normalizedDoi);
              
              continue;
            }

            // Get public URL
            const { data: urlData } = supabase.storage
              .from("papers")
              .getPublicUrl(filename);

            // Update database with success
            await supabase
              .from("study_pdfs")
              .update({
                status: "downloaded",
                storage_path: filename,
                public_url: urlData.publicUrl,
              })
              .eq("report_id", report_id)
              .eq("doi", normalizedDoi);

            console.log(`[scihub-download] Successfully processed ${normalizedDoi}`);

          } else {
            // Mark as not found
            await supabase
              .from("study_pdfs")
              .update({ status: "not_found" })
              .eq("report_id", report_id)
              .eq("doi", normalizedDoi);

            console.log(`[scihub-download] PDF not found for ${normalizedDoi}`);
          }

        } catch (err) {
          console.error(`[scihub-download] Error processing ${normalizedDoi}:`, err);
          
          await supabase
            .from("study_pdfs")
            .update({ status: "failed" })
            .eq("report_id", report_id)
            .eq("doi", normalizedDoi);
        }
      }

      console.log(`[scihub-download] Completed processing for report ${report_id}`);
    })();

    // Use EdgeRuntime.waitUntil if available
    if (typeof (globalThis as any).EdgeRuntime !== "undefined" && (globalThis as any).EdgeRuntime.waitUntil) {
      (globalThis as any).EdgeRuntime.waitUntil(backgroundWork);
    } else {
      backgroundWork.catch(console.error);
    }

    return new Response(
      JSON.stringify({ success: true, message: `Processing ${dois.length} DOIs` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[scihub-download] Error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
