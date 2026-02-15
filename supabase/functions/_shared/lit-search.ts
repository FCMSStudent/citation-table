export type ProviderName = "openalex" | "semantic_scholar" | "arxiv" | "pubmed" | "crossref";

export interface SearchFilters {
  from_year: number;
  to_year: number;
  languages: string[];
  exclude_preprints: boolean;
}

export interface SearchRequestPayload {
  query: string;
  domain: "auto" | "biomed" | "cs" | "economics" | "custom";
  filters: SearchFilters;
  max_candidates: number;
  max_evidence_rows: number;
  response_mode: "evidence_table_brief";
}

export interface ProviderProvenance {
  provider: ProviderName;
  external_id: string;
  rank_signal: number;
  metadata_confidence: number;
}

export interface QualityScoreBreakdown {
  source_authority: number;
  study_design_strength: number;
  methods_transparency: number;
  citation_impact: number;
  recency_fit: number;
  q_total: number;
  hard_rejected: boolean;
  reject_reason: string | null;
}

export interface InputPaper {
  id: string;
  title: string;
  year: number;
  abstract: string;
  authors: string[];
  venue: string;
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  arxiv_id?: string | null;
  source: ProviderName;
  citationCount?: number;
  publicationTypes?: string[];
  journal?: string;
  referenced_ids?: string[];
  is_retracted?: boolean;
  preprint_status?: "Preprint" | "Peer-reviewed";
  rank_signal?: number;
}

export interface CanonicalPaper {
  paper_id: string;
  title: string;
  abstract: string;
  year: number | null;
  authors: string[];
  venue: string;
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  arxiv_id: string | null;
  citation_count: number;
  referenced_ids: string[];
  is_retracted: boolean;
  is_preprint: boolean;
  study_design_hint: string | null;
  methods_present: boolean;
  source_confidence: number;
  relevance_score: number;
  provenance: ProviderProvenance[];
  quality: QualityScoreBreakdown;
}

export interface CitationAnchor {
  paper_id: string;
  section: "abstract";
  page: number | null;
  char_start: number;
  char_end: number;
  snippet_hash: string;
}

export interface ClaimSentence {
  text: string;
  citations: CitationAnchor[];
  stance: "positive" | "negative" | "neutral" | "mixed" | "conflicting";
}

export interface EvidenceRow {
  rank: number;
  paper_id: string;
  title: string;
  year: number | null;
  authors: string[];
  venue: string;
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  arxiv_id: string | null;
  abstract_snippet: string;
  proposition_label: string;
  quality: QualityScoreBreakdown;
  provenance: ProviderProvenance[];
}

export interface CoverageReport {
  providers_queried: number;
  providers_failed: number;
  failed_provider_names: string[];
  degraded: boolean;
}

export interface SearchStats {
  latency_ms: number;
  candidates_total: number;
  candidates_filtered: number;
  retrieved_total?: number;
  abstract_eligible_total?: number;
  quality_kept_total?: number;
  extraction_input_total?: number;
  strict_complete_total?: number;
  partial_total?: number;
}

export interface BriefPayload {
  sentences: ClaimSentence[];
}

export interface SearchResponsePayload {
  search_id: string;
  status: "running" | "completed" | "failed";
  coverage: CoverageReport;
  evidence_table: EvidenceRow[];
  brief: BriefPayload;
  stats: SearchStats;
  error?: string;
}

interface ClaimCandidate {
  paper_id: string;
  sentence: string;
  char_start: number;
  char_end: number;
  outcome: string;
  direction: "positive" | "negative" | "neutral";
}

interface ClaimCluster {
  cluster_id: string;
  label: string;
  claims: ClaimCandidate[];
  disposition: "consensus_positive" | "consensus_negative" | "mixed" | "conflicting";
}

const PROVIDER_CONFIDENCE: Record<ProviderName, number> = {
  pubmed: 0.98,
  openalex: 0.92,
  semantic_scholar: 0.9,
  crossref: 0.89,
  arxiv: 0.84,
};

const QUALITY_WEIGHTS = {
  source_authority: 0.3,
  study_design_strength: 0.25,
  methods_transparency: 0.2,
  citation_impact: 0.15,
  recency_fit: 0.1,
};

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "is", "it", "of", "on", "or", "that", "the", "to", "with",
]);

const EFFECT_TERMS = [
  "increase", "increased", "decrease", "decreased", "improve", "improved", "reduce", "reduced", "associated", "effect", "significant",
];

const POSITIVE_TERMS = ["increase", "increased", "improve", "improved", "higher", "benefit", "effective"];
const NEGATIVE_TERMS = ["decrease", "decreased", "reduce", "reduced", "lower", "worse", "adverse"];
const NULL_TERMS = ["no significant", "non-significant", "no effect", "null effect"];

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeDoi(raw: string | null): string | null {
  if (!raw) return null;
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
}

function normalizeText(raw: string | null): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textTokens(raw: string): Set<string> {
  const tokens = raw
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2)
    .filter((token) => !STOP_WORDS.has(token));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const token of smaller) {
    if (larger.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function hasMethodsSignal(text: string): boolean {
  if (!text) return false;
  const lowered = text.toLowerCase();
  return ["method", "methods", "participants", "dataset", "protocol", "randomized", "randomised"].some((term) => lowered.includes(term));
}

function inferStudyDesignHint(paper: InputPaper): string {
  const joined = `${paper.title} ${paper.abstract} ${(paper.publicationTypes || []).join(" ")}`.toLowerCase();
  if (joined.includes("meta-analysis")) return "meta-analysis";
  if (joined.includes("systematic review")) return "systematic review";
  if (joined.includes("randomized") || joined.includes("randomised")) return "rct";
  if (joined.includes("cohort")) return "cohort";
  if (joined.includes("cross-sectional")) return "cross-sectional";
  if (joined.includes("review")) return "review";
  if (paper.source === "arxiv") return "preprint";
  return "unknown";
}

function initialQuality(): QualityScoreBreakdown {
  return {
    source_authority: 0,
    study_design_strength: 0,
    methods_transparency: 0,
    citation_impact: 0,
    recency_fit: 0,
    q_total: 0,
    hard_rejected: false,
    reject_reason: null,
  };
}

function canonicalIdSeed(paper: InputPaper): string {
  return paper.doi || paper.pubmed_id || paper.openalex_id || paper.arxiv_id || `${paper.title}|${paper.year}|${paper.authors.slice(0, 2).join("|")}`;
}

function mergeCanonical(target: CanonicalPaper, incoming: InputPaper): void {
  const providerConfidence = PROVIDER_CONFIDENCE[incoming.source] || 0.75;
  target.source_confidence = Math.max(target.source_confidence, providerConfidence);
  target.relevance_score += (incoming.rank_signal || 0) * providerConfidence;
  target.citation_count = Math.max(target.citation_count, incoming.citationCount || 0);

  if (!target.abstract && incoming.abstract) target.abstract = incoming.abstract;
  if (!target.venue && incoming.venue) target.venue = incoming.venue;
  if (!target.year && incoming.year) target.year = incoming.year;
  if (!target.doi && incoming.doi) target.doi = incoming.doi;
  if (!target.pubmed_id && incoming.pubmed_id) target.pubmed_id = incoming.pubmed_id;
  if (!target.openalex_id && incoming.openalex_id) target.openalex_id = incoming.openalex_id;
  if (!target.arxiv_id && incoming.arxiv_id) target.arxiv_id = incoming.arxiv_id;

  target.is_retracted = target.is_retracted || Boolean(incoming.is_retracted);
  target.is_preprint = target.is_preprint || incoming.preprint_status === "Preprint" || incoming.source === "arxiv";
  target.methods_present = target.methods_present || hasMethodsSignal(incoming.abstract || "");

  if (incoming.referenced_ids && incoming.referenced_ids.length > 0) {
    const mergedRefs = new Set([...target.referenced_ids, ...incoming.referenced_ids]);
    target.referenced_ids = Array.from(mergedRefs);
  }

  target.provenance.push({
    provider: incoming.source,
    external_id: incoming.id,
    rank_signal: incoming.rank_signal || 0,
    metadata_confidence: providerConfidence,
  });
}

function isLikelyDuplicateByText(a: CanonicalPaper, b: InputPaper): boolean {
  if (a.year && b.year && Math.abs(a.year - b.year) > 1) return false;
  const titleSimilarity = jaccard(textTokens(a.title), textTokens(b.title));
  const authorSimilarity = jaccard(textTokens(a.authors.join(" ")), textTokens((b.authors || []).join(" ")));
  return titleSimilarity >= 0.78 && authorSimilarity >= 0.2;
}

export function canonicalizePapers(papers: InputPaper[]): CanonicalPaper[] {
  const canonicals: CanonicalPaper[] = [];
  const idIndex = new Map<string, number>();

  for (const paper of papers) {
    const normalizedPaper: InputPaper = {
      ...paper,
      doi: normalizeDoi(paper.doi),
      arxiv_id: paper.arxiv_id || (paper.source === "arxiv" ? paper.id : null),
      rank_signal: paper.rank_signal ?? 0.3,
    };

    const keys = [
      normalizedPaper.doi ? `doi:${normalizedPaper.doi}` : null,
      normalizedPaper.pubmed_id ? `pmid:${normalizedPaper.pubmed_id}` : null,
      normalizedPaper.arxiv_id ? `arxiv:${normalizedPaper.arxiv_id}` : null,
    ].filter((key): key is string => Boolean(key));

    let targetIndex: number | undefined;
    for (const key of keys) {
      const found = idIndex.get(key);
      if (found !== undefined) {
        targetIndex = found;
        break;
      }
    }

    if (targetIndex === undefined) {
      targetIndex = canonicals.findIndex((candidate) => isLikelyDuplicateByText(candidate, normalizedPaper));
      if (targetIndex < 0) targetIndex = undefined;
    }

    if (targetIndex === undefined) {
      const seededId = `paper_${hashString(canonicalIdSeed(normalizedPaper))}`;
      const canonical: CanonicalPaper = {
        paper_id: seededId,
        title: normalizedPaper.title,
        abstract: normalizedPaper.abstract,
        year: normalizedPaper.year || null,
        authors: normalizedPaper.authors || [],
        venue: normalizedPaper.venue || normalizedPaper.journal || "",
        doi: normalizedPaper.doi,
        pubmed_id: normalizedPaper.pubmed_id,
        openalex_id: normalizedPaper.openalex_id,
        arxiv_id: normalizedPaper.arxiv_id || null,
        citation_count: normalizedPaper.citationCount || 0,
        referenced_ids: normalizedPaper.referenced_ids || [],
        is_retracted: Boolean(normalizedPaper.is_retracted),
        is_preprint: normalizedPaper.preprint_status === "Preprint" || normalizedPaper.source === "arxiv",
        study_design_hint: inferStudyDesignHint(normalizedPaper),
        methods_present: hasMethodsSignal(normalizedPaper.abstract || ""),
        source_confidence: 0,
        relevance_score: 0,
        provenance: [],
        quality: initialQuality(),
      };
      mergeCanonical(canonical, normalizedPaper);
      canonicals.push(canonical);
      targetIndex = canonicals.length - 1;
    } else {
      mergeCanonical(canonicals[targetIndex], normalizedPaper);
    }

    for (const key of keys) {
      idIndex.set(key, targetIndex);
    }
  }

  return canonicals.sort((a, b) => {
    if (b.relevance_score !== a.relevance_score) return b.relevance_score - a.relevance_score;
    return (b.citation_count || 0) - (a.citation_count || 0);
  });
}

function scoreStudyDesign(paper: CanonicalPaper): number {
  const design = (paper.study_design_hint || "").toLowerCase();
  if (design.includes("meta-analysis") || design.includes("systematic")) return 0.9;
  if (design.includes("rct") || design.includes("randomized") || design.includes("randomised")) return 0.86;
  if (design.includes("cohort")) return 0.72;
  if (design.includes("cross")) return 0.64;
  if (design.includes("review")) return 0.62;
  if (paper.is_preprint) return 0.45;
  return 0.55;
}

function scoreMethodsTransparency(paper: CanonicalPaper): number {
  const text = paper.abstract.toLowerCase();
  if (!text) return 0.2;
  const methodSignals = ["method", "methods", "participants", "sample", "dataset", "randomized", "protocol"];
  const hits = methodSignals.filter((term) => text.includes(term)).length;
  const numbers = /\b\d{2,}\b/.test(text) ? 1 : 0;
  return clamp((hits / methodSignals.length) * 0.75 + numbers * 0.25);
}

function scoreCitationImpact(paper: CanonicalPaper, currentYear: number): number {
  const citations = paper.citation_count || 0;
  if (citations <= 0) return 0;
  const age = paper.year ? Math.max(1, currentYear - paper.year + 1) : 5;
  const fieldNormalized = citations / (age * 10);
  return clamp(Math.log1p(fieldNormalized) / Math.log1p(20));
}

function scoreRecency(paper: CanonicalPaper, currentYear: number, timeframe?: [number, number]): number {
  if (!paper.year) return 0.35;
  const age = Math.max(0, currentYear - paper.year);
  let score = Math.exp(-age / 8);
  if (timeframe && paper.year >= timeframe[0] && paper.year <= timeframe[1]) score += 0.15;
  return clamp(score);
}

function empiricalSignalsExpected(paper: CanonicalPaper): boolean {
  const text = `${paper.title} ${paper.abstract}`.toLowerCase();
  return ["study", "trial", "cohort", "experiment", "participants", "dataset", "evaluation"].some((term) => text.includes(term));
}

export function applyQualityFilter(
  papers: CanonicalPaper[],
  filters: SearchFilters,
  timeframe?: [number, number],
): { kept: CanonicalPaper[]; filtered_count: number } {
  const currentYear = new Date().getUTCFullYear();
  const kept: CanonicalPaper[] = [];
  let filteredCount = 0;

  for (const paper of papers) {
    const sourceAuthority = clamp(Math.max(...paper.provenance.map((prov) => prov.metadata_confidence), 0.25));
    const studyDesign = scoreStudyDesign(paper);
    const methods = scoreMethodsTransparency(paper);
    const citationImpact = scoreCitationImpact(paper, currentYear);
    const recency = scoreRecency(paper, currentYear, timeframe);

    const total =
      sourceAuthority * QUALITY_WEIGHTS.source_authority
      + studyDesign * QUALITY_WEIGHTS.study_design_strength
      + methods * QUALITY_WEIGHTS.methods_transparency
      + citationImpact * QUALITY_WEIGHTS.citation_impact
      + recency * QUALITY_WEIGHTS.recency_fit;

    const quality: QualityScoreBreakdown = {
      source_authority: Number(sourceAuthority.toFixed(4)),
      study_design_strength: Number(studyDesign.toFixed(4)),
      methods_transparency: Number(methods.toFixed(4)),
      citation_impact: Number(citationImpact.toFixed(4)),
      recency_fit: Number(recency.toFixed(4)),
      q_total: Number(total.toFixed(4)),
      hard_rejected: false,
      reject_reason: null,
    };

    if (paper.is_retracted) {
      quality.hard_rejected = true;
      quality.reject_reason = "retracted_or_invalidated";
    } else if (filters.exclude_preprints && paper.is_preprint) {
      quality.hard_rejected = true;
      quality.reject_reason = "preprint_excluded";
    } else if (paper.year && (paper.year < filters.from_year || paper.year > filters.to_year)) {
      quality.hard_rejected = true;
      quality.reject_reason = "outside_requested_timeframe";
    } else if (empiricalSignalsExpected(paper) && !paper.methods_present && quality.methods_transparency < 0.35) {
      quality.hard_rejected = true;
      quality.reject_reason = "missing_methodological_metadata";
    } else if (quality.q_total < 0.6) {
      quality.hard_rejected = true;
      quality.reject_reason = "quality_below_threshold";
    }

    paper.quality = quality;

    if (quality.hard_rejected) {
      filteredCount += 1;
      continue;
    }
    kept.push(paper);
  }

  kept.sort((a, b) => {
    if (b.quality.q_total !== a.quality.q_total) return b.quality.q_total - a.quality.q_total;
    if (b.relevance_score !== a.relevance_score) return b.relevance_score - a.relevance_score;
    return (b.citation_count || 0) - (a.citation_count || 0);
  });

  return { kept, filtered_count: filteredCount };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isClaimSentence(sentence: string): boolean {
  const lowered = sentence.toLowerCase();
  return EFFECT_TERMS.some((term) => lowered.includes(term));
}

function directionOf(sentence: string): "positive" | "negative" | "neutral" {
  const lowered = sentence.toLowerCase();
  if (NULL_TERMS.some((term) => lowered.includes(term))) return "neutral";
  const positive = POSITIVE_TERMS.filter((term) => lowered.includes(term)).length;
  const negative = NEGATIVE_TERMS.filter((term) => lowered.includes(term)).length;
  if (positive > negative) return "positive";
  if (negative > positive) return "negative";
  return "neutral";
}

function outcomeLabel(sentence: string): string {
  const cleaned = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !EFFECT_TERMS.includes(token));
  return tokens.slice(0, 6).join(" ") || "outcome";
}

function extractClaims(papers: CanonicalPaper[]): ClaimCandidate[] {
  const claims: ClaimCandidate[] = [];

  for (const paper of papers) {
    if (!paper.abstract) continue;
    let cursor = 0;

    for (const sentence of splitSentences(paper.abstract)) {
      const charStart = Math.max(0, paper.abstract.indexOf(sentence, cursor));
      const charEnd = charStart + sentence.length;
      cursor = charEnd;

      if (!isClaimSentence(sentence)) continue;

      claims.push({
        paper_id: paper.paper_id,
        sentence,
        char_start: charStart,
        char_end: charEnd,
        outcome: outcomeLabel(sentence),
        direction: directionOf(sentence),
      });
    }
  }

  return claims;
}

function clusterClaims(claims: ClaimCandidate[]): ClaimCluster[] {
  const clusters: ClaimCluster[] = [];
  const signatures: Set<string>[] = [];

  for (const claim of claims) {
    const signature = textTokens(`${claim.outcome} ${claim.sentence}`);
    let bestIndex = -1;
    let bestScore = 0;

    signatures.forEach((candidate, idx) => {
      const score = jaccard(signature, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = idx;
      }
    });

    if (bestIndex >= 0 && bestScore >= 0.42) {
      clusters[bestIndex].claims.push(claim);
      signatures[bestIndex] = new Set([...signatures[bestIndex], ...signature]);
      continue;
    }

    clusters.push({
      cluster_id: `cluster_${hashString(`${claim.paper_id}|${claim.sentence}`)}`,
      label: claim.outcome,
      claims: [claim],
      disposition: "mixed",
    });
    signatures.push(signature);
  }

  for (const cluster of clusters) {
    const pos = cluster.claims.filter((claim) => claim.direction === "positive").length;
    const neg = cluster.claims.filter((claim) => claim.direction === "negative").length;
    const neu = cluster.claims.filter((claim) => claim.direction === "neutral").length;

    if (pos > 0 && neg > 0) cluster.disposition = "conflicting";
    else if (pos > 0 && neu === 0) cluster.disposition = "consensus_positive";
    else if (neg > 0 && neu === 0) cluster.disposition = "consensus_negative";
    else cluster.disposition = "mixed";
  }

  return clusters.sort((a, b) => b.claims.length - a.claims.length);
}

function anchorFromClaim(claim: ClaimCandidate): CitationAnchor {
  return {
    paper_id: claim.paper_id,
    section: "abstract",
    page: null,
    char_start: claim.char_start,
    char_end: claim.char_end,
    snippet_hash: hashString(claim.sentence),
  };
}

function snippet(text: string, maxLength = 280): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

export function buildEvidenceAndBrief(
  papers: CanonicalPaper[],
  maxRows: number,
): { evidence_table: EvidenceRow[]; brief: BriefPayload } {
  const claims = extractClaims(papers);
  const clusters = clusterClaims(claims);

  const propositionByPaper = new Map<string, string>();
  for (const cluster of clusters) {
    for (const claim of cluster.claims) {
      const existing = propositionByPaper.get(claim.paper_id);
      if (!existing) {
        propositionByPaper.set(claim.paper_id, cluster.disposition);
      } else if (existing !== cluster.disposition) {
        propositionByPaper.set(claim.paper_id, "mixed");
      }
    }
  }

  const evidence_table: EvidenceRow[] = papers.slice(0, maxRows).map((paper, idx) => ({
    rank: idx + 1,
    paper_id: paper.paper_id,
    title: paper.title,
    year: paper.year,
    authors: paper.authors,
    venue: paper.venue,
    doi: paper.doi,
    pubmed_id: paper.pubmed_id,
    openalex_id: paper.openalex_id,
    arxiv_id: paper.arxiv_id,
    abstract_snippet: snippet(paper.abstract || paper.title),
    proposition_label: propositionByPaper.get(paper.paper_id) || "mixed",
    quality: paper.quality,
    provenance: paper.provenance,
  }));

  const topPapers = papers.slice(0, 3);
  const overviewCitations: CitationAnchor[] = topPapers.map((paper) => ({
    paper_id: paper.paper_id,
    section: "abstract",
    page: null,
    char_start: 0,
    char_end: Math.min((paper.abstract || paper.title).length, 160),
    snippet_hash: hashString(`${paper.paper_id}|overview`),
  }));

  const sentences: ClaimSentence[] = [
    {
      text: `The search retained ${papers.length} quality-screened studies after multi-source retrieval and strict filtering.`,
      citations: overviewCitations,
      stance: "neutral",
    },
  ];

  for (const cluster of clusters.slice(0, 3)) {
    const anchors = cluster.claims.slice(0, 3).map(anchorFromClaim);
    if (cluster.disposition === "conflicting") {
      sentences.push({
        text: `Evidence for ${cluster.label} is conflicting across the retrieved studies, with both positive and negative directions reported.`,
        citations: anchors,
        stance: "conflicting",
      });
    } else if (cluster.disposition === "consensus_positive") {
      sentences.push({
        text: `Most studies indicate a positive association for ${cluster.label}.`,
        citations: anchors,
        stance: "positive",
      });
    } else if (cluster.disposition === "consensus_negative") {
      sentences.push({
        text: `Most studies indicate a negative association for ${cluster.label}.`,
        citations: anchors,
        stance: "negative",
      });
    } else {
      sentences.push({
        text: `Findings related to ${cluster.label} are mixed and likely context-dependent.`,
        citations: anchors,
        stance: "mixed",
      });
    }
  }

  if (clusters.some((cluster) => cluster.disposition === "conflicting")) {
    const conflictAnchors = clusters
      .filter((cluster) => cluster.disposition === "conflicting")
      .flatMap((cluster) => cluster.claims.slice(0, 2).map(anchorFromClaim))
      .slice(0, 3);

    sentences.push({
      text: "At least one major proposition remains unresolved, so conclusions should be interpreted with explicit uncertainty.",
      citations: conflictAnchors.length > 0 ? conflictAnchors : overviewCitations,
      stance: "conflicting",
    });
  }

  if (sentences.length === 1) {
    sentences.push({
      text: "No high-confidence effect statements were extractable from abstracts, so interpretation remains limited.",
      citations: overviewCitations,
      stance: "neutral",
    });
  }

  return {
    evidence_table,
    brief: { sentences },
  };
}

export function defaultSearchRequestFromQuestion(question: string): SearchRequestPayload {
  return {
    query: question,
    domain: "auto",
    filters: {
      from_year: 1900,
      to_year: 2100,
      languages: ["en"],
      exclude_preprints: false,
    },
    max_candidates: 2000,
    max_evidence_rows: 200,
    response_mode: "evidence_table_brief",
  };
}

export function sanitizeSearchRequest(raw: Partial<SearchRequestPayload> | null | undefined): SearchRequestPayload {
  const fallback = defaultSearchRequestFromQuestion((raw?.query || "").trim());
  const query = (raw?.query || "").trim();
  const fromYear = Number(raw?.filters?.from_year ?? fallback.filters.from_year);
  const toYear = Number(raw?.filters?.to_year ?? fallback.filters.to_year);
  const boundedFrom = Number.isFinite(fromYear) ? Math.max(1900, Math.min(2100, Math.trunc(fromYear))) : fallback.filters.from_year;
  const boundedToRaw = Number.isFinite(toYear) ? Math.max(1900, Math.min(2100, Math.trunc(toYear))) : fallback.filters.to_year;
  const boundedTo = Math.max(boundedFrom, boundedToRaw);

  return {
    query,
    domain: raw?.domain || fallback.domain,
    filters: {
      from_year: boundedFrom,
      to_year: boundedTo,
      languages: Array.isArray(raw?.filters?.languages) && raw?.filters?.languages.length > 0
        ? raw!.filters!.languages.map((lang) => String(lang).toLowerCase())
        : fallback.filters.languages,
      exclude_preprints: Boolean(raw?.filters?.exclude_preprints),
    },
    max_candidates: Math.max(100, Math.min(5000, Number(raw?.max_candidates ?? fallback.max_candidates))),
    max_evidence_rows: Math.max(10, Math.min(500, Number(raw?.max_evidence_rows ?? fallback.max_evidence_rows))),
    response_mode: "evidence_table_brief",
  };
}
