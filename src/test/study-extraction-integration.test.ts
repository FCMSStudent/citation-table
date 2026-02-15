import { describe, expect, it } from "vitest";
import {
  applyCompletenessTiers,
  extractStudiesDeterministic,
  type DeterministicExtractionInput,
} from "../../supabase/functions/_shared/study-extraction.ts";

function makeInput(overrides: Partial<DeterministicExtractionInput> = {}): DeterministicExtractionInput {
  return {
    study_id: "study-1",
    title: "Randomized melatonin trial",
    year: 2024,
    abstract: "Methods: 120 participants were randomized. Melatonin versus placebo improved sleep quality.",
    doi: "10.1000/example",
    pubmed_id: null,
    openalex_id: null,
    source: "openalex",
    ...overrides,
  };
}

describe("study extraction integration", () => {
  it("uses pdf extractor when available and falls back to abstract parsing", async () => {
    const inputs: DeterministicExtractionInput[] = [
      makeInput({
        study_id: "pdf-study",
        pdf_url: "https://example.org/paper.pdf",
      }),
      makeInput({
        study_id: "abstract-study",
        title: "Cohort sleep association",
        source: "pubmed",
        abstract:
          "Methods: 240 participants were followed in a cohort study. Sleep duration was associated with daytime fatigue.",
        pdf_url: null,
      }),
    ];

    const mockFetch: typeof fetch = async () => {
      const body = {
        results: [
          {
            study_id: "pdf-study",
            study: {
              study_id: "pdf-study",
              title: "Randomized melatonin trial",
              year: 2024,
              study_design: "RCT",
              sample_size: 120,
              population: "120 participants",
              outcomes: [
                {
                  outcome_measured: "sleep quality",
                  key_result: "Melatonin versus placebo improved sleep quality (OR = 1.40) p = 0.02",
                  citation_snippet: "Melatonin versus placebo improved sleep quality (OR = 1.40) p = 0.02",
                  intervention: "Melatonin",
                  comparator: "placebo",
                  effect_size: "OR = 1.40",
                  p_value: "p = 0.02",
                },
              ],
              citation: {
                doi: "10.1000/example",
                pubmed_id: null,
                openalex_id: null,
                formatted: "Unknown (2024). Randomized melatonin trial.",
              },
              abstract_excerpt:
                "Randomized melatonin trial abstract excerpt with sufficient detail to exceed the completeness threshold used by strict filtering.",
              preprint_status: "Peer-reviewed",
              review_type: "None",
              source: "openalex",
              citationCount: 10,
              pdf_url: "https://example.org/paper.pdf",
              landing_page_url: null,
            },
            diagnostics: {
              engine: "pdf",
              used_pdf: true,
              fallback_reason: null,
              parse_error: null,
              outcome_confidence: [0.9],
            },
          },
        ],
      };

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const extracted = await extractStudiesDeterministic(inputs, {
      pdfExtractorUrl: "https://extractor.example.org",
      fetchImpl: mockFetch,
      pdfParseTimeoutMs: 5000,
    });

    expect(extracted).toHaveLength(2);
    const pdfStudy = extracted.find((entry) => entry.study.study_id === "pdf-study");
    const abstractStudy = extracted.find((entry) => entry.study.study_id === "abstract-study");

    expect(pdfStudy?.diagnostics.used_pdf).toBe(true);
    expect(pdfStudy?.diagnostics.engine).toBe("pdf");

    expect(abstractStudy?.diagnostics.used_pdf).toBe(false);
    expect(abstractStudy?.diagnostics.engine).toBe("abstract");
    expect(abstractStudy?.diagnostics.fallback_reason).toBe("missing_pdf_url");

    const tiers = applyCompletenessTiers(extracted.map((entry) => entry.study));
    expect(tiers.complete.some((study) => study.study_id === "pdf-study")).toBe(true);
    expect(tiers.partial.some((study) => study.study_id === "abstract-study")).toBe(true);
  });
});
