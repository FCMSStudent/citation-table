import { describe, it, expect, vi } from "vitest";
import {
  createStageContext,
  runStage,
  StageError,
  type PipelineStage,
  type StageResult,
  type StageEvent,
  type StageContext,
} from "../../supabase/functions/research-async/application/stages/pipeline-runtime.ts";
import { hashKey } from "../../supabase/functions/research-async/domain/models/research.ts";

// ---------- helpers ----------
function successStage(name: string, output: unknown): PipelineStage<unknown, unknown> {
  return {
    name: name as any,
    execute: async () => ({ output }),
  };
}

function failStage(name: string, error: Error): PipelineStage<unknown, unknown> {
  return {
    name: name as any,
    execute: async () => { throw error; },
  };
}

function slowStage(name: string, ms: number, output: unknown): PipelineStage<unknown, unknown> {
  return {
    name: name as any,
    execute: () => new Promise((res) => setTimeout(() => res({ output }), ms)),
  };
}

function collectEvents(): { events: StageEvent[]; emitEvent: (e: StageEvent) => void } {
  const events: StageEvent[] = [];
  return { events, emitEvent: (e: StageEvent) => { events.push(e); } };
}

// ---------- tests ----------
describe("Pipeline Runtime", () => {
  describe("runStage event emission", () => {
    it("emits START + SUCCESS for a successful stage", async () => {
      const { events, emitEvent } = collectEvents();
      const ctx = createStageContext({ emitEvent, stageTimeoutsMs: { VALIDATE: 5000 } });
      const stage = successStage("VALIDATE", { ok: true });

      const result = await runStage(stage, { q: "test" }, ctx);

      expect(result).toEqual({ ok: true });
      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe("START");
      expect(events[0].stage).toBe("VALIDATE");
      expect(events[0].input_hash).toBeTruthy();
      expect(events[1].event_type).toBe("SUCCESS");
      expect(events[1].duration_ms).toBeTypeOf("number");
      expect(events[1].output_hash).toBeTruthy();
    });

    it("emits START + FAILURE for a failed stage", async () => {
      const { events, emitEvent } = collectEvents();
      const ctx = createStageContext({ emitEvent, stageTimeoutsMs: { VALIDATE: 5000 } });
      const stage = failStage("VALIDATE", new Error("invalid input"));

      await expect(runStage(stage, {}, ctx)).rejects.toThrow();

      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe("START");
      expect(events[1].event_type).toBe("FAILURE");
      expect(events[1].error_category).toBe("VALIDATION");
      expect(events[1].error_code).toBe("VALIDATION:VALIDATE");
      expect(events[1].duration_ms).toBeTypeOf("number");
    });

    it("emits IDEMPOTENT on cache hit", async () => {
      const { events, emitEvent } = collectEvents();
      const ctx = createStageContext({ emitEvent, stageTimeoutsMs: { VALIDATE: 5000 } });
      const stage = successStage("VALIDATE", "first");

      await runStage(stage, { q: "same" }, ctx);
      const second = await runStage(stage, { q: "same" }, ctx);

      expect(second).toBe("first");
      expect(events).toHaveLength(3);
      expect(events[2].event_type).toBe("IDEMPOTENT");
    });
  });

  describe("StageError classification", () => {
    it("classifies timeout errors", async () => {
      const { events, emitEvent } = collectEvents();
      const ctx = createStageContext({ emitEvent, stageTimeoutsMs: { RETRIEVE_PROVIDERS: 250 } });
      const stage = slowStage("RETRIEVE_PROVIDERS", 500, null);

      await expect(runStage(stage, {}, ctx)).rejects.toThrow();

      const failEvent = events.find((e) => e.event_type === "FAILURE");
      expect(failEvent?.error_category).toBe("TIMEOUT");
    });

    it("classifies transient errors (rate limit)", async () => {
      const { events, emitEvent } = collectEvents();
      const ctx = createStageContext({ emitEvent, stageTimeoutsMs: { VALIDATE: 5000 } });
      const stage = failStage("VALIDATE", new Error("429 rate limit exceeded"));

      await expect(runStage(stage, {}, ctx)).rejects.toThrow();

      expect(events[1].error_category).toBe("TRANSIENT");
    });

    it("classifies external errors (fetch/network)", async () => {
      const { events, emitEvent } = collectEvents();
      const ctx = createStageContext({ emitEvent, stageTimeoutsMs: { VALIDATE: 5000 } });
      const stage = failStage("VALIDATE", new Error("fetch failed"));

      await expect(runStage(stage, {}, ctx)).rejects.toThrow();

      expect(events[1].error_category).toBe("EXTERNAL");
    });
  });

  describe("trace_id = run_id contract", () => {
    it("uses provided traceId and runId", () => {
      const ctx = createStageContext({ traceId: "abc", runId: "abc" });
      expect(ctx.traceId).toBe("abc");
      expect(ctx.runId).toBe("abc");
      expect(ctx.traceId).toBe(ctx.runId);
    });
  });
});

describe("hashKey determinism", () => {
  it("produces identical hash for identical input", () => {
    const a = hashKey('{"query":"test","year":2024}');
    const b = hashKey('{"query":"test","year":2024}');
    expect(a).toBe(b);
  });

  it("produces different hash for different input", () => {
    const a = hashKey('{"query":"test"}');
    const b = hashKey('{"query":"other"}');
    expect(a).not.toBe(b);
  });

  it("always returns 8-char hex", () => {
    for (const input of ["", "a", "longer string with spaces", '{"json":true}']) {
      const h = hashKey(input);
      expect(h).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe("Normalization", () => {
  it("normalizeDoi handles prefixes and case", async () => {
    const { normalizeDoi } = await import(
      "../../supabase/functions/research-async/providers/normalization.ts"
    );
    expect(normalizeDoi("https://doi.org/10.1000/ABC")).toBe("10.1000/abc");
    expect(normalizeDoi("https://dx.doi.org/10.1000/ABC")).toBe("10.1000/abc");
    expect(normalizeDoi("10.1000/abc")).toBe("10.1000/abc");
    expect(normalizeDoi(null)).toBeNull();
    expect(normalizeDoi(undefined)).toBeNull();
  });

  it("reconstructAbstract rebuilds from inverted index", async () => {
    const { reconstructAbstract } = await import(
      "../../supabase/functions/research-async/providers/normalization.ts"
    );
    expect(reconstructAbstract({ hello: [0], world: [1] })).toBe("hello world");
    expect(reconstructAbstract(undefined)).toBe("");
    expect(reconstructAbstract({})).toBe("");
  });
});

describe("Canonicalization dedup", () => {
  it("merges papers by normalized DOI", async () => {
    const { canonicalizePapers } = await import(
      "../../supabase/functions/_shared/lit-search.ts"
    );

    const papers = canonicalizePapers([
      {
        id: "oa-1", title: "Paper A", year: 2022, abstract: "Abstract A",
        authors: ["A"], venue: "J", doi: "10.1000/ABC", pubmed_id: null,
        openalex_id: "W1", source: "openalex" as const, citationCount: 10,
        publicationTypes: ["journal-article"], rank_signal: 1,
      },
      {
        id: "ss-1", title: "Paper A", year: 2022, abstract: "Abstract A",
        authors: ["A"], venue: "J", doi: "https://doi.org/10.1000/abc",
        pubmed_id: "PM1", openalex_id: null, source: "semantic_scholar" as const,
        citationCount: 15, publicationTypes: [], rank_signal: 2,
      },
    ]);

    expect(papers).toHaveLength(1);
    expect(papers[0].doi).toBe("10.1000/abc");
    expect(papers[0].provenance).toHaveLength(2);
    expect(papers[0].pubmed_id).toBe("PM1");
  });

  it("keeps papers with different DOIs separate", async () => {
    const { canonicalizePapers } = await import(
      "../../supabase/functions/_shared/lit-search.ts"
    );

    const papers = canonicalizePapers([
      {
        id: "a", title: "Paper A", year: 2022, abstract: "Abstract A",
        authors: ["A"], venue: "J", doi: "10.1000/a", pubmed_id: null,
        openalex_id: null, source: "openalex" as const, rank_signal: 1,
      },
      {
        id: "b", title: "Paper B", year: 2022, abstract: "Abstract B",
        authors: ["B"], venue: "J", doi: "10.1000/b", pubmed_id: null,
        openalex_id: null, source: "openalex" as const, rank_signal: 1,
      },
    ]);

    expect(papers).toHaveLength(2);
  });
});

describe("Deterministic extraction replay", () => {
  it("produces identical output hash for identical input", async () => {
    const { extractStudiesDeterministic } = await import(
      "../../supabase/functions/_shared/study-extraction.ts"
    );

    const input = {
      study_id: "replay-1",
      title: "Randomized melatonin trial",
      year: 2024,
      abstract: "Methods: 120 participants were randomized. Melatonin versus placebo improved sleep quality.",
      doi: "10.1000/replay",
      pubmed_id: null,
      openalex_id: null,
      source: "openalex" as const,
    };

    const run1 = await extractStudiesDeterministic([input]);
    const run2 = await extractStudiesDeterministic([input]);

    const hash1 = hashKey(JSON.stringify(run1.map((r) => r.study)));
    const hash2 = hashKey(JSON.stringify(run2.map((r) => r.study)));

    expect(hash1).toBe(hash2);
    expect(run1).toHaveLength(1);
    expect(run1[0].study.study_id).toBe("replay-1");
  });
});

describe("LLM schema validation", () => {
  it("applyCompletenessTiers classifies complete vs partial", async () => {
    const { applyCompletenessTiers } = await import(
      "../../supabase/functions/_shared/study-extraction.ts"
    );

    const complete = {
      study_id: "c1",
      title: "Complete Study",
      year: 2024,
      study_design: "RCT" as const,
      sample_size: 100,
      population: "Adults",
      outcomes: [{
        outcome_measured: "Blood pressure",
        key_result: "Reduced by 10mmHg",
        citation_snippet: "Significant reduction in blood pressure was observed",
        intervention: "Drug A",
        comparator: "Placebo",
        effect_size: "d=0.5",
        p_value: "p<0.01",
      }],
      citation: { doi: "10.1000/c1", pubmed_id: null, openalex_id: null, formatted: "Complete (2024)" },
      abstract_excerpt: "This study examined a randomized controlled trial with detailed methods.",
      preprint_status: "Peer-reviewed" as const,
      review_type: "None" as const,
      source: "openalex" as const,
    };

    const partial = {
      study_id: "p1",
      title: "Partial Study",
      year: 2024,
      study_design: "cohort" as const,
      sample_size: null,
      population: null,
      outcomes: [{
        outcome_measured: "Some outcome",
        key_result: null,
        citation_snippet: "Some snippet text here",
        intervention: null,
        comparator: null,
        effect_size: null,
        p_value: null,
      }],
      citation: { doi: null, pubmed_id: null, openalex_id: null, formatted: "Partial (2024)" },
      abstract_excerpt: "Brief.",
      preprint_status: "Peer-reviewed" as const,
      review_type: "None" as const,
      source: "openalex" as const,
    };

    const tiers = applyCompletenessTiers([complete, partial]);
    expect(tiers.complete.some((s) => s.study_id === "c1")).toBe(true);
    expect(tiers.partial.some((s) => s.study_id === "p1")).toBe(true);
  });
});
