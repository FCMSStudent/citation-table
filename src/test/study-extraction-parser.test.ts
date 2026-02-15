import { describe, expect, it } from "vitest";
import {
  __test_only_classifyStudyDesign,
  __test_only_extractOutcomes,
  __test_only_extractSampleSize,
} from "../../supabase/functions/_shared/study-extraction.ts";

describe("study extraction parser", () => {
  it("classifies common study designs", () => {
    expect(__test_only_classifyStudyDesign("Randomized controlled trial with parallel groups")).toBe("RCT");
    expect(__test_only_classifyStudyDesign("Prospective cohort follow-up of adults")).toBe("cohort");
    expect(__test_only_classifyStudyDesign("Cross-sectional survey of adolescents")).toBe("cross-sectional");
    expect(__test_only_classifyStudyDesign("Systematic review and meta-analysis")).toBe("review");
  });

  it("extracts sample size from common patterns", () => {
    expect(__test_only_extractSampleSize("Methods: n=150 adults were enrolled.")).toBe(150);
    expect(__test_only_extractSampleSize("A total of 420 participants completed follow-up.")).toBe(420);
    expect(__test_only_extractSampleSize("No clear enrollment count in abstract.")).toBeNull();
  });

  it("extracts outcomes with effect sizes and p-values", () => {
    const duplicateSentence =
      "Melatonin versus placebo improved sleep quality (OR = 1.45) with p = 0.02.";
    const parsed = __test_only_extractOutcomes(
      `${duplicateSentence} ${duplicateSentence}`,
    );

    expect(parsed.outcomes.length).toBe(1);
    expect(parsed.outcomes[0].effect_size).toContain("OR = 1.45");
    expect(parsed.outcomes[0].p_value).toContain("p = 0.02");
    expect(parsed.outcomes[0].intervention).toBeTruthy();
    expect(parsed.outcomes[0].comparator).toBeTruthy();
    expect(parsed.confidence[0]).toBeGreaterThan(0.5);
  });
});
