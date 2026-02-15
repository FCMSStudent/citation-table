import { describe, expect, it } from "vitest";
import {
  applyQualityFilter,
  buildEvidenceAndBrief,
  canonicalizePapers,
  sanitizeSearchRequest,
  type InputPaper,
} from "../../supabase/functions/_shared/lit-search.ts";

function paper(overrides: Partial<InputPaper> = {}): InputPaper {
  return {
    id: "seed-1",
    title: "Randomized trial improved outcomes in adults",
    year: 2022,
    abstract: "Methods: 200 participants were randomized. The intervention improved outcomes compared with control.",
    authors: ["A. Author"],
    venue: "Journal",
    doi: "10.1000/abc",
    pubmed_id: null,
    openalex_id: null,
    source: "openalex",
    citationCount: 40,
    publicationTypes: ["journal-article"],
    rank_signal: 1,
    ...overrides,
  };
}

describe("lit-search shared pipeline", () => {
  it("canonicalizes DOI duplicates and keeps provenance", () => {
    const canonical = canonicalizePapers([
      paper({ id: "oa-1", source: "openalex", doi: "10.1000/abc" }),
      paper({ id: "pm-1", source: "pubmed", doi: "https://doi.org/10.1000/abc", pubmed_id: "12345" }),
    ]);

    expect(canonical).toHaveLength(1);
    expect(canonical[0].doi).toBe("10.1000/abc");
    expect(canonical[0].provenance.length).toBe(2);
  });

  it("applies hard quality rejection rules", () => {
    const candidates = canonicalizePapers([
      paper({ id: "good", doi: "10.1000/good" }),
      paper({
        id: "retracted",
        doi: "10.1000/retracted",
        title: "Retracted trial",
        is_retracted: true,
      }),
      paper({
        id: "weak",
        doi: "10.1000/weak",
        abstract: "Study report without methods details.",
        publicationTypes: ["editorial"],
      }),
    ]);

    const { kept, filtered_count } = applyQualityFilter(candidates, {
      from_year: 1900,
      to_year: 2100,
      languages: ["en"],
      exclude_preprints: false,
    }, [1900, 2100]);

    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(filtered_count).toBeGreaterThanOrEqual(1);
    expect(kept.every((item) => !item.quality.hard_rejected)).toBe(true);
  });

  it("builds brief sentences with sentence-level citation anchors", () => {
    const candidates = canonicalizePapers([
      paper({
        id: "pos",
        doi: "10.1000/pos",
        abstract: "Methods: randomized trial. The intervention increased response rates among adults.",
      }),
      paper({
        id: "neg",
        doi: "10.1000/neg",
        abstract: "Methods: randomized trial. The intervention decreased response rates among adults.",
      }),
    ]);

    const { kept } = applyQualityFilter(candidates, {
      from_year: 1900,
      to_year: 2100,
      languages: ["en"],
      exclude_preprints: false,
    }, [1900, 2100]);

    const payload = buildEvidenceAndBrief(kept, 20);
    expect(payload.evidence_table.length).toBeGreaterThan(0);
    expect(payload.brief.sentences.length).toBeGreaterThan(0);
    expect(payload.brief.sentences.every((sentence) => sentence.citations.length > 0)).toBe(true);
  });

  it("sanitizes incoming search payload", () => {
    const request = sanitizeSearchRequest({
      query: "trial outcomes",
      max_candidates: 6000,
      max_evidence_rows: 1,
      filters: {
        from_year: 1800,
        to_year: 2400,
        languages: [],
        exclude_preprints: false,
      },
      response_mode: "evidence_table_brief",
      domain: "auto",
    });

    expect(request.max_candidates).toBe(5000);
    expect(request.max_evidence_rows).toBe(10);
    expect(request.filters.from_year).toBe(1900);
    expect(request.filters.to_year).toBe(2100);
    expect(request.filters.languages).toEqual(["en"]);
  });
});
