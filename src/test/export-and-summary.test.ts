import { describe, it, expect } from "vitest";
import { generateRISFile } from "../lib/risExport";
import { generateNarrativeSummary } from "../lib/narrativeSummary";
import type { StudyResult } from "../types/research";

const picoDefaults = { intervention: null, comparator: null, effect_size: null, p_value: null };

describe("RIS Export", () => {
  const mockStudy: StudyResult = {
    study_id: "test-123",
    title: "Pain Management Study",
    year: 2023,
    study_design: "RCT",
    sample_size: 150,
    population: "Adults with chronic pain",
    outcomes: [
      { outcome_measured: "Pain score", key_result: "Mean reduction 2.5 points", citation_snippet: "Pain scores decreased significantly", ...picoDefaults }
    ],
    citation: { doi: "10.1234/test", pubmed_id: "12345678", openalex_id: "https://openalex.org/W123", formatted: "Smith et al. (2023). Pain Management Study. Nature Medicine." },
    abstract_excerpt: "This study examined pain management...",
    preprint_status: "Peer-reviewed",
    review_type: "None",
    source: "openalex",
    citationCount: 42
  };

  it("should generate valid RIS format", () => {
    const ris = generateRISFile([mockStudy]);
    expect(ris).toContain("TY  - JOUR");
    expect(ris).toContain("TI  - Pain Management Study");
    expect(ris).toContain("PY  - 2023");
    expect(ris).toContain("DO  - 10.1234/test");
    expect(ris).toContain("PM  - 12345678");
    expect(ris).toContain("ER  - ");
  });

  it("should handle multiple studies", () => {
    const studies = [mockStudy, { ...mockStudy, study_id: "test-456" }];
    const ris = generateRISFile(studies);
    const erCount = (ris.match(/ER {2}- /g) || []).length;
    expect(erCount).toBe(2);
  });
});

describe("Narrative Summary", () => {
  const mockStudies: StudyResult[] = [
    {
      study_id: "test-1",
      title: "Study 1",
      year: 2023,
      study_design: "RCT",
      sample_size: 100,
      population: "Adults aged 18-65",
      outcomes: [
        { outcome_measured: "Primary outcome", key_result: "Significant improvement observed", citation_snippet: "The treatment group showed improvement", ...picoDefaults }
      ],
      citation: { doi: null, pubmed_id: null, openalex_id: null, formatted: "Smith et al. (2023). Study 1. Journal." },
      abstract_excerpt: "Abstract...",
      preprint_status: "Peer-reviewed",
      review_type: "None",
      source: "openalex"
    },
    {
      study_id: "test-2",
      title: "Study 2",
      year: 2022,
      study_design: "cohort",
      sample_size: 200,
      population: "Children aged 5-12",
      outcomes: [
        { outcome_measured: "Secondary outcome", key_result: "No significant change noted in primary endpoints", citation_snippet: "No significant change noted", ...picoDefaults }
      ],
      citation: { doi: null, pubmed_id: null, openalex_id: null, formatted: "Jones et al. (2022). Study 2. Journal." },
      abstract_excerpt: "Abstract...",
      preprint_status: "Preprint",
      review_type: "None",
      source: "semantic_scholar",
      citationCount: 5
    }
  ];

  it("should generate summary with study count", () => {
    const summary = generateNarrativeSummary(mockStudies, "test query");
    expect(summary).toContain("2 studies");
    expect(summary).toContain("test query");
  });

  it("should distinguish preprints from peer-reviewed", () => {
    const summary = generateNarrativeSummary(mockStudies, "test query");
    expect(summary).toContain("peer-reviewed");
    expect(summary).toContain("preprint");
  });

  it("should include inline citations", () => {
    const summary = generateNarrativeSummary(mockStudies, "test query");
    expect(summary).toMatch(/Smith.*2023/);
    expect(summary).toMatch(/Jones.*2022/);
  });

  it("should handle empty results", () => {
    const summary = generateNarrativeSummary([], "test query");
    expect(summary).toContain("No studies");
  });

  it("should paraphrase without causal language", () => {
    const summary = generateNarrativeSummary(mockStudies, "test query");
    expect(summary).not.toContain(" caused ");
    expect(summary).not.toContain(" led to ");
  });

  it("should not replace 'because' when removing causal language", () => {
    const studyWithBecause: StudyResult = {
      ...mockStudies[0],
      outcomes: [{ outcome_measured: "Test outcome", key_result: "Effect observed because of treatment", citation_snippet: "Test", ...picoDefaults }]
    };
    const summary = generateNarrativeSummary([studyWithBecause], "test query");
    expect(summary).toContain("because");
  });

  it("should handle null or undefined citation.formatted", () => {
    const studyWithNullCitation: StudyResult = {
      ...mockStudies[0],
      citation: { doi: null, pubmed_id: null, openalex_id: null, formatted: null }
    };
    expect(() => generateNarrativeSummary([studyWithNullCitation], "test query")).not.toThrow();
    const summary = generateNarrativeSummary([studyWithNullCitation], "test query");
    expect(summary).toContain("Unknown");
  });
});
