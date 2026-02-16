import { describe, expect, it } from "vitest";
import { buildSourceQuery, resolvePreparedQuery } from "../../supabase/functions/research-async/providers/query-builder.ts";

describe("research query builder", () => {
  it("builds source-specific query styles", () => {
    const semantic = buildSourceQuery("blood pressure", "semantic_scholar", "balanced");
    const openalex = buildSourceQuery("blood pressure", "openalex", "balanced");

    expect(semantic.apiQuery).toContain("OR");
    expect(openalex.apiQuery).toContain("blood pressure");
  });

  it("respects precompiled source query override", () => {
    const resolved = resolvePreparedQuery("ignored", "pubmed", "balanced", "hypertension[Title/Abstract]");
    expect(resolved.apiQuery).toBe("hypertension[Title/Abstract]");
    expect(resolved.expandedKeywordQuery).toBe("hypertension[Title/Abstract]");
  });
});
