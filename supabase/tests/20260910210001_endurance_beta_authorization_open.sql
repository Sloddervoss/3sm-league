-- ============================================================================
-- FASE B — schakelaars AAN. Krijgt een gewoon lid nu echt toegang?
-- Draait bovenop fase A (zelfde testdata). Vult alleen de fase-B-checks aan.
-- ============================================================================
\set ON_ERROR_STOP on

-- Schakelaars openzetten. Dit moet ALS een super-admin gebeuren: de functie
-- controleert has_role(auth.uid(),'super_admin'). Twee valkuilen:
--   1. een kale psql-aanroep heeft geen identiteit, dus we zetten eerst de
--      JWT-claims van de test-super-admin;
--   2. set_config(..., true) is TRANSACTIE-lokaal. Buiten een transactie
--      vervalt de instelling direct na de regel, dus alles moet tussen
--      BEGIN en COMMIT staan.
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-4000-a000-00000000000d','role','authenticated')::text, true);
SELECT set_config('role','authenticated', true);
SELECT public.endurance_set_runtime_settings(true, true, true, true, true);
COMMIT;

-- Controle: staan ze echt aan? LET OP: endurance_runtime_settings heeft RLS
-- met 0 policies, dus ook een super_admin leest die tabel niet via RLS. Deze
-- controle hoort dus buiten de rolwissel om te gebeuren, als eigenaar.
INSERT INTO public._beta_results
SELECT 19,'B','eigenaar','schakelaars staan nu AAN',
       (member_access_enabled AND member_pairing_enabled AND member_ingest_enabled AND multi_user_realtime_enabled)::int,
       '>0',
       (member_access_enabled AND member_pairing_enabled AND member_ingest_enabled AND multi_user_realtime_enabled)
FROM public.endurance_runtime_settings;

-- ---- POSITIEF: de capabilities-RPC geeft een gewoon lid nu toegang ----
SELECT public._beta_check(20,'B','lid','capabilities: can_access nu AAN voor lid',
  '00000000-0000-4000-a000-00000000000a',
  'SELECT (public.endurance_current_capabilities()).can_access::int','>0');
SELECT public._beta_check(21,'B','lid','capabilities: mag eigen device koppelen',
  '00000000-0000-4000-a000-00000000000a',
  'SELECT (public.endurance_current_capabilities()).can_pair_own_device::int','>0');
SELECT public._beta_check(22,'B','lid','capabilities: realtime nu AAN voor lid',
  '00000000-0000-4000-a000-00000000000a',
  'SELECT (public.endurance_current_capabilities()).multi_user_realtime_enabled::int','>0');
SELECT public._beta_check(23,'B','lid','capabilities: mag nu eigen device-data insturen',
  '00000000-0000-4000-a000-00000000000a',
  'SELECT (public.endurance_current_capabilities()).can_ingest_own_device::int','>0');

-- ---- NEGATIEF: openzetten geeft een lid GEEN beheerrechten ----
SELECT public._beta_check(24,'B','lid','capabilities: beheer events blijft NEE',
  '00000000-0000-4000-a000-00000000000a',
  'SELECT (public.endurance_current_capabilities()).can_manage_events::int','=0');
SELECT public._beta_check(25,'B','lid','capabilities: beheer devices blijft NEE',
  '00000000-0000-4000-a000-00000000000a',
  'SELECT (public.endurance_current_capabilities()).can_manage_devices::int','=0');

-- ---- POSITIEF: beheerder houdt beheer ----
SELECT public._beta_check(26,'B','manager','capabilities: manager houdt beheer',
  '00000000-0000-4000-a000-00000000000c',
  'SELECT (public.endurance_current_capabilities()).can_manage_events::int','>0');
SELECT public._beta_check(27,'B','super_admin','capabilities: super_admin houdt beheer',
  '00000000-0000-4000-a000-00000000000d',
  'SELECT (public.endurance_current_capabilities()).can_manage_events::int','>0');

-- ---- POSITIEF: eigen beschikbaarheid schrijven mag nu ----
-- Beschikbaarheid hangt aan DEELNAME, niet aan "ingelogd zijn": je schrijft
-- je beschikbaarheid voor een race waarvoor je je hebt ingeschreven.
SELECT public._beta_check(28,'B','deelnemer','mag eigen beschikbaarheid wegschrijven',
  '00000000-0000-4000-a000-00000000000e',
  'WITH i AS (INSERT INTO public.endurance_availability (event_id,user_id,start_at,end_at,type)
              VALUES (''10000000-0000-4000-a000-000000000001'',''00000000-0000-4000-a000-00000000000e'',
                      now()+interval ''8 days'', now()+interval ''8 days 2 hours'',''available'')
              RETURNING 1) SELECT count(*) FROM i','>0');
-- NEGATIEF: een lid dat niet meedoet mag dat niet voor zichzelf opeisen.
SELECT public._beta_check(33,'B','lid','niet-deelnemer mag GEEN beschikbaarheid zetten',
  '00000000-0000-4000-a000-00000000000a',
  'WITH i AS (INSERT INTO public.endurance_availability (event_id,user_id,start_at,end_at,type)
              VALUES (''10000000-0000-4000-a000-000000000001'',''00000000-0000-4000-a000-00000000000a'',
                      now()+interval ''9 days'', now()+interval ''9 days 2 hours'',''available'')
              RETURNING 1) SELECT count(*) FROM i','deny');

-- ---- NEGATIEF: beschikbaarheid van iemand anders overschrijven mag NIET ----
SELECT public._beta_check(29,'B','lid','mag andermans beschikbaarheid NIET aanpassen',
  '00000000-0000-4000-a000-00000000000a',
  'WITH u AS (UPDATE public.endurance_availability SET type=''unavailable''
              WHERE user_id=''00000000-0000-4000-a000-000000000001'' RETURNING 1)
   SELECT count(*) FROM u','=0');

-- ---- NEGATIEF: lid mag nog steeds geen events aanmaken ----
SELECT public._beta_check(30,'B','lid','mag GEEN event aanmaken',
  '00000000-0000-4000-a000-00000000000a',
  'WITH i AS (INSERT INTO public.endurance_events
      (id,name,circuit,configuration,start_at,end_at,slots,class_ids,max_drivers_per_car,visibility,status,source,invited_user_ids,manager_ids)
      VALUES (gen_random_uuid(),''Stiekem'',''Test'',''GP'',now()+interval ''30 days'',now()+interval ''30 days 1 hour'',
              ''[]''::jsonb,ARRAY[''gt3''],2,''open'',''registration_open'',''test'',ARRAY[]::uuid[],ARRAY[]::uuid[])
      RETURNING 1) SELECT count(*) FROM i','deny');

-- ---- POSITIEF: manager MAG een event aanmaken ----
SELECT public._beta_check(31,'B','manager','mag WEL een event aanmaken',
  '00000000-0000-4000-a000-00000000000c',
  'WITH i AS (INSERT INTO public.endurance_events
      (id,name,circuit,configuration,start_at,end_at,slots,class_ids,max_drivers_per_car,visibility,status,source,invited_user_ids,manager_ids)
      VALUES (gen_random_uuid(),''Door manager'',''Test'',''GP'',now()+interval ''31 days'',now()+interval ''31 days 1 hour'',
              ''[]''::jsonb,ARRAY[''gt3''],2,''open'',''registration_open'',''test'',ARRAY[]::uuid[],ARRAY[]::uuid[])
      RETURNING 1) SELECT count(*) FROM i','>0');

-- ---- NEGATIEF: lid krijgt geen deelnemersrechten op een event waar het niet aan meedoet ----
SELECT public._beta_check(32,'B','lid','geen deelnemersrechten op andermans team',
  '00000000-0000-4000-a000-00000000000a',
  'SELECT count(*) FROM public.endurance_team_members','=0');
