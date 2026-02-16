import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("research provider wiring smoke", () => {
  it("keeps provider invocation order in centralized provider registry", () => {
    const filePath = path.resolve(process.cwd(), "supabase/functions/research-async/providers/catalog.ts");
    const content = fs.readFileSync(filePath, "utf8");

    const semanticPos = content.indexOf('name: "semantic_scholar"');
    const openalexPos = content.indexOf('name: "openalex"');
    const arxivPos = content.indexOf('name: "arxiv"');
    const pubmedPos = content.indexOf('name: "pubmed"');

    expect(semanticPos).toBeGreaterThan(-1);
    expect(openalexPos).toBeGreaterThan(semanticPos);
    expect(arxivPos).toBeGreaterThan(openalexPos);
    expect(pubmedPos).toBeGreaterThan(arxivPos);
  });

  it("routes research-async through the centralized provider pipeline", () => {
    const filePath = path.resolve(process.cwd(), "supabase/functions/research-async/index.ts");
    const content = fs.readFileSync(filePath, "utf8");

    expect(content).toContain("runProviderPipeline(");
    expect(content).not.toContain("retryProviderSearch(");
  });
});
