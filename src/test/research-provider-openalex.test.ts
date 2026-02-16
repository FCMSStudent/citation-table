import { beforeEach, describe, expect, it, vi } from "vitest";
import { expandOpenAlexCitationGraph, searchOpenAlex } from "../../supabase/functions/research-async/providers/openalex.ts";
import type { UnifiedPaper } from "../../supabase/functions/research-async/providers/types.ts";

function mockEnv(values: Record<string, string | undefined>) {
  (globalThis as any).Deno = {
    env: {
      get: (name: string) => values[name],
    },
  };
}

describe("research provider: openalex", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockEnv({ OPENALEX_API_KEY: "openalex-key" });
  });

  it("maps OpenAlex works into unified papers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: "https://openalex.org/W123",
            title: "OpenAlex Study",
            publication_year: 2021,
            abstract_inverted_index: { hello: [0], world: [1] },
            authorships: [{ author: { display_name: "Alice" } }],
            primary_location: { source: { display_name: "Nature" } },
            best_oa_location: { pdf_url: "https://example.com/paper.pdf", landing_page_url: "https://example.com" },
            doi: "https://doi.org/10.1000/ABC",
            type: "preprint",
            cited_by_count: 42,
            referenced_works: ["https://openalex.org/WX"],
            is_retracted: false,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const papers = await searchOpenAlex("blood pressure", "balanced");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const searchUrl = String(fetchMock.mock.calls[0][0]);
    expect(searchUrl).toContain("per-page=25");
    expect(searchUrl).toContain("select=");
    expect(papers).toHaveLength(1);
    expect(papers[0].doi).toBe("10.1000/abc");
    expect(papers[0].abstract).toBe("hello world");
    expect(papers[0].preprint_status).toBe("Preprint");
    expect(papers[0].source).toBe("openalex");
  });

  it("expands references and keeps only papers with usable abstracts", async () => {
    const seed: UnifiedPaper[] = [
      {
        id: "seed-1",
        title: "Seed",
        year: 2020,
        abstract: "seed abstract",
        authors: ["A"],
        venue: "J",
        doi: null,
        pubmed_id: null,
        openalex_id: "WSEED",
        source: "openalex",
        referenced_ids: ["https://openalex.org/WGOOD", "https://openalex.org/WBAD"],
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: "https://openalex.org/WGOOD",
            title: "Good",
            publication_year: 2019,
            abstract_inverted_index: { long: [0], enough: [1], abstract: [2], words: [3], here: [4], now: [5], yes: [6], ok: [7], more: [8], text: [9], one: [10], two: [11] },
          },
          {
            id: "https://openalex.org/WBAD",
            title: "Bad",
            publication_year: 2019,
            abstract_inverted_index: { short: [0] },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const expanded = await expandOpenAlexCitationGraph(seed, 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const expansionUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(expansionUrl.searchParams.get("filter")).toBe("openalex_id:WGOOD|WBAD");
    expect(expansionUrl.searchParams.get("per-page")).toBe("2");
    expect(expanded).toHaveLength(1);
    expect(expanded[0].id).toBe("https://openalex.org/WGOOD");
  });
});
