#!/usr/bin/env node
import path from "node:path";
import {
  fetchRunDetail,
  fetchJson,
  mean,
  percentile,
  pollSearchStatus,
  readTopics,
  requiredEnv,
  timestampTag,
  writeJsonDeterministic,
} from "./_common.mjs";

const PROFILE_CONCURRENCY = {
  light: 10,
  medium: 50,
  heavy: 200,
};

function parseArgs(argv) {
  const out = {
    profile: "light",
    topics: path.resolve("repro/data/topics.sample.json"),
    requests: null,
    simulate429: 0,
    simulateTimeout: 0,
    simulateDbMs: 0,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile") out.profile = String(argv[++i] || out.profile);
    else if (arg === "--topics") out.topics = path.resolve(String(argv[++i] || out.topics));
    else if (arg === "--requests") out.requests = Number(argv[++i] || 0);
    else if (arg === "--simulate429") out.simulate429 = Number(argv[++i] || 0);
    else if (arg === "--simulateTimeout") out.simulateTimeout = Number(argv[++i] || 0);
    else if (arg === "--simulateDbMs") out.simulateDbMs = Number(argv[++i] || 0);
  }

  if (!PROFILE_CONCURRENCY[out.profile]) {
    throw new Error(`Unknown profile: ${out.profile}. Expected one of ${Object.keys(PROFILE_CONCURRENCY).join(", ")}`);
  }

  return out;
}

async function run() {
  const args = parseArgs(process.argv);
  const baseUrl = requiredEnv("RESEARCH_ASYNC_LIT_BASE_URL");
  const authToken = requiredEnv("RESEARCH_USER_BEARER_TOKEN");
  const topics = readTopics(args.topics);

  const concurrency = PROFILE_CONCURRENCY[args.profile];
  const requestCount = Number.isFinite(args.requests) && args.requests > 0 ? Math.trunc(args.requests) : concurrency;
  const queue = Array.from({ length: requestCount }, (_, i) => i);

  const workers = Array.from({ length: Math.min(concurrency, requestCount) }, async () => {
    const rows = [];
    while (queue.length > 0) {
      const idx = queue.shift();
      if (idx === undefined) break;

      const topic = topics[idx % topics.length];
      const startedAt = Date.now();
      let success = false;
      let status = "failed";
      let latencyMs = 0;
      let queueAgeMs = 0;
      let fallback = 0;
      let cost = 0;
      let error = null;

      try {
        const started = await fetchJson(`${baseUrl}/search`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: topic,
            max_candidates: 300,
            simulation: {
              provider_429_burst_rate: args.simulate429,
              provider_timeout_rate: args.simulateTimeout,
              db_contention_ms: args.simulateDbMs,
            },
          }),
        });

        const searchId = started.search_id;
        const done = await pollSearchStatus({ baseUrl, searchId, authToken });
        status = String(done.status || "failed");
        latencyMs = Date.now() - startedAt;
        queueAgeMs = Math.max(0, latencyMs - Number(done?.stats?.latency_ms || 0));
        success = status === "completed";

        if (done.active_run_id) {
          const detail = await fetchRunDetail({
            baseUrl,
            searchId,
            runId: done.active_run_id,
            authToken,
          }).catch(() => null);

          const extractionStats = detail?.run?.extraction_stats || {};
          fallback = extractionStats.llmFallbackApplied ? 1 : 0;
          const llmBatches = Number(extractionStats.llm_batches || 0);
          const perBatch = Number(process.env.LLM_COST_PER_BATCH_USD || 0.0025);
          cost = llmBatches * perBatch;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      rows.push({
        request_index: idx,
        topic,
        success,
        status,
        latency_ms: latencyMs,
        queue_age_ms: queueAgeMs,
        fallback_rate: fallback,
        cost_per_report: cost,
        error,
      });
    }
    return rows;
  });

  const allRows = (await Promise.all(workers)).flat().sort((a, b) => a.request_index - b.request_index);
  const successRows = allRows.filter((row) => row.success);

  const summary = {
    profile: args.profile,
    concurrency,
    request_count: allRows.length,
    success_rate: allRows.length ? successRows.length / allRows.length : 0,
    latency_p95_ms: percentile(successRows.map((row) => row.latency_ms), 95),
    queue_age_p95_ms: percentile(successRows.map((row) => row.queue_age_ms), 95),
    fallback_rate: mean(successRows.map((row) => row.fallback_rate)),
    cost_per_report: mean(successRows.map((row) => row.cost_per_report)),
    simulation: {
      provider_429_burst_rate: args.simulate429,
      provider_timeout_rate: args.simulateTimeout,
      db_contention_ms: args.simulateDbMs,
    },
  };

  const outPath = path.resolve(`repro/results/load_test_${args.profile}_${timestampTag()}.json`);
  writeJsonDeterministic(outPath, { summary, rows: allRows });
  console.log(JSON.stringify({ output: outPath, summary }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
