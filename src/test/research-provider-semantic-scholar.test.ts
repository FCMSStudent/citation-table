import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchSemanticScholar } from "../../supabase/functions/research-async/providers/semantic-scholar.ts";

function mockEnv(values: Record<string, string | undefined>) {
  (globalThis as any).Deno = {
    env: {
      get: (name: string) => values[name],
    },
  };
}

describe("research provider: semantic scholar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockEnv({ SEMANTIC_SCHOLAR_API_KEY: "s2-key" });
  });

  it("maps fields and applies API key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            paperId: "S2-1",
            title: "Semantic Study",
            abstract: "This abstract is definitely longer than fifty characters and should pass filtering.",
            year: 2022,
            authors: [{ authorId: "a1", name: "Author One" }],
            venue: "Journal",
            citationCount: 8,
            publicationTypes: ["JournalArticle"],
            externalIds: { DOI: "10.1000/s2", PubMed: "123" },
            openAccessPdf: { url: "https://example.com/s2.pdf" },
            url: "https://example.com/s2",
            isRetracted: false,
            references: [{ paperId: "R1" }],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const papers = await searchSemanticScholar("trial outcomes", "balanced");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "s2-key" });
    expect(papers).toHaveLength(1);
    expect(papers[0].source).toBe("semantic_scholar");
    expect(papers[0].pubmed_id).toBe("123");
  });

  it("supports back-to-back calls with throttle", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await searchSemanticScholar("q1", "balanced");
    const started = Date.now();
    await searchSemanticScholar("q2", "balanced");
    const elapsed = Date.now() - started;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });
});
