-- Read-only captured production projector, 2026-11-17. Test fixture only; not a migration.
CREATE OR REPLACE FUNCTION public.simhub_pace_project_v1(snapshot jsonb, reference_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  h jsonb; own_id text; ref_id text; arr jsonb; stripped jsonb;
BEGIN
  IF snapshot IS NULL OR jsonb_typeof(snapshot) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  stripped := snapshot - 'paceHistory' - 'paceCapture';
  h := snapshot->'paceHistory';
  IF h IS NULL OR jsonb_typeof(h) IS DISTINCT FROM 'object'
     OR jsonb_typeof(h->'cars') IS DISTINCT FROM 'array' THEN
    RETURN stripped;
  END IF;
  BEGIN
    IF (h->>'updatedAt') IS NULL
       OR (h->>'updatedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}:[0-9]{2}|Z)?$'
       OR (h->>'updatedAt')::timestamptz < now() - interval '24 hours' THEN
      RETURN stripped;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN stripped;
  END;

  IF reference_id IS NOT NULL AND char_length(reference_id) > 64 THEN
    reference_id := NULL;
  END IF;
  IF jsonb_typeof(snapshot->'opponents') = 'array' THEN
    SELECT v->>'id' INTO own_id FROM jsonb_array_elements(snapshot->'opponents') t(v)
     WHERE v->>'isPlayer' = 'true' LIMIT 1;
    IF reference_id IS NULL THEN
      SELECT v->>'id' INTO ref_id FROM jsonb_array_elements(snapshot->'opponents') t(v)
       WHERE v->>'position' = '1' AND v->>'id' IS DISTINCT FROM own_id LIMIT 1;
    END IF;
  END IF;
  IF reference_id IS NOT NULL THEN
    ref_id := reference_id;
  END IF;

  SELECT coalesce(jsonb_agg(CASE WHEN v->>'id' IN (own_id,ref_id) THEN v
                                 ELSE v - 'traces' - 'laps' END ORDER BY n),'[]'::jsonb)
    INTO arr
    FROM jsonb_array_elements(h->'cars') WITH ORDINALITY t(v,n)
   WHERE n <= 40;
  RETURN jsonb_set(stripped,'{paceHistory}',jsonb_set(h,'{cars}',arr));
EXCEPTION WHEN OTHERS THEN
  RETURN stripped;
END;
$function$;
