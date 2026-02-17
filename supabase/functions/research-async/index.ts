import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { prepareQueryProcessingV2, type QueryProcessingMeta, type SearchSource } from "../_shared/query-processing.ts";
import { providerHealthSnapshot, runProviderPipeline } from "./providers/index.ts";
import { extractSearchKeywords } from "./providers/query-builder.ts";
import { normalizeDoi } from "./providers/normalization.ts";
import type { UnifiedPaper } from "./providers/types.ts";
import {
  applyQualityFilter,
  buildEvidenceAndBrief,
  canonicalizePapers,
  defaultSearchRequestFromQuestion,
  sanitizeSearchRequest,
  type CanonicalPaper,
  type CoverageReport,
  type InputPaper,
  type SearchRequestPayload,
  type SearchResponsePayload,
  type SearchStats,
} from "../_shared/lit-search.ts";
import {
  getMetadataEnrichmentRuntimeConfig,
  runMetadataEnrichment,
  selectEffectiveEnrichmentMode,
  type EnrichmentInputPaper,
} from "../_shared/metadata-enrichment.ts";
import { MetadataEnrichmentStore, type MetadataEnrichmentMode } from "../_shared/metadata-enrichment-store.ts";
import {
  applyCompletenessTiers,
  extractStudiesDeterministic,
  summarizeExtractionResults,
  type DeterministicExtractionInput,
  type DeterministicStudyResult,
} from "../_shared/study-extraction.ts";
import {
  getExtractionRunDetail,
  listExtractionRuns,
  persistExtractionRun,
} from "../_shared/extraction-runs.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface Outcome {
  outcome_measured: string;
  key_result: string | null;
  citation_snippet: string;
  intervention: string | null;
  comparator: string | null;
  effect_size: string | null;
  p_value: string | null;
}

interface Citation {
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  formatted: string;
}

interface StudyResult {
  study_id: string;
  title: string;
  year: number;
  study_design: "RCT" | "cohort" | "cross-sectional" | "review" | "unknown";
  sample_size: number | null;
  population: string | null;
  outcomes: Outcome[];
  citation: Citation;
  abstract_excerpt: string;
  preprint_status: "Preprint" | "Peer-reviewed";
  review_type: "None" | "Systematic review" | "Meta-analysis";
  source: "openalex" | "semantic_scholar" | "arxiv" | "pubmed";
  citationCount?: number;
  pdf_url?: string | null;
  landing_page_url?: string | null;
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

type QueryPipelineMode = "v1" | "v2" | "shadow";
type ExtractionEngine = "llm" | "scripted" | "hybrid";
type ResearchJobStatus = "queued" | "leased" | "completed" | "dead";

interface ResearchJobRecord {
  id: string;
  report_id: string;
  stage: string;
  provider: string;
  payload: Record<string, unknown>;
  status: ResearchJobStatus;
  attempts: number;
  max_attempts: number;
  dedupe_key: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
}

const RESEARCH_JOB_STAGE_PIPELINE = "pipeline";
const RESEARCH_JOB_PROVIDER = "research-async";

function getQueryPipelineMode(): QueryPipelineMode {
  const raw = (Deno.env.get("QUERY_PIPELINE_MODE") || "shadow").toLowerCase();
  if (raw === "v1" || raw === "v2" || raw === "shadow") return raw;
  return "shadow";
}

function getExtractionEngine(): ExtractionEngine {
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

function hashKey(raw: string): string {
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ─── Deduplication ───────────────────────────────────────────────────────────

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
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
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


// ─── Metadata Enrichment ─────────────────────────────────────────────────────

interface MetadataEnrichmentContext {
  mode: MetadataEnrichmentMode;
  store?: MetadataEnrichmentStore;
  sourceTrust?: Record<string, number>;
  userId?: string;
  reportId?: string;
  searchId?: string;
  retryMax?: number;
  maxLatencyMs?: number;
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

// ─── Study Completeness Filter ──────────────────────────────────────────────

function isCompleteStudy(study: StudyResult): boolean {
  if (!study.title || !study.year) return false;
  if (study.study_design === "unknown") return false;
  if (!study.abstract_excerpt || study.abstract_excerpt.trim().length < 50) return false;
  if (!study.outcomes || study.outcomes.length === 0) return false;
  const hasCompleteOutcome = study.outcomes.some((o: Outcome) =>
    o.outcome_measured &&
    (o.effect_size || o.p_value || o.intervention || o.comparator)
  );
  return hasCompleteOutcome;
}

function getQueryKeywordSet(query: string, precomputedTerms?: string[]): Set<string> {
  if (precomputedTerms && precomputedTerms.length > 0) {
    return new Set(precomputedTerms.map((k) => k.trim().toLowerCase()).filter(Boolean));
  }
  const { originalTerms, expandedTerms } = extractSearchKeywords(query);
  const keywords = [...originalTerms, ...expandedTerms]
    .map(k => k.trim())
    .filter(Boolean);
  return new Set(keywords);
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

// ─── LLM Extraction ─────────────────────────────────────────────────────────

async function extractStudyData(
  papers: UnifiedPaper[],
  question: string,
  openaiApiKey: string
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

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, {
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

    // Merge pdf_url / landing_page_url from original papers into LLM results
    for (const study of results) {
      const matchedPaper = papers.find(p => p.id === study.study_id);
      if (matchedPaper) {
        study.pdf_url = matchedPaper.pdfUrl || null;
        study.landing_page_url = matchedPaper.landingPageUrl || null;
      }
    }

    return results;
  } catch (parseError) {
    console.error(`[LLM] JSON parse error:`, parseError);
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

// ─── Full Research Pipeline ──────────────────────────────────────────────────

interface PipelineResult {
  results: StudyResult[];
  partial_results: StudyResult[];
  extraction_stats: Record<string, unknown>;
  evidence_table: SearchResponsePayload["evidence_table"];
  brief: SearchResponsePayload["brief"];
  coverage: CoverageReport;
  stats: SearchStats;
  canonical_papers: CanonicalPaper[];
  normalized_query?: string;
  total_papers_searched: number;
  openalex_count: number;
  semantic_scholar_count: number;
  arxiv_count: number;
  pubmed_count: number;
  query_processing?: QueryProcessingMeta;
  query_pipeline_mode: QueryPipelineMode;
}

async function runResearchPipeline(
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
      if (!GEMINI_API_KEY) {
        throw new Error("GOOGLE_GEMINI_API_KEY required when EXTRACTION_ENGINE=llm");
      }

      try {
        const batchSize = 15;
        const extractionBatches: Promise<StudyResult[]>[] = [];
        for (let i = 0; i < extractionCandidates.length; i += batchSize) {
          const batch = extractionCandidates.slice(i, i + batchSize);
          extractionBatches.push(extractStudyData(batch, question, GEMINI_API_KEY));
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
            const batch = extractionCandidates.slice(i, i + batchSize);
            llmBatches.push(extractStudyData(batch, question, GEMINI_API_KEY));
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

// ─── Rate Limiting ───────────────────────────────────────────────────────────

type SupabaseClientLike = ReturnType<typeof createClient>;

async function checkRateLimit(
  supabase: SupabaseClientLike,
  functionName: string,
  clientIp: string,
  maxRequests: number,
  windowMinutes: number
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("function_name", functionName)
    .eq("client_ip", clientIp)
    .gte("created_at", windowStart);

  if (error) {
    console.error("[rate-limit] Check failed:", error);
    return true; // fail open
  }

  if ((count || 0) >= maxRequests) return false;

  await supabase.from("rate_limits").insert({ function_name: functionName, client_ip: clientIp });
  return true;
}

async function recordQueryProcessingEvent(
  supabase: SupabaseClientLike,
  params: {
    functionName: string;
    mode: QueryPipelineMode;
    reportId?: string;
    originalQuery: string;
    servedQuery: string;
    normalizedQuery?: string;
    queryProcessing?: QueryProcessingMeta;
    userId?: string;
  },
): Promise<void> {
  if (!params.queryProcessing) return;

  const payload = {
    function_name: params.functionName,
    mode: params.mode,
    user_id: params.userId ?? null,
    report_id: params.reportId ?? null,
    original_query: params.originalQuery,
    served_query: params.servedQuery,
    normalized_query: params.normalizedQuery ?? null,
    deterministic_confidence: params.queryProcessing.deterministic_confidence,
    used_llm_fallback: params.queryProcessing.used_llm_fallback,
    processing_ms: params.queryProcessing.processing_ms,
    reason_codes: params.queryProcessing.reason_codes,
    source_queries: params.queryProcessing.source_queries,
  };

  const { error } = await supabase.from("query_processing_events").insert(payload);
  if (error) {
    console.warn("[query-processing] Failed to record event:", error.message);
  }
}

function runningSearchResponse(searchId: string): SearchResponsePayload {
  return {
    search_id: searchId,
    status: "running",
    coverage: {
      providers_queried: 0,
      providers_failed: 0,
      failed_provider_names: [],
      degraded: false,
    },
    evidence_table: [],
    brief: { sentences: [] },
    stats: {
      latency_ms: 0,
      candidates_total: 0,
      candidates_filtered: 0,
    },
    run_version: 0,
  };
}

function mapReportToSearchResponse(report: {
  id?: string;
  status?: string;
  error_message?: string | null;
  active_extraction_run_id?: string | null;
  extraction_run_count?: number | null;
  lit_response?: Partial<SearchResponsePayload> & { error?: string };
}): SearchResponsePayload {
  const payload = report?.lit_response || {};
  const status = report?.status === "failed"
    ? "failed"
    : report?.status === "completed"
      ? "completed"
      : "running";

  return {
    search_id: String(report?.id || payload.search_id || ""),
    status,
    coverage: payload.coverage || {
      providers_queried: 0,
      providers_failed: 0,
      failed_provider_names: [],
      degraded: false,
    },
    evidence_table: payload.evidence_table || [],
    brief: payload.brief || { sentences: [] },
    stats: payload.stats || {
      latency_ms: 0,
      candidates_total: 0,
      candidates_filtered: 0,
    },
    active_run_id: report?.active_extraction_run_id || payload.active_run_id || undefined,
    run_version: report?.extraction_run_count ?? payload.run_version ?? undefined,
    error: report?.error_message || payload.error || undefined,
  };
}

async function readCachedSearch(
  supabase: SupabaseClientLike,
  cacheKey: string,
): Promise<SearchResponsePayload | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("lit_query_cache")
    .select("response_payload")
    .eq("cache_key", cacheKey)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (error) {
    console.warn("[cache] read failed:", error.message);
    return null;
  }

  return (data?.response_payload as SearchResponsePayload) || null;
}

async function writeSearchCache(
  supabase: SupabaseClientLike,
  cacheKey: string,
  requestPayload: SearchRequestPayload,
  responsePayload: SearchResponsePayload,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
  const { error } = await supabase.from("lit_query_cache").upsert({
    cache_key: cacheKey,
    request_payload: requestPayload,
    response_payload: responsePayload,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "cache_key" });

  if (error) {
    console.warn("[cache] write failed:", error.message);
  }
}

async function createExtractionRunForSearch(
  supabase: SupabaseClientLike,
  params: {
    reportId: string;
    userId?: string;
    trigger: "initial_pipeline" | "initial_pipeline_cached";
    engine: "llm" | "scripted" | "hybrid" | "unknown";
    question: string;
    normalizedQuery?: string;
    litRequest?: SearchRequestPayload;
    litResponse?: SearchResponsePayload;
    results?: StudyResult[];
    partialResults?: StudyResult[];
    evidenceTable?: SearchResponsePayload["evidence_table"];
    brief?: SearchResponsePayload["brief"];
    coverage?: CoverageReport;
    stats?: SearchStats;
    extractionStats?: Record<string, unknown>;
    canonicalPapers?: CanonicalPaper[];
  },
): Promise<{ runId: string; runIndex: number }> {
  const persisted = await persistExtractionRun(supabase, {
    reportId: params.reportId,
    userId: params.userId,
    trigger: params.trigger,
    status: "completed",
    engine: params.engine,
    question: params.question,
    normalizedQuery: params.normalizedQuery ?? null,
    litRequest: (params.litRequest as unknown as Record<string, unknown>) || {},
    litResponse: (params.litResponse as unknown as Record<string, unknown>) || {},
    results: params.results || [],
    partialResults: params.partialResults || [],
    evidenceTable: params.evidenceTable || [],
    briefJson: (params.brief as unknown as Record<string, unknown>) || {},
    coverageReport: (params.coverage as unknown as Record<string, unknown>) || {},
    searchStats: (params.stats as unknown as Record<string, unknown>) || {},
    extractionStats: params.extractionStats || {},
    canonicalPapers: params.canonicalPapers || [],
    completedAt: new Date().toISOString(),
  });

  return {
    runId: persisted.runId,
    runIndex: persisted.runIndex,
  };
}

async function upsertPaperCache(supabase: SupabaseClientLike, papers: CanonicalPaper[]): Promise<void> {
  if (papers.length === 0) return;
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
  const payload = papers.slice(0, 500).map((paper) => ({
    paper_id: paper.paper_id,
    paper_payload: paper,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("lit_paper_cache").upsert(payload, { onConflict: "paper_id" });
  if (error) {
    console.warn("[paper-cache] upsert failed:", error.message);
  }
}

function getPathParts(req: Request): string[] {
  const path = new URL(req.url).pathname
    .replace(/^\/functions\/v1\/research-async\/?/, "")
    .replace(/^\/research-async\/?/, "")
    .replace(/^\/+/, "");
  return path.split("/").filter(Boolean);
}

function buildResearchJobDedupeKey(reportId: string, stage: string, provider: string): string {
  return `${stage}:${provider}:${reportId}`;
}

async function enqueueResearchJob(
  supabase: SupabaseClientLike,
  params: {
    reportId: string;
    question: string;
    userId: string;
    litRequest: SearchRequestPayload;
    cacheKey: string;
    stage?: string;
    provider?: string;
    maxAttempts?: number;
  },
): Promise<ResearchJobRecord> {
  const stage = params.stage || RESEARCH_JOB_STAGE_PIPELINE;
  const provider = params.provider || RESEARCH_JOB_PROVIDER;
  const dedupeKey = buildResearchJobDedupeKey(params.reportId, stage, provider);

  const { data, error } = await supabase.rpc("research_jobs_enqueue", {
    p_report_id: params.reportId,
    p_stage: stage,
    p_provider: provider,
    p_payload: {
      report_id: params.reportId,
      question: params.question,
      user_id: params.userId,
      lit_request: params.litRequest,
      cache_key: params.cacheKey,
    },
    p_dedupe_key: dedupeKey,
    p_max_attempts: params.maxAttempts ?? 5,
  });

  if (error) {
    throw new Error(`Failed to enqueue research job: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("Failed to enqueue research job: empty response");
  }

  return row as ResearchJobRecord;
}

async function claimResearchJobs(
  supabase: SupabaseClientLike,
  workerId: string,
  batchSize: number,
  leaseSeconds: number,
): Promise<ResearchJobRecord[]> {
  const { data, error } = await supabase.rpc("research_jobs_claim", {
    p_worker_id: workerId,
    p_batch_size: batchSize,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    throw new Error(`Failed to claim research jobs: ${error.message}`);
  }
  return Array.isArray(data) ? data as ResearchJobRecord[] : [];
}

async function completeResearchJob(
  supabase: SupabaseClientLike,
  jobId: string,
  workerId: string,
): Promise<ResearchJobRecord | null> {
  const { data, error } = await supabase.rpc("research_jobs_complete", {
    p_job_id: jobId,
    p_worker_id: workerId,
  });
  if (error) {
    throw new Error(`Failed to complete research job: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ResearchJobRecord | null) || null;
}

async function failResearchJob(
  supabase: SupabaseClientLike,
  jobId: string,
  workerId: string,
  errorMessage: string,
): Promise<ResearchJobRecord | null> {
  const { data, error } = await supabase.rpc("research_jobs_fail", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_error: errorMessage,
  });
  if (error) {
    throw new Error(`Failed to fail research job: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ResearchJobRecord | null) || null;
}

async function processPipelineJob(
  supabase: SupabaseClientLike,
  job: ResearchJobRecord,
  metadataRuntime: ReturnType<typeof getMetadataEnrichmentRuntimeConfig>,
  metadataStore: MetadataEnrichmentStore,
  metadataSourceTrust: Record<string, number>,
): Promise<void> {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const reportId = job.report_id;
  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const userId = typeof payload.user_id === "string" ? payload.user_id : "";
  const litRequest = sanitizeSearchRequest(
    (payload.lit_request || defaultSearchRequestFromQuestion(question)) as Partial<SearchRequestPayload>,
  );
  const cacheKey = typeof payload.cache_key === "string"
    ? payload.cache_key
    : hashKey(JSON.stringify(litRequest));

  if (!question || !userId || !reportId) {
    throw new Error("job payload missing required fields");
  }

  const { data: report } = await supabase
    .from("research_reports")
    .select("id,status")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) {
    throw new Error("report not found");
  }

  if (report.status === "completed") {
    return;
  }

  await supabase
    .from("research_reports")
    .update({
      status: "processing",
      error_message: null,
    })
    .eq("id", reportId);

  const metadataMode = selectEffectiveEnrichmentMode(metadataRuntime);
  const data = await runResearchPipeline(question, litRequest, {
    mode: metadataMode,
    store: metadataStore,
    sourceTrust: metadataSourceTrust,
    userId,
    reportId,
    searchId: reportId,
    retryMax: metadataRuntime.retryMax,
    maxLatencyMs: metadataRuntime.maxLatencyMs,
  });

  const responsePayload: SearchResponsePayload = {
    search_id: reportId,
    status: "completed",
    coverage: data.coverage,
    evidence_table: data.evidence_table,
    brief: data.brief,
    stats: data.stats,
  };

  const runSnapshot = await createExtractionRunForSearch(supabase, {
    reportId,
    userId,
    trigger: "initial_pipeline",
    engine: (() => {
      const raw = String((data.extraction_stats || {}).engine || "unknown").toLowerCase();
      if (raw === "llm" || raw === "scripted" || raw === "hybrid" || raw === "manual") return raw;
      return "unknown";
    })(),
    question,
    normalizedQuery: data.normalized_query || null,
    litRequest,
    litResponse: responsePayload,
    results: data.results || [],
    partialResults: data.partial_results || [],
    evidenceTable: data.evidence_table || [],
    brief: data.brief,
    coverage: data.coverage,
    stats: data.stats,
    extractionStats: data.extraction_stats || {},
    canonicalPapers: data.canonical_papers || [],
  });
  responsePayload.active_run_id = runSnapshot.runId;
  responsePayload.run_version = runSnapshot.runIndex;

  const { error: updateError } = await supabase
    .from("research_reports")
    .update({
      status: "completed",
      results: [...(data.results || []), ...(data.partial_results || [])],
      normalized_query: data.normalized_query || null,
      total_papers_searched: data.total_papers_searched || 0,
      openalex_count: data.openalex_count || 0,
      semantic_scholar_count: data.semantic_scholar_count || 0,
      arxiv_count: data.arxiv_count || 0,
      pubmed_count: data.pubmed_count || 0,
      lit_request: litRequest,
      lit_response: responsePayload,
      coverage_report: responsePayload.coverage,
      evidence_table: responsePayload.evidence_table,
      brief_json: responsePayload.brief,
      search_stats: responsePayload.stats,
      active_extraction_run_id: runSnapshot.runId,
      extraction_run_count: runSnapshot.runIndex,
      completed_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", reportId);

  if (updateError) {
    throw new Error(`DB update failed: ${updateError.message}`);
  }

  await writeSearchCache(supabase, cacheKey, litRequest, responsePayload);
  await upsertPaperCache(supabase, data.canonical_papers);
  await recordQueryProcessingEvent(supabase, {
    functionName: "research-async",
    mode: data.query_pipeline_mode,
    reportId,
    originalQuery: question,
    servedQuery: data.normalized_query || question,
    normalizedQuery: data.normalized_query,
    queryProcessing: data.query_processing,
    userId,
  });

  const dois = (data.results || [])
    .map((result: StudyResult) => result.citation?.doi?.trim())
    .filter((doi: string | undefined): doi is string => Boolean(doi));

  if (dois.length > 0) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const scihubUrl = `${supabaseUrl}/functions/v1/scihub-download`;
    fetch(scihubUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ report_id: reportId, dois, user_id: userId }),
    }).catch((err) => console.error("[research-async] Failed to trigger PDF downloads:", err));
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const pathParts = getPathParts(req);
    const isLitRoute = pathParts[0] === "v1" && pathParts[1] === "lit";
    const isWorkerDrainRoute = req.method === "POST" && isLitRoute && pathParts[2] === "jobs" && pathParts[3] === "drain";

    if (isWorkerDrainRoute) {
      const workerToken = Deno.env.get("RESEARCH_JOB_WORKER_TOKEN");
      const suppliedToken = req.headers.get("x-research-worker-token");
      if (!workerToken || suppliedToken !== workerToken) {
        return new Response(JSON.stringify({ error: "Unauthorized worker request" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json().catch(() => ({}));
      const batchSizeRaw = Number(body?.batch_size ?? 1);
      const leaseSecondsRaw = Number(body?.lease_seconds ?? 120);
      const batchSize = Number.isFinite(batchSizeRaw) ? Math.min(25, Math.max(1, Math.trunc(batchSizeRaw))) : 1;
      const leaseSeconds = Number.isFinite(leaseSecondsRaw) ? Math.min(900, Math.max(30, Math.trunc(leaseSecondsRaw))) : 120;
      const workerId = typeof body?.worker_id === "string" && body.worker_id.trim().length > 0
        ? body.worker_id.trim()
        : `research-worker-${crypto.randomUUID()}`;

      const metadataRuntime = getMetadataEnrichmentRuntimeConfig();
      const metadataStore = new MetadataEnrichmentStore(supabase);
      const metadataSourceTrust = await metadataStore.getSourceTrustMap();

      const jobs = await claimResearchJobs(supabase, workerId, batchSize, leaseSeconds);
      let completed = 0;
      let retried = 0;
      let dead = 0;
      const failures: Array<{ job_id: string; error: string }> = [];

      for (const job of jobs) {
        try {
          await processPipelineJob(supabase, job, metadataRuntime, metadataStore, metadataSourceTrust);
          await completeResearchJob(supabase, job.id, workerId);
          completed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown_error";
          failures.push({ job_id: job.id, error: message });
          const updated = await failResearchJob(supabase, job.id, workerId, message);

          if (updated?.status === "dead") {
            dead += 1;
            await supabase
              .from("research_reports")
              .update({
                status: "failed",
                error_message: message,
                completed_at: new Date().toISOString(),
              })
              .eq("id", job.report_id);
          } else {
            retried += 1;
            await supabase
              .from("research_reports")
              .update({
                status: "queued",
                error_message: message,
              })
              .eq("id", job.report_id);
          }
        }
      }

      return new Response(JSON.stringify({
        worker_id: workerId,
        claimed: jobs.length,
        completed,
        retried,
        dead,
        failures,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = userData.user.id;

    if (req.method === "GET" && isLitRoute && pathParts[2] === "providers" && pathParts[3] === "health") {
      const health = await providerHealthSnapshot();
      return new Response(JSON.stringify(health), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET" && isLitRoute && pathParts[2] === "search" && pathParts[3] && pathParts[4] === "runs" && pathParts[5]) {
      const searchId = pathParts[3];
      const runId = pathParts[5];
      const { data: report, error } = await supabase
        .from("research_reports")
        .select("id,user_id")
        .eq("id", searchId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load search" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!report) {
        return new Response(JSON.stringify({ error: "search_id not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const detail = await getExtractionRunDetail(supabase, searchId, runId);
      if (!detail) {
        return new Response(JSON.stringify({ error: "run_id not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(detail), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET" && isLitRoute && pathParts[2] === "search" && pathParts[3] && pathParts[4] === "runs") {
      const searchId = pathParts[3];
      const { data: report, error } = await supabase
        .from("research_reports")
        .select("id,user_id,active_extraction_run_id")
        .eq("id", searchId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load search" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!report) {
        return new Response(JSON.stringify({ error: "search_id not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const runs = await listExtractionRuns(supabase, searchId, report.active_extraction_run_id || null);
      return new Response(JSON.stringify({ search_id: searchId, runs }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET" && isLitRoute && pathParts[2] === "search" && pathParts[3]) {
      const searchId = pathParts[3];
      const { data: report, error } = await supabase
        .from("research_reports")
        .select("id,status,error_message,lit_response,user_id,active_extraction_run_id,extraction_run_count")
        .eq("id", searchId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load search" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!report) {
        return new Response(JSON.stringify({ error: "search_id not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(mapReportToSearchResponse(report)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "GET" && isLitRoute && pathParts[2] === "paper" && pathParts[3]) {
      const paperId = decodeURIComponent(pathParts[3]);
      const nowIso = new Date().toISOString();
      const { data: paperCache, error } = await supabase
        .from("lit_paper_cache")
        .select("paper_payload")
        .eq("paper_id", paperId)
        .gt("expires_at", nowIso)
        .maybeSingle();

      if (error) {
        return new Response(JSON.stringify({ error: "Failed to load paper" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!paperCache) {
        return new Response(JSON.stringify({ error: "paper_id not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify(paperCache.paper_payload), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isStartRequest =
      req.method === "POST" &&
      ((isLitRoute && pathParts[2] === "search") || pathParts.length === 0);

    if (!isStartRequest) {
      return new Response(JSON.stringify({ error: "Unsupported route" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const allowed = await checkRateLimit(supabase, "research-async", clientIp, 10, 60);
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rawBody = await req.json().catch(() => ({}));
    const legacyQuestion = typeof rawBody?.question === "string" ? rawBody.question.trim() : "";
    const litRequest = isLitRoute
      ? sanitizeSearchRequest(rawBody as Partial<SearchRequestPayload>)
      : sanitizeSearchRequest(defaultSearchRequestFromQuestion(legacyQuestion));
    const question = (litRequest.query || legacyQuestion).trim();

    if (!question || question.length < 5) {
      return new Response(JSON.stringify({ error: "Please provide a valid research query (at least 5 characters)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (question.length > 500) {
      return new Response(JSON.stringify({ error: "Query is too long (maximum 500 characters)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cacheKey = hashKey(JSON.stringify(litRequest));
    const { data: report, error: insertError } = await supabase
      .from("research_reports")
      .insert({
        question,
        status: "queued",
        user_id: userId,
      })
      .select("id")
      .single();

    if (insertError || !report) {
      console.error("[research-async] Insert error:", insertError);
      throw new Error("Failed to create report");
    }

    const reportId = report.id as string;

    if (isLitRoute) {
      const cached = await readCachedSearch(supabase, cacheKey);
      if (cached && cached.status === "completed") {
        const replayed: SearchResponsePayload = { ...cached, search_id: reportId };
        const runSnapshot = await createExtractionRunForSearch(supabase, {
          reportId,
          userId,
          trigger: "initial_pipeline_cached",
          engine: "unknown",
          question,
          normalizedQuery: null,
          litRequest,
          litResponse: replayed,
          results: [],
          partialResults: [],
          evidenceTable: replayed.evidence_table || [],
          brief: replayed.brief || { sentences: [] },
          coverage: replayed.coverage,
          stats: replayed.stats,
          extractionStats: {},
          canonicalPapers: [],
        });
        replayed.active_run_id = runSnapshot.runId;
        replayed.run_version = runSnapshot.runIndex;

        await supabase
          .from("research_reports")
          .update({
            status: "completed",
            active_extraction_run_id: runSnapshot.runId,
            extraction_run_count: runSnapshot.runIndex,
            lit_request: litRequest,
            lit_response: replayed,
            coverage_report: replayed.coverage,
            evidence_table: replayed.evidence_table,
            brief_json: replayed.brief,
            search_stats: replayed.stats,
            completed_at: new Date().toISOString(),
          })
          .eq("id", reportId);

        return new Response(JSON.stringify(replayed), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    await enqueueResearchJob(supabase, {
      reportId,
      question,
      userId,
      litRequest,
      cacheKey,
      stage: RESEARCH_JOB_STAGE_PIPELINE,
      provider: RESEARCH_JOB_PROVIDER,
      maxAttempts: 5,
    });

    if (isLitRoute) {
      return new Response(JSON.stringify(runningSearchResponse(reportId)), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ report_id: reportId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[research-async] Error:", error);
    return new Response(
      JSON.stringify({ error: "An unexpected error occurred" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
