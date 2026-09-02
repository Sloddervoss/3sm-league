-- Test-only H01-H15 authority-handoff matrix. Runs only against the disposable DB.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email,created_at,updated_at) VALUES
 ('11111111-1111-1111-1111-111111111111','handoff-a@test.invalid',now(),now()),
 ('22222222-2222-2222-2222-222222222222','handoff-b@test.invalid',now(),now()),
 ('33333333-3333-3333-3333-333333333333','handoff-c@test.invalid',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.endurance_events (id,name,circuit,configuration,status,visibility,source,max_drivers_per_car,invited_user_ids,manager_ids,slots,class_ids,created_at,updated_at,start_at,end_at) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','Handoff event A','Spa','GP','draft','open','scheduled',4,'{}','{}','{}'::jsonb,'{}',now(),now(),now()-interval '1 day',now()+interval '1 day'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','Handoff event B','Spa','GP','draft','open','scheduled',4,'{}','{}','{}'::jsonb,'{}',now(),now(),now()-interval '1 day',now()+interval '1 day')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.endurance_teams (id,event_id,name) VALUES
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','Handoff team A'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','Handoff team B')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.endurance_registrations (event_id,user_id,status,registered_at) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','11111111-1111-1111-1111-111111111111','provisional',now()),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','22222222-2222-2222-2222-222222222222','confirmed',now()),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','33333333-3333-3333-3333-333333333333','confirmed',now()),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','22222222-2222-2222-2222-222222222222','confirmed',now())
ON CONFLICT (event_id,user_id) DO UPDATE SET status=EXCLUDED.status;

INSERT INTO public.simhub_devices (id,owner_user_id,token_hash,connector_id,device_name,paired_at,updated_at,endurance_event_id,endurance_team_id,endurance_binding_source,device_status,device_role) VALUES
 ('cccccccc-cccc-cccc-cccc-ccccccccccc1','11111111-1111-1111-1111-111111111111',repeat('1',64),'ha','H-A',now(),now(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','manual','active_binding','primary'),
 ('cccccccc-cccc-cccc-cccc-ccccccccccc2','22222222-2222-2222-2222-222222222222',repeat('2',64),'hb','H-B',now(),now(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','manual','active_binding','standby'),
 ('cccccccc-cccc-cccc-cccc-ccccccccccc3','33333333-3333-3333-3333-333333333333',repeat('3',64),'hc','H-C',now(),now(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','manual','active_binding','standby'),
 ('cccccccc-cccc-cccc-cccc-ccccccccccc4','22222222-2222-2222-2222-222222222222',repeat('4',64),'hd','H-D-other',now(),now(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2','manual','active_binding','primary'),
 ('cccccccc-cccc-cccc-cccc-ccccccccccc5','22222222-2222-2222-2222-222222222222',repeat('5',64),'he','H-practice',now(),now(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1','manual','active_binding','practice'),
 ('cccccccc-cccc-cccc-cccc-ccccccccccc7','22222222-2222-2222-2222-222222222222',repeat('7',64),'hg','H-revoked',now(),now(),NULL,NULL,NULL,'inactive',NULL),
 ('cccccccc-cccc-cccc-cccc-ccccccccccc8','22222222-2222-2222-2222-222222222222',repeat('8',64),'hh','H-no-primary',now(),now(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2','manual','active_binding','standby'),
 ('cccccccc-cccc-cccc-cccc-ccccccccccc9','22222222-2222-2222-2222-222222222222',repeat('9',64),'hi','H-unbound-then-assign',now(),now(),NULL,NULL,NULL,'inactive',NULL)
ON CONFLICT (id) DO NOTHING;

UPDATE public.simhub_devices
   SET device_status='revoked', revoked_at=now(), updated_at=now()
 WHERE id='cccccccc-cccc-cccc-cccc-ccccccccccc7';

SET LOCAL request.jwt.claim.role = 'service_role';

DO $$
DECLARE v text; n integer;
BEGIN
  -- H01, H12, H15
  SELECT public.simhub_set_primary_device('cccccccc-cccc-cccc-cccc-ccccccccccc2') INTO v;
  IF v <> 'accepted' THEN RAISE EXCEPTION 'H01 expected accepted, got %',v; END IF;
  SELECT count(*) INTO n FROM public.simhub_devices WHERE endurance_event_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' AND endurance_team_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1' AND device_role='primary';
  IF n <> 1 OR public.simhub_current_authority_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') <> 'cccccccc-cccc-cccc-cccc-ccccccccccc2'::uuid THEN RAISE EXCEPTION 'H01/H15 state mismatch'; END IF;
  -- H02
  IF public.simhub_set_primary_device('cccccccc-cccc-cccc-cccc-ccccccccccc2') <> 'already_primary' THEN RAISE EXCEPTION 'H02'; END IF;
  -- H04/H05/H07
  IF public.simhub_set_primary_device('cccccccc-cccc-cccc-cccc-ccccccccccc7') <> 'revoked' THEN RAISE EXCEPTION 'H04'; END IF;
  IF public.simhub_set_primary_device('cccccccc-cccc-cccc-cccc-ccccccccccc9') <> 'not_bound' THEN RAISE EXCEPTION 'H05'; END IF;
  IF public.simhub_set_primary_device('cccccccc-cccc-cccc-cccc-ccccccccccc5') <> 'invalid_role' THEN RAISE EXCEPTION 'H07'; END IF;
  -- H06: other binding is idempotent and cannot touch binding A.
  IF public.simhub_set_primary_device('cccccccc-cccc-cccc-cccc-ccccccccccc4') <> 'already_primary' THEN RAISE EXCEPTION 'H06 result'; END IF;
  IF public.simhub_current_authority_device('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') <> 'cccccccc-cccc-cccc-cccc-ccccccccccc2'::uuid THEN RAISE EXCEPTION 'H06 contaminated binding A'; END IF;
  -- H03: remove B-event primary only inside this disposable fixture, then promote its standby.
  UPDATE public.simhub_devices SET device_status='inactive',device_role=NULL,endurance_event_id=NULL,endurance_team_id=NULL,endurance_binding_source=NULL WHERE id='cccccccc-cccc-cccc-cccc-ccccccccccc4';
  IF public.simhub_set_primary_device('cccccccc-cccc-cccc-cccc-ccccccccccc8') <> 'accepted' THEN RAISE EXCEPTION 'H03'; END IF;
  -- H11 rejected and withdrawn both reject; restore accepted.
  UPDATE public.endurance_registrations SET status='rejected' WHERE event_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' AND user_id='22222222-2222-2222-2222-222222222222';
  IF public.simhub_set_primary_device('cccccccc-cccc-cccc-cccc-ccccccccccc2') <> 'registration_invalid' THEN RAISE EXCEPTION 'H11 rejected'; END IF;
  UPDATE public.endurance_registrations SET status='withdrawn' WHERE event_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' AND user_id='22222222-2222-2222-2222-222222222222';
  IF public.simhub_set_primary_device('cccccccc-cccc-cccc-cccc-ccccccccccc2') <> 'registration_invalid' THEN RAISE EXCEPTION 'H11 withdrawn'; END IF;
  UPDATE public.endurance_registrations SET status='confirmed' WHERE event_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1' AND user_id='22222222-2222-2222-2222-222222222222';
  -- H14: existing assignment remains callable and assigns a non-primary alongside H08.
  IF NOT public.simhub_assign_device_to_entry('cccccccc-cccc-cccc-cccc-ccccccccccc9','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2','11111111-1111-1111-1111-111111111111') THEN RAISE EXCEPTION 'H14'; END IF;
END $$;

RESET ROLE;
-- H13 security shape and grants.
DO $$
DECLARE ok boolean;
BEGIN
 SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, public, auth, pg_temp'] INTO ok FROM pg_proc p WHERE p.oid='public.simhub_set_primary_device(uuid)'::regprocedure;
 IF NOT ok THEN RAISE EXCEPTION 'H13 security definer/search path'; END IF;
 IF has_function_privilege('anon','public.simhub_set_primary_device(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.simhub_set_primary_device(uuid)','EXECUTE') OR NOT has_function_privilege('service_role','public.simhub_set_primary_device(uuid)','EXECUTE') THEN RAISE EXCEPTION 'H13 grants'; END IF;
END $$;

COMMIT;
SELECT 'H01,H02,H03,H04,H05,H06,H07,H11,H12,H13,H14,H15 PASS' AS result;
