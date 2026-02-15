import { describe, expect, it } from "vitest";
import { prepareQueryProcessingV2 } from "../../supabase/functions/_shared/query-processing.ts";

type BenchmarkCase = {
  query: string;
  expected: string[];
  forbidden: string[];
};

const CASES: BenchmarkCase[] = [
  {
    query: "What are the effects of sleep deprivation on cognitive performance?",
    expected: ["sleep deprivation", "cognitive performance"],
    forbidden: ["anti-vaccine"],
  },
  {
    query: "blood pressure not improved without exercise versus medication",
    expected: ["blood pressure", "not", "without", "vs"],
    forbidden: ["anti-vaccine"],
  },
  {
    query: "How does vaccine hesitancy influence uptake?",
    expected: ["vaccine hesitancy"],
    forbidden: ["anti-vaccine"],
  },
];

describe("Query Processing V2 Golden Benchmark", () => {
  it("satisfies expected concept coverage and avoids forbidden concepts", async () => {
    const outcomes = await Promise.all(
      CASES.map(async (entry) => {
        const processed = await prepareQueryProcessingV2(entry.query, {
          llmApiKey: "",
          confidenceThreshold: 0,
        });

        const corpus = [
          processed.normalized_query.toLowerCase(),
          ...processed.query_terms.map((t) => t.toLowerCase()),
          ...processed.expanded_terms.map((t) => t.toLowerCase()),
          ...Object.values(processed.query_processing.source_queries).map((q) => q.toLowerCase()),
        ].join(" | ");

        const matchedExpected = entry.expected.filter((token) => corpus.includes(token.toLowerCase()));
        const matchedForbidden = entry.forbidden.filter((token) => corpus.includes(token.toLowerCase()));

        return {
          query: entry.query,
          expectedCount: entry.expected.length,
          matchedExpected,
          matchedForbidden,
          pass: matchedExpected.length === entry.expected.length && matchedForbidden.length === 0,
        };
      }),
    );

    const failed = outcomes.filter((o) => !o.pass);
    expect(
      failed,
      failed.length > 0
        ? `Benchmark failures:\n${failed
            .map((f) => `${f.query}\nexpected=${f.expectedCount} matched=${f.matchedExpected.length} forbidden=${f.matchedForbidden.join(",")}`)
            .join("\n\n")}`
        : undefined,
    ).toHaveLength(0);
  });
});
