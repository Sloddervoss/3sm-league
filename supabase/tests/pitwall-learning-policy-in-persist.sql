-- ============================================================================
-- S2E5 — forward-gedrag van het policyfeit in simhub_persist_v3
--
-- Draait in de S2E5-lab-candidatedatabase, in een EXPLICIETE transactie die aan
-- het eind wordt teruggedraaid. Alle testmutaties (devices, policyrijen,
-- frames) verdwijnen daarmee, zodat de rollback-inventaris dezelfde data ziet.
--
-- Wat hier bewezen wordt:
--   1. resultaatvorm: 4 kolommen, waarvan observation_policy additief is;
--   2. de oude 8-argument-aanroep resolveert nog steeds (zelfde argumentlijst);
--   3. allow / deny / geen-policyrij semantiek is identiek aan
--      public.simhub_observation_policy_v1(text);
--   4. de owner komt uit de devicebinding, nooit uit de payload;
--   5. elke vroege return doet NUL policy-werk (transactieteller) en levert
--      observation_policy = NULL;
--   6. een fout in de policy-leesactie kost het frame niet (fail-closed);
--   7. de bestaande policy-RPC is qua gedrag ongewijzigd.
--
-- Tijdsdiscipline: simhub_persist_v3 heeft een 400ms-rate-limit per device en
-- een 5s-poort voor een nieuwe sessie op een recent gezien device. Elke nieuwe
-- sessie op een hergebruikt device wacht daarom 5.2s en begint op een lage
-- sequence (1), en elke herhaalde aanroep binnen een sessie wacht 450ms.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF current_database() NOT LIKE 'pitwall_learning_s2e5_%'
     OR current_setting('data_directory') <> '/var/lib/postgresql/data' THEN
    RAISE EXCEPTION 'S2E5 FORWARD: wrong database or data_directory (%)', current_database();
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'S2E5 FORWARD: TCP connection is not allowed';
  END IF;
END
$guard$;

-- ---------------------------------------------------------------------------
-- 1. Resultaatvorm en argumentlijst
-- ---------------------------------------------------------------------------
DO $shape$
DECLARE
  v_proc constant regprocedure := 'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)'::regprocedure;
  v_names text[];
  v_modes "char"[];
  v_in integer;
BEGIN
  SELECT p.proargnames, p.proargmodes,
         (SELECT count(*) FROM unnest(p.proargmodes) AS m WHERE m IN ('i', 'b'))
    INTO v_names, v_modes, v_in
    FROM pg_proc p WHERE p.oid = v_proc;

  IF v_in <> 8 THEN
    RAISE EXCEPTION 'expected 8 input parameters (old arity must keep resolving), found %', v_in;
  END IF;
  IF v_modes IS NULL OR array_length(v_modes, 1) <> 12 THEN
    RAISE EXCEPTION 'expected 8 input + 4 output columns, found %', v_modes;
  END IF;
  IF (v_names)[9:12] IS DISTINCT FROM
     ARRAY['result', 'received_at', 'measurement_ack', 'observation_policy']::text[] THEN
    RAISE EXCEPTION 'unexpected output columns: %', (v_names)[9:12];
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = v_proc AND p.prosecdef AND p.prorettype = 'record'::regtype
       AND p.proconfig @> ARRAY['search_path=pg_catalog, public, auth, pg_temp']
  ) THEN
    RAISE EXCEPTION 'SECURITY DEFINER and the pinned search_path must be preserved';
  END IF;
  RAISE NOTICE 'PASS 8-argument signature with additive observation_policy column, SECURITY DEFINER, pinned search_path';
END
$shape$;

DO $acl$
BEGIN
  IF has_function_privilege('anon', 'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated regained EXECUTE on persist';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on persist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)'::regprocedure
       AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC still has an ACL entry';
  END IF;
  IF to_regprocedure('public.simhub_observation_policy_v1(text)') IS NULL THEN
    RAISE EXCEPTION 'public.simhub_observation_policy_v1(text) disappeared';
  END IF;
  RAISE NOTICE 'PASS ACL: service_role only; the existing policy RPC still exists';
END
$acl$;

-- ---------------------------------------------------------------------------
-- 2. Fixtures (binnen deze transactie, aan het eind teruggedraaid)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE s2e5_forward_fixture (
  owner_id uuid, device_id uuid, hash text, revoked boolean, capture boolean, version integer
) ON COMMIT DROP;

INSERT INTO s2e5_forward_fixture VALUES
  ('a5000000-0000-4000-8000-0000000000a1', 'd5000000-0000-4000-8000-0000000000a1', repeat('a', 64), false, true, 1),
  ('a5000000-0000-4000-8000-0000000000b2', 'd5000000-0000-4000-8000-0000000000b2', repeat('b', 64), false, false, 3),
  ('a5000000-0000-4000-8000-0000000000c3', 'd5000000-0000-4000-8000-0000000000c3', repeat('c', 64), false, null, null),
  ('a5000000-0000-4000-8000-0000000000d4', 'd5000000-0000-4000-8000-0000000000d4', repeat('d', 64), true, true, 1),
  ('a5000000-0000-4000-8000-0000000000e5', 'd5000000-0000-4000-8000-0000000000e5', repeat('e', 64), false, true, 2);

INSERT INTO auth.users(id, email, aud, role, is_sso_user)
SELECT owner_id, 's2e5-' || left(hash, 8) || '@example.invalid', 'authenticated', 'authenticated', false
  FROM s2e5_forward_fixture;

INSERT INTO public.simhub_devices(id, owner_user_id, token_hash, device_name, connector_id, device_status, revoked_at)
SELECT device_id, owner_id, hash, 'S2E5 synthetic ' || left(hash, 8), 's2e5-' || left(hash, 8),
       CASE WHEN revoked THEN 'revoked' ELSE 'active_unbound' END,
       CASE WHEN revoked THEN now() ELSE NULL END
  FROM s2e5_forward_fixture;

INSERT INTO pitwall_learning.account_policy(owner_user_id, capture_enabled, policy_version)
SELECT owner_id, capture, version FROM s2e5_forward_fixture WHERE capture IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Hulpfuncties: scan-teller, frame, en de 450ms-pauze
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.policy_scans() RETURNS bigint
LANGUAGE sql
AS $scans$
  SELECT coalesce(sum(pg_stat_get_xact_numscans(c.oid)), 0)::bigint
    FROM pg_class c
   WHERE c.oid = 'pitwall_learning.account_policy'::regclass
      OR c.oid IN (SELECT i.indexrelid FROM pg_index i
                    WHERE i.indrelid = 'pitwall_learning.account_policy'::regclass)
$scans$;

CREATE FUNCTION pg_temp.frame(p_laps integer) RETURNS jsonb
LANGUAGE sql
AS $frame$
  SELECT jsonb_build_object(
    'observationPolicyRequested', true,
    'timing', jsonb_build_object('completedLaps', p_laps),
    'raceState', jsonb_build_object('incidents', 0),
    'track', jsonb_build_object('onPitRoad', false),
    'session', jsonb_build_object('flags', jsonb_build_array('green'), 'sessionTimeSeconds', 120),
    'identity', jsonb_build_object('currentDriverName', 'S2E5 Synthetic', 'carId', '1321', 'trackId', 42)
  )
$frame$;

CREATE FUNCTION pg_temp.pause() RETURNS void LANGUAGE sql AS $pause$ SELECT pg_sleep(0.45) $pause$;

-- Een nieuwe sessie op een recent gezien device wordt als replay geweigerd
-- (last_seen_at binnen 5s). De fixture simuleert daarom een echt idle device.
CREATE FUNCTION pg_temp.idle() RETURNS void LANGUAGE sql AS $idle$ SELECT pg_sleep(5.2) $idle$;

SET LOCAL request.jwt.claim.role = 'service_role';

-- ---------------------------------------------------------------------------
-- 4. Allow / deny / geen policyrij — en de oude 8-argument-aanroep
-- ---------------------------------------------------------------------------
DO $semantics$
DECLARE
  v_row record;
BEGIN
  -- A: policyrij capture=true/version=1 -> allow met de ECHTE versie.
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('a', 64), 's2e5-forward-a', 1, now(), pg_temp.frame(1), NULL, NULL, NULL);
  IF v_row.result <> 'accepted' THEN
    RAISE EXCEPTION 'A expected accepted, got %', v_row.result;
  END IF;
  IF v_row.observation_policy IS DISTINCT FROM
     jsonb_build_object('captureAllowed', true, 'policyVersion', 1) THEN
    RAISE EXCEPTION 'A expected allow v1, got %', v_row.observation_policy;
  END IF;
  IF v_row.measurement_ack IS NOT NULL THEN
    RAISE EXCEPTION 'measurement_ack changed for a frame without batches: %', v_row.measurement_ack;
  END IF;
  IF v_row.received_at IS NULL THEN
    RAISE EXCEPTION 'received_at disappeared';
  END IF;
  RAISE NOTICE 'PASS accepted frame via the old 8-argument call publishes allow v1 in the same result';

  -- B: policyrij capture=false -> expliciete deny (geen allow, geen stilte).
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('b', 64), 's2e5-forward-b', 1, now(), pg_temp.frame(1));
  IF v_row.result <> 'accepted' THEN
    RAISE EXCEPTION 'B expected accepted, got %', v_row.result;
  END IF;
  IF v_row.observation_policy IS DISTINCT FROM
     jsonb_build_object('captureAllowed', false, 'policyVersion', NULL) THEN
    RAISE EXCEPTION 'B expected deny, got %', v_row.observation_policy;
  END IF;
  RAISE NOTICE 'PASS capture_enabled=false publishes an explicit deny';

  -- C: device bestaat, geen policyrij -> niet ingeschreven -> deny.
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('c', 64), 's2e5-forward-c', 1, now(), pg_temp.frame(1));
  IF v_row.result <> 'accepted' THEN
    RAISE EXCEPTION 'C expected accepted, got %', v_row.result;
  END IF;
  IF v_row.observation_policy IS DISTINCT FROM
     jsonb_build_object('captureAllowed', false, 'policyVersion', NULL) THEN
    RAISE EXCEPTION 'C expected deny, got %', v_row.observation_policy;
  END IF;
  RAISE NOTICE 'PASS a missing policy row is not enrolment (explicit deny)';

  -- E: toekomstige versie 2 blijft 2 en wordt nooit 1.
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('e', 64), 's2e5-forward-e', 1, now(), pg_temp.frame(1));
  IF v_row.observation_policy IS DISTINCT FROM
     jsonb_build_object('captureAllowed', true, 'policyVersion', 2) THEN
    RAISE EXCEPTION 'E expected allow with the real version 2, got %', v_row.observation_policy;
  END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_row.observation_policy) AS k)
     IS DISTINCT FROM ARRAY['captureAllowed', 'policyVersion']::text[] THEN
    RAISE EXCEPTION 'decision carries extra keys: %', v_row.observation_policy;
  END IF;
  IF v_row.observation_policy::text LIKE '%' || repeat('e', 64) || '%' THEN
    RAISE EXCEPTION 'token hash leaked into the decision';
  END IF;
  RAISE NOTICE 'PASS real policy version preserved; only captureAllowed/policyVersion published';
END
$semantics$;

-- ---------------------------------------------------------------------------
-- 5. De vroege returns doen nul policy-werk
-- ---------------------------------------------------------------------------
DO $early$
DECLARE
  v_row record;
  v_before bigint;
  v_after bigint;
  v_body text;
BEGIN
  -- unauthorized: verkeerde rolclaim, maar wel EXECUTE (superuser-sessie).
  SET LOCAL request.jwt.claim.role = 'anon';
  v_before := pg_temp.policy_scans();
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('a', 64), 's2e5-forward-a', 99, now(), pg_temp.frame(9));
  v_after := pg_temp.policy_scans();
  IF v_row.result <> 'unauthorized' OR v_row.observation_policy IS NOT NULL THEN
    RAISE EXCEPTION 'unauthorized changed: %, %', v_row.result, v_row.observation_policy;
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'unauthorized read the policy table (% -> %)', v_before, v_after;
  END IF;
  SET LOCAL request.jwt.claim.role = 'service_role';

  -- invalid_payload.
  v_before := pg_temp.policy_scans();
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    'not-a-hash', 's2e5-forward-a', 1, now(), pg_temp.frame(1));
  v_after := pg_temp.policy_scans();
  IF v_row.result <> 'invalid_payload' OR v_row.observation_policy IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_payload changed: %, %', v_row.result, v_row.observation_policy;
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'invalid_payload read the policy table';
  END IF;

  -- invalid_device.
  v_before := pg_temp.policy_scans();
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('9', 64), 's2e5-forward-a', 1, now(), pg_temp.frame(1));
  v_after := pg_temp.policy_scans();
  IF v_row.result <> 'invalid_device' OR v_row.observation_policy IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_device changed: %, %', v_row.result, v_row.observation_policy;
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'invalid_device read the policy table';
  END IF;

  -- revoked: heeft wél een positieve policyrij, maar mag er niets van publiceren.
  v_before := pg_temp.policy_scans();
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('d', 64), 's2e5-forward-d', 1, now(), pg_temp.frame(1));
  v_after := pg_temp.policy_scans();
  IF v_row.result <> 'revoked' OR v_row.observation_policy IS NOT NULL THEN
    RAISE EXCEPTION 'revoked changed: %, %', v_row.result, v_row.observation_policy;
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'revoked read the policy table';
  END IF;

  -- rate_limited: eerst een geaccepteerd frame op een idle device (de
  -- 5s-poort voor een nieuwe sessie moet echt verstreken zijn, en de eerste
  -- sequence van een sessie is laag), daarna direct het volgende frame.
  PERFORM pg_temp.idle();
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('a', 64), 's2e5-forward-rate', 1, now(), pg_temp.frame(3));
  IF v_row.result <> 'accepted' THEN
    RAISE EXCEPTION 'rate primer was not accepted: %', v_row.result;
  END IF;
  v_before := pg_temp.policy_scans();
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('a', 64), 's2e5-forward-rate', 2, now(), pg_temp.frame(3));
  v_after := pg_temp.policy_scans();
  IF v_row.result <> 'rate_limited' OR v_row.observation_policy IS NOT NULL THEN
    RAISE EXCEPTION 'rate_limited changed: %, %', v_row.result, v_row.observation_policy;
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'rate_limited read the policy table';
  END IF;

  -- replayed: na de 400ms-poort, met een sequence <= de laatste van die sessie.
  PERFORM pg_temp.pause();
  v_before := pg_temp.policy_scans();
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('a', 64), 's2e5-forward-rate', 1, now(), pg_temp.frame(3));
  v_after := pg_temp.policy_scans();
  IF v_row.result <> 'replayed' OR v_row.observation_policy IS NOT NULL THEN
    RAISE EXCEPTION 'replayed changed: %, %', v_row.result, v_row.observation_policy;
  END IF;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'replayed read the policy table (% -> %)', v_before, v_after;
  END IF;

  -- Structureel: elke vroege return staat vóór de policy-lookup in de body.
  -- session_limit wordt door de sessie-prune in een verse database niet
  -- bereikbaar, dus die tak wordt hier op positie bewezen, niet uitgevoerd.
  v_body := (SELECT prosrc FROM pg_proc
              WHERE oid = 'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)'::regprocedure);
  IF strpos(v_body, 'account_policy') = 0 THEN
    RAISE EXCEPTION 'policy lookup not found in the function body';
  END IF;
  IF strpos(v_body, '''session_limit''') > strpos(v_body, 'account_policy')
     OR strpos(v_body, '''replayed''') > strpos(v_body, 'account_policy')
     OR strpos(v_body, '''rate_limited''') > strpos(v_body, 'account_policy')
     OR strpos(v_body, '''invalid_device''') > strpos(v_body, 'account_policy')
     OR strpos(v_body, '''invalid_payload''') > strpos(v_body, 'account_policy')
     OR strpos(v_body, '''unauthorized''') > strpos(v_body, 'account_policy') THEN
    RAISE EXCEPTION 'an early return moved behind the policy lookup';
  END IF;
  RAISE NOTICE 'PASS every early return leaves observation_policy NULL and never reads the policy table';
END
$early$;

-- ---------------------------------------------------------------------------
-- 6. De owner komt uit de devicebinding, nooit uit de payload
-- ---------------------------------------------------------------------------
DO $forged$
DECLARE
  v_row record;
  v_payload jsonb;
BEGIN
  PERFORM pg_temp.idle();
  v_payload := pg_temp.frame(1) || jsonb_build_object(
    'ownerUserId', 'a5000000-0000-4000-8000-0000000000b2',
    'deviceId', 'd5000000-0000-4000-8000-0000000000b2',
    'tokenHash', repeat('b', 64),
    'owner', jsonb_build_object('userId', 'a5000000-0000-4000-8000-0000000000b2')
  );
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('e', 64), 's2e5-forward-forged', 1, now(), v_payload);
  IF v_row.result <> 'accepted' THEN
    RAISE EXCEPTION 'forged frame was not accepted: %', v_row.result;
  END IF;
  IF v_row.observation_policy->>'policyVersion' <> '2' THEN
    RAISE EXCEPTION 'forged payload won: %', v_row.observation_policy;
  END IF;
  IF (SELECT session_id FROM public.simhub_telemetry_latest
       WHERE device_id = 'd5000000-0000-4000-8000-0000000000b2')
     IS DISTINCT FROM 's2e5-forward-b' THEN
    RAISE EXCEPTION 'forged payload device received the write';
  END IF;
  IF (SELECT session_id FROM public.simhub_telemetry_latest
       WHERE device_id = 'd5000000-0000-4000-8000-0000000000e5')
     IS DISTINCT FROM 's2e5-forward-forged' THEN
    RAISE EXCEPTION 'the token-bound device did not receive the write';
  END IF;
  RAISE NOTICE 'PASS forged payload owner/device/hash are ignored; the token binding decides';
END
$forged$;

-- ---------------------------------------------------------------------------
-- 7. De bestaande policy-RPC is qua gedrag ongewijzigd
-- ---------------------------------------------------------------------------
DO $parity$
DECLARE
  v_rpc jsonb;
  v_persist record;
  v_hash text;
  v_seq integer := 0;
BEGIN
  PERFORM pg_temp.idle();
  FOREACH v_hash IN ARRAY ARRAY[repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('e', 64), repeat('9', 64)] LOOP
    v_seq := v_seq + 1;
    PERFORM pg_temp.pause();
    v_rpc := public.simhub_observation_policy_v1(v_hash);
    SELECT * INTO v_persist FROM public.simhub_persist_v3(
      v_hash, 's2e5-forward-parity', v_seq, now(), pg_temp.frame(1));
    IF v_persist.result = 'accepted' THEN
      IF v_persist.observation_policy IS DISTINCT FROM v_rpc THEN
        RAISE EXCEPTION 'policy parity broken for %: rpc=% persist=%', left(v_hash, 8),
          v_rpc, v_persist.observation_policy;
      END IF;
    ELSE
      IF v_persist.observation_policy IS NOT NULL THEN
        RAISE EXCEPTION 'non-accepted result published a policy: %', v_persist.observation_policy;
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS the separate policy RPC keeps its exact behaviour and agrees with the embedded fact';
END
$parity$;

-- ---------------------------------------------------------------------------
-- 8. Fail-closed: een fout in de policy-leesactie kost het frame niet
-- ---------------------------------------------------------------------------
DO $failclosed$
DECLARE
  v_row record;
BEGIN
  PERFORM pg_temp.idle();
  ALTER TABLE pitwall_learning.account_policy RENAME TO account_policy_s2e5_hidden;
  BEGIN
    SELECT * INTO v_row FROM public.simhub_persist_v3(
      repeat('a', 64), 's2e5-forward-failclosed', 1, now(), pg_temp.frame(1));
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE pitwall_learning.account_policy_s2e5_hidden RENAME TO account_policy;
    RAISE EXCEPTION 'a policy read failure escaped the function: %', SQLERRM;
  END;
  ALTER TABLE pitwall_learning.account_policy_s2e5_hidden RENAME TO account_policy;
  IF v_row.result <> 'accepted' THEN
    RAISE EXCEPTION 'policy failure cost the frame: %', v_row.result;
  END IF;
  IF v_row.observation_policy IS NOT NULL THEN
    RAISE EXCEPTION 'policy failure published a fabricated decision: %', v_row.observation_policy;
  END IF;
  RAISE NOTICE 'PASS an unavailable policy table keeps the frame accepted and omits the policy';
END
$failclosed$;

-- ---------------------------------------------------------------------------
-- 9. Aanwezig veld = precies één policy-read; vroeg pad = nul
-- ---------------------------------------------------------------------------
DO $counter$
DECLARE
  v_row record;
  v_before bigint;
  v_after bigint;
BEGIN
  PERFORM pg_temp.idle();
  v_before := pg_temp.policy_scans();
  SELECT * INTO v_row FROM public.simhub_persist_v3(
    repeat('a', 64), 's2e5-forward-counter', 1, now(), pg_temp.frame(1));
  v_after := pg_temp.policy_scans();
  IF v_row.result <> 'accepted' THEN
    RAISE EXCEPTION 'counter frame was not accepted: %', v_row.result;
  END IF;
  IF v_after - v_before <> 1 THEN
    RAISE EXCEPTION 'accepted path must read the policy exactly once, delta=%', v_after - v_before;
  END IF;
  RAISE NOTICE 'PASS the accepted path performs exactly one bounded policy lookup';
END
$counter$;

-- ---------------------------------------------------------------------------
-- 10. Readonly: de policy-lookup wijzigt geen enkele rij
-- ---------------------------------------------------------------------------
-- Explicit SQL-boundary intent controls: these valid cores must NOT be masked
-- by a failed identity or an early rejection. Only JSON boolean true opts in.
DO $intent$
DECLARE
  v_marker jsonb;
  v_row record;
  v_before bigint;
  v_seq integer := 0;
BEGIN
  PERFORM pg_temp.idle();
  FOREACH v_marker IN ARRAY ARRAY[NULL::jsonb, 'false'::jsonb, '"true"'::jsonb, '"unavailable"'::jsonb] LOOP
    v_seq := v_seq + 1;
    PERFORM pg_temp.pause();
    v_before := pg_temp.policy_scans();
    SELECT * INTO v_row FROM public.simhub_persist_v3(
      repeat('a',64), 's2e5-intent', v_seq, now(),
      (pg_temp.frame(1) - 'observationPolicyRequested') ||
        CASE WHEN v_marker IS NULL THEN '{}'::jsonb
             ELSE jsonb_build_object('observationPolicyRequested',v_marker) END);
    IF v_row.result <> 'accepted' OR v_row.observation_policy IS NOT NULL
       OR pg_temp.policy_scans() <> v_before THEN
      RAISE EXCEPTION 'non-ON intent did policy work or lost core: %', v_marker;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS absent/off/wrong-type/unavailable intent: accepted cores, null policy, zero scans';
END
$intent$;

DO $readonly$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT jsonb_build_object(
    'devices_md5', (SELECT md5(coalesce(string_agg(md5((to_jsonb(t) - 'last_seen_at' - 'last_session_id' - 'last_sequence' - 'updated_at')::text), '|' ORDER BY t.id), '')) FROM public.simhub_devices t),
    'policies_md5', (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.owner_user_id), '')) FROM pitwall_learning.account_policy t)
  ) INTO v_before;

  PERFORM pg_temp.idle();
  PERFORM public.simhub_persist_v3(repeat('a', 64), 's2e5-forward-readonly', 1, now(), pg_temp.frame(1));

  SELECT jsonb_build_object(
    'devices_md5', (SELECT md5(coalesce(string_agg(md5((to_jsonb(t) - 'last_seen_at' - 'last_session_id' - 'last_sequence' - 'updated_at')::text), '|' ORDER BY t.id), '')) FROM public.simhub_devices t),
    'policies_md5', (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.owner_user_id), '')) FROM pitwall_learning.account_policy t)
  ) INTO v_after;

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'persist changed device or policy rows: % -> %', v_before, v_after;
  END IF;
  RAISE NOTICE 'PASS the embedded policy lookup leaves device and policy rows unchanged';
END
$readonly$;

RESET request.jwt.claim.role;
ROLLBACK;
