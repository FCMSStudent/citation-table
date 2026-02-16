export { searchOpenAlex, expandOpenAlexCitationGraph } from "./openalex.ts";
export { searchSemanticScholar } from "./semantic-scholar.ts";
export { searchArxiv } from "./arxiv.ts";
export { searchPubMed } from "./pubmed.ts";

export type { ExpansionMode, PreparedSourceQuery, OpenAlexWork, SemanticScholarPaper, UnifiedPaper } from "./types.ts";
export { extractSearchKeywords, buildSourceQuery, resolvePreparedQuery } from "./query-builder.ts";
export { normalizeDoi, reconstructAbstract } from "./normalization.ts";
export { withTimeout } from "./http.ts";
