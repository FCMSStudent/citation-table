import { getExtractionRunDetail, listExtractionRuns } from "../../../_shared/extraction-runs.ts";
import { corsHeaders, mapReportToSearchResponse, type SupabaseClientLike } from "../../domain/models/research.ts";

export async function maybeHandleReadRoute(
  req: Request,
  supabase: SupabaseClientLike,
  pathParts: string[],
  userId: string,
  isLitRoute: boolean,
): Promise<Response | null> {
  if (req.method === "GET" && isLitRoute && pathParts[2] === "search" && pathParts[3] && pathParts[4] === "runs" && pathParts[5]) {
    const searchId = pathParts[3];
    const runId = pathParts[5];
    const { data: report, error } = await supabase
      .from("research_reports")
      .select("id,user_id")
      .eq("id", searchId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: "Failed to load search" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!report) {
      return new Response(JSON.stringify({ error: "search_id not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const detail = await getExtractionRunDetail(supabase, searchId, runId);
    if (!detail) {
      return new Response(JSON.stringify({ error: "run_id not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(detail), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET" && isLitRoute && pathParts[2] === "search" && pathParts[3] && pathParts[4] === "runs") {
    const searchId = pathParts[3];
    const { data: report, error } = await supabase
      .from("research_reports")
      .select("id,user_id,active_extraction_run_id")
      .eq("id", searchId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: "Failed to load search" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!report) {
      return new Response(JSON.stringify({ error: "search_id not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const runs = await listExtractionRuns(supabase, searchId, report.active_extraction_run_id || null);
    return new Response(JSON.stringify({ search_id: searchId, runs }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET" && isLitRoute && pathParts[2] === "search" && pathParts[3]) {
    const searchId = pathParts[3];
    const { data: report, error } = await supabase
      .from("research_reports")
      .select("id,status,error_message,lit_response,user_id,active_extraction_run_id,extraction_run_count")
      .eq("id", searchId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: "Failed to load search" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!report) {
      return new Response(JSON.stringify({ error: "search_id not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(mapReportToSearchResponse(report)), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET" && isLitRoute && pathParts[2] === "paper" && pathParts[3]) {
    const paperId = decodeURIComponent(pathParts[3]);
    const nowIso = new Date().toISOString();
    const { data: paperCache, error } = await supabase
      .from("lit_paper_cache")
      .select("paper_payload")
      .eq("paper_id", paperId)
      .gt("expires_at", nowIso)
      .maybeSingle();

    if (error) {
      return new Response(JSON.stringify({ error: "Failed to load paper" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!paperCache) {
      return new Response(JSON.stringify({ error: "paper_id not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(paperCache.paper_payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return null;
}
