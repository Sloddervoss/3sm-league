-- ============================================================================
-- Remote Diagnostics v1 — simhub_device_health + simhub_device_diagnostic_events
-- Datum: 2026-08-31 | Branch: fix/endurance-alpha-hardening
-- Release: 0.3.10.0 (nog NIET gedeployed naar productie)
--
-- Diagnostische codes als ENUM voor typeveilige constraint.
-- ============================================================================

CREATE TYPE simhub_diagnostic_code AS ENUM (
    'OK',
    'RAW_DATA_UNAVAILABLE',
    'RAW_TELEMETRY_UNAVAILABLE',
    'SESSION_TIME_READ_FAILED',
    'TELEMETRY_STALE',
    'INGEST_401',
    'INGEST_403',
    'INGEST_429',
    'INGEST_500',
    'DEVICE_UNBOUND',
    'DEVICE_REVOKED',
    'UPDATE_CHECK_FAILED',
    'UPDATE_DOWNLOAD_FAILED',
    'UPDATE_HASH_FAILED',
    'UPDATE_SIGNATURE_FAILED',
    'UPDATE_INSTALL_FAILED',
    'UPDATE_DLL_LOCKED',
    'UPDATE_ROLLBACK_USED'
);

-- ============================================================================
-- simhub_device_health — één actuele health-row per device
-- ============================================================================

CREATE TABLE simhub_device_health (
    device_id                       uuid PRIMARY KEY REFERENCES simhub_devices(id) ON DELETE CASCADE,
    connector_version               text NOT NULL,
    simhub_version                  text NOT NULL,
    game_connected                  boolean NOT NULL,
    telemetry_available             boolean NOT NULL,
    raw_data_available              boolean NOT NULL,
    raw_telemetry_available         boolean NOT NULL,
    session_time_read_ok            boolean NOT NULL,
    session_time_seconds            double precision,
    session_time_reader             text NOT NULL,
    sequence                        bigint NOT NULL,

    -- Client-reported velden (NIET authoritative; received_at is authoritative)
    client_last_telemetry_attempt_utc    timestamptz,
    client_last_successful_ingest_utc    timestamptz,
    client_last_ingest_http_status       integer,

    diagnostic_code                 simhub_diagnostic_code NOT NULL,
    updater_state                   text NOT NULL,
    updater_current_version         text NOT NULL,
    updater_target_version          text,
    last_update_result              text,
    last_update_utc                 timestamptz,
    client_reported_at_utc          timestamptz,

    received_at                     timestamptz NOT NULL DEFAULT now(),
    updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- Index voor online/offline-lijst-query
CREATE INDEX idx_simhub_device_health_received_at ON simhub_device_health (received_at DESC);

-- ============================================================================
-- simhub_device_diagnostic_events — beperkte event-history per device
-- ============================================================================

CREATE TABLE simhub_device_diagnostic_events (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id       uuid NOT NULL REFERENCES simhub_devices(id) ON DELETE CASCADE,
    code            simhub_diagnostic_code NOT NULL,
    exception_type  text,
    detail          text CHECK (length(detail) <= 200),
    reported_at_utc timestamptz,
    received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_diag_events_device_received ON simhub_device_diagnostic_events (device_id, received_at DESC);

-- ============================================================================
-- RLS: schrijven alleen via service-role RPC; lezen voor super_admin
-- ============================================================================

ALTER TABLE simhub_device_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE simhub_device_diagnostic_events ENABLE ROW LEVEL SECURITY;

-- Health: schrijven via RPC (service role) — geen directe insert/update voor andere rollen
CREATE POLICY simhub_device_health_service_write
    ON simhub_device_health
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Events: schrijven via RPC (service role)
CREATE POLICY simhub_device_diagnostic_events_service_write
    ON simhub_device_diagnostic_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Leestoegang voor super_admin (via gevestigde can_manage_simhub() helper)
CREATE POLICY simhub_device_health_admin_read
    ON simhub_device_health
    FOR SELECT TO authenticated
    USING (public.can_manage_simhub());

CREATE POLICY simhub_device_diagnostic_events_admin_read
    ON simhub_device_diagnostic_events
    FOR SELECT TO authenticated
    USING (public.can_manage_simhub());

-- ============================================================================
-- RPC: simhub_upsert_health
-- SECURITY DEFINER, service-role-only. Schrijft heartbeat naar health-tabel.
-- Rate limit: max 1 geaccepteerde heartbeat per 55 seconden/device.
-- ============================================================================

CREATE OR REPLACE FUNCTION simhub_upsert_health(
    p_token_hash text,
    p_health jsonb
) RETURNS jsonb
    SECURITY DEFINER
    LANGUAGE plpgsql AS $$
DECLARE
    v_device simhub_devices;
BEGIN
    -- Device lookup: token + niet-revoked. Unbound devices WEL toegestaan.
    SELECT * INTO v_device FROM simhub_devices
    WHERE token_hash = p_token_hash
    LIMIT 1;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'invalid_device');
    END IF;
    IF v_device.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('result', 'invalid_device');
    END IF;

    -- Heartbeat rate limit (DB-authoritative): max 1 per 55s/device
    IF EXISTS (
        SELECT 1 FROM simhub_device_health
        WHERE device_id = v_device.id
        AND received_at > now() - interval '55 seconds'
    ) THEN
        RETURN jsonb_build_object('result', 'diagnostic_rate_limited');
    END IF;

    INSERT INTO simhub_device_health AS h (
        device_id, connector_version, simhub_version,
        game_connected, telemetry_available, raw_data_available,
        raw_telemetry_available, session_time_read_ok, session_time_seconds,
        session_time_reader, sequence,
        client_last_telemetry_attempt_utc,
        client_last_successful_ingest_utc,
        client_last_ingest_http_status,
        diagnostic_code,
        updater_state, updater_current_version, updater_target_version,
        last_update_result, last_update_utc, client_reported_at_utc,
        received_at, updated_at
    ) VALUES (
        v_device.id,
        p_health->>'connectorVersion',
        p_health->>'simHubVersion',
        (p_health->>'gameConnected')::boolean,
        (p_health->>'telemetryAvailable')::boolean,
        (p_health->>'rawDataAvailable')::boolean,
        (p_health->>'rawTelemetryAvailable')::boolean,
        (p_health->>'sessionTimeReadOk')::boolean,
        (p_health->>'sessionTimeSeconds')::double precision,
        p_health->>'sessionTimeReader',
        (p_health->>'sequence')::bigint,
        (p_health->>'lastTelemetryAttemptUtc')::timestamptz,
        (p_health->>'lastSuccessfulIngestUtc')::timestamptz,
        (p_health->>'lastIngestHttpStatus')::integer,
        (p_health->>'diagnosticCode')::simhub_diagnostic_code,
        p_health->>'updaterState',
        p_health->>'updaterCurrentVersion',
        p_health->>'updaterTargetVersion',
        p_health->>'lastUpdateResult',
        (p_health->>'lastUpdateUtc')::timestamptz,
        (p_health->>'clientReportedAtUtc')::timestamptz,
        now(), now()
    ) ON CONFLICT (device_id) DO UPDATE SET
        connector_version = EXCLUDED.connector_version,
        simhub_version = EXCLUDED.simhub_version,
        game_connected = EXCLUDED.game_connected,
        telemetry_available = EXCLUDED.telemetry_available,
        raw_data_available = EXCLUDED.raw_data_available,
        raw_telemetry_available = EXCLUDED.raw_telemetry_available,
        session_time_read_ok = EXCLUDED.session_time_read_ok,
        session_time_seconds = EXCLUDED.session_time_seconds,
        session_time_reader = EXCLUDED.session_time_reader,
        sequence = EXCLUDED.sequence,
        client_last_telemetry_attempt_utc = EXCLUDED.client_last_telemetry_attempt_utc,
        client_last_successful_ingest_utc = EXCLUDED.client_last_successful_ingest_utc,
        client_last_ingest_http_status = EXCLUDED.client_last_ingest_http_status,
        diagnostic_code = EXCLUDED.diagnostic_code,
        updater_state = EXCLUDED.updater_state,
        updater_current_version = EXCLUDED.updater_current_version,
        updater_target_version = EXCLUDED.updater_target_version,
        last_update_result = EXCLUDED.last_update_result,
        last_update_utc = EXCLUDED.last_update_utc,
        client_reported_at_utc = EXCLUDED.client_reported_at_utc,
        received_at = EXCLUDED.received_at,
        updated_at = now();

    RETURN jsonb_build_object('result', 'accepted');
END;
$$;

-- ============================================================================
-- RPC: simhub_insert_diagnostic_event
-- SECURITY DEFINER, service-role-only.
-- Rate limit/dedupe: max 1 event met zelfde code per 10s/device.
-- Retention: max 100 events/device.
-- ============================================================================

CREATE OR REPLACE FUNCTION simhub_insert_diagnostic_event(
    p_token_hash text,
    p_event jsonb
) RETURNS jsonb
    SECURITY DEFINER
    LANGUAGE plpgsql AS $$
DECLARE
    v_device simhub_devices;
    v_detail text;
BEGIN
    -- Serialize all diagnostics mutations for one device. This makes the
    -- 10-second rate limit and the retention cap concurrency-safe without
    -- locking unrelated devices.
    SELECT * INTO v_device FROM simhub_devices
    WHERE token_hash = p_token_hash
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'invalid_device');
    END IF;
    IF v_device.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('result', 'invalid_device');
    END IF;

    -- Retention #1: remove expired events even if the new event is rate-limited.
    DELETE FROM simhub_device_diagnostic_events
    WHERE device_id = v_device.id
    AND received_at < now() - interval '7 days';

    -- Event rate limit (DB-authoritative): max 1 diagnostic event per 10s per device
    -- regardless of code. The locked device row prevents concurrent bypasses.
    IF EXISTS (
        SELECT 1 FROM simhub_device_diagnostic_events
        WHERE device_id = v_device.id
        AND received_at > now() - interval '10 seconds'
    ) THEN
        RETURN jsonb_build_object('result', 'diagnostic_event_rate_limited');
    END IF;

    v_detail := p_event->>'detail';
    IF v_detail IS NOT NULL AND length(v_detail) > 200 THEN
        v_detail := left(v_detail, 200);
    END IF;

    INSERT INTO simhub_device_diagnostic_events
        (device_id, code, exception_type, detail, reported_at_utc, received_at)
    VALUES (
        v_device.id,
        (p_event->>'code')::simhub_diagnostic_code,
        p_event->>'exceptionType',
        v_detail,
        (p_event->>'atUtc')::timestamptz,
        now()
    );

    -- Retention #2: rank after the accepted insert, so the newly accepted event
    -- is included in the deterministic newest-100 set.
    DELETE FROM simhub_device_diagnostic_events
    WHERE device_id = v_device.id
    AND id IN (
        SELECT id FROM (
            SELECT id, row_number() OVER (
                PARTITION BY device_id
                ORDER BY received_at DESC, id DESC
            ) AS rn
            FROM simhub_device_diagnostic_events
            WHERE device_id = v_device.id
        ) ranked
        WHERE ranked.rn > 100
    );

    RETURN jsonb_build_object('result', 'accepted');
END;
$$;