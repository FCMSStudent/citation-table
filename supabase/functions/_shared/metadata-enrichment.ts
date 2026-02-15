import type {
  MetadataEnrichmentMode,
  MetadataEnrichmentOutcome,
  MetadataEnrichmentStore,
} from "./metadata-enrichment-store.ts";

export interface EnrichmentInputPaper {
  id: string;
  title: string;
  year?: number | null;
  abstract?: string;
  authors?: string[];
  venue?: string;
  doi?: string | null;
  source?: string;
  citationCount?: number | null;
  journal?: string | null;
}

export interface EnrichmentCandidate {
  provider: string;
  title: string;
  authors: string[];
  venue?: string | null;
  doi?: string | null;
  year?: number | null;
  citationCount?: number | null;
  journal?: string | null;
  raw?: Record<string, unknown>;
}

export interface EnrichmentFieldEvidence {
  field: "doi" | "year" | "journal" | "citationCount";
  previous: string | number | null;
  next: string | number | null;
  evidence_score: number;
  applied: boolean;
  reason: string;
}

export interface EnrichmentDecision {
  paper_id: string;
  lookup_key: string;
  lookup_kind: "doi" | "title";
  outcome: MetadataEnrichmentOutcome;
  confidence: number;
  reason_codes: string[];
  providers_attempted: string[];
  provider_statuses: Record<string, unknown>;
  fields_applied: Record<string, EnrichmentFieldEvidence>;
  used_cache: boolean;
  latency_ms: number;
  matched_provider?: string;
  matched_metadata?: {
    doi?: string | null;
    year?: number | null;
    journal?: string | null;
    citationCount?: number | null;
  };
}

export interface EnrichmentResult {
  paper: EnrichmentInputPaper;
  decision: EnrichmentDecision;
}

export interface EnrichmentBatchResult {
  papers: EnrichmentInputPaper[];
  decisions: EnrichmentDecision[];
}

export interface MetadataEnrichmentRuntimeConfig {
  mode: MetadataEnrichmentMode;
  inlinePercent: number;
  maxLatencyMs: number;
  retryMax: number;
}

export interface RunMetadataEnrichmentOptions {
  mode: MetadataEnrichmentMode;
  functionName: string;
  stack: "supabase_edge" | "python_api" | "backfill";
  reportId?: string;
  searchId?: string;
  userId?: string;
  sourceTrust?: Record<string, number>;
  store?: MetadataEnrichmentStore;
  retryMax?: number;
  maxLatencyMs?: number;
  applyMutations?: boolean;
}

const AUTO_ACCEPT_THRESHOLD = 0.9;
const DEFER_THRESHOLD = 0.75;
const DOI_BONUS = 0.1;
const CACHE_TTL_DAYS = {
  doiAccepted: 30,
  titleAccepted: 7,
  unresolved: 1,
  staleServeWindow: 90,
};

const DEFAULT_SOURCE_TRUST: Record<string, number> = {
  pubmed: 0.98,
  openalex: 0.92,
  semantic_scholar: 0.9,
  crossref: 0.89,
  arxiv: 0.84,
  unknown: 0.5,
};

function envGet(name: string): string | undefined {
  const denoEnv = (globalThis as any)?.Deno?.env?.get;
  if (typeof denoEnv === "function") {
    return denoEnv(name) ?? undefined;
  }
  if (typeof process !== "undefined" && process?.env) {
    return process.env[name];
  }
  return undefined;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function parseIntWithDefault(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseMode(raw: string | undefined): MetadataEnrichmentMode {
  if (raw === "offline_apply" || raw === "inline_apply" || raw === "offline_shadow") return raw;
  return "offline_shadow";
}

export function getMetadataEnrichmentRuntimeConfig(): MetadataEnrichmentRuntimeConfig {
  const mode = parseMode(envGet("METADATA_ENRICHMENT_MODE"));
  const inlinePercent = Math.max(0, Math.min(100, parseIntWithDefault(envGet("METADATA_ENRICHMENT_INLINE_PERCENT"), 100)));
  const maxLatencyMs = Math.max(200, parseIntWithDefault(envGet("METADATA_ENRICHMENT_MAX_LATENCY_MS"), 5_000));
  const retryMax = Math.max(1, Math.min(8, parseIntWithDefault(envGet("METADATA_ENRICHMENT_RETRY_MAX"), 4)));
  return { mode, inlinePercent, maxLatencyMs, retryMax };
}

export function selectEffectiveEnrichmentMode(config: MetadataEnrichmentRuntimeConfig): MetadataEnrichmentMode {
  if (config.mode !== "inline_apply") return config.mode;
  if ((Math.random() * 100) > config.inlinePercent) return "offline_shadow";
  return "inline_apply";
}

function addDays(input: Date, days: number): string {
  const d = new Date(input);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
  return normalized || null;
}

function tokenize(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
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

function bigrams(value: string): Set<string> {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  const grams = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) {
    grams.add(normalized.slice(i, i + 2));
  }
  return grams;
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const token of smaller) {
    if (larger.has(token)) overlap += 1;
  }
  return (2 * overlap) / (a.size + b.size);
}

function textSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const tokenScore = jaccard(tokenize(a), tokenize(b));
  const charScore = diceCoefficient(bigrams(a), bigrams(b));
  return clamp(0.6 * tokenScore + 0.4 * charScore);
}

function authorOverlap(a: string[] | undefined, b: string[] | undefined): number {
  const setA = new Set((a || []).slice(0, 6).map((name) => normalizeText(name)).filter(Boolean));
  const setB = new Set((b || []).slice(0, 6).map((name) => normalizeText(name)).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const entry of setA) {
    if (setB.has(entry)) overlap += 1;
  }
  return overlap / Math.max(setA.size, setB.size);
}

function yearScore(existingYear?: number | null, candidateYear?: number | null): number {
  if (!existingYear || !candidateYear) return 0;
  if (existingYear === candidateYear) return 1;
  if (Math.abs(existingYear - candidateYear) <= 1) return 0.5;
  return 0;
}

function safeNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

async function sha1Hex(value: string): Promise<string> {
  const input = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-1", input);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function titleFingerprint(paper: EnrichmentInputPaper): Promise<string> {
  const title = normalizeText(paper.title || "");
  const leadAuthor = normalizeText((paper.authors || [""])[0] || "");
  const year = paper.year ?? "na";
  return sha1Hex(`${title}|${leadAuthor}|${year}`);
}

function toCrossrefCandidate(item: any): EnrichmentCandidate {
  const authors = (item?.author || [])
    .map((author: any) => [author?.given, author?.family].filter(Boolean).join(" ").trim())
    .filter(Boolean);

  const issuedYear = item?.issued?.["date-parts"]?.[0]?.[0]
    ?? item?.published?.["date-parts"]?.[0]?.[0]
    ?? item?.["published-print"]?.["date-parts"]?.[0]?.[0]
    ?? null;

  const venue = item?.["container-title"]?.[0] || null;

  return {
    provider: "crossref",
    title: item?.title?.[0] || "",
    authors,
    venue,
    doi: normalizeDoi(item?.DOI),
    year: safeNumber(issuedYear),
    citationCount: safeNumber(item?.["is-referenced-by-count"]),
    journal: venue,
    raw: item,
  };
}

function toOpenAlexCandidate(item: any): EnrichmentCandidate {
  const authors = (item?.authorships || [])
    .map((entry: any) => entry?.author?.display_name)
    .filter(Boolean);
  const venue = item?.primary_location?.source?.display_name || null;

  return {
    provider: "openalex",
    title: item?.display_name || item?.title || "",
    authors,
    venue,
    doi: normalizeDoi(item?.doi),
    year: safeNumber(item?.publication_year),
    citationCount: safeNumber(item?.cited_by_count),
    journal: venue,
    raw: item,
  };
}

interface FetchTrace {
  providersAttempted: string[];
  providerStatuses: Record<string, unknown>;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const asSeconds = Number.parseFloat(value);
  if (Number.isFinite(asSeconds)) {
    return Math.max(0, asSeconds * 1_000);
  }
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function retryDelayMs(attempt: number): number {
  const base = 250 * (2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 101);
}

async function fetchJsonWithRetry(
  url: string,
  init: RequestInit,
  providerName: string,
  retryMax: number,
  providerStatuses: Record<string, unknown>,
): Promise<any | null> {
  let attempts = 0;
  let lastError = "";

  while (attempts < retryMax) {
    attempts += 1;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      if (response.ok) {
        providerStatuses[providerName] = {
          status: "ok",
          attempts,
          http_status: response.status,
          latency_ms: Date.now() - startedAt,
        };
        return await response.json();
      }

      const retriable = response.status === 429 || response.status >= 500;
      lastError = `http_${response.status}`;

      if (!retriable) {
        providerStatuses[providerName] = {
          status: "non_retryable",
          attempts,
          http_status: response.status,
          latency_ms: Date.now() - startedAt,
          last_error: lastError,
        };
        return null;
      }

      if (attempts >= retryMax) {
        providerStatuses[providerName] = {
          status: "retry_exhausted",
          attempts,
          http_status: response.status,
          latency_ms: Date.now() - startedAt,
          last_error: lastError,
        };
        return null;
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      await sleep(retryAfterMs ?? retryDelayMs(attempts));
    } catch (error) {
      clearTimeout(timeout);
      const name = (error as Error).name || "fetch_error";
      lastError = name;

      if (attempts >= retryMax) {
        providerStatuses[providerName] = {
          status: "retry_exhausted",
          attempts,
          latency_ms: Date.now() - startedAt,
          last_error: lastError,
        };
        return null;
      }

      await sleep(retryDelayMs(attempts));
    }
  }

  providerStatuses[providerName] = {
    status: "retry_exhausted",
    attempts,
    last_error: lastError || "unknown",
  };
  return null;
}

async function fetchCrossrefByDoi(doi: string, retryMax: number, trace: FetchTrace): Promise<EnrichmentCandidate[]> {
  trace.providersAttempted.push("crossref");
  const encoded = encodeURIComponent(doi);
  const payload = await fetchJsonWithRetry(
    `https://api.crossref.org/works/${encoded}`,
    {
      headers: {
        "User-Agent": "EurekaSearch/1.0 (mailto:research@eureka.app)",
      },
    },
    "crossref",
    retryMax,
    trace.providerStatuses,
  );

  if (!payload?.message) return [];
  return [toCrossrefCandidate(payload.message)];
}

async function fetchCrossrefByTitle(title: string, retryMax: number, trace: FetchTrace): Promise<EnrichmentCandidate[]> {
  trace.providersAttempted.push("crossref");
  const encoded = encodeURIComponent(title);
  const payload = await fetchJsonWithRetry(
    `https://api.crossref.org/works?query.bibliographic=${encoded}&rows=5`,
    {
      headers: {
        "User-Agent": "EurekaSearch/1.0 (mailto:research@eureka.app)",
      },
    },
    "crossref",
    retryMax,
    trace.providerStatuses,
  );

  const items = payload?.message?.items;
  if (!Array.isArray(items)) return [];
  return items.map(toCrossrefCandidate);
}

async function fetchOpenAlexByDoi(doi: string, retryMax: number, trace: FetchTrace): Promise<EnrichmentCandidate[]> {
  trace.providersAttempted.push("openalex");
  const filter = encodeURIComponent(`doi:https://doi.org/${doi}`);
  const payload = await fetchJsonWithRetry(
    `https://api.openalex.org/works?filter=${filter}&per-page=5`,
    {},
    "openalex",
    retryMax,
    trace.providerStatuses,
  );

  const results = payload?.results;
  if (!Array.isArray(results)) return [];
  return results.map(toOpenAlexCandidate);
}

async function fetchOpenAlexByTitle(title: string, retryMax: number, trace: FetchTrace): Promise<EnrichmentCandidate[]> {
  trace.providersAttempted.push("openalex");
  const search = encodeURIComponent(title);
  const payload = await fetchJsonWithRetry(
    `https://api.openalex.org/works?search=${search}&per-page=5&sort=relevance_score:desc`,
    {},
    "openalex",
    retryMax,
    trace.providerStatuses,
  );

  const results = payload?.results;
  if (!Array.isArray(results)) return [];
  return results.map(toOpenAlexCandidate);
}

function scoreCandidate(input: EnrichmentInputPaper, candidate: EnrichmentCandidate): number {
  const titleSim = textSimilarity(input.title, candidate.title);
  const authorSim = authorOverlap(input.authors, candidate.authors);
  const yearSim = yearScore(input.year ?? null, candidate.year ?? null);
  const venueSim = textSimilarity(input.venue || input.journal || "", candidate.venue || candidate.journal || "");

  const inputDoi = normalizeDoi(input.doi);
  const candidateDoi = normalizeDoi(candidate.doi);
  const doiBonus = inputDoi && candidateDoi && inputDoi === candidateDoi ? DOI_BONUS : 0;

  const score =
    (0.55 * titleSim)
    + (0.20 * authorSim)
    + (0.15 * yearSim)
    + (0.10 * venueSim)
    + doiBonus;

  return clamp(score);
}

function selectBestCandidate(
  paper: EnrichmentInputPaper,
  candidates: EnrichmentCandidate[],
  sourceTrust: Record<string, number>,
): { candidate: EnrichmentCandidate | null; confidence: number } {
  if (candidates.length === 0) {
    return { candidate: null, confidence: 0 };
  }

  let best: EnrichmentCandidate | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    const score = scoreCandidate(paper, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
      continue;
    }

    if (score === bestScore && best) {
      const bestTrust = sourceTrust[best.provider] ?? sourceTrust.unknown ?? 0.5;
      const candidateTrust = sourceTrust[candidate.provider] ?? sourceTrust.unknown ?? 0.5;
      if (candidateTrust > bestTrust) {
        best = candidate;
      }
    }
  }

  return { candidate: best, confidence: clamp(bestScore) };
}

function mergePaperMetadata(
  paper: EnrichmentInputPaper,
  selected: EnrichmentCandidate,
  confidence: number,
  sourceTrust: Record<string, number>,
  applyMutations: boolean,
): { updatedPaper: EnrichmentInputPaper; fieldsApplied: Record<string, EnrichmentFieldEvidence>; reasonCodes: string[] } {
  const updatedPaper: EnrichmentInputPaper = { ...paper };
  const reasonCodes: string[] = [];
  const fieldsApplied: Record<string, EnrichmentFieldEvidence> = {};

  const providerTrust = sourceTrust[selected.provider] ?? sourceTrust.unknown ?? 0.5;
  const existingTrust = sourceTrust[(paper.source || "unknown").toLowerCase()] ?? sourceTrust.unknown ?? 0.5;
  const newEvidence = providerTrust * confidence;

  const currentDoi = normalizeDoi(paper.doi);
  const candidateDoi = normalizeDoi(selected.doi);
  if (candidateDoi) {
    if (currentDoi && currentDoi !== candidateDoi) {
      reasonCodes.push("doi_conflict");
      fieldsApplied.doi = {
        field: "doi",
        previous: currentDoi,
        next: candidateDoi,
        evidence_score: newEvidence,
        applied: false,
        reason: "doi_conflict",
      };
    } else if (!currentDoi && applyMutations) {
      updatedPaper.doi = candidateDoi;
      fieldsApplied.doi = {
        field: "doi",
        previous: null,
        next: candidateDoi,
        evidence_score: newEvidence,
        applied: true,
        reason: "filled",
      };
    }
  }

  if (selected.year) {
    if (!paper.year && applyMutations) {
      updatedPaper.year = selected.year;
      fieldsApplied.year = {
        field: "year",
        previous: null,
        next: selected.year,
        evidence_score: newEvidence,
        applied: true,
        reason: "filled",
      };
    } else if (paper.year) {
      const delta = Math.abs(paper.year - selected.year);
      if (delta <= 1) {
        const currentEvidence = existingTrust * 0.8;
        const eligible = newEvidence >= (currentEvidence + 0.05);
        if (eligible && applyMutations && paper.year !== selected.year) {
          updatedPaper.year = selected.year;
          fieldsApplied.year = {
            field: "year",
            previous: paper.year,
            next: selected.year,
            evidence_score: newEvidence,
            applied: true,
            reason: "higher_evidence",
          };
        }
      } else {
        reasonCodes.push("year_out_of_range");
      }
    }
  }

  const selectedJournal = selected.journal || selected.venue || null;
  const currentJournal = paper.journal || paper.venue || null;
  if (selectedJournal) {
    if (!paper.journal && applyMutations) {
      updatedPaper.journal = selectedJournal;
      fieldsApplied.journal = {
        field: "journal",
        previous: currentJournal,
        next: selectedJournal,
        evidence_score: newEvidence,
        applied: true,
        reason: "filled",
      };
    } else if (paper.journal && currentJournal) {
      const similarity = textSimilarity(currentJournal, selectedJournal);
      const currentEvidence = existingTrust * 0.8;
      const eligible = similarity >= 0.85 && newEvidence >= (currentEvidence + 0.03);
      if (eligible && applyMutations && currentJournal !== selectedJournal) {
        updatedPaper.journal = selectedJournal;
        fieldsApplied.journal = {
          field: "journal",
          previous: currentJournal,
          next: selectedJournal,
          evidence_score: newEvidence,
          applied: true,
          reason: "higher_evidence",
        };
      }
    }
  }

  const selectedCitationCount = selected.citationCount ?? null;
  if (selectedCitationCount !== null) {
    const currentCount = paper.citationCount ?? 0;
    const mergedCount = Math.max(currentCount, selectedCitationCount);
    if (applyMutations && mergedCount !== currentCount) {
      updatedPaper.citationCount = mergedCount;
      fieldsApplied.citationCount = {
        field: "citationCount",
        previous: currentCount,
        next: mergedCount,
        evidence_score: newEvidence,
        applied: true,
        reason: "max_trusted",
      };
    }
  }

  return { updatedPaper, fieldsApplied, reasonCodes };
}

function resolveOutcome(confidence: number): MetadataEnrichmentOutcome {
  if (confidence >= AUTO_ACCEPT_THRESHOLD) return "accepted";
  if (confidence >= DEFER_THRESHOLD) return "deferred";
  return "rejected";
}

interface CachedHydration {
  paper: EnrichmentInputPaper;
  decision: EnrichmentDecision;
}

function parseDateSafe(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function shouldUseCachedRecord(
  record: any,
  now: Date,
  mode: MetadataEnrichmentMode,
): { use: boolean; stale: boolean } {
  const expiresAt = parseDateSafe(record?.expires_at);
  if (!expiresAt) return { use: false, stale: false };
  if (expiresAt.getTime() > now.getTime()) {
    return { use: true, stale: false };
  }

  if (mode !== "inline_apply") {
    return { use: false, stale: false };
  }

  const fetchedAt = parseDateSafe(record?.fetched_at) ?? expiresAt;
  const staleUntil = new Date(fetchedAt);
  staleUntil.setUTCDate(staleUntil.getUTCDate() + CACHE_TTL_DAYS.staleServeWindow);
  if (staleUntil.getTime() > now.getTime()) {
    return { use: true, stale: true };
  }

  return { use: false, stale: false };
}

function hydrateFromCache(
  paper: EnrichmentInputPaper,
  cacheRecord: any,
  mode: MetadataEnrichmentMode,
  lookupKey: string,
  lookupKind: "doi" | "title",
  sourceTrust: Record<string, number>,
): CachedHydration {
  const resolved = cacheRecord?.resolved_metadata || {};
  const confidence = Number(cacheRecord?.confidence || 0);
  const outcome = (cacheRecord?.status || "not_found") as MetadataEnrichmentOutcome;
  const selected: EnrichmentCandidate = {
    provider: String(resolved.provider || "crossref"),
    title: String(resolved.title || paper.title || ""),
    authors: Array.isArray(resolved.authors) ? resolved.authors : paper.authors || [],
    venue: (resolved.venue as string | undefined) || null,
    doi: (resolved.doi as string | undefined) || null,
    year: safeNumber(resolved.year),
    citationCount: safeNumber(resolved.citationCount),
    journal: (resolved.journal as string | undefined) || null,
  };

  const applyMutations = mode === "inline_apply" && outcome === "accepted";
  const { updatedPaper, fieldsApplied, reasonCodes } = mergePaperMetadata(paper, selected, confidence, sourceTrust, applyMutations);

  const decision: EnrichmentDecision = {
    paper_id: paper.id,
    lookup_key: lookupKey,
    lookup_kind: lookupKind,
    outcome,
    confidence,
    reason_codes: [...(cacheRecord?.reason_codes || []), ...reasonCodes],
    providers_attempted: Object.keys(cacheRecord?.provider_payloads || {}),
    provider_statuses: { cache: "hit" },
    fields_applied: fieldsApplied,
    used_cache: true,
    latency_ms: 0,
    matched_provider: selected.provider,
    matched_metadata: {
      doi: selected.doi,
      year: selected.year,
      journal: selected.journal,
      citationCount: selected.citationCount,
    },
  };

  return { paper: updatedPaper, decision };
}

function cacheExpiryForOutcome(
  now: Date,
  outcome: MetadataEnrichmentOutcome,
  lookupKind: "doi" | "title",
): string {
  if (outcome === "accepted") {
    return addDays(now, lookupKind === "doi" ? CACHE_TTL_DAYS.doiAccepted : CACHE_TTL_DAYS.titleAccepted);
  }
  return addDays(now, CACHE_TTL_DAYS.unresolved);
}

export async function runMetadataEnrichment(
  papers: EnrichmentInputPaper[],
  options: RunMetadataEnrichmentOptions,
): Promise<EnrichmentBatchResult> {
  const startedAt = Date.now();
  const retryMax = options.retryMax ?? 4;
  const maxLatencyMs = options.maxLatencyMs ?? 5_000;
  const sourceTrust = {
    ...DEFAULT_SOURCE_TRUST,
    ...(options.sourceTrust || {}),
  };

  const applyMutationsByMode = options.applyMutations ?? (options.mode === "inline_apply");

  const results: EnrichmentInputPaper[] = [];
  const decisions: EnrichmentDecision[] = [];

  for (const paper of papers) {
    const paperStartedAt = Date.now();
    const now = new Date();
    const normalizedDoi = normalizeDoi(paper.doi);
    const lookupKind: "doi" | "title" = normalizedDoi ? "doi" : "title";
    const fingerprint = normalizedDoi ? null : await titleFingerprint(paper);
    const lookupKey = normalizedDoi ? `doi:${normalizedDoi}` : `title:${fingerprint}`;

    if ((Date.now() - startedAt) > maxLatencyMs && options.mode === "inline_apply") {
      const timeoutDecision: EnrichmentDecision = {
        paper_id: paper.id,
        lookup_key: lookupKey,
        lookup_kind: lookupKind,
        outcome: "error",
        confidence: 0,
        reason_codes: ["latency_budget_exceeded"],
        providers_attempted: [],
        provider_statuses: {},
        fields_applied: {},
        used_cache: false,
        latency_ms: Date.now() - paperStartedAt,
      };

      decisions.push(timeoutDecision);
      results.push({ ...paper });
      continue;
    }

    try {
      const cached = options.store ? await options.store.getCacheByLookupKey(lookupKey) : null;
      const cacheState = shouldUseCachedRecord(cached, now, options.mode);
      if (cached && cacheState.use) {
        const hydrated = hydrateFromCache(paper, cached, options.mode, lookupKey, lookupKind, sourceTrust);
        if (cacheState.stale) {
          hydrated.decision.reason_codes.push("stale_cache_served");
        }
        hydrated.decision.latency_ms = Date.now() - paperStartedAt;

        if (options.store) {
          await options.store.insertEvent({
            stack: options.stack,
            function_name: options.functionName,
            mode: options.mode,
            report_id: options.reportId ?? null,
            search_id: options.searchId ?? null,
            user_id: options.userId ?? null,
            paper_id: paper.id,
            lookup_key: lookupKey,
            providers_attempted: hydrated.decision.providers_attempted,
            provider_statuses: hydrated.decision.provider_statuses,
            outcome: hydrated.decision.outcome,
            confidence: hydrated.decision.confidence,
            reason_codes: hydrated.decision.reason_codes,
            fields_applied: hydrated.decision.fields_applied,
            latency_ms: hydrated.decision.latency_ms,
            used_cache: true,
          });
        }

        decisions.push(hydrated.decision);
        results.push(hydrated.paper);
        continue;
      }

      const trace: FetchTrace = {
        providersAttempted: [],
        providerStatuses: {},
      };

      const candidates: EnrichmentCandidate[] = [];

      candidates.push({
        provider: paper.source || "unknown",
        title: paper.title,
        authors: paper.authors || [],
        venue: paper.venue || paper.journal || null,
        doi: paper.doi || null,
        year: paper.year ?? null,
        citationCount: paper.citationCount ?? null,
        journal: paper.journal || null,
        raw: {
          source: paper.source || "unknown",
          seeded: true,
        },
      });

      let crossrefCandidates: EnrichmentCandidate[] = [];
      if (normalizedDoi) {
        crossrefCandidates = await fetchCrossrefByDoi(normalizedDoi, retryMax, trace);
      }
      if (crossrefCandidates.length === 0 && paper.title) {
        crossrefCandidates = await fetchCrossrefByTitle(paper.title, retryMax, trace);
      }
      candidates.push(...crossrefCandidates);

      let { candidate: bestCandidate, confidence } = selectBestCandidate(paper, candidates, sourceTrust);
      if (confidence < AUTO_ACCEPT_THRESHOLD) {
        const openAlexCandidates = normalizedDoi
          ? await fetchOpenAlexByDoi(normalizedDoi, retryMax, trace)
          : await fetchOpenAlexByTitle(paper.title, retryMax, trace);
        candidates.push(...openAlexCandidates);
        ({ candidate: bestCandidate, confidence } = selectBestCandidate(paper, candidates, sourceTrust));
      }

      if (!bestCandidate) {
        const decision: EnrichmentDecision = {
          paper_id: paper.id,
          lookup_key: lookupKey,
          lookup_kind: lookupKind,
          outcome: "not_found",
          confidence: 0,
          reason_codes: ["no_candidate_found"],
          providers_attempted: Array.from(new Set(trace.providersAttempted)),
          provider_statuses: trace.providerStatuses,
          fields_applied: {},
          used_cache: false,
          latency_ms: Date.now() - paperStartedAt,
        };

        if (options.store) {
          await options.store.upsertCache({
            lookup_key: lookupKey,
            lookup_kind: lookupKind,
            doi_norm: normalizedDoi,
            title_fingerprint: fingerprint,
            resolved_metadata: {},
            provider_payloads: trace.providerStatuses,
            confidence: 0,
            status: "not_found",
            reason_codes: decision.reason_codes,
            expires_at: cacheExpiryForOutcome(now, "not_found", lookupKind),
          });

          await options.store.insertEvent({
            stack: options.stack,
            function_name: options.functionName,
            mode: options.mode,
            report_id: options.reportId ?? null,
            search_id: options.searchId ?? null,
            user_id: options.userId ?? null,
            paper_id: paper.id,
            lookup_key: lookupKey,
            providers_attempted: decision.providers_attempted,
            provider_statuses: decision.provider_statuses,
            outcome: decision.outcome,
            confidence: 0,
            reason_codes: decision.reason_codes,
            fields_applied: {},
            latency_ms: decision.latency_ms,
            used_cache: false,
          });
        }

        decisions.push(decision);
        results.push({ ...paper });
        continue;
      }

      const outcome = resolveOutcome(confidence);
      const shouldApply = applyMutationsByMode && outcome === "accepted";
      const merge = mergePaperMetadata(paper, bestCandidate, confidence, sourceTrust, shouldApply);
      const decision: EnrichmentDecision = {
        paper_id: paper.id,
        lookup_key: lookupKey,
        lookup_kind: lookupKind,
        outcome,
        confidence,
        reason_codes: merge.reasonCodes,
        providers_attempted: Array.from(new Set(trace.providersAttempted.concat(bestCandidate.provider))),
        provider_statuses: trace.providerStatuses,
        fields_applied: merge.fieldsApplied,
        used_cache: false,
        latency_ms: Date.now() - paperStartedAt,
        matched_provider: bestCandidate.provider,
        matched_metadata: {
          doi: normalizeDoi(bestCandidate.doi),
          year: bestCandidate.year ?? null,
          journal: bestCandidate.journal ?? bestCandidate.venue ?? null,
          citationCount: bestCandidate.citationCount ?? null,
        },
      };

      const selectedMetadata = {
        provider: bestCandidate.provider,
        title: bestCandidate.title,
        authors: bestCandidate.authors,
        venue: bestCandidate.venue,
        doi: normalizeDoi(bestCandidate.doi),
        year: bestCandidate.year ?? null,
        journal: bestCandidate.journal ?? bestCandidate.venue ?? null,
        citationCount: bestCandidate.citationCount ?? null,
      };

      if (options.store) {
        await options.store.upsertCache({
          lookup_key: lookupKey,
          lookup_kind: lookupKind,
          doi_norm: normalizedDoi,
          title_fingerprint: fingerprint,
          resolved_metadata: selectedMetadata,
          provider_payloads: {
            statuses: trace.providerStatuses,
            selected_provider: bestCandidate.provider,
            selected_raw: bestCandidate.raw || {},
          },
          confidence,
          status: outcome,
          reason_codes: decision.reason_codes,
          expires_at: cacheExpiryForOutcome(now, outcome, lookupKind),
        });

        await options.store.insertEvent({
          stack: options.stack,
          function_name: options.functionName,
          mode: options.mode,
          report_id: options.reportId ?? null,
          search_id: options.searchId ?? null,
          user_id: options.userId ?? null,
          paper_id: paper.id,
          lookup_key: lookupKey,
          providers_attempted: decision.providers_attempted,
          provider_statuses: decision.provider_statuses,
          outcome,
          confidence,
          reason_codes: decision.reason_codes,
          fields_applied: decision.fields_applied,
          latency_ms: decision.latency_ms,
          used_cache: false,
        });
      }

      decisions.push(decision);
      results.push(merge.updatedPaper);

      await sleep(100);
    } catch (error) {
      const decision: EnrichmentDecision = {
        paper_id: paper.id,
        lookup_key: lookupKey,
        lookup_kind: lookupKind,
        outcome: "error",
        confidence: 0,
        reason_codes: ["enrichment_exception"],
        providers_attempted: [],
        provider_statuses: { error: String((error as Error)?.message || error) },
        fields_applied: {},
        used_cache: false,
        latency_ms: Date.now() - paperStartedAt,
      };

      if (options.store) {
        await options.store.insertEvent({
          stack: options.stack,
          function_name: options.functionName,
          mode: options.mode,
          report_id: options.reportId ?? null,
          search_id: options.searchId ?? null,
          user_id: options.userId ?? null,
          paper_id: paper.id,
          lookup_key: lookupKey,
          providers_attempted: [],
          provider_statuses: decision.provider_statuses,
          outcome: "error",
          confidence: 0,
          reason_codes: decision.reason_codes,
          fields_applied: {},
          latency_ms: decision.latency_ms,
          used_cache: false,
        });
      }

      decisions.push(decision);
      results.push({ ...paper });
    }
  }

  return { papers: results, decisions };
}
