-- PACE-opslag: rehearsal op een DISPOSABLE kloon van productie (PostgreSQL 15.19).
--
-- Dit bestand hoort NOOIT op productie te draaien. Het weigert elke database
-- die niet letterlijk `rehearsal` heet. Het seedt zijn eigen apparaat, team en
-- event, en het ruimt alleen die eigen rijen op.
--
-- Verwacht vóór de forward migratie:
--   create table pace_expected as
--   select p.proname, pg_get_functiondef(p.oid) as def
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('simhub_persist_v3','get_pitwall_data',
--                        'get_simhub_device_details','get_pitwall_pace',
--                        'simhub_connector_config_apply');
--
-- Daarna:
--   psql -1 -f supabase/migrations/20261110231000_pitwall_pace_storage.sql
--   psql -f supabase/tests/pace-production-rehearsal.sql
--   psql -1 -f supabase/rollbacks/20261110231000_pitwall_pace_storage.sql
--   psql -f supabase/tests/pace-rollback-rehearsal.sql
--
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'rehearsal' THEN
    RAISE EXCEPTION 'Refusing: this rehearsal runs only in a disposable database named rehearsal (got %)', current_database();
  END IF;
  IF to_regclass('public.pace_expected') IS NULL THEN
    RAISE EXCEPTION 'Refusing: create table pace_expected from the pristine live definitions first';
  END IF;
  IF (SELECT count(*) FROM public.pace_expected) <> 5 THEN
    RAISE EXCEPTION 'Refusing: pace_expected must hold exactly five baseline functions';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Seed (idempotent, only our own fixed ids)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  uid  uuid := '22222222-2222-2222-2222-222222222222';
  dev  uuid := '11111111-1111-1111-1111-111111111111';
  ev   uuid := '33333333-3333-3333-3333-333333333333';
  team uuid := '44444444-4444-4444-4444-444444444444';
  run  uuid := '55555555-5555-5555-5555-555555555555';
BEGIN
  INSERT INTO auth.users(id) VALUES (uid) ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles(id,user_id,display_name,created_at,updated_at,rating_source)
    VALUES (gen_random_uuid(),uid,'PACE rehearsal',now(),now(),'self')
    ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_roles(id,user_id,role)
    VALUES (gen_random_uuid(),uid,'super_admin'::public.app_role)
    ON CONFLICT DO NOTHING;
  INSERT INTO public.simhub_devices(id,owner_user_id,connector_id,device_name,token_hash,
                                    device_status,last_sequence,paired_at,updated_at)
    VALUES (dev,uid,'rehearsal','PACE rehearsal',repeat('a',64),'inactive',0,now(),now())
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.endurance_events(id,name,circuit,start_at,end_at,status)
    VALUES (ev,'PACE rehearsal','Test',now()-interval '1 hour',now()+interval '3 hours','live')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.endurance_teams(id,event_id,name,car_id,car_number)
    VALUES (team,ev,'PACE team','car','7') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.endurance_race_runs(id,event_id,team_id,run_kind,status,started_at)
    VALUES (run,ev,team,'race','active',now()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.simhub_connector_config(id,config_revision,send_interval_ms,sample_hz,
                                             payload_budget_bytes,features)
    VALUES (1,4,1000,10,16384,
            '{"paceCapture":true,"lapSummaries":true,"measurementEvents":true}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  DELETE FROM public.simhub_telemetry_latest WHERE device_id = dev;
  DELETE FROM public.simhub_device_sessions WHERE device_id = dev;
  DELETE FROM public.endurance_source_segments WHERE device_id = dev;
  UPDATE public.simhub_devices
     SET device_status='inactive', device_role=NULL, endurance_event_id=NULL,
         endurance_team_id=NULL, last_seen_at=NULL, last_session_id=NULL,
         last_sequence=0, updated_at=now()
   WHERE id=dev;
  DELETE FROM public.simhub_telemetry_latest WHERE connector_id = 'rehearsal-bulk';
  DELETE FROM public.simhub_devices WHERE connector_id = 'rehearsal-bulk';
END $$;

-- ---------------------------------------------------------------------------
-- 1. ACL's: geen anon/authenticated op de schrijf- en hulpfuncties
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('anon','public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz)',false),
      ('authenticated','public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz)',false),
      ('anon','public.simhub_pace_project_v1(jsonb,text)',false),
      ('authenticated','public.simhub_pace_project_v1(jsonb,text)',false),
      ('anon','public.simhub_pace_cleanup_v1()',false),
      ('authenticated','public.simhub_pace_cleanup_v1()',false),
      ('service_role','public.simhub_pace_cleanup_v1()',true),
      ('anon','public.get_pitwall_pace(uuid,text,uuid,uuid)',false),
      ('authenticated','public.get_pitwall_pace(uuid,text,uuid,uuid)',true),
      ('anon','public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)',false),
      ('authenticated','public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)',false),
      ('service_role','public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)',true),
      ('anon','public.simhub_connector_config_apply(jsonb,integer)',false),
      ('authenticated','public.simhub_connector_config_apply(jsonb,integer)',false),
      ('service_role','public.simhub_connector_config_apply(jsonb,integer)',true)
    ) t(role_name, sig, expected)
  LOOP
    IF has_function_privilege(r.role_name, r.sig, 'EXECUTE') <> r.expected THEN
      RAISE EXCEPTION 'ACL mismatch: % on % expected %', r.role_name, r.sig, r.expected;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS acl-boundaries';
END $$;

-- ---------------------------------------------------------------------------
-- 2. Persist: signatures, ACK, replay, PACE-opslag
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dev uuid := '11111111-1111-1111-1111-111111111111';
  r record;
  hist jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"22222222-2222-2222-2222-222222222222"}',false);
  UPDATE public.simhub_devices SET last_seen_at = NULL WHERE id = dev;
  SELECT * INTO r FROM public.simhub_persist_v3(repeat('a',64),'reh-1',1,now(),'{}'::jsonb);
  IF r.result <> 'unauthorized' THEN RAISE EXCEPTION 'authenticated persist was not refused'; END IF;
  RAISE NOTICE 'PASS persist-unauthorized';

  PERFORM set_config('request.jwt.claims','{"role":"service_role","sub":"22222222-2222-2222-2222-222222222222"}',false);

  -- five arguments
  UPDATE public.simhub_devices SET last_seen_at = NULL WHERE id = dev;
  SELECT * INTO r FROM public.simhub_persist_v3(repeat('a',64),'reh-1',1,now(),
    '{"transportSessionId":"reh-1","session":{"sessionTimeSeconds":100},
      "identity":{"carId":"car-own","trackId":1},"timing":{"completedLaps":1},
      "fuel":{"fuelLitres":50},
      "paceCapture":{"schemaRevision":1,"observedSessionId":"obs-1","segmentId":"seg-1",
        "opponentMetrics":[{"id":"car-own","observedSessionTimeSeconds":100,"lastLapSeconds":100,
          "bestLapSeconds":100,"lastLapSectorSeconds":[30,30,40],"bestLapSectorSeconds":[30,30,40],
          "bestSectorSeconds":[30,30,40],"bestLapDeltaToFieldBestSeconds":0,
          "bestLapDeltaToPlayerSeconds":0,"lapValid":true,"lapHighPrecision":100,
          "trackPositionPercentRaw":0,"sectorMismatchCount":0,"sectorCount":3}],
        "opponentLaps":[{"id":"car-own","lap":1,"seconds":100,"observedSessionTimeSeconds":100,
          "quality":"sampled","observationId":"lap-1"}],"traceChunks":[]}}'::jsonb);
  IF r.result <> 'accepted' THEN RAISE EXCEPTION 'five-argument persist failed: %', r.result; END IF;
  IF r.measurement_ack IS NOT NULL THEN RAISE EXCEPTION 'five-argument ACK changed'; END IF;
  RAISE NOTICE 'PASS persist-five-arguments';

  -- six arguments
  UPDATE public.simhub_devices SET last_seen_at = NULL WHERE id = dev;
  SELECT * INTO r FROM public.simhub_persist_v3(repeat('a',64),'reh-1',2,now(),
    '{"transportSessionId":"reh-1","session":{"sessionTimeSeconds":110},
      "identity":{"carId":"car-own","trackId":1},"timing":{"completedLaps":1},
      "fuel":{"fuelLitres":49},"source":{"simHubVersion":"9.1","connectorVersion":"0.8.4.0"}}'::jsonb,
    '0.8.4.0');
  IF r.result <> 'accepted' THEN RAISE EXCEPTION 'six-argument persist failed: %', r.result; END IF;
  RAISE NOTICE 'PASS persist-six-arguments';

  -- eight arguments + measurement ACK shape
  UPDATE public.simhub_devices SET last_seen_at = NULL WHERE id = dev;
  SELECT * INTO r FROM public.simhub_persist_v3(repeat('a',64),'reh-1',3,now(),
    '{"transportSessionId":"reh-1","session":{"sessionTimeSeconds":120},
      "identity":{"carId":"car-own","trackId":1},"timing":{"completedLaps":1},
      "fuel":{"fuelLitres":48}}'::jsonb,
    '0.8.4.0','[]'::jsonb,'[]'::jsonb);
  IF r.result <> 'accepted' OR r.measurement_ack IS NULL THEN
    RAISE EXCEPTION 'eight-argument persist/ACK failed';
  END IF;
  IF r.measurement_ack->'events' IS NULL OR r.measurement_ack->'laps' IS NULL
     OR (r.measurement_ack->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'measurement ACK shape changed: %', r.measurement_ack;
  END IF;
  RAISE NOTICE 'PASS persist-eight-arguments-ack';

  -- replay gate still precedes PACE
  UPDATE public.simhub_devices SET last_seen_at = NULL WHERE id = dev;
  SELECT * INTO r FROM public.simhub_persist_v3(repeat('a',64),'reh-1',3,now(),
    '{"transportSessionId":"reh-1","session":{"sessionTimeSeconds":121},"identity":{"carId":"car-own","trackId":1}}'::jsonb);
  IF r.result <> 'replayed' THEN RAISE EXCEPTION 'replay gate changed: %', r.result; END IF;
  RAISE NOTICE 'PASS persist-replay';

  -- version metadata and track id preserved
  IF (SELECT simhub_version || '/' || connector_version FROM public.simhub_telemetry_latest WHERE device_id = dev)
     <> '0.8.4.0/0.8.4.0' THEN
    RAISE EXCEPTION 'version metadata changed';
  END IF;
  IF (SELECT v3_normalized#>>'{identity,trackId}' FROM public.simhub_telemetry_latest WHERE device_id = dev) <> '1' THEN
    RAISE EXCEPTION 'track identity changed';
  END IF;
  RAISE NOTICE 'PASS version-metadata-trackid';

  -- PACE stored in the existing JSONB, transport stripped
  SELECT v3_normalized INTO hist FROM public.simhub_telemetry_latest WHERE device_id = dev;
  IF hist ? 'paceCapture' THEN RAISE EXCEPTION 'paceCapture leaked into storage'; END IF;
  IF NOT (hist ? 'paceHistory') THEN RAISE EXCEPTION 'paceHistory missing'; END IF;
  IF hist#>>'{paceHistory,transportSessionId}' <> 'reh-1' THEN RAISE EXCEPTION 'transport mismatch'; END IF;
  IF jsonb_array_length(hist#>'{paceHistory,cars}') <> 1 THEN RAISE EXCEPTION 'car history missing'; END IF;
  IF hist#>>'{paceHistory,cars,0,metrics,lastLapSeconds}' <> '100' THEN RAISE EXCEPTION 'metric not stored'; END IF;
  IF jsonb_array_length(hist#>'{paceHistory,cars,0,laps}') <> 1 THEN RAISE EXCEPTION 'lap not stored'; END IF;
  RAISE NOTICE 'PASS pace-storage-shape';

  -- a malformed optional block costs neither the frame nor the history
  UPDATE public.simhub_devices SET last_seen_at = NULL WHERE id = dev;
  SELECT * INTO r FROM public.simhub_persist_v3(repeat('a',64),'reh-1',4,now(),
    '{"transportSessionId":"reh-1","session":{"sessionTimeSeconds":130},
      "identity":{"carId":"car-own","trackId":1},"timing":{"completedLaps":1},
      "fuel":{"fuelLitres":47},"paceCapture":42}'::jsonb);
  IF r.result <> 'accepted' THEN RAISE EXCEPTION 'malformed pace cost the frame'; END IF;
  IF NOT ((SELECT v3_normalized FROM public.simhub_telemetry_latest WHERE device_id = dev) ? 'paceHistory') THEN
    RAISE EXCEPTION 'malformed pace wiped history';
  END IF;
  IF (SELECT v3_normalized#>>'{fuel,fuelLitres}' FROM public.simhub_telemetry_latest WHERE device_id = dev) <> '47' THEN
    RAISE EXCEPTION 'core fuel changed by optional block';
  END IF;
  RAISE NOTICE 'PASS optional-block-isolated';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Merge: caps, completeness, conflict, TTL, malformed input
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  now_at timestamptz := now();
  prev jsonb; cap jsonb; out jsonb; chunk jsonb; i integer; cars jsonb;
BEGIN
  prev := jsonb_build_object('schemaRevision',1,'observedSessionId','s','segmentId','g',
    'transportSessionId','t','updatedAt',now_at,
    'cars',jsonb_build_array(jsonb_build_object('id','a','laps','[]'::jsonb,'traces','[]'::jsonb)));

  out := public.simhub_pace_merge_v1(prev,
    '{"schemaRevision":1,"observedSessionId":"s","segmentId":"g","opponentMetrics":3}'::jsonb,'t',now_at);
  IF out IS DISTINCT FROM prev THEN RAISE EXCEPTION 'malformed capture changed history'; END IF;

  out := public.simhub_pace_merge_v1(prev,
    '{"observedSessionId":"s","segmentId":"g"}'::jsonb,'t',now_at);
  IF out IS DISTINCT FROM prev THEN RAISE EXCEPTION 'missing schemaRevision changed history'; END IF;

  out := public.simhub_pace_merge_v1(prev,
    '{"schemaRevision":1,"observedSessionId":"s","segmentId":"g","opponentMetrics":[{"id":"a","observedSessionTimeSeconds":"x"}]}'::jsonb,'t',now_at);
  IF out IS DISTINCT FROM prev THEN RAISE EXCEPTION 'non-numeric metric changed history'; END IF;

  out := public.simhub_pace_merge_v1(prev,
    '{"schemaRevision":1,"observedSessionId":"s","segmentId":"g","evil":1}'::jsonb,'t',now_at);
  IF out IS DISTINCT FROM prev THEN RAISE EXCEPTION 'unknown key accepted'; END IF;

  IF public.simhub_pace_merge_v1(prev,NULL,'other',now_at) IS NOT NULL THEN RAISE EXCEPTION 'transport change did not reset'; END IF;
  IF public.simhub_pace_merge_v1(prev,NULL,'t',now_at + interval '25 hours') IS NOT NULL THEN RAISE EXCEPTION 'TTL did not reset'; END IF;
  IF public.simhub_pace_merge_v1(prev,NULL,'t',NULL) IS NOT NULL THEN RAISE EXCEPTION 'null at_time accepted'; END IF;
  RAISE NOTICE 'PASS merge-guards';

  cap := jsonb_build_object('schemaRevision',1,'observedSessionId','s','segmentId','g',
    'opponentMetrics','[]'::jsonb,'opponentLaps','[]'::jsonb,'traceChunks','[]'::jsonb);
  FOR i IN 0..3 LOOP
    chunk := jsonb_build_object('id','a','traceId','trace','lap',2,'chunkIndex',i*32,
      'finalChunk',(i=3),'anchorSessionTimeMs',0,'anchorUncertaintyMs',100,
      'lapSeconds',127,'provenance','simhub-opponent-sampled','speedUnit','km/h',
      'points',(SELECT jsonb_agg(jsonb_build_array(b,b*1000,1800) ORDER BY b)
                  FROM generate_series(i*32,i*32+31) b));
    out := public.simhub_pace_merge_v1(out,
      cap || jsonb_build_object('traceChunks',jsonb_build_array(chunk)),'t',now_at);
  END LOOP;
  IF out#>>'{cars,0,traces,0,complete}' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '128-bin trace not complete';
  END IF;
  RAISE NOTICE 'PASS trace-complete';

  -- conflict on a differing bin never completes
  chunk := jsonb_build_object('id','a','traceId','trace','lap',2,'chunkIndex',0,
    'finalChunk',false,'anchorSessionTimeMs',0,'anchorUncertaintyMs',100,
    'lapSeconds',127,'provenance','simhub-opponent-sampled','speedUnit','km/h',
    'points',jsonb_build_array(jsonb_build_array(0,1,1800)));
  out := public.simhub_pace_merge_v1(out,cap || jsonb_build_object('traceChunks',jsonb_build_array(chunk)),'t',now_at);
  IF out#>>'{cars,0,traces,0,conflict}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'conflict not flagged'; END IF;
  IF out#>>'{cars,0,traces,0,complete}' = 'true' THEN RAISE EXCEPTION 'conflicted trace complete'; END IF;
  RAISE NOTICE 'PASS trace-conflict';

  -- 45 identities cap at 40 and remain under 512 KiB
  out := NULL;
  FOR i IN 0..44 LOOP
    out := public.simhub_pace_merge_v1(out,
      jsonb_build_object('schemaRevision',1,'observedSessionId','s','segmentId','g',
        'opponentLaps',jsonb_build_array(jsonb_build_object('id','car-'||i,'lap',1,'seconds',100,
          'observedSessionTimeSeconds',i,'quality','sampled','observationId','lap-'||i))),
      't',now_at);
  END LOOP;
  IF jsonb_array_length(out->'cars') <> 40 THEN RAISE EXCEPTION 'car cap %', jsonb_array_length(out->'cars'); END IF;
  IF octet_length(out::text) >= 524288 THEN RAISE EXCEPTION 'storage cap exceeded'; END IF;
  RAISE NOTICE 'PASS car-cap-bytes';

  -- 20 laps with identical times survive
  out := NULL;
  FOR i IN 1..40 LOOP
    out := public.simhub_pace_merge_v1(out,
      jsonb_build_object('schemaRevision',1,'observedSessionId','s','segmentId','g',
        'opponentLaps',jsonb_build_array(jsonb_build_object('id','a','lap',i,'seconds',100,
          'observedSessionTimeSeconds',i,'quality','sampled','observationId','lap-'||i))),
      't',now_at);
  END LOOP;
  IF jsonb_array_length(out#>'{cars,0,laps}') <> 20 THEN RAISE EXCEPTION 'lap cap'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(out#>'{cars,0,laps}') l WHERE (l->>'seconds')::numeric <> 100) THEN
    RAISE EXCEPTION 'identical lap times changed';
  END IF;
  RAISE NOTICE 'PASS lap-cap';

  -- three traces cap
  out := NULL;
  FOR i IN 1..5 LOOP
    chunk := jsonb_build_object('id','a','traceId','trace-'||i,'lap',i,'chunkIndex',0,
      'finalChunk',false,'anchorSessionTimeMs',0,'anchorUncertaintyMs',100,
      'lapSeconds',100,'provenance','simhub-opponent-sampled','speedUnit','km/h',
      'points',jsonb_build_array(jsonb_build_array(0,0,1800)));
    out := public.simhub_pace_merge_v1(out,cap || jsonb_build_object('traceChunks',jsonb_build_array(chunk)),'t',now_at);
  END LOOP;
  IF jsonb_array_length(out#>'{cars,0,traces}') <> 3 THEN RAISE EXCEPTION 'trace cap'; END IF;
  RAISE NOTICE 'PASS trace-cap';

  -- project: series only for own + reference, TTL hides, paceCapture stripped
  cars := jsonb_build_array(
    jsonb_build_object('id','own','laps',jsonb_build_array(jsonb_build_object('lap',1,'seconds',100,'observationId','o')),'traces',jsonb_build_array(jsonb_build_object('traceId','x','points','[]'::jsonb))),
    jsonb_build_object('id','leader','laps','[]'::jsonb,'traces',jsonb_build_array(jsonb_build_object('traceId','y','points','[]'::jsonb))),
    jsonb_build_object('id','third','laps','[]'::jsonb,'traces',jsonb_build_array(jsonb_build_object('traceId','z','points','[]'::jsonb))));
  prev := jsonb_build_object('schemaRevision',1,'observedSessionId','s','segmentId','g',
    'transportSessionId','t','updatedAt',now_at,'cars',cars);
  cap := jsonb_build_object('opponents',jsonb_build_array(
           jsonb_build_object('id','own','isPlayer',true),
           jsonb_build_object('id','leader','position',1)),
         'paceHistory',prev,'paceCapture',jsonb_build_object('x',1));
  out := public.simhub_pace_project_v1(cap,NULL);
  IF out ? 'paceCapture' THEN RAISE EXCEPTION 'project kept paceCapture'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(out#>'{paceHistory,cars}') c WHERE c ? 'traces') <> 2 THEN
    RAISE EXCEPTION 'project did not bound series';
  END IF;
  out := public.simhub_pace_project_v1(cap,'third');
  IF (SELECT count(*) FROM jsonb_array_elements(out#>'{paceHistory,cars}') c
       WHERE c->>'id' = 'third' AND c ? 'traces') <> 1 THEN
    RAISE EXCEPTION 'reference car not projected';
  END IF;
  out := public.simhub_pace_project_v1(
    jsonb_set(cap,'{paceHistory,updatedAt}','"2000-01-01T00:00:00Z"'::jsonb),NULL);
  IF out ? 'paceHistory' THEN RAISE EXCEPTION 'expired history survived'; END IF;
  RAISE NOTICE 'PASS project-bounds-ttl';
END $$;

-- ---------------------------------------------------------------------------
-- 4. Routering: active binding levert event/team/run, PACE blijft staan
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dev uuid := '11111111-1111-1111-1111-111111111111';
  r record;
BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"service_role","sub":"22222222-2222-2222-2222-222222222222"}',false);
  UPDATE public.simhub_devices
     SET device_status='active_binding', device_role='primary',
         endurance_event_id='33333333-3333-3333-3333-333333333333',
         endurance_team_id='44444444-4444-4444-4444-444444444444',
         last_seen_at=NULL
   WHERE id=dev;
  SELECT * INTO r FROM public.simhub_persist_v3(repeat('a',64),'reh-1',5,now(),
    '{"transportSessionId":"reh-1","session":{"sessionTimeSeconds":140},
      "identity":{"carId":"car-own","trackId":1},"timing":{"completedLaps":1,"lastLapTimeSeconds":100},
      "fuel":{"fuelLitres":46}}'::jsonb);
  IF r.result <> 'accepted' THEN RAISE EXCEPTION 'routed persist failed: %', r.result; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.simhub_telemetry_latest
                  WHERE device_id=dev
                    AND endurance_event_id='33333333-3333-3333-3333-333333333333'
                    AND endurance_team_id='44444444-4444-4444-4444-444444444444'
                    AND race_run_id IS NOT NULL) THEN
    RAISE EXCEPTION 'routing columns lost';
  END IF;
  RAISE NOTICE 'PASS routing';
END $$;

-- ---------------------------------------------------------------------------
-- 5. Leesroutes: device-detail, pitwall_data en get_pitwall_pace
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dev uuid := '11111111-1111-1111-1111-111111111111';
  ev  uuid := '33333333-3333-3333-3333-333333333333';
  team uuid := '44444444-4444-4444-4444-444444444444';
  d jsonb; p jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"22222222-2222-2222-2222-222222222222"}',false);

  d := public.get_simhub_device_details(dev);
  IF d#>>'{telemetry,v3_normalized,paceHistory,transportSessionId}' <> 'reh-1' THEN
    RAISE EXCEPTION 'device detail lost pace history';
  END IF;
  IF d#>>'{telemetry,v3_normalized,paceCapture}' IS NOT NULL THEN
    RAISE EXCEPTION 'device detail leaked paceCapture';
  END IF;
  RAISE NOTICE 'PASS read-device-detail';

  d := public.get_pitwall_data(ev,team);
  IF d#>>'{team,name}' <> 'PACE team' THEN RAISE EXCEPTION 'pitwall team shape changed'; END IF;
  IF d#>>'{v3_normalized,paceHistory,transportSessionId}' <> 'reh-1' THEN
    RAISE EXCEPTION 'pitwall data lost pace history';
  END IF;
  IF d#>>'{v3_normalized,paceCapture}' IS NOT NULL THEN
    RAISE EXCEPTION 'pitwall data leaked paceCapture';
  END IF;
  RAISE NOTICE 'PASS read-pitwall-data';

  p := public.get_pitwall_pace(dev,NULL,NULL,NULL);
  IF p#>>'{cars,0,id}' <> 'car-own' THEN RAISE EXCEPTION 'device pace read failed'; END IF;
  p := public.get_pitwall_pace(NULL,NULL,ev,team);
  IF p#>>'{cars,0,id}' <> 'car-own' THEN RAISE EXCEPTION 'team pace read failed'; END IF;
  RAISE NOTICE 'PASS read-pitwall-pace';
END $$;

-- ---------------------------------------------------------------------------
-- 6. Cleanup: bounded batches, only paceHistory, no other payload loss
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  uid uuid := '22222222-2222-2222-2222-222222222222';
  n bigint;
BEGIN
  INSERT INTO public.simhub_devices(id,owner_user_id,connector_id,device_name,token_hash,
                                    device_status,last_sequence,paired_at,updated_at)
  SELECT gen_random_uuid(),uid,'rehearsal-bulk','bulk-'||i,
         md5(i::text)||md5('x'||i::text),'inactive',0,now(),now()
    FROM generate_series(1,105) i;

  INSERT INTO public.simhub_telemetry_latest(device_id,owner_user_id,session_id,sequence,
      captured_at,received_at,connector_id,game,telemetry,v3_normalized)
  SELECT d.id,uid,'reh-bulk',1,now(),now(),'rehearsal-bulk','IRacing','{}'::jsonb,
         jsonb_build_object('transportSessionId','reh-bulk',
           'fuel',jsonb_build_object('fuelLitres',42),
           'paceHistory',jsonb_build_object('schemaRevision',1,'transportSessionId','reh-bulk',
             'updatedAt','2000-01-01T00:00:00Z'::timestamptz,'cars','[]'::jsonb))
    FROM public.simhub_devices d WHERE d.connector_id='rehearsal-bulk';

  SET SESSION AUTHORIZATION authenticator;
  SET ROLE service_role;
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',false);
  n := public.simhub_pace_cleanup_v1();
  IF n <> 100 THEN RAISE EXCEPTION 'cleanup batch was %, expected 100', n; END IF;
  n := public.simhub_pace_cleanup_v1();
  IF n <> 5 THEN RAISE EXCEPTION 'second cleanup batch was %, expected 5', n; END IF;
  n := public.simhub_pace_cleanup_v1();
  IF n <> 0 THEN RAISE EXCEPTION 'third cleanup batch was %, expected 0', n; END IF;
  RESET ROLE;
  RESET SESSION AUTHORIZATION;

  IF EXISTS (SELECT 1 FROM public.simhub_telemetry_latest
              WHERE connector_id='rehearsal-bulk' AND v3_normalized ? 'paceHistory') THEN
    RAISE EXCEPTION 'expired history left behind';
  END IF;
  IF EXISTS (SELECT 1 FROM public.simhub_telemetry_latest
              WHERE connector_id='rehearsal-bulk' AND v3_normalized#>>'{fuel,fuelLitres}' <> '42') THEN
    RAISE EXCEPTION 'cleanup damaged other payload keys';
  END IF;
  RAISE NOTICE 'PASS cleanup-bounded-batches';
END $$;

-- ---------------------------------------------------------------------------
-- 7. Lees-TTL: een verlopen opgeslagen blok wordt niet getoond
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dev uuid := '11111111-1111-1111-1111-111111111111';
  p jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"22222222-2222-2222-2222-222222222222"}',false);
  UPDATE public.simhub_telemetry_latest
     SET v3_normalized = jsonb_set(v3_normalized,'{paceHistory,updatedAt}','"2000-01-01T00:00:00Z"'::jsonb)
   WHERE device_id = dev;
  p := public.get_pitwall_pace(dev,NULL,NULL,NULL);
  IF p IS NULL OR jsonb_array_length(p->'cars') <> 0 THEN
    RAISE EXCEPTION 'expired pace history was shown';
  END IF;
  RAISE NOTICE 'PASS read-ttl';
END $$;

DO $$ BEGIN RAISE NOTICE 'SUMMARY PACE-REHEARSAL PASS'; END $$;
