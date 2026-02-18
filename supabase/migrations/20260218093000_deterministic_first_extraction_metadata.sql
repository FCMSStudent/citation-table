ALTER TABLE public.extraction_runs
  ADD COLUMN IF NOT EXISTS extractor_version TEXT,
  ADD COLUMN IF NOT EXISTS prompt_hash TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS deterministic_flag BOOLEAN NOT NULL DEFAULT false;
