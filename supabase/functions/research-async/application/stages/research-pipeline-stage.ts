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
import {
  createStageContext,
  runStage,
  StageError,
  type PipelineStage,
  type StageResult,
} from "./pipeline-runtime.ts";

const DETERMINISTIC_EXTRACTOR_VERSION = "deterministic_first_v1";
const LLM_MODEL = "gemini-2.5-flash";
const DETERMINISTIC_FIELDS = [
  "study_id",
  "title",
  "year",
  "study_design",
  "outcomes[].outcome_measured",
  "outcomes[].citation_snippet",
  "citation.formatted",
  "abstract_excerpt",
  "preprint_status",
  "review_type",
  "source",
];
const NULLABLE_LLM_FIELDS = [
  "sample_size",
  "population",
  "outcomes[].key_result",
  "outcomes[].intervention",
  "outcomes[].comparator",
  "outcomes[].effect_size",
  "outcomes[].p_value",
  "citation.doi",
  "citation.pubmed_id",
  "citation.openalex_id",
  "citationCount",
  "pdf_url",
  "landing_page_url",
];

function hashString(raw: string): string {
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function hasNullableGaps(study: StudyResult): boolean {
  if (study.sample_size === null || study.population === null) return true;
  if (!study.citation?.doi || !study.citation?.pubmed_id || !study.citation?.openalex_id) return true;
  if (study.citationCount === undefined || study.citationCount === null) return true;
  if (study.pdf_url === null || study.pdf_url === undefined) return true;
  if (study.landing_page_url === null || study.landing_page_url === undefined) return true;
  return (study.outcomes || []).some((outcome) =>
    !outcome.key_result
    || !outcome.intervention
    || !outcome.comparator
    || !outcome.effect_size
    || !outcome.p_value
  );
}

function outcomeMatchKey(outcome: Outcome): string {
  return `${outcome.outcome_measured.toLowerCase().trim()}|${outcome.citation_snippet.toLowerCase().trim()}`;
}

function mergeNullableLlmFields(deterministic: StudyResult[], llmStudies: StudyResult[]): StudyResult[] {
  const llmById = new Map<string, StudyResult>();
  for (const study of llmStudies) {
    if (study?.study_id) llmById.set(study.study_id, study);
  }

  return deterministic.map((base) => {
    const llm = llmById.get(base.study_id);
    if (!llm) return base;

    const mergedOutcomes = (base.outcomes || []).map((baseOutcome, index) => {
      const byKey = (llm.outcomes || []).find((candidate) => outcomeMatchKey(candidate) === outcomeMatchKey(baseOutcome));
      const llmOutcome = byKey || llm.outcomes?.[index];
      if (!llmOutcome) return baseOutcome;
      return {
        ...baseOutcome,
        key_result: baseOutcome.key_result ?? llmOutcome.key_result ?? null,
        intervention: baseOutcome.intervention ?? llmOutcome.intervention ?? null,
        comparator: baseOutcome.comparator ?? llmOutcome.comparator ?? null,
        effect_size: baseOutcome.effect_size ?? llmOutcome.effect_size ?? null,
        p_value: baseOutcome.p_value ?? llmOutcome.p_value ?? null,
      };
    });

    return {
      ...base,
      sample_size: base.sample_size ?? llm.sample_size ?? null,
      population: base.population ?? llm.population ?? null,
      outcomes: mergedOutcomes,
      citation: {
        ...base.citation,
        doi: base.citation?.doi ?? llm.citation?.doi ?? null,
        pubmed_id: base.citation?.pubmed_id ?? llm.citation?.pubmed_id ?? null,
        openalex_id: base.citation?.openalex_id ?? llm.citation?.openalex_id ?? null,
      },
      citationCount: base.citationCount ?? llm.citationCount,
      pdf_url: base.pdf_url ?? llm.pdf_url ?? null,
      landing_page_url: base.landing_page_url ?? llm.landing_page_url ?? null,
    };
  });
}

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

function validateLlmStudyPayload(raw: unknown): StudyResult[] {
  const allowedStudyKeys = new Set([
    "study_id",
    "title",
    "year",
    "study_design",
    "sample_size",
    "population",
    "outcomes",
    "citation",
    "abstract_excerpt",
    "preprint_status",
    "review_type",
    "source",
    "citationCount",
    "pdf_url",
    "landing_page_url",
  ]);
  const allowedOutcomeKeys = new Set([
    "outcome_measured",
    "key_result",
    "citation_snippet",
    "intervention",
    "comparator",
    "effect_size",
    "p_value",
  ]);
  const allowedCitationKeys = new Set(["doi", "pubmed_id", "openalex_id", "formatted"]);
  const validDesigns = new Set(["RCT", "cohort", "cross-sectional", "review", "unknown"]);
  const validPreprint = new Set(["Preprint", "Peer-reviewed"]);
  const validReviewType = new Set(["None", "Systematic review", "Meta-analysis"]);
  const validSources = new Set(["openalex", "semantic_scholar", "arxiv", "pubmed"]);

  const payloadArray = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.results)
      ? raw.results
      : isRecord(raw) && Array.isArray(raw.studies)
        ? raw.studies
        : isRecord(raw) && Array.isArray(raw.data)
          ? raw.data
          : null;

  if (!payloadArray) {
    throw new Error("LLM response must be an array of studies");
  }

  const validated: StudyResult[] = [];

  for (const entry of payloadArray) {
    if (!isRecord(entry)) throw new Error("LLM response item must be an object");
    for (const key of Object.keys(entry)) {
      if (!allowedStudyKeys.has(key)) throw new Error(`Unexpected study field: ${key}`);
    }

    if (typeof entry.study_id !== "string" || !entry.study_id.trim()) throw new Error("study_id must be a non-empty string");
    if (typeof entry.title !== "string" || !entry.title.trim()) throw new Error("title must be a non-empty string");
    if (typeof entry.year !== "number" || !Number.isFinite(entry.year)) throw new Error("year must be a finite number");
    if (!validDesigns.has(String(entry.study_design))) throw new Error("invalid study_design");
    if (entry.sample_size !== null && (typeof entry.sample_size !== "number" || !Number.isFinite(entry.sample_size))) {
      throw new Error("sample_size must be number|null");
    }
    if (!isNullableText(entry.population)) throw new Error("population must be string|null");
    if (typeof entry.abstract_excerpt !== "string" || !entry.abstract_excerpt.trim()) throw new Error("abstract_excerpt must be a non-empty string");
    if (!validPreprint.has(String(entry.preprint_status))) throw new Error("invalid preprint_status");
    if (!validReviewType.has(String(entry.review_type))) throw new Error("invalid review_type");
    if (!validSources.has(String(entry.source))) throw new Error("invalid source");
    if (entry.citationCount !== undefined && entry.citationCount !== null && (typeof entry.citationCount !== "number" || !Number.isFinite(entry.citationCount))) {
      throw new Error("citationCount must be number|null");
    }
    if (entry.pdf_url !== undefined && !isNullableText(entry.pdf_url)) throw new Error("pdf_url must be string|null");
    if (entry.landing_page_url !== undefined && !isNullableText(entry.landing_page_url)) throw new Error("landing_page_url must be string|null");

    if (!Array.isArray(entry.outcomes)) throw new Error("outcomes must be an array");
    const outcomes: Outcome[] = entry.outcomes.map((outcome) => {
      if (!isRecord(outcome)) throw new Error("outcome must be an object");
      for (const key of Object.keys(outcome)) {
        if (!allowedOutcomeKeys.has(key)) throw new Error(`Unexpected outcome field: ${key}`);
      }
      if (typeof outcome.outcome_measured !== "string" || !outcome.outcome_measured.trim()) throw new Error("outcome_measured must be a non-empty string");
      if (!isNullableText(outcome.key_result)) throw new Error("key_result must be string|null");
      if (typeof outcome.citation_snippet !== "string" || !outcome.citation_snippet.trim()) throw new Error("citation_snippet must be a non-empty string");
      if (!isNullableText(outcome.intervention)) throw new Error("intervention must be string|null");
      if (!isNullableText(outcome.comparator)) throw new Error("comparator must be string|null");
      if (!isNullableText(outcome.effect_size)) throw new Error("effect_size must be string|null");
      if (!isNullableText(outcome.p_value)) throw new Error("p_value must be string|null");
      return {
        outcome_measured: outcome.outcome_measured,
        key_result: outcome.key_result,
        citation_snippet: outcome.citation_snippet,
        intervention: outcome.intervention,
        comparator: outcome.comparator,
        effect_size: outcome.effect_size,
        p_value: outcome.p_value,
      };
    });

    if (!isRecord(entry.citation)) throw new Error("citation must be an object");
    for (const key of Object.keys(entry.citation)) {
      if (!allowedCitationKeys.has(key)) throw new Error(`Unexpected citation field: ${key}`);
    }
    if (!isNullableText(entry.citation.doi)) throw new Error("citation.doi must be string|null");
    if (!isNullableText(entry.citation.pubmed_id)) throw new Error("citation.pubmed_id must be string|null");
    if (!isNullableText(entry.citation.openalex_id)) throw new Error("citation.openalex_id must be string|null");
    if (typeof entry.citation.formatted !== "string" || !entry.citation.formatted.trim()) throw new Error("citation.formatted must be a non-empty string");

    validated.push({
      study_id: entry.study_id,
      title: entry.title,
      year: entry.year,
      study_design: entry.study_design as StudyResult["study_design"],
      sample_size: entry.sample_size,
      population: entry.population,
      outcomes,
      citation: {
        doi: entry.citation.doi,
        pubmed_id: entry.citation.pubmed_id,
        openalex_id: entry.citation.openalex_id,
        formatted: entry.citation.formatted,
      },
      abstract_excerpt: entry.abstract_excerpt,
      preprint_status: entry.preprint_status as StudyResult["preprint_status"],
      review_type: entry.review_type as StudyResult["review_type"],
      source: entry.source as StudyResult["source"],
      citationCount: entry.citationCount ?? undefined,
      pdf_url: entry.pdf_url ?? null,
      landing_page_url: entry.landing_page_url ?? null,
    });
  }

  return validated;
}

async function extractStudyData(
  papers: UnifiedPaper[],
  question: string,
  openaiApiKey: string,
  deterministicByStudyId: Map<string, StudyResult>,
): Promise<{ studies: StudyResult[]; model: string; promptHash: string }> {
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
    deterministic: deterministicByStudyId.get(p.id) || null,
  }));

  const systemPrompt = `You are a deterministic-first medical extraction augmenter.

Rules:
1. Treat provided deterministic JSON as locked baseline.
2. Do not change non-nullable deterministic fields.
3. You may only fill nullable fields when currently null.
4. Keep the same study_ids and outcomes alignment.
5. Return strict JSON only; no markdown.`;

  const userPrompt = `Research Question: "${question}"

Papers to analyze:
${JSON.stringify(papersContext, null, 2)}

Fill only nullable fields for each deterministic study.`;

  const promptHash = hashString(systemPrompt);

  console.log(`[LLM] Sending ${papers.length} papers for extraction via Gemini`);

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
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
    const parsed = JSON.parse(jsonStr.trim());
    const results = validateLlmStudyPayload(parsed);
    console.log(`[LLM] Parsed and validated ${results.length} study results`);
    for (const study of results) {
      const matchedPaper = papers.find((p) => p.id === study.study_id);
      if (matchedPaper) {
        study.pdf_url = matchedPaper.pdfUrl || null;
        study.landing_page_url = matchedPaper.landingPageUrl || null;
      }
    }
    return { studies: results, model: LLM_MODEL, promptHash };
  } catch (parseError) {
    console.error("[LLM] JSON parse/validation error:", parseError);
    throw new Error("Failed strict JSON schema validation for LLM response");
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

interface StageValidated {
  question: string;
  requestPayload: SearchRequestPayload;
  queryPipelineMode: QueryPipelineMode;
  extractionEngine: ExtractionEngine;
  extractionMaxCandidates: number;
  geminiApiKey: string;
  pdfExtractorUrl?: string;
  pdfExtractorBearerToken?: string;
  pdfParseTimeoutMs: number;
  enrichmentContext: MetadataEnrichmentContext;
}

interface StagePrepared extends StageValidated {
  searchQuery: string;
  normalizedQueryForResponse?: string;
  queryProcessingMeta?: QueryProcessingMeta;
  queryTermsForRanking?: string[];
  sourceQueryOverrides: Partial<Record<SearchSource, string>>;
  shadowPreparedPromise?: Promise<Awaited<ReturnType<typeof prepareQueryProcessingV2>>>;
}

interface StageRetrieved extends StagePrepared {
  coverage: CoverageReport;
  papersByProvider: {
    semantic_scholar: UnifiedPaper[];
    openalex: UnifiedPaper[];
    arxiv: UnifiedPaper[];
    pubmed: UnifiedPaper[];
  };
  providerCandidates: UnifiedPaper[];
  enrichedLegacyPapers: UnifiedPaper[];
  papersWithAbstracts: UnifiedPaper[];
}

interface StageCanonicalized extends StageRetrieved {
  providerById: Map<string, UnifiedPaper>;
  providerByDoi: Map<string, UnifiedPaper>;
  canonicalCandidates: CanonicalPaper[];
}

interface StageQualityFiltered extends StageCanonicalized {
  filtered_count: number;
  keptCapped: CanonicalPaper[];
  evidence_table: SearchResponsePayload["evidence_table"];
  brief: SearchResponsePayload["brief"];
}

interface StageDeterministicExtracted extends StageQualityFiltered {
  extractionStartedAt: number;
  extractionCandidates: UnifiedPaper[];
  extraction_input_total: number;
  deterministicResults: Awaited<ReturnType<typeof extractStudiesDeterministic>>;
  deterministicMerged: StudyResult[];
  results: StudyResult[];
  partial_results: StudyResult[];
  needsNullableLlmAugment: boolean;
}

class ValidateStage implements PipelineStage<{ question: string; requestPayload: SearchRequestPayload; enrichmentContext: MetadataEnrichmentContext }, StageValidated> {
  readonly name = "VALIDATE" as const;

  async execute(input: { question: string; requestPayload: SearchRequestPayload; enrichmentContext: MetadataEnrichmentContext }): Promise<StageResult<StageValidated>> {
    const question = input.question.trim();
    if (!question) throw new StageError(this.name, "VALIDATION", "Question is required");
    if (!Number.isFinite(input.requestPayload.max_candidates) || input.requestPayload.max_candidates <= 0) {
      throw new StageError(this.name, "VALIDATION", "max_candidates must be a positive number");
    }
    if (!input.requestPayload.filters) throw new StageError(this.name, "VALIDATION", "filters are required");

    return {
      output: {
        question,
        requestPayload: input.requestPayload,
        queryPipelineMode: getQueryPipelineMode(),
        extractionEngine: getExtractionEngine(),
        extractionMaxCandidates: getExtractionMaxCandidates(),
        geminiApiKey: Deno.env.get("GOOGLE_GEMINI_API_KEY") || "",
        pdfExtractorUrl: Deno.env.get("PDF_EXTRACTOR_URL") || undefined,
        pdfExtractorBearerToken: Deno.env.get("PDF_EXTRACTOR_BEARER_TOKEN") || undefined,
        pdfParseTimeoutMs: getPdfParseTimeoutMs(),
        enrichmentContext: input.enrichmentContext,
      },
    };
  }
}

class PrepareQueryStage implements PipelineStage<StageValidated, StagePrepared> {
  readonly name = "PREPARE_QUERY" as const;

  async execute(input: StageValidated): Promise<StageResult<StagePrepared>> {
    const { normalized: v1Normalized, wasNormalized: v1WasNormalized } = normalizeQuery(input.question);
    let normalizedQueryForResponse = v1WasNormalized ? v1Normalized : undefined;
    let searchQuery = v1WasNormalized ? v1Normalized : input.question;
    let queryProcessingMeta: QueryProcessingMeta | undefined;
    let queryTermsForRanking: string[] | undefined;
    const sourceQueryOverrides: Partial<Record<SearchSource, string>> = {};
    let shadowPreparedPromise: Promise<Awaited<ReturnType<typeof prepareQueryProcessingV2>>> | null = null;

    if (input.queryPipelineMode === "v2") {
      const prepared = await prepareQueryProcessingV2(input.question, {
        llmApiKey: input.geminiApiKey || undefined,
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
    } else if (input.queryPipelineMode === "shadow") {
      shadowPreparedPromise = prepareQueryProcessingV2(input.question, {
        llmApiKey: input.geminiApiKey || undefined,
        fallbackTimeoutMs: 350,
      });
    }

    return {
      output: {
        ...input,
        searchQuery,
        normalizedQueryForResponse,
        queryProcessingMeta,
        queryTermsForRanking,
        sourceQueryOverrides,
        shadowPreparedPromise,
      },
    };
  }
}

class RetrieveProvidersStage implements PipelineStage<StagePrepared, StageRetrieved> {
  readonly name = "RETRIEVE_PROVIDERS" as const;

  async execute(input: StagePrepared): Promise<StageResult<StageRetrieved>> {
    const { coverage, papersByProvider, candidates: providerCandidates } = await runProviderPipeline({
      query: input.searchQuery,
      maxCandidates: input.requestPayload.max_candidates,
      mode: "balanced",
      sourceQueryOverrides: input.sourceQueryOverrides,
    });

    const s2Papers = papersByProvider.semantic_scholar;
    const openAlexPapers = papersByProvider.openalex;
    const arxivPapers = papersByProvider.arxiv;
    const pubmedPapers = papersByProvider.pubmed;

    const dedupedForLegacyFlow = deduplicateAndMerge(s2Papers, openAlexPapers, arxivPapers, pubmedPapers);
    const enrichedLegacyPapers = await enrichWithMetadata(dedupedForLegacyFlow, input.enrichmentContext, "research-async");
    const enrichedProviderCandidates = await enrichWithMetadata(providerCandidates, input.enrichmentContext, "research-async");
    const papersWithAbstracts = enrichedProviderCandidates.filter((paper) => paper.abstract && paper.abstract.length > 50);

    return {
      output: {
        ...input,
        coverage,
        papersByProvider: {
          semantic_scholar: s2Papers,
          openalex: openAlexPapers,
          arxiv: arxivPapers,
          pubmed: pubmedPapers,
        },
        providerCandidates: enrichedProviderCandidates,
        enrichedLegacyPapers,
        papersWithAbstracts,
      },
    };
  }
}

class CanonicalizeStage implements PipelineStage<StageRetrieved, StageCanonicalized> {
  readonly name = "CANONICALIZE" as const;

  async execute(input: StageRetrieved): Promise<StageResult<StageCanonicalized>> {
    const queryKeywords = getQueryKeywordSet(
      input.searchQuery,
      input.queryPipelineMode === "v2" ? input.queryTermsForRanking : undefined,
    );
    const rankedByQuery = [...input.papersWithAbstracts].sort(
      (left, right) => scorePaperCandidate(right, queryKeywords) - scorePaperCandidate(left, queryKeywords),
    );
    const cappedCandidates = rankedByQuery.slice(0, input.requestPayload.max_candidates);
    const providerById = new Map<string, UnifiedPaper>();
    const providerByDoi = new Map<string, UnifiedPaper>();
    for (const candidate of cappedCandidates) {
      providerById.set(candidate.id, candidate);
      const normalized = normalizeDoi(candidate.doi);
      if (normalized && !providerByDoi.has(normalized)) providerByDoi.set(normalized, candidate);
    }
    const canonicalCandidates = canonicalizePapers(cappedCandidates as InputPaper[]);

    return {
      output: {
        ...input,
        providerById,
        providerByDoi,
        canonicalCandidates,
      },
    };
  }
}

class QualityFilterStage implements PipelineStage<StageCanonicalized, StageQualityFiltered> {
  readonly name = "QUALITY_FILTER" as const;

  async execute(input: StageCanonicalized): Promise<StageResult<StageQualityFiltered>> {
    const timeframe: [number, number] = [input.requestPayload.filters.from_year, input.requestPayload.filters.to_year];
    const { kept, filtered_count } = applyQualityFilter(input.canonicalCandidates, input.requestPayload.filters, timeframe);
    const keptCapped = kept.slice(0, input.requestPayload.max_candidates);
    const { evidence_table, brief } = buildEvidenceAndBrief(keptCapped, input.requestPayload.max_evidence_rows);

    return {
      output: {
        ...input,
        filtered_count,
        keptCapped,
        evidence_table,
        brief,
      },
    };
  }
}

class DeterministicExtractStage implements PipelineStage<StageQualityFiltered, StageDeterministicExtracted> {
  readonly name = "DETERMINISTIC_EXTRACT" as const;

  async execute(input: StageQualityFiltered): Promise<StageResult<StageDeterministicExtracted>> {
    if (input.keptCapped.length === 0) {
      return {
        output: {
          ...input,
          extractionStartedAt: Date.now(),
          extractionCandidates: [],
          extraction_input_total: 0,
          deterministicResults: [],
          deterministicMerged: [],
          results: [],
          partial_results: [],
          needsNullableLlmAugment: false,
        },
      };
    }

    const extractionCandidates = input.keptCapped.slice(0, input.extractionMaxCandidates).map((paper) => {
      const base = canonicalToUnifiedPaper(paper);
      const providerMatch = input.providerById.get(paper.paper_id)
        || (paper.doi ? input.providerByDoi.get(normalizeDoi(paper.doi) || "") : undefined);
      if (providerMatch?.pdfUrl) base.pdfUrl = providerMatch.pdfUrl;
      if (providerMatch?.landingPageUrl) base.landingPageUrl = providerMatch.landingPageUrl;
      return base;
    });
    const extraction_input_total = extractionCandidates.length;
    const extractionStartedAt = Date.now();

    const deterministicInputs = extractionCandidates.map((paper) => toDeterministicInput(paper));
    const deterministicResults = await extractStudiesDeterministic(deterministicInputs, {
      question: input.question,
      pdfExtractorUrl: input.pdfExtractorUrl,
      pdfExtractorBearerToken: input.pdfExtractorBearerToken,
      pdfParseTimeoutMs: input.pdfParseTimeoutMs,
      batchSize: 10,
    });
    const deterministicMerged = mergeExtractedStudies(
      deterministicResults.map((row) => row.study as unknown as StudyResult),
    );
    const deterministicTiers = applyCompletenessTiers(deterministicMerged as unknown as DeterministicStudyResult[]);
    const needsNullableLlmAugment = input.extractionEngine !== "scripted"
      && Boolean(input.geminiApiKey)
      && deterministicMerged.some(hasNullableGaps);

    return {
      output: {
        ...input,
        extractionStartedAt,
        extractionCandidates,
        extraction_input_total,
        deterministicResults,
        deterministicMerged,
        results: deterministicTiers.complete as unknown as StudyResult[],
        partial_results: deterministicTiers.partial as unknown as StudyResult[],
        needsNullableLlmAugment,
      },
    };
  }
}

class LlmAugmentStage implements PipelineStage<
  StageDeterministicExtracted,
  StageDeterministicExtracted & {
    extraction_stats: Record<string, unknown>;
    extraction_metadata: {
      extractor_version: string;
      prompt_hash: string | null;
      model: string | null;
      deterministic_flag: boolean;
    };
  }
> {
  readonly name = "LLM_AUGMENT" as const;

  async execute(input: StageDeterministicExtracted): Promise<StageResult<
    StageDeterministicExtracted & {
      extraction_stats: Record<string, unknown>;
      extraction_metadata: {
        extractor_version: string;
        prompt_hash: string | null;
        model: string | null;
        deterministic_flag: boolean;
      };
    }
  >> {
    let deterministicMerged = [...input.deterministicMerged];
    let results = [...input.results];
    let partial_results = [...input.partial_results];
    let llmFallbackApplied = false;
    let llmPromptHash: string | null = null;
    let llmModel: string | null = null;

    if (input.needsNullableLlmAugment && input.geminiApiKey) {
      try {
        const batchSize = 15;
        const extractionBatches: Promise<{ studies: StudyResult[]; model: string; promptHash: string }>[] = [];
        const deterministicByStudyId = new Map<string, StudyResult>();
        for (const study of input.deterministicMerged) {
          if (study?.study_id) deterministicByStudyId.set(study.study_id, study);
        }
        for (let i = 0; i < input.extractionCandidates.length; i += batchSize) {
          extractionBatches.push(extractStudyData(
            input.extractionCandidates.slice(i, i + batchSize),
            input.question,
            input.geminiApiKey,
            deterministicByStudyId,
          ));
        }
        const extracted = await Promise.all(extractionBatches);
        llmModel = extracted[0]?.model || LLM_MODEL;
        llmPromptHash = extracted[0]?.promptHash || null;
        const llmExtracted = mergeExtractedStudies(extracted.flatMap((batch) => batch.studies));
        deterministicMerged = mergeNullableLlmFields(input.deterministicMerged, llmExtracted);
        const tiers = applyCompletenessTiers(deterministicMerged as unknown as DeterministicStudyResult[]);
        results = tiers.complete as unknown as StudyResult[];
        partial_results = tiers.partial as unknown as StudyResult[];
        llmFallbackApplied = true;
      } catch (error) {
        console.warn("[Pipeline] Nullable LLM augmentation failed:", error);
      }
    }

    if (results.length === 0 && partial_results.length === 0 && input.keptCapped.length > 0) {
      partial_results = input.keptCapped.slice(0, 50).map(canonicalToFallbackStudy);
    }

    return {
      output: {
        ...input,
        deterministicMerged,
        results,
        partial_results,
        extraction_stats: {
          ...(summarizeExtractionResults(input.deterministicResults, {
            totalInputs: input.extractionCandidates.length,
            completeTotal: results.length,
            partialTotal: partial_results.length,
            latencyMs: Date.now() - input.extractionStartedAt,
            engine: input.extractionEngine,
            llmFallbackApplied,
          }) as unknown as Record<string, unknown>),
          deterministic_fields: DETERMINISTIC_FIELDS,
          llm_nullable_fields: NULLABLE_LLM_FIELDS,
        },
        extraction_metadata: {
          extractor_version: DETERMINISTIC_EXTRACTOR_VERSION,
          prompt_hash: llmPromptHash,
          model: llmModel,
          deterministic_flag: true,
        },
      },
    };
  }
}

class PersistStage implements PipelineStage<{
  pipelineStartedAt: number;
  state: StageDeterministicExtracted & {
    extraction_stats: Record<string, unknown>;
    extraction_metadata: {
      extractor_version: string;
      prompt_hash: string | null;
      model: string | null;
      deterministic_flag: boolean;
    };
  };
}, PipelineResult> {
  readonly name = "PERSIST" as const;

  async execute(input: {
    pipelineStartedAt: number;
    state: StageDeterministicExtracted & {
      extraction_stats: Record<string, unknown>;
      extraction_metadata: {
        extractor_version: string;
        prompt_hash: string | null;
        model: string | null;
        deterministic_flag: boolean;
      };
    };
  }): Promise<StageResult<PipelineResult>> {
    const state = input.state;
    const stats: SearchStats = {
      latency_ms: Date.now() - input.pipelineStartedAt,
      candidates_total: state.canonicalCandidates.length,
      candidates_filtered: state.filtered_count,
      retrieved_total: state.providerCandidates.length,
      abstract_eligible_total: state.papersWithAbstracts.length,
      quality_kept_total: state.keptCapped.length,
      extraction_input_total: state.extraction_input_total,
      strict_complete_total: state.results.length,
      partial_total: state.partial_results.length,
    };

    return {
      output: {
        results: state.results,
        partial_results: state.partial_results,
        extraction_stats: state.extraction_stats,
        extraction_metadata: state.extraction_metadata,
        evidence_table: state.evidence_table,
        brief: state.brief,
        coverage: state.coverage,
        stats,
        canonical_papers: state.keptCapped,
        normalized_query: state.normalizedQueryForResponse,
        total_papers_searched: state.enrichedLegacyPapers.length,
        openalex_count: state.papersByProvider.openalex.length,
        semantic_scholar_count: state.papersByProvider.semantic_scholar.length,
        arxiv_count: state.papersByProvider.arxiv.length,
        pubmed_count: state.papersByProvider.pubmed.length,
        query_processing: state.queryProcessingMeta,
        query_pipeline_mode: state.queryPipelineMode,
      },
    };
  }
}

async function resolveShadowPreparedQuery(state: StageRetrieved): Promise<StageRetrieved> {
  if (state.queryPipelineMode !== "shadow") return state;
  if (!state.shadowPreparedPromise) return state;
  try {
    const prepared = await state.shadowPreparedPromise;
    return { ...state, queryProcessingMeta: prepared.query_processing, shadowPreparedPromise: undefined };
  } catch (error) {
    console.warn("[Pipeline] Shadow query processing failed:", error);
    return { ...state, shadowPreparedPromise: undefined };
  }
}

export async function runResearchPipeline(
  question: string,
  requestPayload: SearchRequestPayload,
  enrichmentContext: MetadataEnrichmentContext,
  observability?: {
    traceId?: string;
    runId?: string;
    emitEvent?: Parameters<typeof createStageContext>[0]["emitEvent"];
  },
): Promise<PipelineResult> {
  const pipelineStartedAt = Date.now();
  console.log(`[Pipeline] Processing query="${question}" max_candidates=${requestPayload.max_candidates}`);

  const stageCtx = createStageContext({
    traceId: observability?.traceId,
    runId: observability?.runId,
    emitEvent: observability?.emitEvent,
    stageTimeoutsMs: {
      VALIDATE: 2_000,
      PREPARE_QUERY: 5_000,
      RETRIEVE_PROVIDERS: 60_000,
      CANONICALIZE: 5_000,
      QUALITY_FILTER: 5_000,
      DETERMINISTIC_EXTRACT: 120_000,
      LLM_AUGMENT: 150_000,
      PERSIST: 2_000,
    },
  });

  const validated = await runStage(new ValidateStage(), { question, requestPayload, enrichmentContext }, stageCtx);
  const prepared = await runStage(new PrepareQueryStage(), validated, stageCtx);
  const retrievedRaw = await runStage(new RetrieveProvidersStage(), prepared, stageCtx);
  const retrieved = await resolveShadowPreparedQuery(retrievedRaw);
  const canonicalized = await runStage(new CanonicalizeStage(), retrieved, stageCtx);
  const qualityFiltered = await runStage(new QualityFilterStage(), canonicalized, stageCtx);
  const deterministicExtracted = await runStage(new DeterministicExtractStage(), qualityFiltered, stageCtx);
  const llmAugmented = await runStage(new LlmAugmentStage(), deterministicExtracted, stageCtx);
  return await runStage(new PersistStage(), { pipelineStartedAt, state: llmAugmented }, stageCtx);
}
