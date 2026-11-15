-- ============================================================================
-- S2E5 — pre-image: de base-arm (captured LIVE schema, zonder het S2E5-pakket)
--
-- Bewijst dat de definitie die de paired rollback herstelt echt de bestaande,
-- live gevormde definitie is: 8 parameters, 3 resultaatkolommen, geen
-- observation_policy. Draait in de base-database van de S2E5-lab.
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() NOT LIKE 'pitwall_learning_s2e5_%'
     OR current_setting('data_directory') <> '/var/lib/postgresql/data' THEN
    RAISE EXCEPTION 'S2E5 PRE: wrong database or data_directory (%)', current_database();
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'S2E5 PRE: TCP connection is not allowed';
  END IF;
END
$guard$;

DO $pre$
DECLARE
  v_names text[];
  v_modes "char"[];
  v_in integer;
BEGIN
  SELECT p.proargnames, p.proargmodes,
         (SELECT count(*) FROM unnest(p.proargmodes) AS m WHERE m IN ('i', 'b'))
    INTO v_names, v_modes, v_in
    FROM pg_proc p
   WHERE p.oid = 'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)'::regprocedure;

  IF v_in IS NULL OR v_in <> 8 THEN
    RAISE EXCEPTION 'pre-image does not have the expected 8 input parameters: %', v_in;
  END IF;
  IF array_length(v_modes, 1) <> 11 THEN
    RAISE EXCEPTION 'pre-image must have 8 input + 3 output columns, found %', v_modes;
  END IF;
  IF (v_names)[9:11] IS DISTINCT FROM ARRAY['result', 'received_at', 'measurement_ack']::text[] THEN
    RAISE EXCEPTION 'pre-image output columns changed: %', (v_names)[9:11];
  END IF;
  IF v_names @> ARRAY['observation_policy'] THEN
    RAISE EXCEPTION 'pre-image already has observation_policy';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)'::regprocedure
       AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'pre-image lost SECURITY DEFINER';
  END IF;
  IF to_regprocedure('public.simhub_observation_policy_v1(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'base arm unexpectedly already has the S2E2 policy RPC';
  END IF;
  RAISE NOTICE 'PASS pre-image: 8-in/3-out persist without observation_policy, SECURITY DEFINER, no policy RPC yet';
END
$pre$;
