export type StudyDesign = "RCT" | "cohort" | "cross-sectional" | "review" | "unknown";
export type StudySource = "openalex" | "semantic_scholar" | "arxiv" | "pubmed";

export interface DeterministicOutcome {
  outcome_measured: string;
  key_result: string | null;
  citation_snippet: string;
  intervention: string | null;
  comparator: string | null;
  effect_size: string | null;
  p_value: string | null;
}

export interface DeterministicCitation {
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  formatted: string;
}

export interface DeterministicStudyResult {
  study_id: string;
  title: string;
  year: number;
  study_design: StudyDesign;
  sample_size: number | null;
  population: string | null;
  outcomes: DeterministicOutcome[];
  citation: DeterministicCitation;
  abstract_excerpt: string;
  preprint_status: "Preprint" | "Peer-reviewed";
  review_type: "None" | "Systematic review" | "Meta-analysis";
  source: StudySource;
  citationCount?: number;
  pdf_url?: string | null;
  landing_page_url?: string | null;
}

export interface DeterministicExtractionInput {
  study_id: string;
  title: string;
  year: number;
  abstract: string;
  authors?: string[];
  venue?: string;
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  source: StudySource;
  citationCount?: number;
  publicationTypes?: string[];
  preprint_status?: "Preprint" | "Peer-reviewed";
  pdf_url?: string | null;
  landing_page_url?: string | null;
}

export interface ExtractionDiagnostics {
  engine: "pdf" | "abstract";
  used_pdf: boolean;
  fallback_reason: string | null;
  parse_error: string | null;
  outcome_confidence: number[];
}

export interface ExtractionResult {
  study: DeterministicStudyResult;
  diagnostics: ExtractionDiagnostics;
}

export interface ExtractionStats {
  total_inputs: number;
  extracted_total: number;
  complete_total: number;
  partial_total: number;
  used_pdf: number;
  used_abstract_fallback: number;
  failures: number;
  fallback_reasons: Record<string, number>;
  engine: "llm" | "scripted" | "hybrid";
  llm_fallback_applied: boolean;
  latency_ms: number;
}

export interface ExtractDeterministicOptions {
  question?: string;
  pdfExtractorUrl?: string;
  pdfExtractorBearerToken?: string;
  pdfParseTimeoutMs?: number;
  batchSize?: number;
  fetchImpl?: typeof fetch;
}

interface PdfExtractorRequestPaper {
  study_id: string;
  title: string;
  year: number;
  source: StudySource;
  doi: string | null;
  pubmed_id: string | null;
  openalex_id: string | null;
  abstract: string;
  pdf_url: string | null;
  landing_page_url: string | null;
  citationCount?: number;
  preprint_status?: "Preprint" | "Peer-reviewed";
}

interface PdfExtractorResponseItem {
  study_id: string;
  study?: DeterministicStudyResult;
  diagnostics?: Partial<ExtractionDiagnostics>;
  error?: string;
}

interface PdfExtractorResponse {
  results?: PdfExtractorResponseItem[];
}

const EFFECT_PATTERN = /\b(?:OR|RR|HR|SMD|MD|IRR|beta|β|Cohen'?s?\s*d|d)\s*(?:=|:)\s*[-+]?\d+(?:\.\d+)?(?:\s*\([^)]*\))?/i;
const CI_PATTERN = /\b(?:95%\s*CI|CI\s*95%|confidence\s*interval)\b[^.;]*/i;
const P_VALUE_PATTERN = /\bp\s*(?:=|<|>|<=|>=)\s*0?\.\d+/i;
const SAMPLE_SIZE_PATTERNS: RegExp[] = [
  /\bn\s*=\s*(\d{2,7})\b/i,
  /\bN\s*=\s*(\d{2,7})\b/i,
  /\b(\d{2,7})\s+(?:participants|patients|subjects|adults|children|individuals)\b/i,
];
const RESULT_MARKERS = [
  "significant",
  "associated",
  "increase",
  "decrease",
  "improv",
  "reduc",
  "odds ratio",
  "hazard ratio",
  "risk ratio",
  "confidence interval",
  "p=",
  "p <",
  "p>",
  "versus",
  "vs",
  "compared",
];

function normalizeWhitespace(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/[\t\f\v]+/g, " ").replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function formatCitation(input: DeterministicExtractionInput): string {
  const authors = (input.authors || []).slice(0, 3).join(", ");
  const etAl = (input.authors || []).length > 3 ? " et al." : "";
  const year = input.year || "n.d.";
  const venue = input.venue || "";
  const authorPrefix = authors ? `${authors}${etAl}` : "Unknown";
  return `${authorPrefix} (${year}). ${input.title}. ${venue}`.trim();
}

function classifyReviewType(text: string): "None" | "Systematic review" | "Meta-analysis" {
  const lowered = text.toLowerCase();
  if (lowered.includes("meta-analysis") || lowered.includes("meta analysis")) return "Meta-analysis";
  if (lowered.includes("systematic review")) return "Systematic review";
  return "None";
}

function classifyStudyDesign(text: string, publicationTypes?: string[]): StudyDesign {
  const lowered = text.toLowerCase();
  const pub = (publicationTypes || []).join(" ").toLowerCase();

  if (/\b(meta-analysis|meta analysis|systematic review|scoping review|literature review|review)\b/.test(lowered) ||
      /\b(review|meta-analysis|systematic)\b/.test(pub)) {
    return "review";
  }

  if (/\b(randomized|randomised|randomly assigned|rct|controlled trial|clinical trial)\b/.test(lowered) ||
      /\b(randomized controlled trial|clinical trial)\b/.test(pub)) {
    return "RCT";
  }

  if (/\b(cohort|prospective|retrospective|follow-up|longitudinal)\b/.test(lowered)) {
    return "cohort";
  }

  if (/\b(cross-sectional|cross sectional|prevalence survey|survey)\b/.test(lowered)) {
    return "cross-sectional";
  }

  return "unknown";
}

function extractSampleSize(text: string): number | null {
  for (const pattern of SAMPLE_SIZE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 2 && value <= 10_000_000) {
      return value;
    }
  }
  return null;
}

function extractPopulation(text: string): string | null {
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    if (/\b(participants|patients|subjects|adults|children|pregnant|volunteers|individuals)\b/i.test(sentence)) {
      return sentence.slice(0, 220);
    }
  }
  return null;
}

function extractInterventionComparator(sentence: string): { intervention: string | null; comparator: string | null } {
  const patterns: RegExp[] = [
    /\b([^.;,]{2,80}?)\s+(?:vs\.?|versus|compared\s+with|compared\s+to|against)\s+([^.;,]{2,80})/i,
    /\brandomi[sz]ed\s+to\s+([^.;,]{2,80}?)\s+(?:or|versus|vs\.?|compared\s+with)\s+([^.;,]{2,80})/i,
  ];

  for (const pattern of patterns) {
    const match = sentence.match(pattern);
    if (!match) continue;
    const intervention = normalizeWhitespace(match[1]).replace(/^the\s+/i, "");
    const comparator = normalizeWhitespace(match[2]).replace(/^the\s+/i, "");
    if (intervention && comparator) {
      return { intervention, comparator };
    }
  }

  return { intervention: null, comparator: null };
}

function extractEffectSize(sentence: string): string | null {
  const match = sentence.match(EFFECT_PATTERN);
  if (match) return normalizeWhitespace(match[0]);
  return null;
}

function extractPValueOrCi(sentence: string): string | null {
  const p = sentence.match(P_VALUE_PATTERN);
  if (p) return normalizeWhitespace(p[0]);
  const ci = sentence.match(CI_PATTERN);
  if (ci) return normalizeWhitespace(ci[0]);
  return null;
}

function inferOutcomeMeasured(sentence: string): string {
  const lowered = sentence.toLowerCase();

  const targeted = [
    /(?:improv(?:ed|ement)?\s+in|increase(?:d)?\s+in|decrease(?:d)?\s+in|reduction\s+in|associated\s+with|effect\s+on)\s+([a-z0-9\s\-]{3,80})/i,
    /([a-z0-9\s\-]{3,80})\s+(?:improved|increased|decreased|reduced|was\s+associated)/i,
  ];

  for (const pattern of targeted) {
    const match = sentence.match(pattern);
    if (match?.[1]) {
      const measured = normalizeWhitespace(match[1]).replace(/\b(the|a|an)\b/gi, "").trim();
      if (measured.length >= 3) return measured.slice(0, 120);
    }
  }

  const tokens = lowered
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .slice(0, 8)
    .join(" ");

  return tokens || "reported outcome";
}

function isResultSentence(sentence: string): boolean {
  const lowered = sentence.toLowerCase();
  return RESULT_MARKERS.some((marker) => lowered.includes(marker));
}

function scoreOutcome(outcome: DeterministicOutcome): number {
  let score = 0.2;
  if (outcome.key_result) score += 0.2;
  if (outcome.effect_size) score += 0.25;
  if (outcome.p_value) score += 0.2;
  if (outcome.intervention) score += 0.15;
  if (outcome.comparator) score += 0.15;
  if (outcome.citation_snippet && outcome.citation_snippet.length >= 20) score += 0.1;
  return clamp(score, 0, 1);
}

function dedupeOutcomes(
  outcomes: Array<{ outcome: DeterministicOutcome; confidence: number }>,
): Array<{ outcome: DeterministicOutcome; confidence: number }> {
  const seen = new Set<string>();
  const deduped: Array<{ outcome: DeterministicOutcome; confidence: number }> = [];

  for (const entry of outcomes) {
    const key = [
      entry.outcome.outcome_measured.toLowerCase().trim(),
      (entry.outcome.effect_size || "").toLowerCase().trim(),
      (entry.outcome.p_value || "").toLowerCase().trim(),
      entry.outcome.citation_snippet.toLowerCase().replace(/\s+/g, " ").trim(),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function extractOutcomes(text: string): { outcomes: DeterministicOutcome[]; confidence: number[] } {
  const sentences = splitSentences(text);
  const candidates: Array<{ outcome: DeterministicOutcome; confidence: number }> = [];

  for (const sentence of sentences) {
    if (!isResultSentence(sentence)) continue;

    const { intervention, comparator } = extractInterventionComparator(sentence);
    const effect_size = extractEffectSize(sentence);
    const p_value = extractPValueOrCi(sentence);

    const outcome: DeterministicOutcome = {
      outcome_measured: inferOutcomeMeasured(sentence),
      key_result: sentence,
      citation_snippet: sentence,
      intervention,
      comparator,
      effect_size,
      p_value,
    };

    const confidence = scoreOutcome(outcome);
    candidates.push({ outcome, confidence });
  }

  const deduped = dedupeOutcomes(candidates);

  const filtered = deduped.filter((entry) => entry.confidence >= 0.35);
  if (filtered.length === 0 && deduped.length > 0) {
    const best = [...deduped].sort((a, b) => b.confidence - a.confidence)[0];
    return { outcomes: [best.outcome], confidence: [best.confidence] };
  }

  if (filtered.length === 0 && sentences.length > 0) {
    const fallbackSentence = sentences[0].slice(0, 280);
    const fallback: DeterministicOutcome = {
      outcome_measured: inferOutcomeMeasured(fallbackSentence),
      key_result: fallbackSentence,
      citation_snippet: fallbackSentence,
      intervention: null,
      comparator: null,
      effect_size: extractEffectSize(fallbackSentence),
      p_value: extractPValueOrCi(fallbackSentence),
    };
    return { outcomes: [fallback], confidence: [scoreOutcome(fallback)] };
  }

  return {
    outcomes: filtered.map((entry) => entry.outcome),
    confidence: filtered.map((entry) => entry.confidence),
  };
}

function abstractExcerpt(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return "";
  return normalized.length <= 420 ? normalized : `${normalized.slice(0, 419)}...`;
}

function buildStudyFromText(
  input: DeterministicExtractionInput,
  text: string,
  diagnostics: Omit<ExtractionDiagnostics, "outcome_confidence">,
): ExtractionResult {
  const normalizedText = normalizeWhitespace(text || input.abstract || input.title);
  const design = classifyStudyDesign(`${input.title}. ${normalizedText}`, input.publicationTypes);
  const reviewType = classifyReviewType(`${input.title}. ${normalizedText}`);
  const sampleSize = extractSampleSize(normalizedText);
  const population = extractPopulation(normalizedText);
  const { outcomes, confidence } = extractOutcomes(normalizedText);

  const study: DeterministicStudyResult = {
    study_id: input.study_id,
    title: input.title,
    year: input.year,
    study_design: reviewType !== "None" && design === "unknown" ? "review" : design,
    sample_size: sampleSize,
    population,
    outcomes,
    citation: {
      doi: input.doi,
      pubmed_id: input.pubmed_id,
      openalex_id: input.openalex_id,
      formatted: formatCitation(input),
    },
    abstract_excerpt: abstractExcerpt(input.abstract || normalizedText || input.title),
    preprint_status: input.preprint_status || (input.source === "arxiv" ? "Preprint" : "Peer-reviewed"),
    review_type: reviewType,
    source: input.source,
    citationCount: input.citationCount,
    pdf_url: input.pdf_url || null,
    landing_page_url: input.landing_page_url || null,
  };

  return {
    study,
    diagnostics: {
      ...diagnostics,
      outcome_confidence: confidence,
    },
  };
}

async function callPdfExtractor(
  papers: DeterministicExtractionInput[],
  options: Required<Pick<ExtractDeterministicOptions, "pdfExtractorUrl" | "pdfParseTimeoutMs">> & {
    pdfExtractorBearerToken?: string;
    fetchImpl: typeof fetch;
  },
): Promise<Map<string, PdfExtractorResponseItem>> {
  const url = options.pdfExtractorUrl.replace(/\/+$/, "");
  const endpoint = `${url}/extract/studies`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.pdfParseTimeoutMs);

  const payload: { papers: PdfExtractorRequestPaper[]; timeout_ms: number } = {
    papers: papers.map((paper) => ({
      study_id: paper.study_id,
      title: paper.title,
      year: paper.year,
      source: paper.source,
      doi: paper.doi,
      pubmed_id: paper.pubmed_id,
      openalex_id: paper.openalex_id,
      abstract: paper.abstract,
      pdf_url: paper.pdf_url || null,
      landing_page_url: paper.landing_page_url || null,
      citationCount: paper.citationCount,
      preprint_status: paper.preprint_status,
    })),
    timeout_ms: options.pdfParseTimeoutMs,
  };

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (options.pdfExtractorBearerToken?.trim()) {
      headers.Authorization = `Bearer ${options.pdfExtractorBearerToken.trim()}`;
    }

    const response = await options.fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`pdf_extractor_http_${response.status}:${text.slice(0, 120)}`);
    }

    const body = (await response.json()) as PdfExtractorResponse;
    const byId = new Map<string, PdfExtractorResponseItem>();

    for (const item of body.results || []) {
      if (item?.study_id) byId.set(item.study_id, item);
    }

    return byId;
  } finally {
    clearTimeout(timeoutId);
  }
}

function toFallbackReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 180);
  return "pdf_extractor_failed";
}

export async function extractStudiesDeterministic(
  inputs: DeterministicExtractionInput[],
  options: ExtractDeterministicOptions = {},
): Promise<ExtractionResult[]> {
  if (inputs.length === 0) return [];

  const fetchImpl = options.fetchImpl || fetch;
  const pdfParseTimeoutMs = Number.isFinite(options.pdfParseTimeoutMs)
    ? Math.max(1_000, Math.min(60_000, Math.trunc(options.pdfParseTimeoutMs!)))
    : 12_000;
  const batchSize = Number.isFinite(options.batchSize)
    ? Math.max(1, Math.min(20, Math.trunc(options.batchSize!)))
    : 10;

  const pdfEligible = new Set(
    inputs
      .filter((input) => input.pdf_url && /^https:\/\//i.test(input.pdf_url))
      .map((input) => input.study_id),
  );

  const pdfResults = new Map<string, PdfExtractorResponseItem>();
  if (options.pdfExtractorUrl && pdfEligible.size > 0) {
    const eligibleInputs = inputs.filter((input) => pdfEligible.has(input.study_id));
    for (let i = 0; i < eligibleInputs.length; i += batchSize) {
      const batch = eligibleInputs.slice(i, i + batchSize);
      try {
        const batchResults = await callPdfExtractor(batch, {
          pdfExtractorUrl: options.pdfExtractorUrl,
          pdfExtractorBearerToken: options.pdfExtractorBearerToken,
          pdfParseTimeoutMs,
          fetchImpl,
        });
        for (const [studyId, item] of batchResults.entries()) {
          pdfResults.set(studyId, item);
        }
      } catch (error) {
        const reason = toFallbackReason(error);
        for (const item of batch) {
          pdfResults.set(item.study_id, {
            study_id: item.study_id,
            error: reason,
          });
        }
      }
    }
  }

  const extracted: ExtractionResult[] = [];

  for (const input of inputs) {
    const pdfAttempt = pdfResults.get(input.study_id);

    if (pdfAttempt?.study) {
      const normalizedStudy = pdfAttempt.study;
      const diagnostics: ExtractionDiagnostics = {
        engine: "pdf",
        used_pdf: true,
        fallback_reason: null,
        parse_error: null,
        outcome_confidence: Array.isArray(pdfAttempt.diagnostics?.outcome_confidence)
          ? pdfAttempt.diagnostics!.outcome_confidence!.filter((value): value is number => typeof value === "number")
          : [],
      };

      extracted.push({ study: normalizedStudy, diagnostics });
      continue;
    }

    const fallbackReason = pdfAttempt?.error || (pdfEligible.has(input.study_id) ? "pdf_unavailable" : "missing_pdf_url");
    extracted.push(
      buildStudyFromText(input, input.abstract || input.title, {
        engine: "abstract",
        used_pdf: false,
        fallback_reason: fallbackReason,
        parse_error: pdfAttempt?.error || null,
      }),
    );
  }

  return extracted;
}

function hasStrictCompleteOutcome(study: DeterministicStudyResult): boolean {
  return (study.outcomes || []).some((outcome) =>
    Boolean(outcome.outcome_measured && (outcome.effect_size || outcome.p_value || outcome.intervention || outcome.comparator)),
  );
}

function isStrictComplete(study: DeterministicStudyResult): boolean {
  if (!study.title || !study.year) return false;
  if (study.study_design === "unknown") return false;
  if (!study.abstract_excerpt || study.abstract_excerpt.trim().length < 50) return false;
  if (!study.outcomes || study.outcomes.length === 0) return false;
  return hasStrictCompleteOutcome(study);
}

function isPartialComplete(study: DeterministicStudyResult): boolean {
  if (!study.title || !study.year) return false;
  if (study.study_design === "unknown") return false;
  if (!study.outcomes || study.outcomes.length === 0) return false;
  return study.outcomes.some((outcome) => Boolean(outcome.outcome_measured && outcome.citation_snippet));
}

export function applyCompletenessTiers(studies: DeterministicStudyResult[]): {
  complete: DeterministicStudyResult[];
  partial: DeterministicStudyResult[];
} {
  const complete: DeterministicStudyResult[] = [];
  const partial: DeterministicStudyResult[] = [];

  const seen = new Set<string>();
  for (const study of studies) {
    if (!study?.study_id || seen.has(study.study_id)) continue;
    seen.add(study.study_id);

    if (isStrictComplete(study)) {
      complete.push(study);
      continue;
    }

    if (isPartialComplete(study)) {
      partial.push(study);
    }
  }

  return { complete, partial };
}

export function summarizeExtractionResults(
  results: ExtractionResult[],
  options: {
    totalInputs: number;
    completeTotal: number;
    partialTotal: number;
    latencyMs: number;
    engine: "llm" | "scripted" | "hybrid";
    llmFallbackApplied?: boolean;
  },
): ExtractionStats {
  const fallback_reasons: Record<string, number> = {};
  let usedPdf = 0;
  let usedFallback = 0;

  for (const result of results) {
    if (result.diagnostics.used_pdf) usedPdf += 1;
    else usedFallback += 1;

    const reason = result.diagnostics.fallback_reason;
    if (reason) fallback_reasons[reason] = (fallback_reasons[reason] || 0) + 1;
  }

  return {
    total_inputs: options.totalInputs,
    extracted_total: results.length,
    complete_total: options.completeTotal,
    partial_total: options.partialTotal,
    used_pdf: usedPdf,
    used_abstract_fallback: usedFallback,
    failures: Math.max(0, options.totalInputs - results.length),
    fallback_reasons,
    engine: options.engine,
    llm_fallback_applied: Boolean(options.llmFallbackApplied),
    latency_ms: Math.max(0, Math.trunc(options.latencyMs)),
  };
}

export function __test_only_extractOutcomes(text: string): { outcomes: DeterministicOutcome[]; confidence: number[] } {
  return extractOutcomes(text);
}

export function __test_only_classifyStudyDesign(text: string, publicationTypes?: string[]): StudyDesign {
  return classifyStudyDesign(text, publicationTypes);
}

export function __test_only_extractSampleSize(text: string): number | null {
  return extractSampleSize(text);
}
