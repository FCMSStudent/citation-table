import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STUCK_THRESHOLD_MINUTES = 15;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Reap stuck reports
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60_000).toISOString();

    const { data: stuckReports, error: selectErr } = await supabase
      .from("research_reports")
      .select("id, question, created_at")
      .eq("status", "processing")
      .lt("created_at", cutoff);

    if (selectErr) {
      console.error("[reaper] Failed to query stuck reports:", selectErr.message);
      return new Response(JSON.stringify({ error: selectErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reaped: string[] = [];

    for (const report of stuckReports || []) {
      const { error: updateErr } = await supabase
        .from("research_reports")
        .update({
          status: "failed",
          error_message: `Timed out: no completion signal received within ${STUCK_THRESHOLD_MINUTES} minutes`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", report.id)
        .eq("status", "processing"); // Guard against race

      if (!updateErr) {
        reaped.push(report.id);
        console.log(`[reaper] Reaped report ${report.id} (question: "${report.question}", created: ${report.created_at})`);
      } else {
        console.warn(`[reaper] Failed to reap ${report.id}: ${updateErr.message}`);
      }
    }

    // 2. Reap dead jobs (stuck in leased past expiry)
    const { data: stuckJobs, error: jobsErr } = await supabase
      .from("research_jobs")
      .select("id, report_id, dedupe_key, attempts, max_attempts")
      .eq("status", "leased")
      .lt("lease_expires_at", new Date().toISOString());

    const reapedJobs: string[] = [];

    if (!jobsErr) {
      for (const job of stuckJobs || []) {
        const newStatus = job.attempts >= job.max_attempts ? "dead" : "queued";
        const { error: jobUpdateErr } = await supabase
          .from("research_jobs")
          .update({
            status: newStatus,
            lease_owner: null,
            lease_expires_at: null,
            last_error: "Reaped: lease expired without completion",
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id)
          .eq("status", "leased");

        if (!jobUpdateErr) {
          reapedJobs.push(job.id);
          console.log(`[reaper] Reaped job ${job.id} → ${newStatus}`);
        }
      }
    }

    const summary = {
      stuck_reports_found: stuckReports?.length || 0,
      reports_reaped: reaped.length,
      reaped_report_ids: reaped,
      stuck_jobs_found: stuckJobs?.length || 0,
      jobs_reaped: reapedJobs.length,
      threshold_minutes: STUCK_THRESHOLD_MINUTES,
      checked_at: new Date().toISOString(),
    };

    console.log("[reaper] Summary:", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[reaper] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Reaper failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
