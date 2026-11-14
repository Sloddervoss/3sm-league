-- ============================================================================
-- S2E2 — forward-gedrag, effectieve ACL en bestaande P1-handhaving
--
-- Draait na de forward-migratie in een EXPLICIETE transactie die aan het eind
-- wordt teruggedraaid. Alle testmutaties (policy uitzetten, device intrekken,
-- capture aanzetten, testrollen) verdwijnen daarmee, zodat de
-- rollback-inventaris dezelfde data ziet.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p2_readiness_policy_s2e2'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'S2E2 FORWARD: wrong database or data_directory';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'S2E2 FORWARD: TCP connection is not allowed';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION pg_temp.expect_denied(p_role text, p_sql text, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $h$
DECLARE
  v_failed boolean := false;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_failed THEN
    RAISE EXCEPTION 'expected insufficient_privilege for %', p_label;
  END IF;
  RAISE NOTICE 'PASS % (role % denied)', p_label, p_role;
END
$h$;

-- ---------------------------------------------------------------------------
-- 1. Autorisatie matrix op de echte functie
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claim.role = 'service_role';

DO $matrix$
DECLARE
  v jsonb;
BEGIN
  -- A: toegestaan, bestaande policyversie 1.
  v := public.simhub_observation_policy_v1(repeat('a', 64));
  IF v IS DISTINCT FROM jsonb_build_object('captureAllowed', true, 'policyVersion', 1) THEN
    RAISE EXCEPTION 'A expected allow v1, got %', v;
  END IF;
  RAISE NOTICE 'PASS A allowed capture with existing version 1';

  -- B: policyrij bestaat maar capture_enabled = false -> expliciete deny.
  v := public.simhub_observation_policy_v1(repeat('b', 64));
  IF v IS DISTINCT FROM jsonb_build_object('captureAllowed', false, 'policyVersion', NULL) THEN
    RAISE EXCEPTION 'B expected deny, got %', v;
  END IF;
  RAISE NOTICE 'PASS B denied although a policy row exists';

  -- C: device bestaat, geen policyrij -> geen inschrijving, deny.
  v := public.simhub_observation_policy_v1(repeat('c', 64));
  IF v IS DISTINCT FROM jsonb_build_object('captureAllowed', false, 'policyVersion', NULL) THEN
    RAISE EXCEPTION 'C expected deny, got %', v;
  END IF;
  RAISE NOTICE 'PASS C denied without policy row (default deny)';

  -- R: device van A maar revoked -> deny.
  v := public.simhub_observation_policy_v1(repeat('e', 64));
  IF v IS DISTINCT FROM jsonb_build_object('captureAllowed', false, 'policyVersion', NULL) THEN
    RAISE EXCEPTION 'R expected deny, got %', v;
  END IF;
  RAISE NOTICE 'PASS revoked device denied';

  -- Onbekende maar geldige hash -> deny.
  v := public.simhub_observation_policy_v1(repeat('f', 64));
  IF v IS DISTINCT FROM jsonb_build_object('captureAllowed', false, 'policyVersion', NULL) THEN
    RAISE EXCEPTION 'unknown expected deny, got %', v;
  END IF;
  RAISE NOTICE 'PASS unknown token hash denied';

  -- D: toekomstige policyversie 2 blijft 2, wordt nooit als 1 gezegend.
  v := public.simhub_observation_policy_v1(repeat('d', 64));
  IF v IS DISTINCT FROM jsonb_build_object('captureAllowed', true, 'policyVersion', 2) THEN
    RAISE EXCEPTION 'D expected allow with real version 2, got %', v;
  END IF;
  IF (v->>'policyVersion') = '1' THEN
    RAISE EXCEPTION 'future version was rewritten to 1';
  END IF;
  RAISE NOTICE 'PASS unknown future version 2 preserved (never blessed as 1)';

  -- Alleen de twee contractvelden, geen owner/token/hash.
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v) AS k)
     IS DISTINCT FROM ARRAY['captureAllowed', 'policyVersion'] THEN
    RAISE EXCEPTION 'publisher returned extra keys';
  END IF;
  RAISE NOTICE 'PASS output carries only captureAllowed and policyVersion';
END
$matrix$;

-- ---------------------------------------------------------------------------
-- 2. Strikte, NULL-safe tokenhashvalidatie (geen normalisatie)
-- ---------------------------------------------------------------------------
DO $hash$
DECLARE
  v jsonb;
  v_deny jsonb := jsonb_build_object('captureAllowed', false, 'policyVersion', NULL);
  v_input text;
BEGIN
  FOREACH v_input IN ARRAY ARRAY[
    NULL,
    '',
    ' ',
    repeat('a', 63),
    repeat('a', 64) || 'a',
    upper(repeat('a', 64)),
    '0x' || repeat('a', 62),
    repeat('a', 63) || 'g',
    ' ' || repeat('a', 63),
    repeat('a', 64) || ' '
  ] LOOP
    v := public.simhub_observation_policy_v1(v_input);
    IF v IS DISTINCT FROM v_deny THEN
      RAISE EXCEPTION 'invalid hash % was not denied: %', coalesce(v_input, '<null>'), v;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS null/blank/wrong-length/uppercase/non-hex/whitespace hashes denied without normalisation';

  -- De geldige lowercase hash blijft wel werken: deny is geen kapotte functie.
  IF public.simhub_observation_policy_v1(repeat('a', 64))
     IS DISTINCT FROM jsonb_build_object('captureAllowed', true, 'policyVersion', 1) THEN
    RAISE EXCEPTION 'valid lowercase hash stopped working';
  END IF;
  RAISE NOTICE 'PASS valid lowercase 64-hex still resolves';
END
$hash$;

-- ---------------------------------------------------------------------------
-- 3. Effectieve ACL: service_role ja, anon/authenticated/nested-leden nee
-- ---------------------------------------------------------------------------
DO $acl$
BEGIN
  IF has_function_privilege('anon', 'public.simhub_observation_policy_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon has EXECUTE';
  END IF;
  IF has_function_privilege('authenticated', 'public.simhub_observation_policy_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated has EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.simhub_observation_policy_v1(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lacks EXECUTE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid = 'public.simhub_observation_policy_v1(text)'::regprocedure
       AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC still has an ACL entry';
  END IF;
  RAISE NOTICE 'PASS ACL: service_role only, PUBLIC/anon/authenticated revoked';
END
$acl$;

-- Nested lid van authenticated: erft geen EXECUTE.
CREATE ROLE s2e2_nested_member NOLOGIN INHERIT;
GRANT authenticated TO s2e2_nested_member;
-- Nested lid van service_role: erft EXECUTE wel.
CREATE ROLE s2e2_nested_service NOLOGIN INHERIT;
GRANT service_role TO s2e2_nested_service;

SELECT pg_temp.expect_denied(
  'anon',
  $$SELECT public.simhub_observation_policy_v1(repeat('a', 64))$$,
  'direct anon EXECUTE');
SELECT pg_temp.expect_denied(
  'authenticated',
  $$SELECT public.simhub_observation_policy_v1(repeat('a', 64))$$,
  'direct authenticated EXECUTE');
SELECT pg_temp.expect_denied(
  's2e2_nested_member',
  $$SELECT public.simhub_observation_policy_v1(repeat('a', 64))$$,
  'nested authenticated member EXECUTE');

DO $nested$
DECLARE
  v jsonb;
BEGIN
  SET LOCAL ROLE s2e2_nested_service;
  v := public.simhub_observation_policy_v1(repeat('a', 64));
  IF v IS DISTINCT FROM jsonb_build_object('captureAllowed', true, 'policyVersion', 1) THEN
    RAISE EXCEPTION 'nested service_role member did not inherit EXECUTE: %', v;
  END IF;
  RAISE NOTICE 'PASS nested service_role member inherits EXECUTE (not only superuser works)';
END
$nested$;
RESET ROLE;

-- service_role heeft EXECUTE maar GEEN directe leesrechten op de private tabel.
SELECT pg_temp.expect_denied(
  'service_role',
  $$SELECT count(*) FROM pitwall_learning.account_policy$$,
  'service_role direct private read');
SELECT pg_temp.expect_denied(
  'anon',
  $$SELECT count(*) FROM pitwall_learning.account_policy$$,
  'anon direct private read');
SELECT pg_temp.expect_denied(
  's2e2_nested_service',
  $$SELECT count(*) FROM pitwall_learning.account_policy$$,
  'nested service_role member direct private read');

-- Interne defense-in-depth: EXECUTE alleen is niet genoeg zonder service-roleclaim.
DO $claim$
BEGIN
  SET LOCAL ROLE service_role;
  SET LOCAL request.jwt.claim.role = 'anon';
  BEGIN
    PERFORM public.simhub_observation_policy_v1(repeat('a', 64));
    RAISE EXCEPTION 'function ran without a service_role claim';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'PASS internal auth.role() gate refuses a non-service_role claim';
END
$claim$;

-- ---------------------------------------------------------------------------
-- 4. Readonly: de lookup wijzigt geen enkele rij
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claim.role = 'service_role';

DO $readonly$
DECLARE
  v_before jsonb;
  v_after jsonb;
BEGIN
  SELECT jsonb_build_object(
    'devices', (SELECT count(*) FROM public.simhub_devices),
    'devices_md5', (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), ''))
                      FROM public.simhub_devices t),
    'policies', (SELECT count(*) FROM pitwall_learning.account_policy),
    'policies_md5', (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.owner_user_id), ''))
                       FROM pitwall_learning.account_policy t)
  ) INTO v_before;

  PERFORM public.simhub_observation_policy_v1(repeat('a', 64));
  PERFORM public.simhub_observation_policy_v1(repeat('b', 64));
  PERFORM public.simhub_observation_policy_v1(repeat('c', 64));
  PERFORM public.simhub_observation_policy_v1(repeat('d', 64));
  PERFORM public.simhub_observation_policy_v1(repeat('e', 64));

  SELECT jsonb_build_object(
    'devices', (SELECT count(*) FROM public.simhub_devices),
    'devices_md5', (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), ''))
                      FROM public.simhub_devices t),
    'policies', (SELECT count(*) FROM pitwall_learning.account_policy),
    'policies_md5', (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.owner_user_id), ''))
                       FROM pitwall_learning.account_policy t)
  ) INTO v_after;

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'readonly lookup changed rows: % -> %', v_before, v_after;
  END IF;
  RAISE NOTICE 'PASS readonly lookup leaves device and policy rows unchanged';
END
$readonly$;

-- ---------------------------------------------------------------------------
-- 5. Bestaande P1-privateprojectie handhaaft ap.capture_enabled
--    (dezelfde echte guard die de capture-triggers gebruiken)
-- ---------------------------------------------------------------------------
DO $capture$
DECLARE
  v_rows jsonb;
  v_result jsonb;
  v_a uuid := 'd0000000-0000-4000-8000-0000000000a1';
  v_b uuid := 'd0000000-0000-4000-8000-0000000000b2';
  v_c uuid := 'd0000000-0000-4000-8000-0000000000c3';
  v_d uuid := 'd0000000-0000-4000-8000-0000000000d4';
  v_owners text[];
  v_versions text[];
BEGIN
  -- De globale P1-schakelaar staat default uit; zet hem alleen in deze
  -- transactie aan. Dat bewijst dat accountbeleid een APARTE poort is.
  UPDATE pitwall_learning.runtime_settings
     SET capture_enabled = false WHERE id = 1;

  v_rows := jsonb_build_array(
    jsonb_build_object('device_id', v_a::text, 'source_uid', '11111111-1111-4111-8111-111111111111',
      'record_revision', 1, 'content_hash', repeat('1', 32),
      'observed_at', '2026-11-14T00:00:00Z', 'payload', '{"lap":1}'::jsonb),
    jsonb_build_object('device_id', v_b::text, 'source_uid', '22222222-2222-4222-8222-222222222222',
      'record_revision', 1, 'content_hash', repeat('2', 32),
      'observed_at', '2026-11-14T00:00:01Z', 'payload', '{"lap":2}'::jsonb),
    jsonb_build_object('device_id', v_c::text, 'source_uid', '33333333-3333-4333-8333-333333333333',
      'record_revision', 1, 'content_hash', repeat('3', 32),
      'observed_at', '2026-11-14T00:00:02Z', 'payload', '{"lap":3}'::jsonb),
    jsonb_build_object('device_id', v_d::text, 'source_uid', '44444444-4444-4444-8444-444444444444',
      'record_revision', 1, 'content_hash', repeat('4', 32),
      'observed_at', '2026-11-14T00:00:03Z', 'payload', '{"lap":4}'::jsonb)
  );

  -- Globale schakelaar uit: niets vastleggen, ongeacht accountbeleid.
  v_result := pitwall_learning.capture_source_batch('lap_summary', v_rows);
  IF (v_result->>'items')::int <> 0 THEN
    RAISE EXCEPTION 'global capture switch off still captured %', v_result;
  END IF;
  RAISE NOTICE 'PASS global capture switch off overrides per-account policy';

  UPDATE pitwall_learning.runtime_settings SET capture_enabled = true WHERE id = 1;
  v_result := pitwall_learning.capture_source_batch('lap_summary', v_rows);
  IF (v_result->>'items')::int <> 2 THEN
    RAISE EXCEPTION 'expected only A and D captured, got %', v_result;
  END IF;

  SELECT array_agg(DISTINCT owner_user_id::text ORDER BY owner_user_id::text),
         array_agg(DISTINCT account_policy_version::text ORDER BY account_policy_version::text)
    INTO v_owners, v_versions
    FROM pitwall_learning.capture_batches;

  IF v_owners IS DISTINCT FROM
     ARRAY['a0000000-0000-4000-8000-0000000000a1',
           'a0000000-0000-4000-8000-0000000000d4']::text[] THEN
    RAISE EXCEPTION 'captured owners wrong: %', v_owners;
  END IF;
  IF v_versions IS DISTINCT FROM ARRAY['1', '2']::text[] THEN
    RAISE EXCEPTION 'captured policy versions wrong: %', v_versions;
  END IF;
  IF EXISTS (SELECT 1 FROM pitwall_learning.capture_batches
              WHERE owner_user_id = 'a0000000-0000-4000-8000-0000000000b2') THEN
    RAISE EXCEPTION 'account B (capture_enabled=false) was captured';
  END IF;
  RAISE NOTICE 'PASS actual P1 guard captures A, denies B, drops no-policy C';

  -- Intrekken van toestemming voor A: nieuwe batches bevatten A niet meer.
  UPDATE pitwall_learning.account_policy SET capture_enabled = false
   WHERE owner_user_id = 'a0000000-0000-4000-8000-0000000000a1';
  v_rows := jsonb_build_array(
    jsonb_build_object('device_id', v_a::text, 'source_uid', '55555555-5555-4555-8555-555555555555',
      'record_revision', 1, 'content_hash', repeat('5', 32),
      'observed_at', '2026-11-14T00:01:00Z', 'payload', '{"lap":5}'::jsonb),
    jsonb_build_object('device_id', v_d::text, 'source_uid', '66666666-6666-4666-8666-666666666666',
      'record_revision', 1, 'content_hash', repeat('6', 32),
      'observed_at', '2026-11-14T00:01:01Z', 'payload', '{"lap":6}'::jsonb)
  );
  v_result := pitwall_learning.capture_source_batch('lap_summary', v_rows);
  IF (v_result->>'items')::int <> 1 THEN
    RAISE EXCEPTION 'revocation did not stop A capture: %', v_result;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_result->'batches') AS b
      JOIN pitwall_learning.capture_batches AS c
        ON c.id = (b->>'batch_id')::uuid
     WHERE c.owner_user_id = 'a0000000-0000-4000-8000-0000000000a1'
  ) THEN
    RAISE EXCEPTION 'revoked account A still produced a new captured batch';
  END IF;
  RAISE NOTICE 'PASS consent revocation stops further private capture for A';

  -- Device intrekken stopt de P1-guard niet zelf; die poort zit in de
  -- tokenroute. Wel eerlijk vastleggen dat de guard op owner/policy kijkt.
  UPDATE public.simhub_devices SET revoked_at = now() WHERE id = v_d;
  v_rows := jsonb_build_array(
    jsonb_build_object('device_id', v_d::text, 'source_uid', '77777777-7777-4777-8777-777777777777',
      'record_revision', 1, 'content_hash', repeat('7', 32),
      'observed_at', '2026-11-14T00:02:00Z', 'payload', '{"lap":7}'::jsonb)
  );
  v_result := pitwall_learning.capture_source_batch('lap_summary', v_rows);
  IF (v_result->>'items')::int <> 1 THEN
    RAISE EXCEPTION 'P1 guard unexpectedly consults revoked_at: %', v_result;
  END IF;
  RAISE NOTICE 'NOTE P1 capture guard keys on owner policy, not device revocation (upstream token auth owns that gate)';
END
$capture$;

RESET request.jwt.claim.role;
ROLLBACK;
