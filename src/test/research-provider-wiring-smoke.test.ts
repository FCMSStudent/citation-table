import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("research provider wiring smoke", () => {
  it("keeps provider invocation order in research-async pipeline", () => {
    const filePath = path.resolve(process.cwd(), "supabase/functions/research-async/index.ts");
    const content = fs.readFileSync(filePath, "utf8");

    const semanticPos = content.indexOf('retryProviderSearch("semantic_scholar"');
    const openalexPos = content.indexOf('retryProviderSearch("openalex"');
    const arxivPos = content.indexOf('retryProviderSearch("arxiv"');
    const pubmedPos = content.indexOf('retryProviderSearch("pubmed"');

    expect(semanticPos).toBeGreaterThan(-1);
    expect(openalexPos).toBeGreaterThan(semanticPos);
    expect(arxivPos).toBeGreaterThan(openalexPos);
    expect(pubmedPos).toBeGreaterThan(arxivPos);
  });
});
