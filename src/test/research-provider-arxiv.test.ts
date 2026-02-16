import { describe, expect, it, vi } from "vitest";
import { searchArxiv } from "../../supabase/functions/research-async/providers/arxiv.ts";

describe("research provider: arxiv", () => {
  it("parses arxiv XML and normalizes IDs", async () => {
    const xml = `
      <feed>
        <entry>
          <id>https://arxiv.org/abs/1234.5678v2</id>
          <title>Arxiv Study</title>
          <published>2020-05-01T00:00:00Z</published>
          <summary>This is a sufficiently long abstract that should pass minimum length requirements in the parser.</summary>
          <author><name>Jane Doe</name></author>
          <arxiv:doi>10.1000/arxiv.1</arxiv:doi>
        </entry>
      </feed>
    `;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => xml }));

    const papers = await searchArxiv("sleep deprivation", "balanced");
    expect(papers).toHaveLength(1);
    expect(papers[0].id).toBe("1234.5678");
    expect(papers[0].doi).toBe("10.1000/arxiv.1");
    expect(papers[0].source).toBe("arxiv");
    expect(papers[0].preprint_status).toBe("Preprint");
  });
});
