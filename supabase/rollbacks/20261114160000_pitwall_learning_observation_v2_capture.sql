-- First disable SIMHUB_OBSERVATION_V2_DEPLOYED on Edge; old clients continue v1.
-- Preserve all stored v2 JSON/hashes, no schema-down, no history rewrite.
CREATE OR REPLACE FUNCTION public.simhub_observation_v1_valid(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public
AS $fn$
  SELECT public.simhub_observation_v1_baseline_valid(p)
$fn$;
ALTER FUNCTION public.simhub_observation_v1_valid(jsonb) OWNER TO supabase_admin;
REVOKE ALL ON FUNCTION public.simhub_observation_v1_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_observation_v1_valid(jsonb) TO service_role;
COMMENT ON FUNCTION public.simhub_observation_v1_valid(jsonb) IS
  'v2 capture disabled by paired rollback; retained raw v2 rows are untouched.';
