#!/usr/bin/env node
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  hashString,
  optionalEnv,
  requiredEnv,
  sleep,
  stableStringify,
  timestampTag,
  writeJsonDeterministic,
} from "./_common.mjs";

const TARGET_RUNS = 10;

function stableHash(value) {
  return hashString(stableStringify(value));
}

function classifyMismatch(oldRun, newRun, oldStudyIds, newStudyIds) {
  if (!newRun || newRun.status !== "completed") return "provider_drift";

  const oldSorted = [...oldStudyIds].sort();
  const newSorted = [...newStudyIds].sort();
  if (stableStringify(oldSorted) === stableStringify(newSorted) && stableStringify(oldStudyIds) !== stableStringify(newStudyIds)) {
    return "nondeterministic_sorting";
  }

  if (oldRun.model || newRun.model) {
    return "llm_instability";
  }

  const oldKeys = Object.keys(oldRun?.results?.[0] || {}).sort();
  const newKeys = Object.keys(newRun?.results?.[0] || {}).sort();
  if (stableStringify(oldKeys) !== stableStringify(newKeys)) {
    return "schema_drift";
  }

  return "provider_drift";
}

async function drainUntilDone({ supabase, reportId, workerDrainUrl, workerToken, maxMinutes = 20 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMinutes * 60_000) {
    await fetch(workerDrainUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-research-worker-token": workerToken,
      },
      body: JSON.stringify({ batch_size: 25, micro_batch_size: 5, worker_id: `replay-${reportId}` }),
    }).catch(() => undefined);

    const { data: report } = await supabase
      .from("research_reports")
      .select("status,error_message")
      .eq("id", reportId)
      .maybeSingle();

    if (report?.status === "completed" || report?.status === "failed") {
      return report;
    }

    await sleep(1500);
  }

  throw new Error(`Timed out waiting for replay report ${reportId}`);
}

async function run() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const workerDrainUrl = requiredEnv("RESEARCH_ASYNC_WORKER_DRAIN_URL");
  const workerToken = requiredEnv("RESEARCH_JOB_WORKER_TOKEN");
  const outputPath = optionalEnv("REPLAY_VALIDATOR_OUTPUT", path.resolve(`repro/results/replay_validator_${timestampTag()}.json`));

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: candidateRuns, error: runErr } = await supabase
    .from("extraction_runs")
    .select("id,report_id,status,question,lit_request,results,prompt_hash,model,pipeline_version_id,seed,input_hash,output_hash,config_snapshot")
    .eq("status", "completed")
    .not("pipeline_version_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(TARGET_RUNS);

  if (runErr) throw new Error(`Failed to load completed runs: ${runErr.message}`);

  const rows = [];

  for (const oldRun of candidateRuns || []) {
    const { data: oldReport, error: reportErr } = await supabase
      .from("research_reports")
      .select("id,user_id,question")
      .eq("id", oldRun.report_id)
      .maybeSingle();
    if (reportErr || !oldReport?.user_id) {
      rows.push({
        source_run_id: oldRun.id,
        status: "skipped",
        reason: "missing_report_or_user",
      });
      continue;
    }

    const { data: newReport, error: insertErr } = await supabase
      .from("research_reports")
      .insert({
        question: oldReport.question,
        user_id: oldReport.user_id,
        status: "queued",
      })
      .select("id")
      .single();
    if (insertErr || !newReport?.id) {
      rows.push({
        source_run_id: oldRun.id,
        status: "skipped",
        reason: `report_insert_failed:${insertErr?.message || "unknown"}`,
      });
      continue;
    }

    const runInputHash = oldRun.input_hash || stableHash({ question: oldRun.question, lit_request: oldRun.lit_request, seed: oldRun.seed || 0 });
    const providerHash = stableHash(["openalex", "semantic_scholar", "arxiv", "pubmed"]);

    const { error: enqErr } = await supabase.rpc("research_jobs_enqueue", {
      p_report_id: newReport.id,
      p_stage: "ingest_provider",
      p_provider: "research-async",
      p_payload: {
        report_id: newReport.id,
        question: oldRun.question,
        user_id: oldReport.user_id,
        lit_request: oldRun.lit_request || {},
        cache_key: stableHash({ lit_request: oldRun.lit_request || {}, replay: true }),
        provider_hash: providerHash,
        pipeline_version_id: oldRun.pipeline_version_id,
        run_input_hash: runInputHash,
        seed: oldRun.seed || 0,
        pipeline_started_at: Date.now(),
        config_snapshot: oldRun.config_snapshot || {},
      },
      p_dedupe_key: `ingest_provider:research-async:${newReport.id}:${runInputHash}`,
      p_max_attempts: 5,
    });

    if (enqErr) {
      rows.push({
        source_run_id: oldRun.id,
        replay_report_id: newReport.id,
        status: "skipped",
        reason: `enqueue_failed:${enqErr.message}`,
      });
      continue;
    }

    const replayReport = await drainUntilDone({
      supabase,
      reportId: newReport.id,
      workerDrainUrl,
      workerToken,
    });

    const { data: newRun } = await supabase
      .from("extraction_runs")
      .select("id,status,results,output_hash,model")
      .eq("report_id", newReport.id)
      .order("run_index", { ascending: false })
      .limit(1)
      .maybeSingle();

    const oldStudyIds = Array.isArray(oldRun.results)
      ? oldRun.results.map((row) => String(row.study_id || "")).filter(Boolean)
      : [];
    const newStudyIds = Array.isArray(newRun?.results)
      ? newRun.results.map((row) => String(row.study_id || "")).filter(Boolean)
      : [];

    const oldHash = oldRun.output_hash || stableHash(oldRun.results || []);
    const newHash = newRun?.output_hash || stableHash(newRun?.results || []);
    const match = replayReport?.status === "completed"
      && stableStringify(oldStudyIds) === stableStringify(newStudyIds)
      && oldHash === newHash;

    rows.push({
      source_run_id: oldRun.id,
      replay_report_id: newReport.id,
      replay_run_id: newRun?.id || null,
      status: replayReport?.status || "failed",
      match,
      old_study_count: oldStudyIds.length,
      new_study_count: newStudyIds.length,
      old_hash: oldHash,
      new_hash: newHash,
      mismatch_cause: match ? null : classifyMismatch(oldRun, newRun, oldStudyIds, newStudyIds),
      error_message: replayReport?.error_message || null,
    });
  }

  const attempted = rows.filter((row) => row.status !== "skipped");
  const matched = attempted.filter((row) => row.match).length;
  const replayMatchRate = attempted.length ? matched / attempted.length : 0;

  await supabase.from("research_metrics_samples").insert({
    metric_name: "deterministic_replay_rate",
    metric_value: replayMatchRate,
    unit: "ratio",
    tags: { source: "replay_validator" },
  }).then(() => undefined).catch(() => undefined);

  const output = {
    generated_at: new Date().toISOString(),
    attempted_runs: attempted.length,
    replay_match_rate: replayMatchRate,
    mismatches: rows.filter((row) => !row.match && row.status !== "skipped").map((row) => row.mismatch_cause),
    rows,
  };

  writeJsonDeterministic(outputPath, output);
  console.log(JSON.stringify({ output: outputPath, replay_match_rate: replayMatchRate }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
