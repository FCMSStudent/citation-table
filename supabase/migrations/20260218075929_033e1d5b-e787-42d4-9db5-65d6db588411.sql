
-- Fix update_study_by_doi to use case-insensitive DOI matching
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
    IF lower(v_elem->'citation'->>'doi') = lower(p_doi) THEN
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

-- Also fix report_has_doi to be case-insensitive
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
      AND lower(elem->'citation'->>'doi') = lower(p_doi)
  ) INTO v_found;
  RETURN v_found;
END;
$function$;
