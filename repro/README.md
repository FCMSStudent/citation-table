# Repro Package

Run the full Phase 3 evaluation pipeline with one command:

```bash
bash repro/scripts/run_eval.sh
```

Expected outputs:

- `repro/results/eval_results.json`
- `repro/results/replay_validator.json`
- `repro/results/metrics_results.json`
- `repro/results/tables_figures/*`

## Required environment

- `RESEARCH_ASYNC_LIT_BASE_URL`
- `RESEARCH_USER_BEARER_TOKEN`

Optional for replay + full validation:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEARCH_ASYNC_WORKER_DRAIN_URL`
- `RESEARCH_JOB_WORKER_TOKEN`
