#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { optionalEnv, requiredEnv, timestampTag, writeJsonDeterministic } from "./_common.mjs";

function boolCheck(name, ok, detail) {
  return { name, ok: Boolean(ok), detail };
}

function latestFileMatching(globPrefix) {
  const dir = path.dirname(globPrefix);
  const prefix = path.basename(globPrefix);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
  if (files.length === 0) return null;
  return path.join(dir, files[files.length - 1]);
}

async function run() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const outPath = optionalEnv("PHASE3_VALIDATION_OUTPUT", `repro/results/phase3_validation_${timestampTag()}.json`);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const [{ data: stuckJobs }, { data: deadJobs }, { data: providerLimits }, { data: providerRuntime }, { data: cacheEvents }] = await Promise.all([
    supabase
      .from("research_jobs")
      .select("id", { count: "exact" })
      .eq("status", "leased")
      .lt("lease_expires_at", new Date().toISOString()),
    supabase
      .from("research_jobs")
      .select("id", { count: "exact" })
      .eq("status", "dead"),
    supabase
      .from("provider_limits")
      .select("provider"),
    supabase
      .from("provider_runtime_state")
      .select("provider,circuit_state,total_successes,total_failures"),
    supabase
      .from("research_cache_events")
      .select("cache_name,event_type", { count: "exact" })
      .eq("event_type", "hit"),
  ]);

  const stuckCount = Array.isArray(stuckJobs) ? stuckJobs.length : 0;
  const deadCount = Array.isArray(deadJobs) ? deadJobs.length : 0;
  const providerLimitCount = Array.isArray(providerLimits) ? providerLimits.length : 0;
  const providerRuntimeCount = Array.isArray(providerRuntime) ? providerRuntime.length : 0;
  const cacheHitCount = Array.isArray(cacheEvents) ? cacheEvents.length : 0;

  const loadFile = latestFileMatching("repro/results/load_test_");
  const loadPayload = loadFile && fs.existsSync(loadFile) ? JSON.parse(fs.readFileSync(loadFile, "utf8")) : null;
  const loadSummary = loadPayload?.summary || {};

  const replayFile = fs.existsSync("repro/results/replay_validator.json")
    ? "repro/results/replay_validator.json"
    : latestFileMatching("repro/results/replay_validator_");
  const replayPayload = replayFile && fs.existsSync(replayFile) ? JSON.parse(fs.readFileSync(replayFile, "utf8")) : null;
  const replayRate = Number(replayPayload?.replay_match_rate || 0);

  const metricsFile = fs.existsSync("repro/results/metrics_results.json") ? "repro/results/metrics_results.json" : null;
  const metricsPayload = metricsFile ? JSON.parse(fs.readFileSync(metricsFile, "utf8")) : null;

  const protocolFrozen = fs.existsSync("repro/manifests/protocol_frozen.json")
    ? JSON.parse(fs.readFileSync("repro/manifests/protocol_frozen.json", "utf8"))
    : { frozen: false };

  const checks = [
    boolCheck("queue_stable", stuckCount === 0, { stuck_jobs: stuckCount }),
    boolCheck("rate_limits_enforced", providerLimitCount > 0 && providerRuntimeCount > 0, {
      provider_limits: providerLimitCount,
      provider_runtime: providerRuntimeCount,
    }),
    boolCheck("caches_working", cacheHitCount > 0, { cache_hit_events: cacheHitCount }),
    boolCheck("slo_pass_under_load", loadSummary ? Number(loadSummary.success_rate || 0) >= 0.95 : false, {
      success_rate: loadSummary?.success_rate || 0,
      latency_p95_ms: loadSummary?.latency_p95_ms || null,
    }),
    boolCheck("no_stuck_jobs", stuckCount === 0, { stuck_jobs: stuckCount, dead_jobs: deadCount }),
    boolCheck("determinism_gte_99_5", replayRate >= 0.995, { replay_match_rate: replayRate }),
    boolCheck("protocol_frozen", Boolean(protocolFrozen?.frozen), { manifest: "repro/manifests/protocol_frozen.json" }),
    boolCheck("annotation_kappa_gte_0_75", Number(metricsPayload?.annotation_kappa || 0) >= 0.75, {
      annotation_kappa: Number(metricsPayload?.annotation_kappa || 0),
    }),
    boolCheck("metrics_script_generated", Boolean(metricsPayload), { metrics_file: metricsFile }),
    boolCheck("statistical_tests_complete", Boolean(metricsPayload?.statistical_tests), {
      has_statistical_tests: Boolean(metricsPayload?.statistical_tests),
    }),
    boolCheck("repro_package_clean", [
      "repro/environment.lock",
      "repro/manifests",
      "repro/data",
      "repro/scripts/run_eval.sh",
      "repro/scripts/make_tables_figures.py",
      "repro/results",
    ].every((p) => fs.existsSync(p)), {}),
  ];

  const output = {
    generated_at: new Date().toISOString(),
    checks,
    pass: checks.every((c) => c.ok),
  };

  writeJsonDeterministic(outPath, output);
  console.log(JSON.stringify({ output: outPath, pass: output.pass }, null, 2));

  if (!output.pass) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
