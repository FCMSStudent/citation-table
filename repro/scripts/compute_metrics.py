#!/usr/bin/env python3
import argparse
import json
import math
import os
import random
from collections import defaultdict
from itertools import combinations
from pathlib import Path

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

try:
    import pandas as pd
except Exception:  # pragma: no cover
    pd = None

try:
    from scipy.stats import friedmanchisquare, wilcoxon
except Exception:  # pragma: no cover
    friedmanchisquare = None
    wilcoxon = None

try:
    from statsmodels.stats.contingency_tables import mcnemar
except Exception:  # pragma: no cover
    mcnemar = None


def stable_dump(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True)


def safe_div(n, d):
    return float(n) / float(d) if d else 0.0


def dcg(binary_relevance):
    total = 0.0
    for idx, rel in enumerate(binary_relevance, start=1):
        gain = rel
        total += gain / math.log2(idx + 1)
    return total


def ndcg_at_k(candidates, relevant, k):
    observed = [1 if c in relevant else 0 for c in candidates[:k]]
    ideal = sorted(observed, reverse=True)
    return safe_div(dcg(observed), dcg(ideal)) if ideal else 0.0


def precision_at_k(candidates, relevant, k):
    top = candidates[:k]
    if not top:
        return 0.0
    hits = sum(1 for c in top if c in relevant)
    return safe_div(hits, len(top))


def recall_at_k(candidates, relevant, k):
    if not relevant:
        return 0.0
    hits = sum(1 for c in candidates[:k] if c in relevant)
    return safe_div(hits, len(relevant))


def f1(precision, recall):
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def flatten_studies(rows):
    flat = {}
    for row in rows:
        sid = str(row.get("study_id") or "").strip()
        if sid:
            flat[sid] = row
    return flat


def bootstrap_ci(samples, iterations=2000, alpha=0.05, seed=42):
    if not samples:
        return (0.0, 0.0)
    rng = random.Random(seed)
    n = len(samples)
    means = []
    for _ in range(iterations):
        draw = [samples[rng.randrange(0, n)] for _ in range(n)]
        means.append(sum(draw) / len(draw))
    means.sort()
    lo = means[int((alpha / 2) * len(means))]
    hi = means[int((1 - alpha / 2) * len(means)) - 1]
    return (float(lo), float(hi))


def holm_bonferroni(pairs):
    ordered = sorted(pairs, key=lambda x: x["p_value"])
    m = len(ordered)
    for i, row in enumerate(ordered):
        alpha_i = 0.05 / max(1, (m - i))
        row["holm_alpha"] = alpha_i
        row["reject"] = row["p_value"] <= alpha_i
    return ordered


def compute_metrics(eval_payload, gold_payload, replay_payload):
    rows = eval_payload.get("structured_results", [])
    gold_topics = (gold_payload or {}).get("topics", {})

    by_topic_baseline = defaultdict(list)
    for row in rows:
        by_topic_baseline[(row["topic"], row["baseline_id"])].append(row)

    topic_metrics = []
    for (topic, baseline), samples in by_topic_baseline.items():
        sample = samples[0]
        candidates = list(sample.get("candidate_ids") or [])
        dois = list(sample.get("dois") or [])

        gold_topic = gold_topics.get(topic, {})
        relevant_ids = set(gold_topic.get("relevant_ids", []))

        p10 = precision_at_k(candidates, relevant_ids, 10)
        r10 = recall_at_k(candidates, relevant_ids, 10)
        ndcg10 = ndcg_at_k(candidates, relevant_ids, 10)

        duplicate_reduction = 1.0 - safe_div(len(set(candidates)), len(candidates)) if candidates else 0.0

        extracted = flatten_studies(sample.get("extraction_stats", {}).get("studies", []))
        gold_extracted = flatten_studies(gold_topic.get("studies", []))

        tp_fields = fp_fields = fn_fields = 0
        key_fields = ["title", "year", "study_design", "sample_size", "population"]
        for sid, study in extracted.items():
            gold_study = gold_extracted.get(sid, {})
            for key in key_fields:
                pred = study.get(key)
                true = gold_study.get(key)
                if pred is None and true is not None:
                    fn_fields += 1
                elif pred is not None and true is None:
                    fp_fields += 1
                elif pred is not None and true is not None:
                    if str(pred).strip().lower() == str(true).strip().lower():
                        tp_fields += 1
                    else:
                        fp_fields += 1
                        fn_fields += 1

        field_precision = safe_div(tp_fields, tp_fields + fp_fields)
        field_recall = safe_div(tp_fields, tp_fields + fn_fields)
        field_f1 = f1(field_precision, field_recall)

        hallucination_rate = safe_div(
            len([sid for sid in extracted.keys() if sid not in gold_extracted]),
            max(1, len(extracted)),
        )

        completeness_count = 0
        completeness_den = 0
        for study in extracted.values():
            for key in key_fields:
                completeness_den += 1
                if study.get(key) not in (None, "", []):
                    completeness_count += 1
        completeness_rate = safe_div(completeness_count, completeness_den)

        extraction_stats = sample.get("extraction_stats") or {}
        llm_batches = float(extraction_stats.get("llm_batches", 0) or 0)
        cost_per_report = llm_batches * float(os.getenv("LLM_COST_PER_BATCH_USD", "0.0025"))

        topic_metrics.append({
            "topic": topic,
            "baseline_id": baseline,
            "precision_at_10": p10,
            "recall_at_10": r10,
            "ndcg_at_10": ndcg10,
            "unique_doi_yield": len(set(dois)),
            "duplicate_reduction": duplicate_reduction,
            "merge_precision": sample.get("merge_precision", 0.0),
            "merge_recall": sample.get("merge_recall", 0.0),
            "field_precision": field_precision,
            "field_recall": field_recall,
            "field_f1": field_f1,
            "hallucination_rate": hallucination_rate,
            "completeness_rate": completeness_rate,
            "latency_ms": float(sample.get("latency_ms") or 0),
            "cost_per_report": cost_per_report,
            "traceability_coverage": 1.0 if sample.get("run_id") else 0.0,
        })

    by_baseline = defaultdict(list)
    for row in topic_metrics:
        by_baseline[row["baseline_id"]].append(row)

    aggregate = {}
    for baseline, rows_for_baseline in by_baseline.items():
        aggregate[baseline] = {
            "precision_at_10": sum(r["precision_at_10"] for r in rows_for_baseline) / len(rows_for_baseline),
            "recall_at_10": sum(r["recall_at_10"] for r in rows_for_baseline) / len(rows_for_baseline),
            "ndcg_at_10": sum(r["ndcg_at_10"] for r in rows_for_baseline) / len(rows_for_baseline),
            "unique_doi_yield": sum(r["unique_doi_yield"] for r in rows_for_baseline) / len(rows_for_baseline),
            "duplicate_reduction": sum(r["duplicate_reduction"] for r in rows_for_baseline) / len(rows_for_baseline),
            "merge_precision": sum(r["merge_precision"] for r in rows_for_baseline) / len(rows_for_baseline),
            "merge_recall": sum(r["merge_recall"] for r in rows_for_baseline) / len(rows_for_baseline),
            "field_precision": sum(r["field_precision"] for r in rows_for_baseline) / len(rows_for_baseline),
            "field_recall": sum(r["field_recall"] for r in rows_for_baseline) / len(rows_for_baseline),
            "field_f1": sum(r["field_f1"] for r in rows_for_baseline) / len(rows_for_baseline),
            "hallucination_rate": sum(r["hallucination_rate"] for r in rows_for_baseline) / len(rows_for_baseline),
            "completeness_rate": sum(r["completeness_rate"] for r in rows_for_baseline) / len(rows_for_baseline),
            "latency_ms": sum(r["latency_ms"] for r in rows_for_baseline) / len(rows_for_baseline),
            "cost_per_report": sum(r["cost_per_report"] for r in rows_for_baseline) / len(rows_for_baseline),
            "traceability_coverage": sum(r["traceability_coverage"] for r in rows_for_baseline) / len(rows_for_baseline),
        }

    replay_match_rate = float((replay_payload or {}).get("replay_match_rate") or 0.0)

    stats = {
        "friedman": None,
        "wilcoxon": [],
        "mcnemar": [],
        "bootstrap_ci": [],
        "holm_bonferroni": [],
    }

    baseline_ids = sorted(by_baseline.keys())
    topic_ids = sorted({r["topic"] for r in topic_metrics})

    if friedmanchisquare and len(baseline_ids) >= 3 and topic_ids:
        matrix = []
        for baseline in baseline_ids:
            values = []
            rows_map = {r["topic"]: r["precision_at_10"] for r in by_baseline[baseline]}
            for topic in topic_ids:
                if topic in rows_map:
                    values.append(rows_map[topic])
            if len(values) == len(topic_ids):
                matrix.append(values)
        if len(matrix) >= 3:
            stat, pvalue = friedmanchisquare(*matrix)
            stats["friedman"] = {"statistic": float(stat), "p_value": float(pvalue)}

    reference = baseline_ids[0] if baseline_ids else None
    if reference and wilcoxon:
        for baseline in baseline_ids[1:]:
            pairs = []
            ref_map = {r["topic"]: r["precision_at_10"] for r in by_baseline[reference]}
            cmp_map = {r["topic"]: r["precision_at_10"] for r in by_baseline[baseline]}
            for topic in topic_ids:
                if topic in ref_map and topic in cmp_map:
                    pairs.append((ref_map[topic], cmp_map[topic]))
            if len(pairs) >= 2:
                x = [a for a, _ in pairs]
                y = [b for _, b in pairs]
                stat, pvalue = wilcoxon(x, y)
                stats["wilcoxon"].append({
                    "reference": reference,
                    "baseline": baseline,
                    "statistic": float(stat),
                    "p_value": float(pvalue),
                })

    if reference and mcnemar:
        for baseline in baseline_ids[1:]:
            table = [[0, 0], [0, 0]]
            ref_map = {r["topic"]: r["precision_at_10"] >= 0.5 for r in by_baseline[reference]}
            cmp_map = {r["topic"]: r["precision_at_10"] >= 0.5 for r in by_baseline[baseline]}
            for topic in topic_ids:
                if topic in ref_map and topic in cmp_map:
                    ref_ok = 1 if ref_map[topic] else 0
                    cmp_ok = 1 if cmp_map[topic] else 0
                    table[ref_ok][cmp_ok] += 1
            result = mcnemar(table, exact=False, correction=True)
            stats["mcnemar"].append({
                "reference": reference,
                "baseline": baseline,
                "table": table,
                "statistic": float(result.statistic),
                "p_value": float(result.pvalue),
            })

    for baseline in baseline_ids:
        vals = [r["precision_at_10"] for r in by_baseline[baseline]]
        lo, hi = bootstrap_ci(vals)
        stats["bootstrap_ci"].append({
            "baseline": baseline,
            "metric": "precision_at_10",
            "ci_low": lo,
            "ci_high": hi,
        })

    stats["holm_bonferroni"] = holm_bonferroni([
        {
            "comparison": f"{row['reference']} vs {row['baseline']}",
            "p_value": row["p_value"],
        }
        for row in stats["wilcoxon"]
    ])

    return {
        "topic_metrics": topic_metrics,
        "aggregate_metrics": aggregate,
        "reproducibility": {
            "deterministic_replay_match": replay_match_rate,
            "traceability_coverage": sum(r["traceability_coverage"] for r in topic_metrics) / max(1, len(topic_metrics)),
        },
        "statistical_tests": stats,
    }


def main():
    parser = argparse.ArgumentParser(description="Compute Phase 3 metrics and statistical tests")
    parser.add_argument("--eval", required=True, help="Path to evaluation results JSON")
    parser.add_argument("--gold", required=False, help="Path to gold annotations JSON")
    parser.add_argument("--replay", required=False, help="Path to replay validator JSON")
    parser.add_argument("--output", required=True, help="Output JSON path")
    args = parser.parse_args()

    eval_payload = json.loads(Path(args.eval).read_text(encoding="utf-8"))
    gold_payload = json.loads(Path(args.gold).read_text(encoding="utf-8")) if args.gold else {}
    replay_payload = json.loads(Path(args.replay).read_text(encoding="utf-8")) if args.replay else {}

    result = compute_metrics(eval_payload, gold_payload, replay_payload)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": args.output}, indent=2))


if __name__ == "__main__":
    main()
