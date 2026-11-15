-- Prospective observation v2 capture only. No worker, backfill, policy or persist rewrite.
-- Paired rollback disables new v2 writes without rewriting retained observations/hashes.
-- Deployment order: apply this migration, then enable SIMHUB_OBSERVATION_V2_DEPLOYED
-- on the existing Edge ingest. Existing observation mode/capability/policy still apply.
DO $guard$
BEGIN
  IF to_regprocedure('public.simhub_observation_v1_valid(jsonb)') IS NULL
     OR to_regprocedure('public.simhub_observation_v1_baseline_valid(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'observation v1 required; refusing to adopt a previous v2 migration';
  END IF;
END
$guard$;

-- Keep the accepted v1 validator verbatim, including its grants/owner and byte bounds.
ALTER FUNCTION public.simhub_observation_v1_valid(jsonb)
  RENAME TO simhub_observation_v1_baseline_valid;

CREATE FUNCTION public.simhub_observation_v1_valid(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  q jsonb;
  k text;
BEGIN
  IF p->'version' = '1'::jsonb THEN
    RETURN public.simhub_observation_v1_baseline_valid(p);
  END IF;
  IF p->'version' IS DISTINCT FROM '2'::jsonb OR pg_column_size(p) > 4096 THEN RETURN false; END IF;
  -- Reuse all accepted v1 constraints without changing the original v2 raw value.
  IF NOT public.simhub_observation_v1_baseline_valid(
    jsonb_set(p - 'fuelQuality', '{version}', '1'::jsonb)) THEN RETURN false; END IF;
  IF NOT (p ? 'fuelQuality') THEN RETURN true; END IF;
  q := p->'fuelQuality';
  IF jsonb_typeof(q) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(q)) <> 5 THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['pitRoad','refuel','resetOrTow','driverId','driverChanged'] LOOP
    IF NOT (q ? k) THEN RETURN false; END IF;
    IF q->k = 'null'::jsonb THEN CONTINUE; END IF;
    IF k = 'driverId' THEN
      IF jsonb_typeof(q->k) IS DISTINCT FROM 'string'
         OR NOT public.simhub_observation_text_valid(q->>k, 128) THEN RETURN false; END IF;
    ELSIF jsonb_typeof(q->k) IS DISTINCT FROM 'boolean' THEN RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END
$fn$;
ALTER FUNCTION public.simhub_observation_v1_valid(jsonb) OWNER TO supabase_admin;
REVOKE ALL ON FUNCTION public.simhub_observation_v1_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_observation_v1_valid(jsonb) TO service_role;
COMMENT ON FUNCTION public.simhub_observation_v1_valid(jsonb) IS
  'Capture versions 1 and 2; v1 baseline unchanged. v2 fuelQuality null means unknown, never a negative fact. Existing authenticated device fence/hash/raw capture remain unchanged.';
