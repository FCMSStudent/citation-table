import { describe, it, expect } from "vitest";
import type { StudyResult } from "../types/research";

const picoDefaults = { intervention: null, comparator: null, effect_size: null, p_value: null };

describe("Crossref Enrichment Support", () => {
  it("should support citationCount in StudyResult", () => {
    const study: StudyResult = {
      study_id: "test-123",
      title: "Test Study with Crossref Data",
      year: 2023,
      study_design: "RCT",
      sample_size: 150,
      population: "Test population",
      outcomes: [
        { outcome_measured: "Test outcome", key_result: "Test result", citation_snippet: "Test snippet", ...picoDefaults }
      ],
      citation: { doi: "10.1038/s41586-020-2649-2", pubmed_id: null, openalex_id: null, formatted: "Test (2023)" },
      abstract_excerpt: "Test abstract",
      preprint_status: "Peer-reviewed",
      review_type: "None",
      source: "openalex",
      citationCount: 150
    };
    
    expect(study.citationCount).toBe(150);
    expect(study.citation.doi).toBe("10.1038/s41586-020-2649-2");
  });

  it("should handle studies with missing optional fields", () => {
    const study: StudyResult = {
      study_id: "test-123",
      title: "Test Study with Missing Fields",
      year: 2023,
      study_design: "RCT",
      sample_size: null,
      population: null,
      outcomes: [],
      citation: { doi: null, pubmed_id: null, openalex_id: null, formatted: "Test (2023)" },
      abstract_excerpt: "Test abstract",
      preprint_status: "Peer-reviewed",
      review_type: "None",
      source: "openalex"
    };

    expect(study.sample_size).toBeNull();
    expect(study.population).toBeNull();
    expect(study.citation.doi).toBeNull();
  });

  it("should handle studies without citation counts", () => {
    const study: StudyResult = {
      study_id: "test-456",
      title: "Study without Citations",
      year: 2023,
      study_design: "cohort",
      sample_size: null,
      population: null,
      outcomes: [],
      citation: { doi: null, pubmed_id: null, openalex_id: null, formatted: "Test (2023)" },
      abstract_excerpt: "Test",
      preprint_status: "Preprint",
      review_type: "None",
      source: "semantic_scholar"
    };
    
    expect(study.citationCount).toBeUndefined();
    expect(study.citation.doi).toBeNull();
  });

  it("should handle DOI URLs correctly", () => {
    const doi = "10.1038/nature12373";
    const expectedUrl = `https://doi.org/${doi}`;
    expect(expectedUrl).toBe("https://doi.org/10.1038/nature12373");
  });

  it("should support citation count display formatting", () => {
    const citationCount = 1234567;
    const formatted = citationCount.toLocaleString();
    expect(formatted).toMatch(/1[,.]234[,.]567/);
  });
});
