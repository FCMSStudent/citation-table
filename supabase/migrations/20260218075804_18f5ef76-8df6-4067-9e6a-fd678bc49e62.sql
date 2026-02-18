
-- Atomic append: adds a study JSON to results array without read-modify-write
-- Returns the new length of the results array
CREATE OR REPLACE FUNCTION public.append_study_to_report(
  p_report_id uuid,
  p_study jsonb
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_len integer;
BEGIN
  UPDATE public.research_reports
  SET results = COALESCE(results, '[]'::jsonb) || jsonb_build_array(p_study)
  WHERE id = p_report_id
  RETURNING jsonb_array_length(results) INTO v_new_len;

  IF v_new_len IS NULL THEN
    RAISE EXCEPTION 'Report % not found', p_report_id;
  END IF;

  RETURN v_new_len;
END;
$function$;

-- Atomic check: returns true if a DOI already exists in the results array
CREATE OR REPLACE FUNCTION public.report_has_doi(
  p_report_id uuid,
  p_doi text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_found boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.research_reports r,
         jsonb_array_elements(COALESCE(r.results, '[]'::jsonb)) AS elem
    WHERE r.id = p_report_id
      AND elem->'citation'->>'doi' = p_doi
  ) INTO v_found;
  RETURN v_found;
END;
$function$;

-- Atomic update: replaces a study matched by DOI within the results array
-- Uses advisory lock on report_id to serialize concurrent updates to same report
CREATE OR REPLACE FUNCTION public.update_study_by_doi(
  p_report_id uuid,
  p_doi text,
  p_study jsonb
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_results jsonb;
  v_new_results jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_updated integer := 0;
  v_lock_key bigint;
BEGIN
  -- Advisory lock keyed on report UUID to serialize per-report updates
  v_lock_key := ('x' || left(replace(p_report_id::text, '-', ''), 15))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT COALESCE(results, '[]'::jsonb)
  INTO v_results
  FROM public.research_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF v_results IS NULL THEN
    RAISE EXCEPTION 'Report % not found', p_report_id;
  END IF;

  FOR v_elem IN SELECT jsonb_array_elements(v_results)
  LOOP
    IF v_elem->'citation'->>'doi' = p_doi THEN
      v_new_results := v_new_results || jsonb_build_array(p_study);
      v_updated := v_updated + 1;
    ELSE
      v_new_results := v_new_results || jsonb_build_array(v_elem);
    END IF;
  END LOOP;

  UPDATE public.research_reports
  SET results = v_new_results
  WHERE id = p_report_id;

  RETURN v_updated;
END;
$function$;
