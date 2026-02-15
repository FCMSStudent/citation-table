import { describe, it, expect } from "vitest";
import type { StudyResult, Outcome, Citation } from "../shared/types/research";

describe("Research Types", () => {
  it("should have valid Outcome structure", () => {
    const outcome: Outcome = {
      outcome_measured: "Pain score",
      key_result: "Mean reduction of 2.5 points (95% CI: 1.8-3.2, p<0.001)",
      citation_snippet: "Pain scores decreased significantly in the treatment group",
      intervention: "Treatment A",
      comparator: "Placebo",
      effect_size: "d = 0.45",
      p_value: "p < 0.001",
    };
    
    expect(outcome.outcome_measured).toBe("Pain score");
    expect(outcome.key_result).toBeTruthy();
    expect(outcome.citation_snippet).toBeTruthy();
    expect(outcome.intervention).toBe("Treatment A");
    expect(outcome.effect_size).toBe("d = 0.45");
  });

  it("should have valid Citation structure", () => {
    const citation: Citation = {
      doi: "10.1234/test",
      pubmed_id: "12345678",
      openalex_id: "https://openalex.org/W123",
      formatted: "Test (2023)"
    };
    
    expect(citation.doi).toBe("10.1234/test");
    expect(citation.pubmed_id).toBe("12345678");
    expect(citation.openalex_id).toBe("https://openalex.org/W123");
  });

  it("should have valid StudyResult structure with multiple outcomes", () => {
    const study: StudyResult = {
      study_id: "test-123",
      title: "Test Study",
      year: 2023,
      study_design: "RCT",
      sample_size: 150,
      population: "Adults aged 18-65 with chronic pain",
      outcomes: [
        {
          outcome_measured: "Pain reduction",
          key_result: "Significant reduction observed",
          citation_snippet: "Pain reduced by 50%",
          intervention: null,
          comparator: null,
          effect_size: null,
          p_value: null,
        }
      ],
      citation: {
        doi: "10.1234/test",
        pubmed_id: null,
        openalex_id: "https://openalex.org/W123",
        formatted: "Test (2023)"
      },
      abstract_excerpt: "This study examined...",
      preprint_status: "Peer-reviewed",
      review_type: "None",
      source: "pubmed",
      citationCount: 42
    };
    
    expect(study.outcomes).toBeInstanceOf(Array);
    expect(study.outcomes.length).toBeGreaterThan(0);
    expect(study.preprint_status).toBe("Peer-reviewed");
    expect(study.source).toBe("pubmed");
  });

  it("should allow multiple outcomes per study", () => {
    const outcomes: Outcome[] = [
      {
        outcome_measured: "Primary outcome",
        key_result: "Result 1",
        citation_snippet: "Snippet 1",
        intervention: "Drug A",
        comparator: "Placebo",
        effect_size: "OR = 2.1",
        p_value: "p = 0.03",
      },
      {
        outcome_measured: "Secondary outcome",
        key_result: null,
        citation_snippet: "Snippet 2",
        intervention: null,
        comparator: null,
        effect_size: null,
        p_value: null,
      }
    ];
    
    expect(outcomes.length).toBe(2);
    expect(outcomes[1].key_result).toBeNull();
  });
});

