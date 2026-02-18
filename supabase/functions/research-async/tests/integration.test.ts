import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getClient() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// ---------- Run lifecycle ----------
Deno.test("research_jobs: enqueue → claim → complete lifecycle", async () => {
  const supabase = getClient();
  const reportId = crypto.randomUUID();

  // Create a report so FK is satisfied
  await supabase.from("research_reports").insert({ id: reportId, question: "lifecycle test", status: "queued" });

  try {
    // Enqueue
    const { data: enqueued, error: enqErr } = await supabase.rpc("research_jobs_enqueue", {
      p_report_id: reportId,
      p_stage: "pipeline",
      p_provider: "test-provider",
      p_payload: { test: true },
      p_dedupe_key: `test:lifecycle:${reportId}`,
    });
    assertEquals(enqErr, null);
    assertExists(enqueued);
    const job = Array.isArray(enqueued) ? enqueued[0] : enqueued;
    assertEquals(job.status, "queued");

    // Claim
    const workerId = `test-worker-${crypto.randomUUID()}`;
    const { data: claimed } = await supabase.rpc("research_jobs_claim", {
      p_worker_id: workerId,
      p_batch_size: 10,
      p_lease_seconds: 60,
    });
    const myJob = (claimed || []).find((j: any) => j.id === job.id);
    assertExists(myJob);
    assertEquals(myJob.status, "leased");

    // Complete
    const { data: completed } = await supabase.rpc("research_jobs_complete", {
      p_job_id: job.id,
      p_worker_id: workerId,
    });
    const done = Array.isArray(completed) ? completed[0] : completed;
    assertEquals(done?.status, "completed");
  } finally {
    await supabase.from("research_jobs").delete().eq("report_id", reportId);
    await supabase.from("research_reports").delete().eq("id", reportId);
  }
});

// ---------- Failure scenario ----------
Deno.test("research_jobs: fail re-queues under max_attempts", async () => {
  const supabase = getClient();
  const reportId = crypto.randomUUID();
  await supabase.from("research_reports").insert({ id: reportId, question: "fail test", status: "queued" });

  try {
    const { data: enqueued } = await supabase.rpc("research_jobs_enqueue", {
      p_report_id: reportId,
      p_stage: "pipeline",
      p_provider: "test-provider",
      p_payload: {},
      p_dedupe_key: `test:fail:${reportId}`,
      p_max_attempts: 3,
    });
    const job = Array.isArray(enqueued) ? enqueued![0] : enqueued;

    const workerId = `worker-${crypto.randomUUID()}`;
    await supabase.rpc("research_jobs_claim", { p_worker_id: workerId, p_batch_size: 10, p_lease_seconds: 60 });

    // Fail it
    const { data: failed } = await supabase.rpc("research_jobs_fail", {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_error: "test error",
    });
    const failedJob = Array.isArray(failed) ? failed[0] : failed;
    assertEquals(failedJob?.status, "queued"); // re-queued because attempts < max
    assertEquals(failedJob?.last_error, "test error");
  } finally {
    await supabase.from("research_jobs").delete().eq("report_id", reportId);
    await supabase.from("research_reports").delete().eq("id", reportId);
  }
});

// ---------- Concurrent append_study ----------
Deno.test("append_study_to_report: 10 concurrent appends lose no writes", async () => {
  const supabase = getClient();
  const reportId = crypto.randomUUID();
  await supabase.from("research_reports").insert({
    id: reportId,
    question: "concurrency test",
    status: "completed",
    results: [],
  });

  try {
    // Fire 10 concurrent appends
    const promises = Array.from({ length: 10 }, (_, i) =>
      supabase.rpc("append_study_to_report", {
        p_report_id: reportId,
        p_study: { study_id: `concurrent_${i}`, title: `Study ${i}` },
      })
    );
    const results = await Promise.all(promises);

    // All should succeed
    for (const r of results) {
      assertEquals(r.error, null);
    }

    // Verify count
    const { data: report } = await supabase
      .from("research_reports")
      .select("results")
      .eq("id", reportId)
      .single();
    const arr = report?.results as any[];
    assertEquals(arr.length, 10);

    // Verify all IDs present
    const ids = new Set(arr.map((s: any) => s.study_id));
    assertEquals(ids.size, 10);
  } finally {
    await supabase.from("research_reports").delete().eq("id", reportId);
  }
});

// ---------- Concurrent job claims ----------
Deno.test("research_jobs_claim: concurrent claims don't double-assign", async () => {
  const supabase = getClient();
  const reportId = crypto.randomUUID();
  await supabase.from("research_reports").insert({ id: reportId, question: "claim test", status: "queued" });

  try {
    // Enqueue 5 jobs
    for (let i = 0; i < 5; i++) {
      await supabase.rpc("research_jobs_enqueue", {
        p_report_id: reportId,
        p_stage: "pipeline",
        p_provider: "test",
        p_payload: { i },
        p_dedupe_key: `test:claim:${reportId}:${i}`,
      });
    }

    // 3 workers claim concurrently, batch_size=3
    const claims = await Promise.all([
      supabase.rpc("research_jobs_claim", { p_worker_id: "w1", p_batch_size: 3, p_lease_seconds: 60 }),
      supabase.rpc("research_jobs_claim", { p_worker_id: "w2", p_batch_size: 3, p_lease_seconds: 60 }),
      supabase.rpc("research_jobs_claim", { p_worker_id: "w3", p_batch_size: 3, p_lease_seconds: 60 }),
    ]);

    const allClaimed = claims.flatMap((c) => (c.data || []).filter((j: any) => j.report_id === reportId));
    const claimedIds = allClaimed.map((j: any) => j.id);
    const uniqueIds = new Set(claimedIds);

    // No job claimed twice
    assertEquals(claimedIds.length, uniqueIds.size);
    // All 5 should be claimed total
    assertEquals(uniqueIds.size, 5);
  } finally {
    await supabase.from("research_jobs").delete().eq("report_id", reportId);
    await supabase.from("research_reports").delete().eq("id", reportId);
  }
});

// ---------- report_has_doi atomic check ----------
Deno.test("report_has_doi: returns true for existing DOI", async () => {
  const supabase = getClient();
  const reportId = crypto.randomUUID();
  await supabase.from("research_reports").insert({
    id: reportId,
    question: "doi check test",
    status: "completed",
    results: [{ study_id: "s1", citation: { doi: "10.1000/existing" } }],
  });

  try {
    const { data: found } = await supabase.rpc("report_has_doi", {
      p_report_id: reportId,
      p_doi: "10.1000/existing",
    });
    assertEquals(found, true);

    const { data: notFound } = await supabase.rpc("report_has_doi", {
      p_report_id: reportId,
      p_doi: "10.1000/missing",
    });
    assertEquals(notFound, false);
  } finally {
    await supabase.from("research_reports").delete().eq("id", reportId);
  }
});

// ---------- next_run_index atomicity ----------
Deno.test("next_run_index: increments atomically", async () => {
  const supabase = getClient();
  const reportId = crypto.randomUUID();
  await supabase.from("research_reports").insert({
    id: reportId,
    question: "run index test",
    status: "completed",
    extraction_run_count: 0,
  });

  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        supabase.rpc("next_run_index", { p_report_id: reportId })
      )
    );

    const indices = results.map((r) => r.data as number).sort((a, b) => a - b);
    // Should be 1,2,3,4,5 — all unique, no gaps
    assertEquals(indices, [1, 2, 3, 4, 5]);
  } finally {
    await supabase.from("research_reports").delete().eq("id", reportId);
  }
});
