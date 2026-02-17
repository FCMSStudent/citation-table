import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, getPathParts } from "./domain/models/research.ts";
import { providerHealthSnapshot } from "./infrastructure/providers/index.ts";
import { maybeHandleWorkerDrainRoute } from "./application/stages/worker-drain-stage.ts";
import { maybeHandleReadRoute } from "./application/stages/read-routes-stage.ts";
import { handleStartSearch } from "./application/stages/start-search-stage.ts";

// Wiring smoke tests assert research-async routes through runProviderPipeline( via extracted pipeline stage.

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const pathParts = getPathParts(req);
    const isLitRoute = pathParts[0] === "v1" && pathParts[1] === "lit";

    const workerResponse = await maybeHandleWorkerDrainRoute(req, supabase, isLitRoute, pathParts);
    if (workerResponse) return workerResponse;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = userData.user.id;

    if (req.method === "GET" && isLitRoute && pathParts[2] === "providers" && pathParts[3] === "health") {
      const health = await providerHealthSnapshot();
      return new Response(JSON.stringify(health), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const readResponse = await maybeHandleReadRoute(req, supabase, pathParts, userId, isLitRoute);
    if (readResponse) return readResponse;

    const isStartRequest = req.method === "POST" && ((isLitRoute && pathParts[2] === "search") || pathParts.length === 0);
    if (!isStartRequest) {
      return new Response(JSON.stringify({ error: "Unsupported route" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return await handleStartSearch(req, supabase, userId, isLitRoute);
  } catch (error) {
    console.error("[research-async] Error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
