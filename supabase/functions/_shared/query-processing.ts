import { BIOMEDICAL_ONTOLOGY } from "./biomedical-ontology.ts";

export type SearchSource = "semantic_scholar" | "openalex" | "pubmed" | "arxiv";

export interface SourceQueries {
  semantic_scholar: string;
  openalex: string;
  pubmed: string;
  arxiv: string;
}

export interface QueryProcessingMeta {
  version: "v2";
  deterministic_confidence: number;
  used_llm_fallback: boolean;
  processing_ms: number;
  reason_codes: string[];
  source_queries: SourceQueries;
}

export interface PreparedQueryV2 {
  original_query: string;
  normalized_query: string;
  search_query: string;
  was_normalized: boolean;
  query_processing: QueryProcessingMeta;
  query_terms: string[];
  expanded_terms: string[];
}

export interface PrepareQueryOptions {
  llmApiKey?: string;
  fallbackTimeoutMs?: number;
  confidenceThreshold?: number;
}

interface SourceBudget {
  base: number;
  expanded: number;
}

const SOURCE_BUDGETS: Record<SearchSource, SourceBudget> = {
  semantic_scholar: { base: 8, expanded: 6 },
  openalex: { base: 8, expanded: 3 },
  pubmed: { base: 8, expanded: 4 },
  arxiv: { base: 8, expanded: 3 },
};

const STOP_WORDS = new Set([
  "what", "are", "is", "the", "a", "an", "of", "for", "with", "to", "in", "on",
  "and", "or", "how", "does", "do", "can", "could", "would", "should", "will",
  "that", "this", "these", "those", "it", "its", "be", "been", "being", "was",
  "were", "has", "have", "had", "but", "by", "from", "at", "as", "into", "through",
  "between", "about", "their", "there", "than", "reported", "outcomes", "associated",
  "effects", "effect", "impact", "relationship", "role", "influence", "evidence", "studies",
  "study", "please", "tell", "show", "find",
]);

const COMPARATOR_MARKERS = new Set(["vs", "versus", "compared", "against"]);
const NEGATION_MARKERS = new Set(["not", "without", "no", "non"]);
const AMBIGUITY_TOKENS = new Set(["better", "best", "worse", "worst", "good", "bad", "safe", "safer"]);

const LOW_SIGNAL_PREFIXES: RegExp[] = [
  /^what\s+(are|is)\s+the\s+/i,
  /^how\s+does\s+/i,
  /^can\s+you\s+/i,
  /^please\s+/i,
  /^i\s+want\s+to\s+know\s+/i,
];

const COMPARATIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string; reason: string }> = [
  { pattern: /\b(better|best|superior)\s+than\b/gi, replacement: "compared with", reason: "comparative_neutralized_positive" },
  { pattern: /\b(worse|worst|inferior)\s+than\b/gi, replacement: "compared with", reason: "comparative_neutralized_negative" },
  { pattern: /\b(more|less)\s+effective\s+than\b/gi, replacement: "compared with", reason: "comparative_neutralized_effective" },
  { pattern: /\beffects?\s+of\b/gi, replacement: "outcomes associated with", reason: "effect_phrase_neutralized" },
];

const FALLBACK_FAILURE_RATE_THRESHOLD = 0.4;
const FALLBACK_MIN_SAMPLE = 8;
const FALLBACK_WINDOW_MS = 5 * 60_000;
const FALLBACK_COOLDOWN_MS = 5 * 60_000;

class LruCache<K, V> {
  private readonly maxSize: number;
  private readonly map = new Map<K, V>();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

interface CircuitState {
  attempts: number[];
  failures: number[];
  openUntil: number;
}

const queryCache = new LruCache<string, PreparedQueryV2>(300);
const fallbackCircuit: CircuitState = { attempts: [], failures: [], openUntil: 0 };

interface DeterministicResult {
  normalizedQuery: string;
  queryTerms: string[];
  expandedTerms: string[];
  sourceQueries: SourceQueries;
  confidence: number;
  reasonCodes: string[];
}

function getEnv(name: string): string | undefined {
  try {
    if (typeof (globalThis as any).Deno !== "undefined" && (globalThis as any).Deno?.env?.get) {
      return (globalThis as any).Deno.env.get(name) ?? undefined;
    }
  } catch (_) {
    // ignore
  }

  try {
    if (typeof (globalThis as any).process !== "undefined") {
      return (globalThis as any).process.env?.[name];
    }
  } catch (_) {
    // ignore
  }

  return undefined;
}

function normalizeUnicodeAndPunctuation(query: string): string {
  return query
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[’‘`]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s*([,;:!?])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDoseAndUnits(query: string, reasons: string[]): string {
  const normalized = query.replace(/(\d)\s*(mg|g|kg|mcg|ml|l|mmhg|bpm|mmol\/l|mg\/dl|%)\b/gi, "$1 $2");
  if (normalized !== query) reasons.push("dose_unit_normalized");
  return normalized;
}

function stripBoilerplate(query: string, reasons: string[]): string {
  let stripped = query;
  for (const prefix of LOW_SIGNAL_PREFIXES) {
    if (prefix.test(stripped)) {
      stripped = stripped.replace(prefix, "").trim();
      reasons.push("boilerplate_removed");
    }
  }
  return stripped;
}

function neutralizeComparatives(query: string, reasons: string[]): string {
  let normalized = query;
  for (const rule of COMPARATIVE_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      normalized = normalized.replace(rule.pattern, rule.replacement);
      reasons.push(rule.reason);
    }
  }
  return normalized;
}

function tokenize(normalizedQuery: string): string[] {
  return normalizedQuery
    .replace(/[^a-z0-9/%-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1)
    .filter((token) => !STOP_WORDS.has(token));
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function quotePhrase(term: string): string {
  return term.includes(" ") ? `"${term}"` : term;
}

function findConceptMatches(normalizedQuery: string): string[] {
  const matches: string[] = [];
  const lower = normalizedQuery.toLowerCase();

  for (const concept of BIOMEDICAL_ONTOLOGY) {
    const candidateTerms = [concept.preferredTerm, ...concept.synonyms];
    if (candidateTerms.some((term) => lower.includes(term.toLowerCase()))) {
      matches.push(concept.id);
    }
  }

  return matches;
}

function expandWithOntology(normalizedQuery: string, baseTerms: string[], reasons: string[]): string[] {
  const lower = normalizedQuery.toLowerCase();
  const expansions: string[] = [];

  for (const concept of BIOMEDICAL_ONTOLOGY) {
    const candidateTerms = [concept.preferredTerm, ...concept.synonyms];
    const matched = candidateTerms.some((term) => lower.includes(term.toLowerCase()));
    if (!matched) continue;

    const forbidden = new Set((concept.forbiddenExpansions || []).map((term) => term.toLowerCase()));
    const conceptTerms = uniq([concept.preferredTerm, ...concept.synonyms])
      .filter((term) => !forbidden.has(term.toLowerCase()))
      .filter((term) => !baseTerms.includes(term))
      .slice(0, concept.maxExpansions ?? 3);

    expansions.push(...conceptTerms);
  }

  const deduped = uniq(expansions);
  if (deduped.length > 0) reasons.push("ontology_expansion_applied");
  return deduped;
}

function compileSourceQuery(source: SearchSource, baseTerms: string[], expandedTerms: string[], normalizedQuery: string): string {
  const budget = SOURCE_BUDGETS[source];
  const boundedBase = baseTerms.slice(0, budget.base);
  const boundedExpanded = expandedTerms.slice(0, budget.expanded);

  if (source === "semantic_scholar") {
    const baseClause = boundedBase.map(quotePhrase).join(" OR ");
    const expandedClause = boundedExpanded.map(quotePhrase).join(" OR ");
    if (baseClause && expandedClause) return `(${baseClause}) OR (${expandedClause})`;
    if (baseClause) return baseClause;
    if (expandedClause) return expandedClause;
    return normalizedQuery;
  }

  if (source === "pubmed") {
    const baseClause = boundedBase.map((term) => `${quotePhrase(term)}[Title/Abstract]`).join(" AND ");
    const expandedClause = boundedExpanded.map((term) => `${quotePhrase(term)}[Title/Abstract]`).join(" OR ");
    if (baseClause && expandedClause) return `${baseClause} AND (${expandedClause})`;
    if (baseClause) return baseClause;
    if (expandedClause) return expandedClause;
    return normalizedQuery;
  }

  const simple = uniq([...boundedBase, ...boundedExpanded]).join(" ").trim();
  return simple || normalizedQuery;
}

function buildSourceQueries(normalizedQuery: string, queryTerms: string[], expandedTerms: string[]): SourceQueries {
  return {
    semantic_scholar: compileSourceQuery("semantic_scholar", queryTerms, expandedTerms, normalizedQuery),
    openalex: compileSourceQuery("openalex", queryTerms, expandedTerms, normalizedQuery),
    pubmed: compileSourceQuery("pubmed", queryTerms, expandedTerms, normalizedQuery),
    arxiv: compileSourceQuery("arxiv", queryTerms, expandedTerms, normalizedQuery),
  };
}

function calculateConfidence(normalizedQuery: string, queryTerms: string[], expandedTerms: string[], reasons: string[]): number {
  let confidence = 0.82;

  if (queryTerms.length < 2) {
    confidence -= 0.2;
    reasons.push("short_query_penalty");
  }

  const tokenSet = new Set(queryTerms);
  if ([...tokenSet].some((token) => AMBIGUITY_TOKENS.has(token))) {
    confidence -= 0.14;
    reasons.push("ambiguity_penalty");
  }

  if ([...tokenSet].some((token) => NEGATION_MARKERS.has(token))) {
    confidence += 0.06;
    reasons.push("negation_preserved");
  }

  if ([...tokenSet].some((token) => COMPARATOR_MARKERS.has(token))) {
    confidence += 0.05;
    reasons.push("comparator_preserved");
  }

  const conceptMatches = findConceptMatches(normalizedQuery).length;
  if (conceptMatches > 0) {
    confidence += Math.min(0.12, conceptMatches * 0.04);
    reasons.push("concept_match_bonus");
  }

  if (expandedTerms.length > 6) {
    confidence -= 0.05;
    reasons.push("expansion_breadth_penalty");
  }

  return Math.min(0.99, Math.max(0.05, confidence));
}

function pruneCircuitWindow(now: number): void {
  const cutoff = now - FALLBACK_WINDOW_MS;
  fallbackCircuit.attempts = fallbackCircuit.attempts.filter((ts) => ts >= cutoff);
  fallbackCircuit.failures = fallbackCircuit.failures.filter((ts) => ts >= cutoff);
}

function canUseFallback(now: number): boolean {
  pruneCircuitWindow(now);
  return now >= fallbackCircuit.openUntil;
}

function recordFallbackAttempt(now: number): void {
  fallbackCircuit.attempts.push(now);
  pruneCircuitWindow(now);
}

function recordFallbackFailure(now: number): void {
  fallbackCircuit.failures.push(now);
  pruneCircuitWindow(now);

  const attemptCount = fallbackCircuit.attempts.length;
  if (attemptCount < FALLBACK_MIN_SAMPLE) return;

  const failureRate = fallbackCircuit.failures.length / Math.max(attemptCount, 1);
  if (failureRate >= FALLBACK_FAILURE_RATE_THRESHOLD) {
    fallbackCircuit.openUntil = now + FALLBACK_COOLDOWN_MS;
  }
}

async function fetchLlmRewrite(query: string, apiKey: string, timeoutMs: number): Promise<{ normalized_query: string; reason_codes?: string[] } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = [
    "Normalize this biomedical research query for high-precision literature retrieval.",
    "Rules: keep negations, keep explicit comparators, remove vague boilerplate, neutralize subjective comparative wording.",
    "Return JSON object only: {\"normalized_query\": string, \"reason_codes\": string[] }.",
  ].join(" ");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Query: ${query}` },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return null;

    const trimmed = content.trim().replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(trimmed);

    if (!parsed?.normalized_query || typeof parsed.normalized_query !== "string") return null;

    return {
      normalized_query: parsed.normalized_query.trim(),
      reason_codes: Array.isArray(parsed.reason_codes) ? parsed.reason_codes.filter((v: unknown) => typeof v === "string") : [],
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function deterministicProcess(query: string): DeterministicResult {
  const reasons: string[] = [];

  let normalized = normalizeUnicodeAndPunctuation(query);
  const lowerCased = normalized.toLocaleLowerCase("en-US");
  if (lowerCased !== normalized) reasons.push("lowercased");
  normalized = lowerCased;

  normalized = normalizeDoseAndUnits(normalized, reasons);
  normalized = stripBoilerplate(normalized, reasons);
  normalized = normalized.replace(/\b(vs\.?|versus)\b/g, "vs");
  normalized = neutralizeComparatives(normalized, reasons);
  normalized = normalized.replace(/\s+/g, " ").trim();

  const queryTerms = uniq(tokenize(normalized)).slice(0, 12);
  const expandedTerms = expandWithOntology(normalized, queryTerms, reasons);
  const sourceQueries = buildSourceQueries(normalized, queryTerms, expandedTerms);
  const confidence = calculateConfidence(normalized, queryTerms, expandedTerms, reasons);

  return {
    normalizedQuery: normalized,
    queryTerms,
    expandedTerms,
    sourceQueries,
    confidence,
    reasonCodes: uniq(reasons),
  };
}

async function hashQueryKey(query: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(query);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (_) {
    return query;
  }
}

export async function prepareQueryProcessingV2(query: string, options: PrepareQueryOptions = {}): Promise<PreparedQueryV2> {
  const startedAt = Date.now();
  const trimmedQuery = query.trim();
  const cacheKey = await hashQueryKey(trimmedQuery);

  const cached = queryCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      query_processing: {
        ...cached.query_processing,
        processing_ms: Math.max(1, Date.now() - startedAt),
        reason_codes: uniq([...cached.query_processing.reason_codes, "cache_hit"]),
      },
    };
  }

  const deterministic = deterministicProcess(trimmedQuery);
  const confidenceThreshold = options.confidenceThreshold ?? 0.74;
  const fallbackTimeoutMs = options.fallbackTimeoutMs ?? 350;

  let normalizedQuery = deterministic.normalizedQuery;
  let queryTerms = deterministic.queryTerms;
  let expandedTerms = deterministic.expandedTerms;
  let sourceQueries = deterministic.sourceQueries;
  let confidence = deterministic.confidence;
  const reasonCodes = [...deterministic.reasonCodes];
  let usedLlmFallback = false;

  const now = Date.now();
  const fallbackApiKey = options.llmApiKey || getEnv("OPENAI_API_KEY") || "";
  const shouldAttemptFallback = confidence < confidenceThreshold && !!fallbackApiKey;

  if (shouldAttemptFallback) {
    if (!canUseFallback(now)) {
      reasonCodes.push("fallback_circuit_open");
    } else {
      recordFallbackAttempt(now);
      const rewritten = await fetchLlmRewrite(trimmedQuery, fallbackApiKey, fallbackTimeoutMs);
      if (rewritten?.normalized_query) {
        const deterministicFromRewrite = deterministicProcess(rewritten.normalized_query);
        normalizedQuery = deterministicFromRewrite.normalizedQuery;
        queryTerms = deterministicFromRewrite.queryTerms;
        expandedTerms = deterministicFromRewrite.expandedTerms;
        sourceQueries = deterministicFromRewrite.sourceQueries;
        confidence = Math.max(deterministicFromRewrite.confidence, confidence);
        usedLlmFallback = true;
        reasonCodes.push("llm_fallback_applied");
        if (rewritten.reason_codes?.length) {
          reasonCodes.push(...rewritten.reason_codes.map((code) => `llm_${code}`));
        }
      } else {
        recordFallbackFailure(Date.now());
        reasonCodes.push("llm_fallback_failed");
      }
    }
  }

  const result: PreparedQueryV2 = {
    original_query: trimmedQuery,
    normalized_query: normalizedQuery,
    search_query: normalizedQuery,
    was_normalized: normalizedQuery !== trimmedQuery,
    query_terms: queryTerms,
    expanded_terms: expandedTerms,
    query_processing: {
      version: "v2",
      deterministic_confidence: Number(confidence.toFixed(3)),
      used_llm_fallback: usedLlmFallback,
      processing_ms: Math.max(1, Date.now() - startedAt),
      reason_codes: uniq(reasonCodes),
      source_queries: sourceQueries,
    },
  };

  queryCache.set(cacheKey, result);
  return result;
}

export function __resetQueryProcessingStateForTests(): void {
  queryCache.clear();
  fallbackCircuit.attempts = [];
  fallbackCircuit.failures = [];
  fallbackCircuit.openUntil = 0;
}

export function __getQueryProcessingCircuitStateForTests(): { attempts: number; failures: number; openUntil: number } {
  return {
    attempts: fallbackCircuit.attempts.length,
    failures: fallbackCircuit.failures.length,
    openUntil: fallbackCircuit.openUntil,
  };
}
