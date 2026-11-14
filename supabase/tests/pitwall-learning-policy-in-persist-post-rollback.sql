-- ============================================================================
-- S2E5 — post-rollback: de vorige definitie is exact terug
--
-- Draait in de S2E5-lab-candidatedatabase direct NA de paired rollback van
-- 20261114101500 en VÓÓR de rollbacks van het eerdere pakket (S2E2/S1/P1).
-- Bewijst lokaal: 8 parameters, 3 resultaatkolommen, geen observation_policy,
-- SECURITY DEFINER, vastgezette search_path en dezelfde ACL.
--
-- De byte-vergelijkende controle tegen de echte base-arm-definitie
-- (pg_get_functiondef/prosrc) doet de harness (sql.py post_rollback), omdat een
-- database geen andere database kan lezen.
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() NOT LIKE 'pitwall_learning_s2e5_%'
     OR current_setting('data_directory') <> '/var/lib/postgresql/data' THEN
    RAISE EXCEPTION 'S2E5 POST-ROLLBACK: wrong database or data_directory (%)', current_database();
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'S2E5 POST-ROLLBACK: TCP connection is not allowed';
  END IF;
END
$guard$;

DO $post$
DECLARE
  v_proc constant regprocedure := 'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)'::regprocedure;
  v_names text[];
  v_modes "char"[];
  v_in integer;
  v_row record;
BEGIN
  SELECT p.proargnames, p.proargmodes,
         (SELECT count(*) FROM unnest(p.proargmodes) AS m WHERE m IN ('i', 'b'))
    INTO v_names, v_modes, v_in
    FROM pg_proc p WHERE p.oid = v_proc;

  IF v_in IS NULL OR v_in <> 8 THEN
    RAISE EXCEPTION 'rollback did not restore the 8-parameter signature: %', v_in;
  END IF;
  IF array_length(v_modes, 1) <> 11 THEN
    RAISE EXCEPTION 'rollback did not restore 8 input + 3 output columns: %', v_modes;
  END IF;
  IF (v_names)[9:11] IS DISTINCT FROM ARRAY['result', 'received_at', 'measurement_ack']::text[] THEN
    RAISE EXCEPTION 'rollback restored the wrong output columns: %', (v_names)[9:11];
  END IF;
  IF v_names @> ARRAY['observation_policy'] THEN
    RAISE EXCEPTION 'observation_policy survived the rollback';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = v_proc AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=pg_catalog, public, auth, pg_temp']
  ) THEN
    RAISE EXCEPTION 'rollback lost SECURITY DEFINER or the pinned search_path';
  END IF;
  IF has_function_privilege('anon', v_proc, 'EXECUTE')
     OR has_function_privilege('authenticated', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback leaked EXECUTE to anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback lost service_role EXECUTE';
  END IF;

  -- De oude aanroep resolveert en gedraagt zich zoals vandaag.
  SET LOCAL request.jwt.claim.role = 'service_role';
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    'not-a-hash', 's2e5-post-rollback', 1, now(), '{}'::jsonb);
  IF v_row.result <> 'invalid_payload' THEN
    RAISE EXCEPTION 'rolled-back function changed its result strings: %', v_row.result;
  END IF;
  RAISE NOTICE 'PASS post-rollback: previous 8-in/3-out definition, SECURITY DEFINER, search_path and ACL restored';
END
$post$;
