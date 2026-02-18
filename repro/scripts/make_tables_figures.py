#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd


def main():
    parser = argparse.ArgumentParser(description="Generate tables and figures from metrics output")
    parser.add_argument("--metrics", required=True, help="Path to metrics output JSON")
    parser.add_argument("--out-dir", required=True, help="Output directory")
    args = parser.parse_args()

    metrics_payload = json.loads(Path(args.metrics).read_text(encoding="utf-8"))
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    aggregate = metrics_payload.get("aggregate_metrics", {})
    aggregate_rows = [{"baseline_id": baseline, **values} for baseline, values in aggregate.items()]
    agg_df = pd.DataFrame(aggregate_rows).sort_values("baseline_id") if aggregate_rows else pd.DataFrame()
    agg_csv = out_dir / "table_aggregate_metrics.csv"
    agg_df.to_csv(agg_csv, index=False)

    topic_rows = metrics_payload.get("topic_metrics", [])
    topic_df = pd.DataFrame(topic_rows)
    topic_csv = out_dir / "table_topic_metrics.csv"
    topic_df.to_csv(topic_csv, index=False)

    if not agg_df.empty:
      fig, ax = plt.subplots(figsize=(11, 5))
      agg_df.plot(x="baseline_id", y=["precision_at_10", "recall_at_10", "ndcg_at_10"], kind="bar", ax=ax)
      ax.set_title("Retrieval Metrics by Baseline")
      ax.set_ylabel("score")
      ax.grid(axis="y", alpha=0.3)
      plt.tight_layout()
      fig_path = out_dir / "figure_retrieval_metrics.png"
      fig.savefig(fig_path, dpi=200)
      plt.close(fig)

      fig2, ax2 = plt.subplots(figsize=(11, 5))
      agg_df.plot(x="baseline_id", y=["latency_ms", "cost_per_report"], kind="bar", ax=ax2)
      ax2.set_title("Efficiency Metrics by Baseline")
      ax2.grid(axis="y", alpha=0.3)
      plt.tight_layout()
      fig2_path = out_dir / "figure_efficiency_metrics.png"
      fig2.savefig(fig2_path, dpi=200)
      plt.close(fig2)

    summary = {
      "tables": [str(agg_csv), str(topic_csv)],
      "figures": sorted(str(p) for p in out_dir.glob("figure_*.png")),
    }
    (out_dir / "tables_figures_manifest.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"out_dir": str(out_dir), **summary}, indent=2))


if __name__ == "__main__":
    main()
