import fs from "node:fs";
import path from "node:path";

export function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function optionalEnv(name, fallback = "") {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

export function stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function hashString(raw) {
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    const message = parsed?.error || parsed?.message || response.statusText;
    throw new Error(`HTTP ${response.status}: ${message}`);
  }
  return parsed;
}

export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollSearchStatus({
  baseUrl,
  searchId,
  authToken,
  timeoutMs = 300000,
  intervalMs = 1000,
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const statusPayload = await fetchJson(`${baseUrl}/search/${searchId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (statusPayload.status === "completed" || statusPayload.status === "failed") {
      return statusPayload;
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for search ${searchId}`);
}

export async function fetchRunDetail({ baseUrl, searchId, runId, authToken }) {
  if (!runId) return null;
  return await fetchJson(`${baseUrl}/search/${searchId}/runs/${runId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function timestampTag() {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
}

export function writeJsonDeterministic(filePath, value) {
  const stable = stableStringify(value);
  const pretty = JSON.stringify(JSON.parse(stable), null, 2) + "\n";
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, pretty, "utf8");
}

export function readTopics(topicsPath) {
  const raw = fs.readFileSync(topicsPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Topics file must be a JSON array: ${topicsPath}`);
  }
  return parsed.map((topic) => String(topic).trim()).filter(Boolean);
}
