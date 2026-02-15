import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __getQueryProcessingCircuitStateForTests,
  __resetQueryProcessingStateForTests,
  prepareQueryProcessingV2,
} from "../../supabase/functions/_shared/query-processing.ts";

describe("Query Processing V2", () => {
  beforeEach(() => {
    __resetQueryProcessingStateForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves negation and comparator markers while neutralizing comparative phrasing", async () => {
    const result = await prepareQueryProcessingV2(
      "Is caffeine not better than placebo vs no treatment for migraine?",
      { llmApiKey: "", confidenceThreshold: 0 },
    );

    expect(result.normalized_query).toContain("not");
    expect(result.normalized_query).toContain("vs");
    expect(result.normalized_query).not.toContain("better than");
    expect(result.query_processing.reason_codes.join(" ")).toMatch(/comparative_neutralized/);
  });

  it("normalizes unicode punctuation and preserves dosage units", async () => {
    const result = await prepareQueryProcessingV2(
      "How does \u201cMelatonin\u201d 10mg \u2014 vs 5 mg placebo \u2014 affect sleep?",
      { llmApiKey: "", confidenceThreshold: 0 },
    );

    expect(result.normalized_query).toContain("10 mg");
    expect(result.normalized_query).toContain("5 mg");
    expect(result.normalized_query).toContain("vs");
    expect(result.normalized_query).not.toMatch(/[\u201c\u201d\u2014]/);
  });

  it("keeps semantic-critical stop words", async () => {
    const result = await prepareQueryProcessingV2(
      "blood pressure not improved without exercise versus medication",
      { llmApiKey: "", confidenceThreshold: 0 },
    );

    expect(result.query_terms).toContain("not");
    expect(result.query_terms).toContain("without");
    expect(result.query_terms).toContain("vs");
  });

  it("applies bounded ontology expansion and source-specific query compilation", async () => {
    const result = await prepareQueryProcessingV2(
      "effects of sleep deprivation on cognitive performance",
      { llmApiKey: "", confidenceThreshold: 0 },
    );

    expect(result.expanded_terms.length).toBeGreaterThan(0);
    expect(result.query_processing.source_queries.semantic_scholar.length).toBeGreaterThan(0);
    expect(result.query_processing.source_queries.openalex.length).toBeGreaterThan(0);
    expect(result.query_processing.source_queries.pubmed).toContain("[Title/Abstract]");
    expect(result.query_processing.source_queries.arxiv.length).toBeGreaterThan(0);
  });

  it("uses deterministic output when LLM fallback fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 500 })),
    );

    const result = await prepareQueryProcessingV2(
      "which treatment is better best safer",
      { llmApiKey: "fake-key", confidenceThreshold: 0.95, fallbackTimeoutMs: 50 },
    );

    expect(result.query_processing.used_llm_fallback).toBe(false);
    expect(result.query_processing.reason_codes).toContain("llm_fallback_failed");
  });

  it("opens fallback circuit after repeated failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 500 })),
    );

    for (let i = 0; i < 8; i += 1) {
      // Use distinct queries to avoid cache hit suppressing attempts.
      await prepareQueryProcessingV2(
        `better best safe bad treatment signal ${i}`,
        { llmApiKey: "fake-key", confidenceThreshold: 0.98, fallbackTimeoutMs: 50 },
      );
    }

    const state = __getQueryProcessingCircuitStateForTests();
    expect(state.attempts).toBeGreaterThanOrEqual(8);
    expect(state.failures).toBeGreaterThanOrEqual(8);
    expect(state.openUntil).toBeGreaterThan(Date.now());
  });

  it("meets lightweight processing latency guard", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const t0 = performance.now();
      await prepareQueryProcessingV2(`sleep deprivation cognitive performance sample ${i}`, {
        llmApiKey: "",
        confidenceThreshold: 0,
      });
      samples.push(performance.now() - t0);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    expect(p95).toBeLessThan(1000);
  });
});
