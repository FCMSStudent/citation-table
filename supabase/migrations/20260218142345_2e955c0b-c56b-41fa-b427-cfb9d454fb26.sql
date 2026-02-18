
-- pipeline_versions
CREATE TABLE IF NOT EXISTS public.pipeline_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_manifest_hash text NOT NULL,
  extractor_bundle_hash text NOT NULL,
  config_hash text NOT NULL,
  seed integer NOT NULL DEFAULT 42,
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_manifest_hash, extractor_bundle_hash, config_hash, seed)
);
ALTER TABLE public.pipeline_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages pipeline_versions" ON public.pipeline_versions FOR ALL USING (true) WITH CHECK (true);

-- research_stage_outputs
CREATE TABLE IF NOT EXISTS public.research_stage_outputs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.research_reports(id),
  stage text NOT NULL,
  input_hash text NOT NULL,
  output_hash text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  pipeline_version_id uuid REFERENCES public.pipeline_versions(id),
  producer_job_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, stage, input_hash)
);
ALTER TABLE public.research_stage_outputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages stage_outputs" ON public.research_stage_outputs FOR ALL USING (true) WITH CHECK (true);

-- research_metrics_samples
CREATE TABLE IF NOT EXISTS public.research_metrics_samples (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  metric_name text NOT NULL,
  metric_value double precision NOT NULL,
  unit text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_id text,
  run_id text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.research_metrics_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages metrics_samples" ON public.research_metrics_samples FOR ALL USING (true) WITH CHECK (true);

-- research_trace_spans
CREATE TABLE IF NOT EXISTS public.research_trace_spans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trace_id text NOT NULL,
  run_id text NOT NULL,
  report_id text,
  span_name text NOT NULL,
  stage text,
  provider text,
  status text NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_ms double precision,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.research_trace_spans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages trace_spans" ON public.research_trace_spans FOR ALL USING (true) WITH CHECK (true);

-- doi_cache
CREATE TABLE IF NOT EXISTS public.doi_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  normalized_doi text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  cache_version text NOT NULL DEFAULT 'v1',
  hit_count integer NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.doi_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages doi_cache" ON public.doi_cache FOR ALL USING (true) WITH CHECK (true);

-- canonical_record_cache
CREATE TABLE IF NOT EXISTS public.canonical_record_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text,
  cache_version text NOT NULL DEFAULT 'v1',
  hit_count integer NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.canonical_record_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages canonical_record_cache" ON public.canonical_record_cache FOR ALL USING (true) WITH CHECK (true);

-- extraction_cache
CREATE TABLE IF NOT EXISTS public.extraction_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key text NOT NULL UNIQUE,
  study_id text NOT NULL,
  extractor_version text NOT NULL,
  prompt_hash text NOT NULL,
  model text NOT NULL,
  output_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_hash text,
  hit_count integer NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.extraction_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages extraction_cache" ON public.extraction_cache FOR ALL USING (true) WITH CHECK (true);

-- research_cache_events
CREATE TABLE IF NOT EXISTS public.research_cache_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_name text NOT NULL,
  event_type text NOT NULL,
  key_hash text,
  report_id text,
  run_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.research_cache_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages cache_events" ON public.research_cache_events FOR ALL USING (true) WITH CHECK (true);

-- provider_rate_limit_state
CREATE TABLE IF NOT EXISTS public.provider_rate_limit_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL UNIQUE,
  tokens_remaining integer NOT NULL DEFAULT 100,
  max_tokens integer NOT NULL DEFAULT 100,
  refill_rate double precision NOT NULL DEFAULT 1.0,
  last_refill_at timestamptz NOT NULL DEFAULT now(),
  in_flight integer NOT NULL DEFAULT 0,
  circuit_state text NOT NULL DEFAULT 'closed',
  blocked_until timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.provider_rate_limit_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages rate_limit_state" ON public.provider_rate_limit_state FOR ALL USING (true) WITH CHECK (true);

-- provider_rate_limit_try_acquire RPC
CREATE OR REPLACE FUNCTION public.provider_rate_limit_try_acquire(
  p_provider text,
  p_tokens integer DEFAULT 1
)
RETURNS TABLE(
  acquired boolean,
  wait_ms integer,
  circuit_state text,
  blocked_until timestamptz,
  tokens_remaining integer,
  in_flight integer
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_state provider_rate_limit_state%ROWTYPE;
  v_now timestamptz := now();
  v_elapsed_seconds double precision;
  v_new_tokens integer;
BEGIN
  -- Upsert default state if missing
  INSERT INTO provider_rate_limit_state (provider)
  VALUES (p_provider)
  ON CONFLICT (provider) DO NOTHING;

  SELECT * INTO v_state FROM provider_rate_limit_state WHERE provider = p_provider FOR UPDATE;

  -- Check circuit breaker
  IF v_state.circuit_state = 'open' AND v_state.blocked_until IS NOT NULL AND v_state.blocked_until > v_now THEN
    RETURN QUERY SELECT false, EXTRACT(EPOCH FROM (v_state.blocked_until - v_now))::integer * 1000,
      v_state.circuit_state, v_state.blocked_until, v_state.tokens_remaining, v_state.in_flight;
    RETURN;
  END IF;

  -- Refill tokens
  v_elapsed_seconds := EXTRACT(EPOCH FROM (v_now - v_state.last_refill_at));
  v_new_tokens := LEAST(v_state.max_tokens, v_state.tokens_remaining + (v_elapsed_seconds * v_state.refill_rate)::integer);

  IF v_new_tokens >= p_tokens THEN
    UPDATE provider_rate_limit_state
    SET tokens_remaining = v_new_tokens - p_tokens,
        in_flight = in_flight + 1,
        last_refill_at = v_now,
        circuit_state = CASE WHEN circuit_state = 'open' THEN 'half_open' ELSE circuit_state END,
        updated_at = v_now
    WHERE provider = p_provider;

    RETURN QUERY SELECT true, 0, 
      CASE WHEN v_state.circuit_state = 'open' THEN 'half_open'::text ELSE v_state.circuit_state END,
      NULL::timestamptz, v_new_tokens - p_tokens, v_state.in_flight + 1;
  ELSE
    RETURN QUERY SELECT false, ((p_tokens - v_new_tokens) / GREATEST(v_state.refill_rate, 0.01) * 1000)::integer,
      v_state.circuit_state, v_state.blocked_until, v_new_tokens, v_state.in_flight;
  END IF;
END;
$$;

-- provider_rate_limit_record_result RPC
CREATE OR REPLACE FUNCTION public.provider_rate_limit_record_result(
  p_provider text,
  p_success boolean,
  p_status integer DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT NULL,
  p_latency_ms double precision DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE provider_rate_limit_state
  SET in_flight = GREATEST(in_flight - 1, 0),
      consecutive_failures = CASE WHEN p_success THEN 0 ELSE consecutive_failures + 1 END,
      circuit_state = CASE
        WHEN p_success AND circuit_state = 'half_open' THEN 'closed'
        WHEN NOT p_success AND consecutive_failures + 1 >= 5 THEN 'open'
        ELSE circuit_state
      END,
      blocked_until = CASE
        WHEN NOT p_success AND consecutive_failures + 1 >= 5 THEN v_now + interval '60 seconds'
        WHEN p_retry_after_seconds IS NOT NULL THEN v_now + (p_retry_after_seconds || ' seconds')::interval
        ELSE blocked_until
      END,
      updated_at = v_now
  WHERE provider = p_provider;
END;
$$;
