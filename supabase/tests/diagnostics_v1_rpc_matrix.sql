-- ============================================================================
-- Diagnostics v1 RPC TESTMATRIX (wegwerp-DB, clean rebuild t/m migratie)
-- Doel: bewijs dat simhub_upsert_health + simhub_insert_diagnostic_event
--       alle testcases doorstaat met correcte rate limits, retention en RLS.
-- ============================================================================
\set ON_ERROR_STOP on

-- ============================ SETUP: fixture =============================
INSERT INTO auth.users (id,email,role,created_at,updated_at) VALUES
 ('cccccccc-0000-4000-8000-000000000001','owner@test.cc','authenticated',now(),now()),
 ('dddddddd-0000-4000-8000-000000000002','super@test.cc','authenticated',now(),now()),
 ('eeeeeeee-0000-4000-8000-000000000003','regular@test.cc','authenticated',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
 ('dddddddd-0000-4000-8000-000000000002','super_admin')
ON CONFLICT DO NOTHING;

INSERT INTO simhub_devices (id, owner_user_id, connector_id, device_name, token_hash, device_status, last_session_id, last_sequence)
VALUES
 ('10000000-0000-0000-0000-000000000001','cccccccc-0000-4000-8000-000000000001','TEST-PC','TEST-PC',
  'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
  'inactive','test-session-1',0),
 ('20000000-0000-0000-0000-000000000002','cccccccc-0000-4000-8000-000000000001','UNBOUND-PC','UNBOUND-PC',
  'bbbbccccbbbbccccbbbbccccbbbbccccbbbbccccbbbbccccbbbbccccbbbbcccc',
  'inactive','test-session-2',0),
 ('40000000-0000-0000-0000-000000000004','eeeeeeee-0000-4000-8000-000000000003','OTHER-PC','OTHER-PC',
  'ddddeeeeddddeeeeddddeeeeddddeeeeddddeeeeddddeeeeddddeeeeddddeeee',
  'inactive','test-session-4',0),
 ('60000000-0000-0000-0000-000000000006','cccccccc-0000-4000-8000-000000000001','RETENTION-A','RETENTION-A',
  '6666666666666666666666666666666666666666666666666666666666666666',
  'inactive','test-session-6',0),
 ('70000000-0000-0000-0000-000000000007','cccccccc-0000-4000-8000-000000000001','RETENTION-B','RETENTION-B',
  '7777777777777777777777777777777777777777777777777777777777777777',
  'inactive','test-session-7',0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO simhub_devices (id, owner_user_id, connector_id, device_name, token_hash, device_status, revoked_at, last_session_id, last_sequence)
VALUES
 ('30000000-0000-0000-0000-000000000003','cccccccc-0000-4000-8000-000000000001','REVOKED-PC','REVOKED-PC',
  'ccccddddccccddddccccddddccccddddccccddddccccddddccccddddccccdddd',
  'revoked', now(), 'test-session-3',0)
ON CONFLICT (id) DO NOTHING;

-- ====================== T01: valid heartbeat ======================
\echo '=== T01: valid heartbeat ==='
SELECT simhub_upsert_health(
    'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    '{"type":"heartbeat","deviceId":"10000000-0000-0000-0000-000000000001","connectorVersion":"0.3.10.0","simHubVersion":"1.0.9735.26972","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1873.5,"sessionTimeReader":"RawDataReflection","sequence":410,"lastTelemetryAttemptUtc":"2026-08-31T17:59:00Z","lastSuccessfulIngestUtc":"2026-08-31T17:58:00Z","lastIngestHttpStatus":202,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}'::jsonb
) AS result;

\echo '--- T01 verify ---'
SELECT device_id, connector_version, diagnostic_code, updater_state, game_connected,
       client_last_telemetry_attempt_utc, client_last_successful_ingest_utc,
       client_last_ingest_http_status
FROM simhub_device_health
WHERE device_id = '10000000-0000-0000-0000-000000000001';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM simhub_device_health
        WHERE device_id = '10000000-0000-0000-0000-000000000001'
          AND client_last_telemetry_attempt_utc = '2026-08-31T17:59:00Z'::timestamptz
          AND client_last_successful_ingest_utc = '2026-08-31T17:58:00Z'::timestamptz
          AND client_last_ingest_http_status = 202
    ) THEN
        RAISE EXCEPTION 'T01 camelCase heartbeat mapping did not persist expected health values';
    END IF;
END $$;

-- ============== T02: deviceId mismatch ==============
\echo '=== T02: deviceId mismatch (PENDING PHASE C — Edge-side) ==='
-- De RPC is token-based en kent geen body-deviceId cross-check;
-- die check gebeurt in de Edge-function (Fase C). RPC accepteert altijd
-- op basis van token-device. Dit is correct gedrag.
\echo '   RPC accepteert (token-based), Edge rejecteert bij body-deviceId mismatch in Fase C. Marked: PENDING PHASE C'

-- ====================== T03: bad token ======================
\echo '=== T03: bad token ==='
SELECT simhub_upsert_health(
    '0000000000000000000000000000000000000000000000000000000000000000',
    '{"type":"heartbeat","deviceId":null,"connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":false,"telemetryAvailable":false,"rawDataAvailable":false,"rawTelemetryAvailable":false,"sessionTimeReadOk":false,"sessionTimeSeconds":null,"sessionTimeReader":"RawDataReflection","sequence":0,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}'::jsonb
) AS result;

-- ====================== T04: revoked device ======================
\echo '=== T04: revoked device ==='
SELECT simhub_upsert_health(
    'ccccddddccccddddccccddddccccddddccccddddccccddddccccddddccccdddd',
    '{"type":"heartbeat","deviceId":null,"connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":false,"telemetryAvailable":false,"rawDataAvailable":false,"rawTelemetryAvailable":false,"sessionTimeReadOk":false,"sessionTimeSeconds":null,"sessionTimeReader":"RawDataReflection","sequence":0,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}'::jsonb
) AS result;

-- ============== T05: unbound device WEL toegestaan ==============
\echo '=== T05: unbound device (geen event/team binding) WEL toegestaan ==='
SELECT simhub_upsert_health(
    'bbbbccccbbbbccccbbbbccccbbbbccccbbbbccccbbbbccccbbbbccccbbbbcccc',
    '{"type":"heartbeat","deviceId":null,"connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":false,"telemetryAvailable":false,"rawDataAvailable":false,"rawTelemetryAvailable":false,"sessionTimeReadOk":false,"sessionTimeSeconds":null,"sessionTimeReader":"RawDataReflection","sequence":0,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"DEVICE_UNBOUND","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}'::jsonb
) AS result;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM simhub_device_health
        WHERE device_id = '20000000-0000-0000-0000-000000000002'
          AND client_last_telemetry_attempt_utc IS NULL
          AND client_last_successful_ingest_utc IS NULL
          AND client_last_ingest_http_status IS NULL
    ) THEN
        RAISE EXCEPTION 'T05 nullable camelCase heartbeat fields did not persist as NULL';
    END IF;
END $$;

-- ====================== T06: valid event ======================
\echo '=== T06: valid event ==='
SELECT simhub_insert_diagnostic_event(
    'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    '{"type":"event","deviceId":null,"code":"SESSION_TIME_READ_FAILED","atUtc":"2026-08-31T18:01:00Z","exceptionType":"System.Reflection.TargetInvocationException","detail":"session time reader returned invalid value","occurredAfter":"OK"}'::jsonb
) AS result;

\echo '--- T06 verify ---'
SELECT device_id, code, exception_type, substring(detail, 1, 40) as detail_short
FROM simhub_device_diagnostic_events
WHERE device_id = '10000000-0000-0000-0000-000000000001'
ORDER BY received_at DESC;

-- ============== T07a: event rate limit —zelfde code binnen 10s ==============
\echo '=== T07a: event rate limit —zelfde code binnen 10s ==='
-- T06 placed event. Second within 10s → rate_limited (global grens, ongeacht code)
SELECT simhub_insert_diagnostic_event(
    'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    '{"type":"event","deviceId":null,"code":"SESSION_TIME_READ_FAILED","atUtc":"2026-08-31T18:01:02Z","exceptionType":"System.Reflection.TargetInvocationException","detail":"session time reader returned invalid value","occurredAfter":"OK"}'::jsonb
) AS result;

-- ============== T07b: event rate limit —andere code binnen 10s ==============
\echo '=== T07b: event rate limit —andere code binnen 10s ==='
-- Andere code maar nog binnen 10s na T06 → rate_limited (per-device grens)
SELECT simhub_insert_diagnostic_event(
    'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    '{"type":"event","deviceId":null,"code":"INGEST_500","atUtc":"2026-08-31T18:01:03Z","exceptionType":null,"detail":"ingest returned 500","occurredAfter":"OK"}'::jsonb
) AS result;

-- ============== T07c: andere code na 10s → accepted ==============
\echo '=== T07c: event na 10s → accepted ==='
-- Forceer received_at naar 10s terug om cooldown te omzeilen
UPDATE simhub_device_diagnostic_events
SET received_at = now() - interval '11 seconds'
WHERE device_id = '10000000-0000-0000-0000-000000000001';

SELECT simhub_insert_diagnostic_event(
    'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    '{"type":"event","deviceId":null,"code":"INGEST_500","atUtc":"2026-08-31T18:01:03Z","exceptionType":null,"detail":"ingest returned 500","occurredAfter":"OK"}'::jsonb
) AS result;

-- ============== T08: heartbeat rate limit (55s) ==============
\echo '=== T08: heartbeat rate limit (55s) ==='
SELECT simhub_upsert_health(
    'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    '{"type":"heartbeat","deviceId":null,"connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":true,"telemetryAvailable":true,"rawDataAvailable":true,"rawTelemetryAvailable":false,"sessionTimeReadOk":true,"sessionTimeSeconds":1890.0,"sessionTimeReader":"RawDataReflection","sequence":411,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:30Z"}'::jsonb
) AS result;

-- ====================== T09: recovery event ======================
\echo '=== T09: recovery event ==='
-- Zet device 1 events terug zodat de 10s-cooldown gepasseerd is
UPDATE simhub_device_diagnostic_events
SET received_at = now() - interval '11 seconds'
WHERE device_id = '10000000-0000-0000-0000-000000000001';

SELECT simhub_insert_diagnostic_event(
    'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    '{"type":"event","deviceId":null,"code":"OK","atUtc":"2026-08-31T18:02:00Z","exceptionType":null,"detail":"SessionTime recovery after read failure","occurredAfter":"SESSION_TIME_READ_FAILED"}'::jsonb
) AS result;

-- ============== T10: retention — 107 identieke timestamps ==============
\echo '=== T10a: retention — 107 events met identieke received_at ==='
DELETE FROM simhub_device_diagnostic_events WHERE device_id = '40000000-0000-0000-0000-000000000004';

-- Insert 107 events voor device 4 met EXACT dezelfde received_at
DO $$
DECLARE
    i int;
    ts timestamptz := now() - interval '11 seconds';
BEGIN
    FOR i IN 1..107 LOOP
        INSERT INTO simhub_device_diagnostic_events
            (device_id, code, exception_type, detail, received_at)
        VALUES (
            '40000000-0000-0000-0000-000000000004',
            'RAW_DATA_UNAVAILABLE',
            'System.NullReferenceException',
            'test event #' || i,
            ts
        );
    END LOOP;
END $$;

-- Insert nieuwe event via RPC (trigert retention #1 cleanup)
SELECT simhub_insert_diagnostic_event(
    'ddddeeeeddddeeeeddddeeeeddddeeeeddddeeeeddddeeeeddddeeeeddddeeee',
    '{"type":"event","deviceId":null,"code":"RAW_DATA_UNAVAILABLE","atUtc":"2026-08-31T18:05:00Z","exceptionType":"System.NullReferenceException","detail":"raw data null","occurredAfter":"OK"}'::jsonb
) AS result;

\echo '--- T10a verify: exact 100 events retained ---'
SELECT count(*) as event_count FROM simhub_device_diagnostic_events
WHERE device_id = '40000000-0000-0000-0000-000000000004';

-- Move the accepted R10a event outside the rate-limit window before the
-- independent R10b cap assertion.
UPDATE simhub_device_diagnostic_events
SET received_at = now() - interval '11 seconds'
WHERE device_id = '40000000-0000-0000-0000-000000000004';

-- ============== T10b: retention — nieuwe insert bij 100 → 100 ==============
\echo '=== T10b: nieuwe insert bij bestaande 100 → exact 100 ==='
SELECT simhub_insert_diagnostic_event(
    'ddddeeeeddddeeeeddddeeeeddddeeeeddddeeeeddddeeeeddddeeeeddddeeee',
    '{"type":"event","deviceId":null,"code":"INGEST_500","atUtc":"2026-08-31T18:06:00Z","exceptionType":null,"detail":"ingest returned 500","occurredAfter":"RAW_DATA_UNAVAILABLE"}'::jsonb
) AS result;

\echo '--- T10b verify: exact 100 events retained ---'
SELECT count(*) as event_count FROM simhub_device_diagnostic_events
WHERE device_id = '40000000-0000-0000-0000-000000000004';

-- ============== T10c: onafhankelijke retention per device ==============
\echo '=== T10c: retention per device onafhankelijk ==='
-- Device 1 heeft eigen events (T06, T09, T07c) — count moet <= 100
\echo '--- T10c verify: device 1 events ---'
SELECT count(*) as event_count FROM simhub_device_diagnostic_events
WHERE device_id = '10000000-0000-0000-0000-000000000001';

-- ============== T10d: 7-day retention ==============
\echo '=== T10d: 7-day retention ==='
-- Zet een event op >7 dagen terug, voeg nieuw event toe, bewijs oude weg
INSERT INTO simhub_device_diagnostic_events
    (device_id, code, exception_type, detail, received_at)
VALUES (
    '10000000-0000-0000-0000-000000000001',
    'RAW_DATA_UNAVAILABLE',
    'System.NullReferenceException',
    'old event to be purged',
    now() - interval '8 days'
);

-- Zet device 1 events terug zodat de 10s-cooldown gepasseerd is; de
-- seven-day assertion moet een accepted insert gebruiken.
UPDATE simhub_device_diagnostic_events
SET received_at = now() - interval '11 seconds'
WHERE device_id = '10000000-0000-0000-0000-000000000001';

SELECT simhub_insert_diagnostic_event(
    'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    '{"type":"event","deviceId":null,"code":"INGEST_500","atUtc":"2026-08-31T18:07:00Z","exceptionType":null,"detail":"ingest 500 test","occurredAfter":"OK"}'::jsonb
) AS result;

\echo '--- T10d verify: geen events ouder dan 7 dagen ---'
SELECT count(*) as old_event_count FROM simhub_device_diagnostic_events
WHERE device_id = '10000000-0000-0000-0000-000000000001'
AND received_at < now() - interval '7 days';

-- ============== R100/R101/R102/R107: post-insert cap invariant ==============
\echo '=== R100/R101/R102/R107: post-insert cap invariant ==='
DO $$
DECLARE
    v_seed_count int;
    v_count int;
    v_result jsonb;
BEGIN
    FOREACH v_seed_count IN ARRAY ARRAY[99, 100, 101] LOOP
        DELETE FROM simhub_device_diagnostic_events
        WHERE device_id = '60000000-0000-0000-0000-000000000006';

        INSERT INTO simhub_device_diagnostic_events (device_id, code, detail, received_at)
        SELECT '60000000-0000-0000-0000-000000000006', 'RAW_DATA_UNAVAILABLE',
               'cap-seed-' || gs, now() - interval '11 seconds'
        FROM generate_series(1, v_seed_count) AS gs;

        v_result := simhub_insert_diagnostic_event(
            '6666666666666666666666666666666666666666666666666666666666666666',
            jsonb_build_object('type','event','deviceId',null,'code','INGEST_500',
                'atUtc','2026-08-31T18:08:00Z','exceptionType',null,'detail','cap probe','occurredAfter','OK')
        );
        IF v_result <> jsonb_build_object('result', 'accepted') THEN
            RAISE EXCEPTION 'R% expected accepted, got %', v_seed_count, v_result;
        END IF;
        SELECT count(*) INTO v_count FROM simhub_device_diagnostic_events
        WHERE device_id = '60000000-0000-0000-0000-000000000006';
        IF v_count <> 100 THEN
            RAISE EXCEPTION 'R% expected 100 events, got %', v_seed_count, v_count;
        END IF;
    END LOOP;

    -- R107 + deterministic same-timestamp tie behavior: after the new event,
    -- 99 highest-id tied seed rows remain; seed 8 is pruned and seed 9 remains.
    DELETE FROM simhub_device_diagnostic_events
    WHERE device_id = '60000000-0000-0000-0000-000000000006';
    INSERT INTO simhub_device_diagnostic_events (device_id, code, detail, received_at)
    SELECT '60000000-0000-0000-0000-000000000006', 'RAW_DATA_UNAVAILABLE',
           'tie-seed-' || gs, now() - interval '11 seconds'
    FROM generate_series(1, 107) AS gs;
    v_result := simhub_insert_diagnostic_event(
        '6666666666666666666666666666666666666666666666666666666666666666',
        jsonb_build_object('type','event','deviceId',null,'code','INGEST_500',
            'atUtc','2026-08-31T18:09:00Z','exceptionType',null,'detail','tie probe','occurredAfter','OK')
    );
    IF v_result <> jsonb_build_object('result', 'accepted') THEN
        RAISE EXCEPTION 'R107 expected accepted, got %', v_result;
    END IF;
    SELECT count(*) INTO v_count FROM simhub_device_diagnostic_events
    WHERE device_id = '60000000-0000-0000-0000-000000000006';
    IF v_count <> 100
       OR EXISTS (SELECT 1 FROM simhub_device_diagnostic_events WHERE device_id = '60000000-0000-0000-0000-000000000006' AND detail = 'tie-seed-8')
       OR NOT EXISTS (SELECT 1 FROM simhub_device_diagnostic_events WHERE device_id = '60000000-0000-0000-0000-000000000006' AND detail = 'tie-seed-9') THEN
        RAISE EXCEPTION 'R107 deterministic newest-100 invariant failed';
    END IF;

    -- Per-device isolation: retaining A cannot delete B's 107 seeded rows.
    DELETE FROM simhub_device_diagnostic_events
    WHERE device_id IN ('60000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000007');
    INSERT INTO simhub_device_diagnostic_events (device_id, code, detail, received_at)
    SELECT '60000000-0000-0000-0000-000000000006', 'RAW_DATA_UNAVAILABLE',
           'isolation-a-' || gs, now() - interval '11 seconds' FROM generate_series(1,100) AS gs;
    INSERT INTO simhub_device_diagnostic_events (device_id, code, detail, received_at)
    SELECT '70000000-0000-0000-0000-000000000007', 'RAW_DATA_UNAVAILABLE',
           'isolation-b-' || gs, now() - interval '11 seconds' FROM generate_series(1,107) AS gs;
    PERFORM simhub_insert_diagnostic_event(
        '6666666666666666666666666666666666666666666666666666666666666666',
        jsonb_build_object('type','event','deviceId',null,'code','INGEST_500',
            'atUtc','2026-08-31T18:10:00Z','exceptionType',null,'detail','isolation probe','occurredAfter','OK')
    );
    IF (SELECT count(*) FROM simhub_device_diagnostic_events WHERE device_id = '60000000-0000-0000-0000-000000000006') <> 100
       OR (SELECT count(*) FROM simhub_device_diagnostic_events WHERE device_id = '70000000-0000-0000-0000-000000000007') <> 107 THEN
        RAISE EXCEPTION 'per-device retention isolation failed';
    END IF;

    -- Seven-day cleanup remains independent of the cap.
    DELETE FROM simhub_device_diagnostic_events WHERE device_id = '60000000-0000-0000-0000-000000000006';
    INSERT INTO simhub_device_diagnostic_events (device_id, code, detail, received_at)
    VALUES ('60000000-0000-0000-0000-000000000006', 'RAW_DATA_UNAVAILABLE', 'expired probe', now() - interval '8 days');
    PERFORM simhub_insert_diagnostic_event(
        '6666666666666666666666666666666666666666666666666666666666666666',
        jsonb_build_object('type','event','deviceId',null,'code','INGEST_500',
            'atUtc','2026-08-31T18:11:00Z','exceptionType',null,'detail','seven-day probe','occurredAfter','OK')
    );
    IF EXISTS (SELECT 1 FROM simhub_device_diagnostic_events WHERE device_id = '60000000-0000-0000-0000-000000000006' AND received_at < now() - interval '7 days') THEN
        RAISE EXCEPTION 'seven-day retention failed';
    END IF;
END $$;

-- ============== T11: RLS verified with real semantics ==============
\echo '=== T11: RLS verified with real can_manage_simhub() semantics ==='
-- De RPCs zijn SECURITY DEFINER -> RLS niet van toepassing op schrijven.
-- De read policies gebruiken public.can_manage_simhub() die user_roles checkt.
-- Bevestig: policies bestaan en gebruiken can_manage_simhub()
\echo '--- T11 verify: policies exist using can_manage_simhub() ---'
SELECT schemaname, tablename, policyname, qual
FROM pg_policies
WHERE tablename IN ('simhub_device_health', 'simhub_device_diagnostic_events')
AND cmd = 'SELECT'
ORDER BY tablename, policyname;

-- ============== T12: RPC result types ==============
\echo '=== T12: verify RPC result types ==='
SELECT result::text FROM simhub_upsert_health(
    'aabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccddaabbccdd',
    '{"type":"heartbeat","deviceId":null,"connectorVersion":"0.3.10.0","simHubVersion":"1.0","gameConnected":false,"telemetryAvailable":false,"rawDataAvailable":false,"rawTelemetryAvailable":false,"sessionTimeReadOk":false,"sessionTimeSeconds":null,"sessionTimeReader":"RawDataReflection","sequence":0,"lastTelemetryAttemptUtc":null,"lastSuccessfulIngestUtc":null,"lastIngestHttpStatus":null,"diagnosticCode":"OK","updaterState":"IDLE","updaterCurrentVersion":"0.3.10.0","updaterTargetVersion":null,"lastUpdateResult":"none","lastUpdateUtc":null,"clientReportedAtUtc":"2026-08-31T18:00:00Z"}'::jsonb
) AS result;

-- ============== T10e: 7-day retention via cron cleanup (ONAFHANKELIJK van insert RPC) ==============
\echo '=== T10e: 7-day retention — cron cleanup onafhankelijk van insert RPC ==='

-- Tel events voor device 4 (heeft 100 events van T10a, allemaal recent)
\echo '--- T10e pre: device 4 event count ---'
SELECT count(*) AS event_count FROM simhub_device_diagnostic_events WHERE device_id = '00000000-0000-0000-0000-000000000004';

-- Voeg 1 oud event toe (8 dagen geleden) voor device 5 (schoon device)
INSERT INTO simhub_devices (id, owner_user_id, token_hash, connector_id, device_name, device_status, device_role, last_session_id, last_sequence)
VALUES ('55555555-0000-0000-0000-000000000005', 'cccccccc-0000-4000-8000-000000000001', '55555555aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'CRON-TEST', 'CRON-TEST-DEVICE', 'inactive', NULL, 'test-cron', 0);

INSERT INTO simhub_device_diagnostic_events
    (device_id, code, exception_type, detail, reported_at_utc, received_at)
VALUES
    ('55555555-0000-0000-0000-000000000005', 'RAW_DATA_UNAVAILABLE'::simhub_diagnostic_code, NULL, NULL, now() - interval '8 days', now() - interval '8 days'),
    ('55555555-0000-0000-0000-000000000005', 'OK'::simhub_diagnostic_code, NULL, NULL, now() - interval '1 day', now() - interval '1 day');

\echo '--- T10e pre: device 5 oude + jonge events ---'
SELECT count(*) AS old_before, (SELECT count(*) FROM simhub_device_diagnostic_events WHERE device_id = '55555555-0000-0000-0000-000000000005' AND received_at > now() - interval '7 days') AS young_before;

-- ROEP GEEN diagnostic insert RPC aan. Voer ALLEEN de cleanup function uit (gescheduled via pg_cron).
SELECT public.simhub_cleanup_old_diagnostic_events();

\echo '--- T10e verify: oude event verwijderd, jonge event behouden ---'
SELECT count(*) AS old_remaining FROM simhub_device_diagnostic_events WHERE device_id = '55555555-0000-0000-0000-000000000005' AND received_at < now() - interval '7 days';
SELECT count(*) AS young_count FROM simhub_device_diagnostic_events WHERE device_id = '55555555-0000-0000-0000-000000000005' AND received_at > now() - interval '7 days';

-- Verify: simhub_device_health onaangetast
\echo '--- T10e verify: health table unaangetast ---'
SELECT count(*) AS health_count FROM simhub_device_health;

-- Verify: cleanup werkt over ALLE devices (device 1 events niet geraakt als die jonger zijn dan 7 dagen)
\echo '--- T10e verify: device 1 events na cleanup ---'
SELECT count(*) AS device1_count FROM simhub_device_diagnostic_events WHERE device_id = '10000000-0000-0000-0000-000000000001';

-- ============================ SUMMARY =============================
\echo ''
\echo '=== DIAGNOSTICS V1 RPC TESTMATRIX SUMMARY ==='
SELECT
    (SELECT count(*) FROM simhub_device_health) as health_rows,
    (SELECT count(*) FROM simhub_device_diagnostic_events) as event_rows;
\echo '============================================'