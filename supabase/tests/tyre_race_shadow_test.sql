-- Isolated PostgreSQL fixture. No production writes.
CREATE SCHEMA pitwall_learning;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.simhub_devices(id uuid,owner_user_id uuid,revoked_at timestamptz,expires_at timestamptz);
CREATE TABLE pitwall_learning.account_policy(owner_user_id uuid,policy_version int,capture_enabled bool,personal_fit_enabled bool,created_at timestamptz,updated_at timestamptz);
CREATE TABLE pitwall_learning.runtime_settings(id int,capture_enabled bool);
CREATE TABLE public.simhub_tyre_observations(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,device_id uuid,session_key text,frame_sequence bigint,raw jsonb,on_pit_road bool,received_at timestamptz,session_time_seconds numeric,lap int,observed_at timestamptz,trigger text,wear_fl numeric,wear_fr numeric,wear_rl numeric,wear_rr numeric,set_fl int,set_fr int,set_rl int,set_rr int,endurance_event_id uuid,endurance_team_id uuid,UNIQUE(device_id,session_key,frame_sequence));
CREATE TABLE public.simhub_tyre_stop_anchors(device_id uuid,session_key text,visit_first_seq bigint,answer text,answered_at timestamptz,endurance_event_id uuid,endurance_team_id uuid);
CREATE TABLE public.simhub_lap_summaries(device_id text,delivered_session_id text,observed_session_id text,lap_number int,complete bool,driver_changed bool,pit_lap bool,invalid_reasons text[],started_at timestamptz,ended_at timestamptz);
\ir ../migrations/20261125190000_tyre_race_shadow.sql
INSERT INTO public.simhub_devices VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',NULL,NULL);
INSERT INTO pitwall_learning.account_policy SELECT owner_user_id,2,true,true,now()-interval '1 day',now()-interval '1 day' FROM simhub_devices;
INSERT INTO pitwall_learning.runtime_settings VALUES(1,true);
CREATE FUNCTION fixture(transport text, race text, seq int, laps int, rest int, service text, t timestamptz, phase bool DEFAULT true, fresh bool DEFAULT true) RETURNS int LANGUAGE plpgsql AS $$
DECLARE d uuid := '00000000-0000-0000-0000-000000000001'; proof jsonb;
BEGIN
 FOR i IN 0..3 LOOP
  proof:=CASE WHEN phase THEN jsonb_build_object('shadowRaceV1',jsonb_build_object('owner','00000000-0000-0000-0000-000000000002','race',race,'driver','sim-driver-1','layout','GP','track',123,'car','GT3','capturedAt',t+i*interval '1 second','inCar',true)) ELSE '{}' END;
  INSERT INTO public.simhub_tyre_observations(device_id,session_key,frame_sequence,raw,on_pit_road,received_at,session_time_seconds,lap,observed_at,trigger,wear_fl,wear_fr,wear_rl,wear_rr)
  VALUES(d,transport,seq+i,proof,i IN (1,2),t+(i+1)*interval '1 second',seq+i,laps,
    t+CASE WHEN fresh THEN 2 ELSE -30 END*interval '1 second','sim_refresh',rest,rest-1,rest-2,rest-3);
 END LOOP;
 IF service IS NOT NULL THEN INSERT INTO public.simhub_tyre_stop_anchors VALUES(d,transport,seq+1,service,now(),NULL,NULL); END IF;
 UPDATE pitwall_learning.tyre_shadow_exit SET ready_at=clock_timestamp() WHERE NOT processed;
 RETURN pitwall_learning.tyre_shadow_drain();
END $$;
DO $$
DECLARE d text := '00000000-0000-0000-0000-000000000001'; t timestamptz:=now()-interval '2 hours'; f bigint; x numeric[]; drained integer;
BEGIN
 IF has_table_privilege('authenticated','pitwall_learning.tyre_shadow_exit','SELECT') OR has_function_privilege('anon','pitwall_learning.tyre_shadow_drain(integer)','EXECUTE') THEN RAISE 'public access'; END IF;
 IF fixture('practice','practice',10,2,99,'both',t,false)<>0 THEN RAISE 'practice exported'; END IF;
 drained:=fixture('stale','rs',10,2,99,'both',t,true,false);
 IF drained<>1 OR NOT EXISTS(SELECT FROM pitwall_learning.tyre_shadow_exit WHERE transport='stale' AND outcome='missing_fresh_wear') THEN RAISE 'stale refresh accepted'; END IF;
 PERFORM fixture('race-1','r1',10,2,98,'both',t);
 FOR block IN 1..2 LOOP
  INSERT INTO simhub_lap_summaries SELECT d,'race-1','r1',block*8-6+i,true,false,false,NULL,t+(block*20-10+i)*interval '1 second',t+(block*20-9+i)*interval '1 second' FROM generate_series(1,7) i;
  PERFORM fixture('race-1','r1',10+block*20,2+block*8,98-block*8,'fuel',t+block*20*interval '1 second');
 END LOOP;
 IF (SELECT count(DISTINCT set_anchor_id) FROM pitwall_learning.tyre_shadow_exit WHERE transport='race-1')<>1 OR (SELECT count(*) FROM pitwall_learning.tyre_shadow_exit WHERE transport='race-1' AND actual_rate=ARRAY[1,1,1,1]::numeric[])<>2 THEN RAISE 'fuel stop split confirmed set or rate wrong'; END IF;
 PERFORM fixture('race-2','r2',10,2,98,'tyres',t+interval '20 minutes');
 INSERT INTO simhub_lap_summaries SELECT d,'race-2','r2',2+i,true,false,false,NULL,t+interval '20 minutes'+i*interval '1 second'+interval '3 seconds',t+interval '20 minutes'+i*interval '1 second'+interval '4 seconds' FROM generate_series(1,7) i;
 PERFORM fixture('race-2','r2',30,10,90,'fuel',t+interval '20 minutes 20 seconds');
 SELECT exit_id INTO f FROM pitwall_learning.tyre_shadow_exit WHERE transport='race-2' AND forecast_rate=ARRAY[1,1,1,1]::numeric[] AND issued_at>t;
 IF f IS NULL THEN RAISE 'independent race baseline did not freeze forecast'; END IF;
 INSERT INTO simhub_lap_summaries SELECT d,'race-2','r2',10+i,true,false,false,NULL,now()-interval '1 minute'+i*interval '1 second',now()-interval '1 minute'+(i+1)*interval '1 second' FROM generate_series(1,7) i;
 -- Simulate a genuinely later observed refresh, without sleeping in the fixture.
 UPDATE pitwall_learning.tyre_shadow_exit SET issued_at=now()-interval '2 minutes' WHERE exit_id=f;
 PERFORM fixture('race-2','r2',50,18,74,'fuel',now()-interval '10 seconds');
 SELECT absolute_error INTO x FROM pitwall_learning.tyre_shadow_exit WHERE transport='race-2' AND frame_seq=53;
 IF x IS DISTINCT FROM ARRAY[1,1,1,1]::numeric[] THEN RAISE 'frozen forecast scored incorrectly: %',x; END IF;
 INSERT INTO simhub_lap_summaries SELECT d,'race-2','r2',18+i,true,false,false,NULL,
  now()-interval '5 seconds'+i*interval '1 second',now()-interval '5 seconds'+(i+1)*interval '1 second' FROM generate_series(1,7) i;
 UPDATE pitwall_learning.tyre_shadow_exit SET issued_at=now()+interval '2 minutes' WHERE transport='race-2' AND frame_seq=53;
 PERFORM fixture('race-2','r2',70,26,66,'fuel',now()+interval '20 seconds');
 IF NOT EXISTS(SELECT FROM pitwall_learning.tyre_shadow_exit WHERE transport='race-2' AND frame_seq=73
  AND outcome='qualified' AND absolute_error IS NULL) THEN RAISE 'late prediction scored'; END IF;
 PERFORM fixture('race-2','r2',90,27,66,NULL,now()+interval '40 seconds');
 PERFORM fixture('race-2','r2',110,28,98,'both',now()+interval '60 seconds');
 IF NOT EXISTS(SELECT FROM pitwall_learning.tyre_shadow_exit WHERE transport='race-2' AND frame_seq=93 AND outcome='unconfirmed_stop' AND set_anchor_id IS NULL)
 OR NOT EXISTS(SELECT FROM pitwall_learning.tyre_shadow_exit WHERE transport='race-2' AND frame_seq=113 AND outcome='confirmed_set_boundary' AND set_anchor_id=exit_id AND actual_rate IS NULL) THEN RAISE 'stop boundaries wrong'; END IF;
 IF pitwall_learning.tyre_shadow_drain()<>0 THEN RAISE 'replay'; END IF;
 RAISE NOTICE 'PASS: race-only, freshness, retained fuel-only set, separate new set, forecast/score with late control, no public grants, replay';
END $$;
\ir ../rollbacks/20261125190000_tyre_race_shadow.sql
DO $$ BEGIN IF to_regclass('pitwall_learning.tyre_shadow_exit') IS NOT NULL THEN RAISE 'rollback failed'; END IF; END $$;
