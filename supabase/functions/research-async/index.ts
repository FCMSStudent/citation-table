import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { question } = await req.json();

    if (!question || typeof question !== "string" || question.trim().length < 5) {
      return new Response(
        JSON.stringify({ error: "Please provide a valid research question (at least 5 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (question.length > 500) {
      return new Response(
        JSON.stringify({ error: "Question is too long (maximum 500 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert a processing row
    const { data: report, error: insertError } = await supabase
      .from("research_reports")
      .insert({ question: question.trim(), status: "processing" })
      .select("id")
      .single();

    if (insertError || !report) {
      console.error("[research-async] Insert error:", insertError);
      throw new Error("Failed to create report");
    }

    const reportId = report.id;
    console.log(`[research-async] Created report ${reportId} for: "${question}"`);

    // Call the existing research edge function in the background
    const researchUrl = `${supabaseUrl}/functions/v1/research`;

    // Use EdgeRuntime.waitUntil to process in background after responding
    const backgroundWork = (async () => {
      try {
        console.log(`[research-async] Starting background processing for ${reportId}`);
        
        const response = await fetch(researchUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({ question: question.trim() }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Research function failed: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        // Update report with results
        const { error: updateError } = await supabase
          .from("research_reports")
          .update({
            status: "completed",
            results: data.results || [],
            normalized_query: data.normalized_query || null,
            total_papers_searched: data.total_papers_searched || 0,
            openalex_count: data.openalex_count || 0,
            semantic_scholar_count: data.semantic_scholar_count || 0,
            arxiv_count: data.arxiv_count || 0,
            completed_at: new Date().toISOString(),
          })
          .eq("id", reportId);

        if (updateError) {
          console.error(`[research-async] Update error for ${reportId}:`, updateError);
        } else {
          console.log(`[research-async] Report ${reportId} completed with ${(data.results || []).length} results`);
        }
      } catch (err) {
        console.error(`[research-async] Background processing failed for ${reportId}:`, err);
        
        await supabase
          .from("research_reports")
          .update({
            status: "failed",
            error_message: err instanceof Error ? err.message : "An unexpected error occurred",
            completed_at: new Date().toISOString(),
          })
          .eq("id", reportId);
      }
    })();

    // Use EdgeRuntime.waitUntil if available, otherwise just fire-and-forget
    if (typeof (globalThis as any).EdgeRuntime !== "undefined" && (globalThis as any).EdgeRuntime.waitUntil) {
      (globalThis as any).EdgeRuntime.waitUntil(backgroundWork);
    } else {
      // Fallback: don't await, let it run in background
      backgroundWork.catch(console.error);
    }

    // Return immediately with the report ID
    return new Response(
      JSON.stringify({ report_id: reportId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[research-async] Error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
