import { describe, it, expect } from "vitest";
import type { ResearchResponse, StudyResult } from "../types/research";

const picoDefaults = { intervention: null, comparator: null, effect_size: null, p_value: null };

describe("Research Retrieval Response Validation", () => {
  it("should validate ResearchResponse structure", () => {
    const response: ResearchResponse = { results: [], query: "test query", total_papers_searched: 0 };
    expect(response.results).toBeInstanceOf(Array);
    expect(response.query).toBe("test query");
  });

  it("should handle normalized query in response", () => {
    const response: ResearchResponse = {
      results: [], query: "effects of treatment", normalized_query: "reported outcomes associated with treatment",
      total_papers_searched: 10, openalex_count: 5, semantic_scholar_count: 5,
    };
    expect(response.normalized_query).toContain("reported outcomes");
  });

  it("should handle error responses", () => {
    const errorResponse: ResearchResponse = { results: [], query: "test", total_papers_searched: 0, error: "API error" };
    expect(errorResponse.error).toBeTruthy();
  });

  it("should validate source field in study results", () => {
    const study: StudyResult = {
      study_id: "test-123", title: "Test Study", year: 2023, study_design: "RCT", sample_size: 100, population: "Test population",
      outcomes: [{ outcome_measured: "Test outcome", key_result: "Test result", citation_snippet: "Test snippet", ...picoDefaults }],
      citation: { doi: "10.1234/test", pubmed_id: null, openalex_id: "https://openalex.org/W123", formatted: "Test (2023)" },
      abstract_excerpt: "Test abstract", preprint_status: "Peer-reviewed", review_type: "None", source: "openalex"
    };
    expect(study.source).toMatch(/^(openalex|semantic_scholar)$/);
  });

  it("should validate citation count from semantic scholar", () => {
    const study: StudyResult = {
      study_id: "test-456", title: "Test Study from S2", year: 2023, study_design: "cohort", sample_size: 200, population: "Test population",
      outcomes: [{ outcome_measured: "Test outcome", key_result: "Test result", citation_snippet: "Test snippet", ...picoDefaults }],
      citation: { doi: null, pubmed_id: "12345678", openalex_id: null, formatted: "Test (2023)" },
      abstract_excerpt: "Test abstract", preprint_status: "Preprint", review_type: "None", source: "semantic_scholar", citationCount: 42
    };
    expect(study.citationCount).toBe(42);
  });

  it("should validate multiple identifiers in citation", () => {
    const study: StudyResult = {
      study_id: "test-789", title: "Multi-ID Study", year: 2023, study_design: "RCT", sample_size: 150, population: "Test population",
      outcomes: [{ outcome_measured: "Test outcome", key_result: "Test result", citation_snippet: "Test snippet", ...picoDefaults }],
      citation: { doi: "10.1234/test", pubmed_id: "12345678", openalex_id: "https://openalex.org/W789", formatted: "Test et al. (2023). Multi-ID Study. Journal." },
      abstract_excerpt: "Test abstract", preprint_status: "Peer-reviewed", review_type: "None", source: "openalex"
    };
    expect(study.citation.doi).toBeTruthy();
    expect(study.citation.pubmed_id).toBeTruthy();
  });

  it("should validate review type classification", () => {
    const metaAnalysis: StudyResult = {
      study_id: "test-meta", title: "Meta-Analysis Study", year: 2023, study_design: "review", sample_size: null, population: null,
      outcomes: [{ outcome_measured: "Pooled outcome", key_result: "Combined result", citation_snippet: "Meta-analysis shows", ...picoDefaults }],
      citation: { doi: "10.1234/meta", pubmed_id: null, openalex_id: null, formatted: "Meta (2023)" },
      abstract_excerpt: "Meta-analysis abstract", preprint_status: "Peer-reviewed", review_type: "Meta-analysis", source: "openalex"
    };
    expect(metaAnalysis.review_type).toBe("Meta-analysis");
  });

  it("should handle null sample size and population", () => {
    const study: StudyResult = {
      study_id: "test-null", title: "Study with Nulls", year: 2023, study_design: "unknown", sample_size: null, population: null,
      outcomes: [{ outcome_measured: "Test outcome", key_result: null, citation_snippet: "Test snippet", ...picoDefaults }],
      citation: { doi: null, pubmed_id: null, openalex_id: null, formatted: "Unknown (2023)" },
      abstract_excerpt: "Test abstract", preprint_status: "Peer-reviewed", review_type: "None", source: "semantic_scholar"
    };
    expect(study.sample_size).toBeNull();
    expect(study.population).toBeNull();
    expect(study.outcomes[0].key_result).toBeNull();
  });
});
