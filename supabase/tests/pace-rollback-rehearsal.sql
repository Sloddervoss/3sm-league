-- Rollback-controle voor 20261110231000_pitwall_pace_storage.sql
-- Draai dit ALLEEN op de disposable `rehearsal`-kloon, direct na de rollback.
-- De vergelijking is tekstueel: pg_get_functiondef() moet exact de live-definitie
-- van 2026-11-10 teruggeven, niet alleen "een werkende functie".
--
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'rehearsal' THEN
    RAISE EXCEPTION 'Refusing: rollback rehearsal runs only in database rehearsal';
  END IF;
  IF to_regclass('public.pace_expected') IS NULL THEN
    RAISE EXCEPTION 'Refusing: pace_expected baseline table is missing';
  END IF;
END $$;

-- 1. De vijf geraakte functies zijn byte-for-byte de live-definitie.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT e.proname, e.def AS expected, pg_get_functiondef(p.oid) AS actual
      FROM public.pace_expected e
      JOIN pg_proc p ON p.proname = e.proname
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  LOOP
    IF r.actual IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'rollback did not restore % exactly', r.proname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.pace_expected e
       JOIN pg_proc p ON p.proname = e.proname
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public') <> 5 THEN
    RAISE EXCEPTION 'expected five restored functions';
  END IF;
  RAISE NOTICE 'PASS rollback-exact-five-definitions';
END $$;

-- 2. De drie PACE-helpers bestaan niet meer, in geen enkele overload.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('simhub_pace_merge_v1','simhub_pace_project_v1','simhub_pace_cleanup_v1')) THEN
    RAISE EXCEPTION 'PACE helper survived rollback';
  END IF;
  RAISE NOTICE 'PASS rollback-helpers-removed';
END $$;

-- 3. ACL's zijn weer de live-situatie.
DO $$
BEGIN
  IF has_function_privilege('authenticated','public.get_pitwall_pace(uuid,text,uuid,uuid)','EXECUTE') IS NOT TRUE THEN
    RAISE EXCEPTION 'authenticated lost the existing pace reader';
  END IF;
  IF has_function_privilege('anon','public.get_pitwall_pace(uuid,text,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'anon gained the pace reader';
  END IF;
  IF has_function_privilege('authenticated','public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated gained persist';
  END IF;
  IF has_function_privilege('authenticated','public.simhub_connector_config_apply(jsonb,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated gained config apply';
  END IF;
  IF has_function_privilege('service_role','public.simhub_connector_config_apply(jsonb,integer)','EXECUTE') IS NOT TRUE THEN
    RAISE EXCEPTION 'service_role lost config apply';
  END IF;
  RAISE NOTICE 'PASS rollback-acls';
END $$;

-- 4. De configuratierij is niet aangeraakt door de rollback.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.simhub_connector_config
                  WHERE id = 1 AND features ? 'paceCapture') THEN
    RAISE EXCEPTION 'rollback changed the stored feature flags';
  END IF;
  RAISE NOTICE 'PASS rollback-config-row-untouched';
END $$;

-- 5. De opgenomen historie blijft als data staan; de oude lezer negeert hem.
DO $$
DECLARE
  dev uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.simhub_telemetry_latest
                  WHERE device_id = dev AND v3_normalized ? 'paceHistory') THEN
    RAISE EXCEPTION 'rollback silently deleted stored paceHistory';
  END IF;
  RAISE NOTICE 'PASS rollback-retains-data';
END $$;

-- 6. De oude persist werkt weer en laat paceCapture ongemoeid (oud contract).
DO $$
DECLARE
  dev uuid := '11111111-1111-1111-1111-111111111111';
  r record;
BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',false);
  UPDATE public.simhub_devices SET last_seen_at = NULL WHERE id = dev;
  SELECT * INTO r FROM public.simhub_persist_v3(repeat('a',64),'reh-1',99,now(),
    '{"transportSessionId":"reh-1","session":{"sessionTimeSeconds":999},
      "identity":{"carId":"car-own","trackId":1},"timing":{"completedLaps":1},
      "fuel":{"fuelLitres":40},"paceCapture":{"schemaRevision":1}}'::jsonb);
  IF r.result <> 'accepted' THEN RAISE EXCEPTION 'restored persist failed: %', r.result; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.simhub_telemetry_latest
                  WHERE device_id = dev AND v3_normalized ? 'paceCapture') THEN
    RAISE EXCEPTION 'restored persist does not exhibit the old payload behaviour';
  END IF;
  RAISE NOTICE 'PASS rollback-old-persist-behaviour';
END $$;

DO $$ BEGIN RAISE NOTICE 'SUMMARY PACE-ROLLBACK PASS'; END $$;
