import { prepareQueryProcessingV2, type QueryProcessingMeta, type SearchSource } from "../../../_shared/query-processing.ts";
import { runProviderPipeline } from "../../infrastructure/providers/index.ts";
import { extractSearchKeywords } from "../../infrastructure/providers/query-builder.ts";
import { normalizeDoi } from "../../infrastructure/providers/normalization.ts";
import type { UnifiedPaper } from "../../infrastructure/providers/types.ts";
import {
  applyQualityFilter,
  buildEvidenceAndBrief,
  canonicalizePapers,
  type CanonicalPaper,
  type CoverageReport,
  type InputPaper,
  type SearchRequestPayload,
  type SearchResponsePayload,
  type SearchStats,
} from "../../../_shared/lit-search.ts";
import {
  runMetadataEnrichment,
  type EnrichmentInputPaper,
} from "../../../_shared/metadata-enrichment.ts";
import {
  applyCompletenessTiers,
  extractStudiesDeterministic,
  summarizeExtractionResults,
  type DeterministicExtractionInput,
  type DeterministicStudyResult,
} from "../../../_shared/study-extraction.ts";
import type {
  Outcome,
  StudyResult,
  QueryPipelineMode,
  ExtractionEngine,
  PipelineResult,
  MetadataEnrichmentContext,
} from "../../domain/models/research.ts";

function formatCitation(paper: UnifiedPaper): string {
  const authors = paper.authors.slice(0, 3).join(", ");
  const etAl = paper.authors.length > 3 ? " et al." : "";
  const year = paper.year || "n.d.";
  const venue = paper.venue || "";
  return `${authors}${etAl} (${year}). ${paper.title}. ${venue}`.trim();
}

function normalizeQuery(query: string): { normalized: string; wasNormalized: boolean } {
  const original = query.trim();
  let normalized = original;
  let wasNormalized = false;

  const comparativePatterns = [
    /\b(better|best|worse|worst|superior|inferior)\b/gi,
    /\b(more|less)\s+(effective|efficient|beneficial)\b/gi,
  ];

  for (const pattern of comparativePatterns) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, (match) => {
        wasNormalized = true;
        if (/better|best|superior/i.test(match)) return "associated with";
        if (/worse|worst|inferior/i.test(match)) return "associated with";
        return "outcomes of";
      });
    }
  }

  if (/\beffects?\s+of\b/i.test(normalized)) {
    normalized = normalized.replace(/\beffects?\s+of\b/gi, "reported outcomes associated with");
    wasNormalized = true;
  }

  return { normalized: normalized.trim(), wasNormalized };
}

export function getQueryPipelineMode(): QueryPipelineMode {
  const raw = (Deno.env.get("QUERY_PIPELINE_MODE") || "shadow").toLowerCase();
  if (raw === "v1" || raw === "v2" || raw === "shadow") return raw;
  return "shadow";
}

export function getExtractionEngine(): ExtractionEngine {
  const raw = (Deno.env.get("EXTRACTION_ENGINE") || "hybrid").toLowerCase();
  if (raw === "llm" || raw === "scripted" || raw === "hybrid") return raw;
  return "hybrid";
}

function getPdfParseTimeoutMs(): number {
  const raw = Number(Deno.env.get("PDF_PARSE_TIMEOUT_MS") || 12_000);
  if (!Number.isFinite(raw)) return 12_000;
  return Math.min(60_000, Math.max(1_000, Math.trunc(raw)));
}

function getExtractionMaxCandidates(): number {
  const raw = Number(Deno.env.get("EXTRACTION_MAX_CANDIDATES") || 45);
  if (!Number.isFinite(raw)) return 45;
  return Math.min(60, Math.max(5, Math.trunc(raw)));
}

function normalizeTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function fuzzyTitleThreshold(title: string): number {
  if (title.length <= 40) return 2;
  return 3;
}

function mergePaperMetadata(existingPaper: UnifiedPaper, incomingPaper: UnifiedPaper): void {
  if (incomingPaper.abstract && incomingPaper.abstract.length > (existingPaper.abstract?.length ?? 0)) {
    existingPaper.abstract = incomingPaper.abstract;
  }
  if (
    incomingPaper.citationCount !== undefined
    && (existingPaper.citationCount === undefined || incomingPaper.citationCount > existingPaper.citationCount)
  ) {
    existingPaper.citationCount = incomingPaper.citationCount;
  }
  if (incomingPaper.pubmed_id && !existingPaper.pubmed_id) existingPaper.pubmed_id = incomingPaper.pubmed_id;
  if (incomingPaper.openalex_id && !existingPaper.openalex_id) existingPaper.openalex_id = incomingPaper.openalex_id;
  if (incomingPaper.doi && !existingPaper.doi) existingPaper.doi = incomingPaper.doi;
  if (incomingPaper.pdfUrl && !existingPaper.pdfUrl) existingPaper.pdfUrl = incomingPaper.pdfUrl;
  if (incomingPaper.landingPageUrl && !existingPaper.landingPageUrl) existingPaper.landingPageUrl = incomingPaper.landingPageUrl;
}

function deduplicateAndMerge(s2Papers: UnifiedPaper[], openAlexPapers: UnifiedPaper[], arxivPapers: UnifiedPaper[], pubmedPapers: UnifiedPaper[] = []): UnifiedPaper[] {
  const doiMap = new Map<string, UnifiedPaper>();
  const titleMap = new Map<string, UnifiedPaper>();
  const uniquePapers = new Set<UnifiedPaper>();
  const allPapers = [...s2Papers, ...openAlexPapers, ...arxivPapers, ...pubmedPapers];

  for (const paper of allPapers) {
    const normalizedTitle = normalizeTitleForDedup(paper.title);
    const doi = paper.doi?.toLowerCase().trim();
    let existingPaper: UnifiedPaper | undefined;
    let dedupeReason: "doi_match" | "title_exact" | "title_fuzzy" | null = null;

    if (doi) {
      existingPaper = doiMap.get(doi);
      if (existingPaper) dedupeReason = "doi_match";
    }
    if (!existingPaper) {
      existingPaper = titleMap.get(normalizedTitle);
      if (existingPaper) dedupeReason = "title_exact";
    }
    if (!existingPaper) {
      let bestMatch: { paper: UnifiedPaper; distance: number } | null = null;
      const threshold = fuzzyTitleThreshold(normalizedTitle);
      for (const [knownTitle, knownPaper] of titleMap.entries()) {
        const distance = levenshteinDistance(normalizedTitle, knownTitle);
        if (distance <= threshold && (!bestMatch || distance < bestMatch.distance)) {
          bestMatch = { paper: knownPaper, distance };
          if (distance === 0) break;
        }
      }
      if (bestMatch) {
        existingPaper = bestMatch.paper;
        dedupeReason = "title_fuzzy";
      }
    }

    if (existingPaper && dedupeReason) {
      mergePaperMetadata(existingPaper, paper);
      if (doi) doiMap.set(doi, existingPaper);
      titleMap.set(normalizedTitle, existingPaper);
      console.log(`[Deduplication] Merged "${paper.title}" via ${dedupeReason}`);
      continue;
    }

    uniquePapers.add(paper);
    if (doi) doiMap.set(doi, paper);
    titleMap.set(normalizedTitle, paper);
  }

  console.log(`[Deduplication] ${allPapers.length} total -> ${uniquePapers.size} unique papers`);
  return Array.from(uniquePapers);
}

function toEnrichmentInputPaper(paper: UnifiedPaper): EnrichmentInputPaper {
  return {
    id: paper.id,
    title: paper.title,
    year: paper.year,
    abstract: paper.abstract,
    authors: paper.authors,
    venue: paper.venue,
    doi: paper.doi,
    source: paper.source,
    citationCount: paper.citationCount ?? null,
    journal: paper.journal ?? null,
  };
}

function mergeEnrichmentPaper(basePaper: UnifiedPaper, enrichedPaper: EnrichmentInputPaper): UnifiedPaper {
  return {
    ...basePaper,
    doi: enrichedPaper.doi ?? basePaper.doi,
    year: enrichedPaper.year ?? basePaper.year,
    citationCount: enrichedPaper.citationCount ?? basePaper.citationCount,
    journal: enrichedPaper.journal ?? basePaper.journal,
  };
}

async function enrichWithMetadata(
  papers: UnifiedPaper[],
  context: MetadataEnrichmentContext,
  functionName: string,
): Promise<UnifiedPaper[]> {
  const input = papers.map(toEnrichmentInputPaper);
  const { papers: enriched, decisions } = await runMetadataEnrichment(input, {
    mode: context.mode,
    functionName,
    stack: "supabase_edge",
    store: context.store,
    sourceTrust: context.sourceTrust,
    reportId: context.reportId,
    searchId: context.searchId,
    userId: context.userId,
    retryMax: context.retryMax,
    maxLatencyMs: context.maxLatencyMs,
  });

  const merged = papers.map((paper, idx) => mergeEnrichmentPaper(paper, enriched[idx] || input[idx]));
  const accepted = decisions.filter((decision) => decision.outcome === "accepted").length;
  const deferred = decisions.filter((decision) => decision.outcome === "deferred").length;
  const rejected = decisions.filter((decision) => decision.outcome === "rejected").length;
  console.log(
    `[MetadataEnrichment] mode=${context.mode} fn=${functionName} total=${decisions.length} accepted=${accepted} deferred=${deferred} rejected=${rejected}`,
  );
  return merged;
}

function getQueryKeywordSet(query: string, precomputedTerms?: string[]): Set<string> {
  if (precomputedTerms && precomputedTerms.length > 0) {
    return new Set(precomputedTerms.map((k) => k.trim().toLowerCase()).filter(Boolean));
  }
  const { originalTerms, expandedTerms } = extractSearchKeywords(query);
  return new Set([...originalTerms, ...expandedTerms].map((k) => k.trim()).filter(Boolean));
}

function scorePaperCandidate(paper: UnifiedPaper, queryKeywords: Set<string>): number {
  const text = `${paper.title} ${paper.abstract}`.toLowerCase();
  const textTokens = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));

  let keywordOverlap = 0;
  for (const keyword of queryKeywords) {
    if (textTokens.has(keyword)) keywordOverlap += 1;
  }

  const overlapScore = queryKeywords.size > 0 ? keywordOverlap / queryKeywords.size : 0;
  const abstractLengthScore = Math.min((paper.abstract.length || 0) / 2000, 1);
  const citationScore = Math.min(Math.log10((paper.citationCount ?? 0) + 1) / 3, 1);
  return overlapScore * 3 + abstractLengthScore + citationScore;
}

function mergeExtractedStudies(studies: StudyResult[]): StudyResult[] {
  const byStudyId = new Map<string, StudyResult>();
  for (const study of studies) {
    if (!study?.study_id) continue;
    const existing = byStudyId.get(study.study_id);
    if (!existing) {
      byStudyId.set(study.study_id, study);
      continue;
    }
    const combinedOutcomes = [...(existing.outcomes || []), ...(study.outcomes || [])];
    const seenOutcomes = new Set<string>();
    const dedupedOutcomes = combinedOutcomes.filter((outcome: Outcome) => {
      const key = `${outcome?.outcome_measured || ""}|${outcome?.citation_snippet || ""}|${outcome?.key_result || ""}`;
      if (seenOutcomes.has(key)) return false;
      seenOutcomes.add(key);
      return true;
    });
    byStudyId.set(study.study_id, {
      ...existing,
      ...study,
      outcomes: dedupedOutcomes,
      citationCount: Math.max(existing.citationCount ?? 0, study.citationCount ?? 0) || undefined,
      abstract_excerpt: existing.abstract_excerpt?.length >= (study.abstract_excerpt?.length || 0)
        ? existing.abstract_excerpt
        : study.abstract_excerpt,
    });
  }
  return Array.from(byStudyId.values());
}

async function extractStudyData(
  papers: UnifiedPaper[],
  question: string,
  openaiApiKey: string,
): Promise<StudyResult[]> {
  const papersContext = papers.map((p, i) => ({
    index: i,
    title: p.title,
    year: p.year,
    abstract: p.abstract,
    id: p.id,
    source: p.source,
    doi: p.doi,
    pubmed_id: p.pubmed_id,
    openalex_id: p.openalex_id,
    citationCount: p.citationCount,
    pdfUrl: p.pdfUrl,
    landingPageUrl: p.landingPageUrl,
  }));

  const systemPrompt = `You are a rigorous medical research data extractor following strict evidence-based principles.

CRITICAL EXTRACTION RULES (per meta prompt):
1. Extract ONLY from Abstract and explicitly labeled Results sections
2. NEVER infer study design - if not explicitly stated, return "unknown"
3. Population descriptions MUST be extracted verbatim from the source
4. Sample size: return only clearly stated total (e.g., "n=150", "150 participants"); otherwise null
5. Each study may report MULTIPLE outcomes - represent as separate objects in outcomes array
6. Each outcome MUST have its own citation_snippet (verbatim text from abstract)
7. Numerical values (CI, p-values, effect sizes) MUST be extracted verbatim - no rounding
8. Terms like "significant" or association language allowed ONLY if quoted or explicitly used in source
9. NO causal language unless the abstract explicitly states causation
12. For each outcome, extract "intervention" (the treatment/exposure) and "comparator" (control group) verbatim. Return null if not stated.
13. For each outcome, extract "effect_size" (verbatim: Cohen's d, OR, RR, HR, SMD, etc.) and "p_value" (verbatim p-value or CI). Return null if not stated.
10. Classify preprint_status: "Preprint" if preprint/not peer-reviewed, else "Peer-reviewed"
11. Classify review_type: "Meta-analysis" for meta-analyses (MUST flag), "Systematic review" for systematic reviews, else "None"

STUDY DESIGN CLASSIFICATION:
- "RCT": Randomized controlled trials, clinical trials with randomization
- "cohort": Cohort studies, longitudinal studies, prospective/retrospective follow-up studies
- "cross-sectional": Cross-sectional surveys, prevalence studies, single time-point observations
- "review": Narrative reviews, literature reviews, systematic reviews, meta-analyses, scoping reviews
- "unknown": Editorials, commentaries, case reports, case series, letters to the editor, opinion pieces, guidelines, conference abstracts, or any paper that does not clearly fit one of the above designs. When in doubt, classify as "unknown".

OUTPUT SCHEMA - return valid JSON array matching this exact structure:
[{
  "study_id": "string (paper ID)",
  "title": "string",
  "year": number,
  "study_design": "RCT" | "cohort" | "cross-sectional" | "review" | "unknown",
  "sample_size": number | null,
  "population": "verbatim population description" | null,
  "outcomes": [{
    "outcome_measured": "string describing what was measured",
    "key_result": "verbatim finding with exact numbers/CI/p-values" | null,
    "citation_snippet": "verbatim text from abstract supporting this result",
    "intervention": "treatment/exposure" | null,
    "comparator": "control/comparison group" | null,
    "effect_size": "verbatim effect size (e.g., Cohen's d, OR, RR, HR)" | null,
    "p_value": "verbatim p-value or CI" | null
  }],
  "citation": {
    "doi": "string" | null,
    "pubmed_id": "string" | null,
    "openalex_id": "string" | null,
    "formatted": "APA formatted citation"
  },
  "abstract_excerpt": "representative excerpt from abstract",
  "preprint_status": "Preprint" | "Peer-reviewed",
  "review_type": "None" | "Systematic review" | "Meta-analysis",
  "source": "openalex" | "semantic_scholar" | "arxiv" | "pubmed",
  "citationCount": number | null
}]

Return ONLY valid JSON array. No markdown, no explanation.`;

  const userPrompt = `Research Question: "${question}"

Papers to analyze:
${JSON.stringify(papersContext, null, 2)}

Extract structured data from each paper's abstract following the strict rules. Remember:
- Multiple outcomes per study as separate objects in outcomes array
- Each outcome needs its own citation_snippet, intervention, comparator, effect_size, and p_value
- No inference - null for missing data
- Verbatim extraction for populations, numerical results, interventions, and comparators`;

  console.log(`[LLM] Sending ${papers.length} papers for extraction via Gemini`);

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: "gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[LLM] Gemini error: ${response.status}`, errorText);
    if (response.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
    if (response.status === 401) throw new Error("Invalid Gemini API key.");
    throw new Error(`LLM extraction failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  console.log(`[LLM] Raw response length: ${content.length}`);

  let jsonStr = content.trim();
  if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
  if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);

  try {
    const results = JSON.parse(jsonStr.trim());
    console.log(`[LLM] Parsed ${results.length} study results`);
    for (const study of results) {
      const matchedPaper = papers.find((p) => p.id === study.study_id);
      if (matchedPaper) {
        study.pdf_url = matchedPaper.pdfUrl || null;
        study.landing_page_url = matchedPaper.landingPageUrl || null;
      }
    }
    return results;
  } catch (parseError) {
    console.error("[LLM] JSON parse error:", parseError);
    throw new Error("Failed to parse LLM response as JSON");
  }
}

function canonicalToUnifiedPaper(paper: CanonicalPaper): UnifiedPaper {
  const primarySource = paper.provenance[0]?.provider;
  const normalizedSource: UnifiedPaper["source"] =
    primarySource === "pubmed" || primarySource === "arxiv" || primarySource === "semantic_scholar"
      ? primarySource
      : "openalex";

  return {
    id: paper.paper_id,
    title: paper.title,
    year: paper.year || new Date().getUTCFullYear(),
    abstract: paper.abstract,
    authors: paper.authors,
    venue: paper.venue,
    doi: paper.doi,
    pubmed_id: paper.pubmed_id,
    openalex_id: paper.openalex_id,
    source: normalizedSource,
    citationCount: paper.citation_count,
    publicationTypes: paper.study_design_hint ? [paper.study_design_hint] : undefined,
    journal: paper.venue || undefined,
    pdfUrl: null,
    landingPageUrl: null,
    referenced_ids: paper.referenced_ids,
    is_retracted: paper.is_retracted,
    preprint_status: paper.is_preprint ? "Preprint" : "Peer-reviewed",
    rank_signal: paper.relevance_score,
  };
}

function toDeterministicInput(paper: UnifiedPaper): DeterministicExtractionInput {
  return {
    study_id: paper.id,
    title: paper.title,
    year: paper.year,
    abstract: paper.abstract,
    authors: paper.authors,
    venue: paper.venue,
    doi: paper.doi,
    pubmed_id: paper.pubmed_id,
    openalex_id: paper.openalex_id,
    source: paper.source,
    citationCount: paper.citationCount,
    publicationTypes: paper.publicationTypes,
    preprint_status: paper.preprint_status || (paper.source === "arxiv" ? "Preprint" : "Peer-reviewed"),
    pdf_url: paper.pdfUrl || null,
    landing_page_url: paper.landingPageUrl || null,
  };
}

function canonicalToFallbackStudy(paper: CanonicalPaper): StudyResult {
  const unified = canonicalToUnifiedPaper(paper);
  const abstractSentence = (paper.abstract || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).find(Boolean) || null;
  const studyDesignText = (paper.study_design_hint || "").toLowerCase();
  let studyDesign: StudyResult["study_design"] = "unknown";
  if (studyDesignText.includes("rct") || studyDesignText.includes("randomized") || studyDesignText.includes("randomised")) studyDesign = "RCT";
  else if (studyDesignText.includes("cohort")) studyDesign = "cohort";
  else if (studyDesignText.includes("cross")) studyDesign = "cross-sectional";
  else if (studyDesignText.includes("review")) studyDesign = "review";

  return {
    study_id: paper.paper_id,
    title: paper.title,
    year: paper.year || new Date().getUTCFullYear(),
    study_design: studyDesign,
    sample_size: null,
    population: null,
    outcomes: [{
      outcome_measured: "Reported outcome",
      key_result: abstractSentence,
      citation_snippet: abstractSentence || paper.title,
      intervention: null,
      comparator: null,
      effect_size: null,
      p_value: null,
    }],
    citation: {
      doi: paper.doi,
      pubmed_id: paper.pubmed_id,
      openalex_id: paper.openalex_id,
      formatted: formatCitation(unified),
    },
    abstract_excerpt: abstractSentence || paper.abstract || paper.title,
    preprint_status: paper.is_preprint ? "Preprint" : "Peer-reviewed",
    review_type: studyDesignText.includes("meta-analysis")
      ? "Meta-analysis"
      : studyDesignText.includes("systematic review")
        ? "Systematic review"
        : "None",
    source: unified.source,
    citationCount: paper.citation_count || 0,
    pdf_url: null,
    landing_page_url: null,
  };
}

export async function runResearchPipeline(
  question: string,
  requestPayload: SearchRequestPayload,
  enrichmentContext: MetadataEnrichmentContext,
): Promise<PipelineResult> {
  const pipelineStartedAt = Date.now();
  const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY") || "";
  const extractionEngine = getExtractionEngine();
  const extractionMaxCandidates = getExtractionMaxCandidates();
  const pdfExtractorUrl = Deno.env.get("PDF_EXTRACTOR_URL") || "";
  const pdfExtractorBearerToken = Deno.env.get("PDF_EXTRACTOR_BEARER_TOKEN") || "";
  const pdfParseTimeoutMs = getPdfParseTimeoutMs();

  console.log(`[Pipeline] Processing query="${question}" max_candidates=${requestPayload.max_candidates}`);

  const queryPipelineMode = getQueryPipelineMode();
  const { normalized: v1Normalized, wasNormalized: v1WasNormalized } = normalizeQuery(question);
  let normalizedQueryForResponse = v1WasNormalized ? v1Normalized : undefined;
  let searchQuery = v1WasNormalized ? v1Normalized : question;
  let queryProcessingMeta: QueryProcessingMeta | undefined;
  let queryTermsForRanking: string[] | undefined;
  const sourceQueryOverrides: Partial<Record<SearchSource, string>> = {};
  let shadowPreparedPromise: Promise<Awaited<ReturnType<typeof prepareQueryProcessingV2>>> | null = null;

  if (queryPipelineMode === "v2") {
    const prepared = await prepareQueryProcessingV2(question, {
      llmApiKey: GEMINI_API_KEY || undefined,
      fallbackTimeoutMs: 350,
    });
    searchQuery = prepared.search_query;
    normalizedQueryForResponse = prepared.was_normalized ? prepared.normalized_query : undefined;
    queryTermsForRanking = prepared.query_terms;
    queryProcessingMeta = prepared.query_processing;
    sourceQueryOverrides.semantic_scholar = prepared.query_processing.source_queries.semantic_scholar;
    sourceQueryOverrides.openalex = prepared.query_processing.source_queries.openalex;
    sourceQueryOverrides.pubmed = prepared.query_processing.source_queries.pubmed;
    sourceQueryOverrides.arxiv = prepared.query_processing.source_queries.arxiv;
  } else if (queryPipelineMode === "shadow") {
    shadowPreparedPromise = prepareQueryProcessingV2(question, {
      llmApiKey: GEMINI_API_KEY || undefined,
      fallbackTimeoutMs: 350,
    });
  }

  const {
    coverage,
    papersByProvider,
    candidates: providerCandidates,
  } = await runProviderPipeline({
    query: searchQuery,
    maxCandidates: requestPayload.max_candidates,
    mode: "balanced",
    sourceQueryOverrides,
  });

  if (queryPipelineMode === "shadow" && shadowPreparedPromise) {
    try {
      const prepared = await shadowPreparedPromise;
      queryProcessingMeta = prepared.query_processing;
    } catch (error) {
      console.warn("[Pipeline] Shadow query processing failed:", error);
    }
  }

  const s2Papers = papersByProvider.semantic_scholar;
  const openAlexPapers = papersByProvider.openalex;
  const arxivPapers = papersByProvider.arxiv;
  const pubmedPapers = papersByProvider.pubmed;

  const dedupedForLegacyFlow = deduplicateAndMerge(s2Papers, openAlexPapers, arxivPapers, pubmedPapers);
  const enrichedLegacyPapers = await enrichWithMetadata(dedupedForLegacyFlow, enrichmentContext, "research-async");
  const enrichedProviderCandidates = await enrichWithMetadata(providerCandidates, enrichmentContext, "research-async");
  const papersWithAbstracts = enrichedProviderCandidates.filter((paper) => paper.abstract && paper.abstract.length > 50);

  const queryKeywords = getQueryKeywordSet(searchQuery, queryPipelineMode === "v2" ? queryTermsForRanking : undefined);
  const rankedByQuery = [...papersWithAbstracts].sort(
    (left, right) => scorePaperCandidate(right, queryKeywords) - scorePaperCandidate(left, queryKeywords),
  );
  const cappedCandidates = rankedByQuery.slice(0, requestPayload.max_candidates);
  const providerById = new Map<string, UnifiedPaper>();
  const providerByDoi = new Map<string, UnifiedPaper>();
  for (const candidate of cappedCandidates) {
    providerById.set(candidate.id, candidate);
    const normalized = normalizeDoi(candidate.doi);
    if (normalized && !providerByDoi.has(normalized)) providerByDoi.set(normalized, candidate);
  }

  const canonicalCandidates = canonicalizePapers(cappedCandidates as InputPaper[]);
  const timeframe: [number, number] = [requestPayload.filters.from_year, requestPayload.filters.to_year];
  const { kept, filtered_count } = applyQualityFilter(canonicalCandidates, requestPayload.filters, timeframe);
  const keptCapped = kept.slice(0, requestPayload.max_candidates);
  const { evidence_table, brief } = buildEvidenceAndBrief(keptCapped, requestPayload.max_evidence_rows);

  let results: StudyResult[] = [];
  let partial_results: StudyResult[] = [];
  let extraction_stats: Record<string, unknown> = {};
  let extraction_input_total = 0;
  if (keptCapped.length > 0) {
    const extractionCandidates = keptCapped.slice(0, extractionMaxCandidates).map((paper) => {
      const base = canonicalToUnifiedPaper(paper);
      const providerMatch = providerById.get(paper.paper_id) || (paper.doi ? providerByDoi.get(normalizeDoi(paper.doi) || "") : undefined);
      if (providerMatch?.pdfUrl) base.pdfUrl = providerMatch.pdfUrl;
      if (providerMatch?.landingPageUrl) base.landingPageUrl = providerMatch.landingPageUrl;
      return base;
    });
    extraction_input_total = extractionCandidates.length;
    const extractionStartedAt = Date.now();

    if (extractionEngine === "llm") {
      if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY required when EXTRACTION_ENGINE=llm");

      try {
        const batchSize = 15;
        const extractionBatches: Promise<StudyResult[]>[] = [];
        for (let i = 0; i < extractionCandidates.length; i += batchSize) {
          extractionBatches.push(extractStudyData(extractionCandidates.slice(i, i + batchSize), question, GEMINI_API_KEY));
        }
        const extracted = (await Promise.all(extractionBatches)).flat();
        const mergedByStudy = mergeExtractedStudies(extracted);
        const tiers = applyCompletenessTiers(mergedByStudy as unknown as DeterministicStudyResult[]);
        results = tiers.complete as unknown as StudyResult[];
        partial_results = tiers.partial as unknown as StudyResult[];
      } catch (error) {
        console.warn("[Pipeline] LLM extraction fallback triggered:", error);
        partial_results = keptCapped.slice(0, 50).map(canonicalToFallbackStudy);
      }

      extraction_stats = {
        total_inputs: extractionCandidates.length,
        extracted_total: results.length + partial_results.length,
        complete_total: results.length,
        partial_total: partial_results.length,
        used_pdf: 0,
        used_abstract_fallback: 0,
        failures: 0,
        fallback_reasons: {},
        engine: "llm",
        llm_fallback_applied: false,
        latency_ms: Date.now() - extractionStartedAt,
      };
    } else {
      const deterministicInputs = extractionCandidates.map((paper) => toDeterministicInput(paper));
      const deterministicResults = await extractStudiesDeterministic(deterministicInputs, {
        question,
        pdfExtractorUrl: pdfExtractorUrl || undefined,
        pdfExtractorBearerToken: pdfExtractorBearerToken || undefined,
        pdfParseTimeoutMs,
        batchSize: 10,
      });
      const deterministicMerged = mergeExtractedStudies(
        deterministicResults.map((row) => row.study as unknown as StudyResult),
      );
      const deterministicTiers = applyCompletenessTiers(deterministicMerged as unknown as DeterministicStudyResult[]);
      results = deterministicTiers.complete as unknown as StudyResult[];
      partial_results = deterministicTiers.partial as unknown as StudyResult[];

      let llmFallbackApplied = false;
      if (extractionEngine === "hybrid" && results.length === 0 && GEMINI_API_KEY) {
        try {
          const batchSize = 15;
          const llmBatches: Promise<StudyResult[]>[] = [];
          for (let i = 0; i < extractionCandidates.length; i += batchSize) {
            llmBatches.push(extractStudyData(extractionCandidates.slice(i, i + batchSize), question, GEMINI_API_KEY));
          }
          const llmExtracted = (await Promise.all(llmBatches)).flat();
          const llmMerged = mergeExtractedStudies(llmExtracted);
          const llmTiers = applyCompletenessTiers(llmMerged as unknown as DeterministicStudyResult[]);
          if (llmTiers.complete.length > 0) {
            results = llmTiers.complete as unknown as StudyResult[];
            llmFallbackApplied = true;
          }
        } catch (error) {
          console.warn("[Pipeline] Hybrid LLM fallback failed:", error);
        }
      }

      if (results.length === 0 && partial_results.length === 0) {
        partial_results = keptCapped.slice(0, 50).map(canonicalToFallbackStudy);
      }

      extraction_stats = summarizeExtractionResults(deterministicResults, {
        totalInputs: deterministicInputs.length,
        completeTotal: results.length,
        partialTotal: partial_results.length,
        latencyMs: Date.now() - extractionStartedAt,
        engine: extractionEngine,
        llmFallbackApplied,
      }) as unknown as Record<string, unknown>;
    }
  }

  const stats: SearchStats = {
    latency_ms: Date.now() - pipelineStartedAt,
    candidates_total: canonicalCandidates.length,
    candidates_filtered: filtered_count,
    retrieved_total: providerCandidates.length,
    abstract_eligible_total: papersWithAbstracts.length,
    quality_kept_total: keptCapped.length,
    extraction_input_total,
    strict_complete_total: results.length,
    partial_total: partial_results.length,
  };

  return {
    results,
    partial_results,
    extraction_stats,
    evidence_table,
    brief,
    coverage,
    stats,
    canonical_papers: keptCapped,
    normalized_query: normalizedQueryForResponse,
    total_papers_searched: enrichedLegacyPapers.length,
    openalex_count: openAlexPapers.length,
    semantic_scholar_count: s2Papers.length,
    arxiv_count: arxivPapers.length,
    pubmed_count: pubmedPapers.length,
    query_processing: queryProcessingMeta,
    query_pipeline_mode: queryPipelineMode,
  };
}
