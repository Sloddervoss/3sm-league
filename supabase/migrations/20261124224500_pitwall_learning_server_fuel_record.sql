-- Personal fuel learning — commit server-derived fuel facts.
--
-- Why this exists: `fuel_worker_record` only accepts an observation while the
-- client-side source (`fuel_worker_source`) can still prove the observation
-- block it validated. A server-derived observation has no observation block by
-- definition, so that function returns NULL for it and the record step refuses
-- the qualification ("qualification_not_committed", three attempts, dead job).
-- The facts are real; only the pinning source differs.
--
-- This function is the matching sink: it pins the write against
-- `fuel_worker_server_source` (owner, device, revision, policy version,
-- visibility timestamp, lap, started/ended, used litres) and then stores the
-- observation exactly where `fuel_worker_record` would have stored it.
--
-- Immutable and idempotent: it only fills `qualified_data` while it is still
-- NULL. It writes no other table and changes no policy.
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('pitwall_learning.fuel_worker_server_source(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'server fuel record requires fuel_worker_server_source(uuid,uuid)';
  END IF;
  IF to_regclass('pitwall_learning.fuel_visibility') IS NULL THEN
    RAISE EXCEPTION 'server fuel record requires fuel_visibility';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION pitwall_learning.fuel_worker_record_server(
  p_job uuid,
  p_lease uuid,
  p_data jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pitwall_learning', 'pg_temp'
AS $fn$
DECLARE
  s jsonb;
  used numeric;
  started numeric;
  ended numeric;
BEGIN
  s := pitwall_learning.fuel_worker_server_source(p_job, p_lease);
  IF s IS NULL OR s ->> 'superseded' IS DISTINCT FROM 'false' THEN
    RETURN false;
  END IF;

  -- Shape first, so a malformed observation can never reach a cast.
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR pg_column_size(p_data) > 4096 THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_data -> 'lap') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_data -> 'usedLitres') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_data -> 'startedAt') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_data -> 'endedAt') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_data -> 'knownAt') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_data -> 'policyVersion') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_data -> 'context') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_data -> 'session') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_data -> 'scope') IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  -- Identity of the source facts, exactly as the SQL function resolved them.
  IF p_data ->> 'revision' IS DISTINCT FROM s ->> 'id'
     OR p_data ->> 'owner' IS DISTINCT FROM s ->> 'owner'
     OR p_data ->> 'device' IS DISTINCT FROM s ->> 'device'
     OR (p_data -> 'policyVersion') IS DISTINCT FROM (s -> 'policyVersion')
     OR p_data -> 'lap' IS DISTINCT FROM s -> 'lap' THEN
    RETURN false;
  END IF;

  started := (p_data ->> 'startedAt')::numeric;
  ended := (p_data ->> 'endedAt')::numeric;
  IF started IS DISTINCT FROM (s ->> 'startedAt')::numeric
     OR ended IS DISTINCT FROM (s ->> 'endedAt')::numeric
     OR (p_data ->> 'knownAt')::numeric IS DISTINCT FROM (s ->> 'knownAt')::numeric THEN
    RETURN false;
  END IF;

  used := (p_data ->> 'usedLitres')::numeric;
  IF used NOT BETWEEN 0.2 AND 15 THEN
    RETURN false;
  END IF;
  IF abs(used - ((s ->> 'fuelStartLitres')::numeric - (s ->> 'fuelEndLitres')::numeric)) > 0.000001 THEN
    RETURN false;
  END IF;

  -- Context and session arrays are the grouping keys of the shared window, so
  -- they must be exactly what the facts produce.
  IF (p_data ->> 'context')::jsonb IS DISTINCT FROM jsonb_build_array(
        s -> 'owner', s -> 'device', s ->> 'driver', s ->> 'car', s -> 'track', s ->> 'layout') THEN
    RETURN false;
  END IF;
  IF (p_data ->> 'session')::jsonb IS DISTINCT FROM jsonb_build_array(s ->> 'sessionKey') THEN
    RETURN false;
  END IF;
  IF p_data #>> '{scope,driver}' IS DISTINCT FROM s ->> 'driver'
     OR p_data #>> '{scope,car}' IS DISTINCT FROM s ->> 'car'
     OR p_data #>> '{scope,layout}' IS DISTINCT FROM s ->> 'layout'
     OR (p_data #>> '{scope,track}')::numeric IS DISTINCT FROM (s ->> 'track')::numeric THEN
    RETURN false;
  END IF;

  UPDATE pitwall_learning.fuel_visibility
     SET qualified_data = p_data
   WHERE source_revision_id = (s ->> 'id')::uuid
     AND qualified_data IS NULL;

  -- Idempotent replay: a second pass over the same lap must succeed even though
  -- an earlier pass stored an equal observation (litres are compared as
  -- numbers, not as jsonb, so float noise from a different producer cannot turn
  -- a valid re-run into a failed job).
  RETURN EXISTS (
    SELECT 1 FROM pitwall_learning.fuel_visibility
     WHERE source_revision_id = (s ->> 'id')::uuid
       AND qualified_data IS NOT NULL
       AND qualified_data ->> 'revision' IS NOT DISTINCT FROM s ->> 'id'
       AND (qualified_data ->> 'knownAt')::numeric IS NOT DISTINCT FROM (s ->> 'knownAt')::numeric
       AND (qualified_data ->> 'usedLitres')::numeric = used);
END
$fn$;

COMMENT ON FUNCTION pitwall_learning.fuel_worker_record_server(uuid, uuid, jsonb) IS
  'Stores a server-derived fuel observation, pinned against fuel_worker_server_source. Fill-once; refuses any mismatch.';

REVOKE ALL ON FUNCTION pitwall_learning.fuel_worker_record_server(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pitwall_learning.fuel_worker_record_server(uuid, uuid, jsonb)
  TO pitwall_learning_worker;

-- Rollback: DROP FUNCTION pitwall_learning.fuel_worker_record_server(uuid, uuid, jsonb);
-- Server-derived observations already stored stay stored; they are ordinary
-- qualified observations for the window, forecast and model steps.

COMMIT;
