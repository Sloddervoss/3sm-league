-- Transaction-only integration against the REAL persist procedure and full schema.
-- Needs one existing owner-backed device for the FK; never changes that device.
-- All probe devices, practice effects and temporary helpers are rolled back.
BEGIN;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='1s';
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE TEMP TABLE session_recovery_results(test text PRIMARY KEY, result text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.check_frame(label text, tok text, sid text, seq bigint, captured timestamptz, payload jsonb, expected text)
RETURNS void LANGUAGE plpgsql AS $test$
DECLARE got text; ack jsonb;
BEGIN
 SELECT result,measurement_ack INTO got,ack FROM public.simhub_persist_v3(tok,sid,seq,captured,payload,NULL,NULL,NULL);
 IF got IS DISTINCT FROM expected THEN RAISE EXCEPTION '%: expected %, got %',label,expected,got; END IF;
 IF (expected<>'accepted' AND ack IS NULL) OR (ack IS NOT NULL AND jsonb_typeof(ack)<>'object') THEN
   RAISE EXCEPTION '%: measurement ACK contract lost',label;
 END IF;
 INSERT INTO session_recovery_results VALUES(label,got);
END $test$;

CREATE FUNCTION pg_temp.seed_session()
RETURNS jsonb LANGUAGE plpgsql AS $test$
DECLARE dev uuid:=gen_random_uuid(); tok text:=repeat(md5(gen_random_uuid()::text),2); own uuid; payload jsonb; got text;
BEGIN
 SELECT owner_user_id INTO own FROM public.simhub_devices WHERE owner_user_id IS NOT NULL LIMIT 1;
 IF own IS NULL THEN RAISE EXCEPTION 'Test needs an existing owner-backed device, or an isolated fixture owner'; END IF;
 INSERT INTO public.simhub_devices(id,owner_user_id,token_hash,device_name,connector_id,device_status)
 VALUES(dev,own,tok,'SYNTHETIC-SESSION-TEST',dev::text,'active_unbound');
 payload:=jsonb_build_object('schemaVersion',3,'capturedAt',clock_timestamp()-interval '60 seconds',
   'identity',jsonb_build_object('carId','synthetic-session-recovery','trackId',596),
   'session',jsonb_build_object('flags','[]'::jsonb),'timing',jsonb_build_object('completedLaps',0),
   'track',jsonb_build_object('onPitRoad',false),'fuel',jsonb_build_object('fuelLitres',25));
 SELECT result INTO got FROM public.simhub_persist_v3(tok,'prior',1,clock_timestamp()-interval '60 seconds',payload,NULL,NULL,NULL);
 IF got<>'accepted' THEN RAISE EXCEPTION 'Synthetic core seed failed: %',got; END IF;
 UPDATE public.simhub_devices SET last_seen_at=clock_timestamp()-interval '60 seconds' WHERE id=dev;
 RETURN jsonb_build_object('device',dev,'token',tok,'payload',payload);
END $test$;

DO $test$
DECLARE f jsonb; dev uuid; tok text; payload jsonb; stamp timestamptz; n integer;
BEGIN
 f:=pg_temp.seed_session(); dev:=(f->>'device')::uuid; tok:=f->>'token';
 stamp:=clock_timestamp(); payload:=jsonb_set(f->'payload','{capturedAt}',to_jsonb(stamp));
 PERFORM pg_temp.check_frame('late_first_frame_1700_recovers',tok,'new',1700,stamp,payload,'accepted');
 UPDATE public.simhub_devices SET last_seen_at=clock_timestamp()-interval '1 second' WHERE id=dev;
 PERFORM pg_temp.check_frame('same_sequence_is_replayed',tok,'new',1700,clock_timestamp(),payload,'replayed');
 PERFORM pg_temp.check_frame('lower_sequence_is_replayed',tok,'new',1699,clock_timestamp(),payload,'replayed');
 PERFORM pg_temp.check_frame('existing_session_can_advance',tok,'new',1701,clock_timestamp(),payload,'accepted');
 UPDATE public.simhub_devices SET last_seen_at=clock_timestamp()-interval '1 second' WHERE id=dev;
 PERFORM pg_temp.check_frame('active_sender_blocks_early_competitor',tok,'competitor-early',1,clock_timestamp(),payload,'replayed');
 PERFORM pg_temp.check_frame('active_sender_blocks_late_competitor',tok,'competitor-late',9000,clock_timestamp(),payload,'replayed');

 f:=pg_temp.seed_session(); dev:=(f->>'device')::uuid; tok:=f->>'token'; payload:=f->'payload';
 PERFORM pg_temp.check_frame('ordinary_first_frame_unchanged',tok,'boot',1,clock_timestamp(),payload,'accepted');

 f:=pg_temp.seed_session(); dev:=(f->>'device')::uuid; tok:=f->>'token'; payload:=f->'payload';
 PERFORM pg_temp.check_frame('older_capture_cannot_resurrect_session',tok,'old-capture',1700,clock_timestamp()-interval '90 seconds',payload,'replayed');
 stamp:=(payload->>'capturedAt')::timestamptz;
 PERFORM pg_temp.check_frame('equal_capture_cannot_resurrect_session',tok,'equal-capture',1700,stamp,payload,'replayed');
 PERFORM pg_temp.check_frame('stale_capture_is_not_late_recovery',tok,'stale-capture',1700,clock_timestamp()-interval '3 minutes',payload,'replayed');
 PERFORM pg_temp.check_frame('future_capture_is_not_late_recovery',tok,'future-capture',1700,clock_timestamp()+interval '3 minutes',payload,'replayed');

 UPDATE public.simhub_telemetry_latest SET v3_normalized=v3_normalized-'capturedAt' WHERE device_id=dev;
 PERFORM pg_temp.check_frame('missing_prior_capture_fails_closed',tok,'missing-capture',1700,clock_timestamp(),payload,'replayed');
 UPDATE public.simhub_telemetry_latest SET v3_normalized=jsonb_set(v3_normalized,'{capturedAt}','"not-a-date"') WHERE device_id=dev;
 PERFORM pg_temp.check_frame('malformed_prior_capture_does_not_crash',tok,'bad-capture',1700,clock_timestamp(),payload,'replayed');
 UPDATE public.simhub_telemetry_latest SET v3_normalized=jsonb_set(v3_normalized,'{capturedAt}','"2026-99-99T00:00:00Z"') WHERE device_id=dev;
 PERFORM pg_temp.check_frame('out_of_range_prior_capture_does_not_crash',tok,'bad-date',1700,clock_timestamp(),payload,'replayed');
 UPDATE public.simhub_telemetry_latest SET v3_normalized=jsonb_set(v3_normalized,'{capturedAt}','null') WHERE device_id=dev;
 PERFORM pg_temp.check_frame('null_prior_capture_fails_closed',tok,'null-capture',1700,clock_timestamp(),payload,'replayed');
 DELETE FROM public.simhub_telemetry_latest WHERE device_id=dev;
 PERFORM pg_temp.check_frame('missing_prior_snapshot_fails_closed',tok,'no-snapshot',1700,clock_timestamp(),payload,'replayed');

 f:=pg_temp.seed_session(); dev:=(f->>'device')::uuid; tok:=f->>'token'; payload:=f->'payload';
 UPDATE public.simhub_telemetry_latest SET v3_normalized=jsonb_set(v3_normalized,'{capturedAt}',to_jsonb(clock_timestamp()-interval '100 seconds')) WHERE device_id=dev;
 stamp:=clock_timestamp()-interval '90 seconds'; payload:=jsonb_set(payload,'{capturedAt}',to_jsonb(stamp));
 PERFORM pg_temp.check_frame('client_clock_skew_uses_client_capture_order',tok,'skewed-client',1700,stamp,payload,'accepted');

 f:=pg_temp.seed_session(); dev:=(f->>'device')::uuid; tok:=f->>'token'; payload:=f->'payload';
 PERFORM pg_temp.check_frame('unknown_device_still_rejected',repeat(md5(gen_random_uuid()::text),2),'unknown',1700,clock_timestamp(),payload,'invalid_device');
 PERFORM pg_temp.check_frame('missing_capture_still_invalid',tok,'invalid',1700,NULL,payload,'invalid_payload');
 UPDATE public.simhub_devices SET revoked_at=clock_timestamp(),device_status='revoked' WHERE id=dev;
 PERFORM pg_temp.check_frame('revocation_still_enforced',tok,'revoked',1700,clock_timestamp(),payload,'revoked');
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 PERFORM pg_temp.check_frame('non_service_caller_still_rejected',tok,'unauthorized',1700,clock_timestamp(),payload,'unauthorized');
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);

 f:=pg_temp.seed_session(); dev:=(f->>'device')::uuid; tok:=f->>'token'; payload:=jsonb_set(f->'payload','{capturedAt}',to_jsonb(clock_timestamp()));
 INSERT INTO public.simhub_device_sessions(device_id,session_id,last_sequence,first_seen_at,last_seen_at)
 SELECT dev,'retention-'||x,50,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day' FROM generate_series(1,64) x;
 PERFORM pg_temp.check_frame('session_retention_and_late_recovery_coexist',tok,'after-retention',1700,clock_timestamp(),payload,'accepted');
 SELECT count(*) INTO n FROM public.simhub_device_sessions WHERE device_id=dev;
 IF n<>49 THEN RAISE EXCEPTION 'Expected 48 retained sessions plus the new one, got %',n; END IF;
 INSERT INTO session_recovery_results VALUES('retained_history_not_wiped','49');
END $test$;
SELECT jsonb_build_object('passed',count(*),'cases',jsonb_agg(to_jsonb(r) ORDER BY test)) FROM session_recovery_results r;
ROLLBACK;
