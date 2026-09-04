-- ============================================================================
-- SimHub Admin Read RPCs v1 — get_simhub_fleet + get_simhub_device_details
-- Datum: 2026-09-04 | Branch: feat/simhub-admin-diagnostics
--
-- Staff-gated read model voor de Diagnostics/Admin UI.
-- Beveiligd via can_manage_simhub() in SECURITY DEFINER context.
-- ============================================================================

-- ============================================================================
-- RPC: get_simhub_fleet()
-- Returns bounded fleet overview rows for admin diagnostics.
-- Joined from simhub_devices + simhub_device_health + simhub_telemetry_latest.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_simhub_fleet()
RETURNS TABLE (
    device_id               uuid,
    device_name             text,
    device_status           text,
    device_role             text,
    revoked_at              timestamptz,
    last_seen_at            timestamptz,
    endurance_event_id      uuid,
    endurance_team_id       uuid,
    endurance_binding_source text,
    endurance_event_name    text,
    endurance_team_name     text,
    connector_version       text,
    simhub_version          text,
    game_connected          boolean,
    telemetry_available     boolean,
    diagnostic_code         simhub_diagnostic_code,
    health_received_at      timestamptz,
    updater_state           text,
    updater_current_version text,
    updater_target_version  text,
    last_update_result      text,
    last_update_utc         timestamptz,
    telemetry_received_at   timestamptz,
    telemetry_game          text,
    telemetry_car_name      text,
    telemetry_track_name    text,
    telemetry_driver_name   text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
    IF NOT public.can_manage_simhub() THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        d.id,
        d.device_name,
        d.device_status,
        d.device_role,
        d.revoked_at,
        d.last_seen_at,
        d.endurance_event_id,
        d.endurance_team_id,
        d.endurance_binding_source,
        ev.name,
        et.name,
        h.connector_version,
        h.simhub_version,
        h.game_connected,
        h.telemetry_available,
        h.diagnostic_code,
        h.received_at,
        h.updater_state,
        h.updater_current_version,
        h.updater_target_version,
        h.last_update_result,
        h.last_update_utc,
        t.received_at,
        t.game::text,
        t.car_name,
        t.track_name,
        t.current_driver_name
    FROM public.simhub_devices d
    LEFT JOIN public.simhub_device_health h ON h.device_id = d.id
    LEFT JOIN public.simhub_telemetry_latest t ON t.device_id = d.id
    LEFT JOIN public.endurance_events ev ON ev.id = d.endurance_event_id
    LEFT JOIN public.endurance_teams et ON et.id = d.endurance_team_id
    WHERE d.revoked_at IS NULL
    ORDER BY
        CASE WHEN h.received_at IS NOT NULL AND h.received_at > now() - interval '5 minutes'
            THEN 0 ELSE 1 END,
        d.device_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_simhub_fleet() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_simhub_fleet() TO authenticated;

-- ============================================================================
-- RPC: get_simhub_device_details(p_device_id uuid)
-- Returns complete read-only detail for one device.
-- Includes: identity, health, telemetry, binding, diagnostic events.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_simhub_device_details(p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
    v_result jsonb;
BEGIN
    IF NOT public.can_manage_simhub() THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    WITH device_info AS (
        SELECT
            d.id,
            d.device_name,
            d.device_status,
            d.device_role,
            d.revoked_at,
            d.last_seen_at,
            d.last_session_id,
            d.last_sequence,
            d.endurance_event_id,
            d.endurance_team_id,
            d.endurance_binding_source,
            d.paired_at
        FROM public.simhub_devices d
        WHERE d.id = p_device_id
    ),
    health_info AS (
        SELECT row_to_json(h.*)::jsonb AS data
        FROM public.simhub_device_health h
        WHERE h.device_id = p_device_id
    ),
    telemetry_info AS (
        SELECT row_to_json(t.*)::jsonb AS data
        FROM public.simhub_telemetry_latest t
        WHERE t.device_id = p_device_id
    ),
    event_info AS (
        SELECT row_to_json(e.*)::jsonb AS data
        FROM public.endurance_events e
        WHERE e.id = (SELECT d.endurance_event_id FROM device_info d)
    ),
    team_info AS (
        SELECT row_to_json(t.*)::jsonb AS data
        FROM public.endurance_teams t
        WHERE t.id = (SELECT d.endurance_team_id FROM device_info d)
    ),
    diagnostic_events AS (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', e.id,
                'code', e.code,
                'exception_type', e.exception_type,
                'detail', e.detail,
                'reported_at_utc', e.reported_at_utc,
                'received_at', e.received_at
            ) ORDER BY e.received_at DESC
        ) AS events
        FROM (
            SELECT *
            FROM public.simhub_device_diagnostic_events
            WHERE device_id = p_device_id
            ORDER BY received_at DESC
            LIMIT 20
        ) e
    )
    SELECT jsonb_build_object(
        'device', row_to_json(d.*)::jsonb,
        'health', COALESCE((SELECT data FROM health_info), 'null'::jsonb),
        'telemetry', COALESCE((SELECT data FROM telemetry_info), 'null'::jsonb),
        'endurance_event', COALESCE((SELECT data FROM event_info), 'null'::jsonb),
        'endurance_team', COALESCE((SELECT data FROM team_info), 'null'::jsonb),
        'diagnostic_events', COALESCE((SELECT events FROM diagnostic_events), '[]'::jsonb)
    ) INTO v_result
    FROM device_info d;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_simhub_device_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_simhub_device_details(uuid) TO authenticated;