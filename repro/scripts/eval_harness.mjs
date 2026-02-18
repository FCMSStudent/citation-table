#!/usr/bin/env node
import path from "node:path";
import {
  fetchRunDetail,
  fetchJson,
  pollSearchStatus,
  readTopics,
  requiredEnv,
  timestampTag,
  writeJsonDeterministic,
} from "./_common.mjs";

const BASELINES = [
  { id: "multi_provider", body: {} },
  { id: "single_provider_openalex", body: { provider_profile: ["openalex"] } },
  { id: "single_provider_semantic_scholar", body: { provider_profile: ["semantic_scholar"] } },
  { id: "single_provider_arxiv", body: { provider_profile: ["arxiv"] } },
  { id: "single_provider_pubmed", body: { provider_profile: ["pubmed"] } },
  { id: "no_dedupe", body: { experiment: { disable_dedupe: true } } },
  { id: "deterministic_only", body: { experiment: { extraction_engine: "scripted" } } },
  { id: "llm_only", body: { experiment: { extraction_engine: "llm" } } },
];

function parseArgs(argv) {
  const out = {
    topics: path.resolve("repro/data/topics.sample.json"),
    output: null,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--topics") out.topics = path.resolve(String(argv[++i] || out.topics));
    else if (arg === "--output") out.output = path.resolve(String(argv[++i]));
  }

  return out;
}

async function run() {
  const args = parseArgs(process.argv);
  const baseUrl = requiredEnv("RESEARCH_ASYNC_LIT_BASE_URL");
  const authToken = requiredEnv("RESEARCH_USER_BEARER_TOKEN");
  const topics = readTopics(args.topics);

  const rows = [];

  for (const topic of topics) {
    for (const baseline of BASELINES) {
      const startedAt = Date.now();
      const started = await fetchJson(`${baseUrl}/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: topic,
          max_candidates: 300,
          ...baseline.body,
        }),
      });

      const searchId = started.search_id;
      const done = await pollSearchStatus({ baseUrl, searchId, authToken });
      const detail = done.active_run_id
        ? await fetchRunDetail({ baseUrl, searchId, runId: done.active_run_id, authToken }).catch(() => null)
        : null;

      const evidence = Array.isArray(done.evidence_table) ? done.evidence_table : [];
      const studies = Array.isArray(detail?.run?.results)
        ? detail.run.results
        : Array.isArray(detail?.run?.partial_results)
          ? detail.run.partial_results
          : [];

      rows.push({
        topic,
        baseline_id: baseline.id,
        search_id: searchId,
        status: done.status,
        latency_ms: Date.now() - startedAt,
        pipeline_latency_ms: Number(done?.stats?.latency_ms || 0),
        run_id: done.active_run_id || null,
        run_version: done.run_version || null,
        provider_coverage: done.coverage || null,
        extraction_stats: detail?.run?.extraction_stats || null,
        extraction_metadata: detail?.run?.extraction_metadata || null,
        study_ids: studies.map((study) => String(study.study_id || "")).filter(Boolean).sort(),
        dois: studies
          .map((study) => String(study?.citation?.doi || "").trim().toLowerCase())
          .filter(Boolean)
          .sort(),
        candidate_ids: evidence.map((row) => String(row.paper_id || "")).filter(Boolean).sort(),
      });
    }
  }

  const pooledCandidateSet = {};
  for (const row of rows) {
    if (!pooledCandidateSet[row.topic]) pooledCandidateSet[row.topic] = new Set();
    for (const id of row.candidate_ids) pooledCandidateSet[row.topic].add(id);
  }

  const pooledSerializable = Object.fromEntries(
    Object.entries(pooledCandidateSet).map(([topic, set]) => [topic, Array.from(set).sort()]),
  );

  const outputPath = args.output || path.resolve(`repro/results/eval_results_${timestampTag()}.json`);
  writeJsonDeterministic(outputPath, {
    generated_at: new Date().toISOString(),
    baselines: BASELINES.map((b) => b.id),
    topics,
    pooled_candidate_set: pooledSerializable,
    structured_results: rows,
  });

  console.log(JSON.stringify({ output: outputPath, rows: rows.length }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
