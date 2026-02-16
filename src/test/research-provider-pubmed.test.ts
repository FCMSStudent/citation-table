import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchPubMed } from "../../supabase/functions/research-async/providers/pubmed.ts";

function mockEnv(values: Record<string, string | undefined>) {
  (globalThis as any).Deno = {
    env: {
      get: (name: string) => values[name],
    },
  };
}

describe("research provider: pubmed", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockEnv({ NCBI_API_KEY: "ncbi-key" });
  });

  it("performs ESearch + EFetch and parses structured abstracts", async () => {
    const efetchXml = `
      <PubmedArticleSet>
        <PubmedArticle>
          <PMID>12345</PMID>
          <ArticleTitle>PubMed <i>Study</i></ArticleTitle>
          <Abstract>
            <AbstractText>Background text that is long enough to pass the parser threshold.</AbstractText>
            <AbstractText>Methods text with more detailed content to ensure minimum size.</AbstractText>
          </Abstract>
          <PubDate><Year>2018</Year></PubDate>
          <Author><LastName>Doe</LastName><ForeName>Jane</ForeName></Author>
          <ArticleId IdType="doi">10.1000/pubmed.1</ArticleId>
          <Title>Medical Journal</Title>
        </PubmedArticle>
      </PubmedArticleSet>
    `;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ esearchresult: { idlist: ["12345"] } }) })
      .mockResolvedValueOnce({ ok: true, text: async () => efetchXml });

    vi.stubGlobal("fetch", fetchMock);

    const papers = await searchPubMed("blood pressure", "balanced");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(papers).toHaveLength(1);
    expect(papers[0].id).toBe("12345");
    expect(papers[0].doi).toBe("10.1000/pubmed.1");
    expect(papers[0].year).toBe(2018);
    expect(papers[0].source).toBe("pubmed");
    expect(papers[0].abstract.length).toBeGreaterThan(50);
  });

  it("returns empty when ESearch finds nothing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ esearchresult: { idlist: [] } }) }));
    const papers = await searchPubMed("no hits", "balanced");
    expect(papers).toEqual([]);
  });
});
