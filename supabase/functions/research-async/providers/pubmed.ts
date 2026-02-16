import type { ExpansionMode, UnifiedPaper } from "./types.ts";
import { resolvePreparedQuery } from "./query-builder.ts";

export async function searchPubMed(
  query: string,
  mode: ExpansionMode = "balanced",
  precompiledQuery?: string,
): Promise<UnifiedPaper[]> {
  const prepared = resolvePreparedQuery(query, "pubmed", mode, precompiledQuery);
  if (!prepared.apiQuery) return [];

  const encodedQuery = encodeURIComponent(prepared.apiQuery);
  console.log(
    `[PubMed] Searching original="${prepared.originalKeywordQuery}" expanded="${prepared.expandedKeywordQuery}" api="${prepared.apiQuery}"`,
  );

  try {
    const ncbiApiKey = Deno.env.get("NCBI_API_KEY");
    const apiKeyParam = ncbiApiKey ? `&api_key=${ncbiApiKey}` : "";
    if (ncbiApiKey) console.log("[PubMed] Using NCBI API key for enhanced rate limits");

    const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodedQuery}&retmax=25&retmode=json${apiKeyParam}`;
    const esearchRes = await fetch(esearchUrl);
    if (!esearchRes.ok) {
      console.error(`[PubMed] ESearch error: ${esearchRes.status}`);
      return [];
    }

    const esearchData = await esearchRes.json();
    const pmids: string[] = esearchData?.esearchresult?.idlist || [];
    if (pmids.length === 0) {
      console.log("[PubMed] No results found");
      return [];
    }
    console.log(`[PubMed] ESearch returned ${pmids.length} PMIDs`);

    await new Promise((resolve) => setTimeout(resolve, 350));

    const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmids.join(",")}&rettype=xml${apiKeyParam}`;
    const efetchRes = await fetch(efetchUrl);
    if (!efetchRes.ok) {
      console.error(`[PubMed] EFetch error: ${efetchRes.status}`);
      return [];
    }

    const xmlText = await efetchRes.text();
    const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
    const papers: UnifiedPaper[] = [];
    let match: RegExpExecArray | null;

    while ((match = articleRegex.exec(xmlText)) !== null) {
      const article = match[1];

      const getTag = (tag: string, context: string = article): string => {
        const tagMatch = context.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return tagMatch ? tagMatch[1].trim().replace(/\s+/g, " ") : "";
      };

      const pmid = getTag("PMID");
      let title = getTag("ArticleTitle");
      title = title.replace(/<[^>]+>/g, "");
      if (!title) continue;

      let abstract = "";
      const abstractSection = article.match(/<Abstract>([\s\S]*?)<\/Abstract>/);
      if (abstractSection) {
        const abstractTextRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
        const parts: string[] = [];
        let abstractMatch: RegExpExecArray | null;
        while ((abstractMatch = abstractTextRegex.exec(abstractSection[1])) !== null) {
          parts.push(abstractMatch[1].trim().replace(/<[^>]+>/g, ""));
        }
        abstract = parts.join(" ").replace(/\s+/g, " ").trim();
      }
      if (abstract.length < 50) continue;

      let year = new Date().getFullYear();
      const pubDateMatch = article.match(/<PubDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/);
      if (pubDateMatch) year = parseInt(pubDateMatch[1], 10);
      else {
        const articleDateMatch = article.match(/<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/);
        if (articleDateMatch) year = parseInt(articleDateMatch[1], 10);
      }

      const authorRegex = /<Author[^>]*>[\s\S]*?<LastName>([^<]+)<\/LastName>[\s\S]*?<ForeName>([^<]*)<\/ForeName>/g;
      const authors: string[] = [];
      let authorMatch: RegExpExecArray | null;
      while ((authorMatch = authorRegex.exec(article)) !== null) {
        authors.push(`${authorMatch[2].trim()} ${authorMatch[1].trim()}`);
      }

      let doi: string | null = null;
      const doiMatch = article.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/);
      if (doiMatch) doi = doiMatch[1].trim();

      const journal = getTag("Title");
      papers.push({
        id: pmid,
        title,
        year,
        abstract,
        authors: authors.length > 0 ? authors : ["Unknown"],
        venue: journal,
        doi,
        pubmed_id: pmid,
        openalex_id: null,
        source: "pubmed" as const,
        citationCount: undefined,
        publicationTypes: undefined,
        journal,
        preprint_status: "Peer-reviewed",
        rank_signal: 1 / (papers.length + 1),
      });
    }

    console.log(`[PubMed] Found ${papers.length} papers`);
    return papers;
  } catch (error) {
    console.error("[PubMed] Error:", error);
    return [];
  }
}
