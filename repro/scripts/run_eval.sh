#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TOPICS_FILE="${TOPICS_FILE:-repro/data/topics.sample.json}"
GOLD_FILE="${GOLD_FILE:-}"

EVAL_OUT="repro/results/eval_results.json"
REPLAY_OUT="repro/results/replay_validator.json"
METRICS_OUT="repro/results/metrics_results.json"
TABLES_OUT_DIR="repro/results/tables_figures"

node repro/scripts/eval_harness.mjs --topics "$TOPICS_FILE" --output "$EVAL_OUT"

if [[ -n "${SUPABASE_URL:-}" && -n "${SUPABASE_SERVICE_ROLE_KEY:-}" && -n "${RESEARCH_ASYNC_WORKER_DRAIN_URL:-}" && -n "${RESEARCH_JOB_WORKER_TOKEN:-}" ]]; then
  REPLAY_VALIDATOR_OUTPUT="$REPLAY_OUT" node repro/scripts/replay_validator.mjs
else
  cat > "$REPLAY_OUT" <<'JSON'
{
  "generated_at": "",
  "attempted_runs": 0,
  "replay_match_rate": 0.0,
  "mismatches": [],
  "rows": []
}
JSON
fi

if [[ -n "$GOLD_FILE" ]]; then
  python3 repro/scripts/compute_metrics.py --eval "$EVAL_OUT" --gold "$GOLD_FILE" --replay "$REPLAY_OUT" --output "$METRICS_OUT"
else
  python3 repro/scripts/compute_metrics.py --eval "$EVAL_OUT" --replay "$REPLAY_OUT" --output "$METRICS_OUT"
fi

python3 repro/scripts/make_tables_figures.py --metrics "$METRICS_OUT" --out-dir "$TABLES_OUT_DIR"

echo "Evaluation completed"
echo "- $EVAL_OUT"
echo "- $REPLAY_OUT"
echo "- $METRICS_OUT"
echo "- $TABLES_OUT_DIR"
