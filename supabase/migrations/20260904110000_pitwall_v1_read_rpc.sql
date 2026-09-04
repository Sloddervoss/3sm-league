-- ============================================================================
-- Pitwall V1 read model — get_pitwall_data
-- Datum: 2026-09-04 | Branch: feat/simhub-admin-diagnostics
--
-- Returns a complete read-only snapshot of Pitwall data for one team in an event.
-- Gated via endurance_team_members (own-team) or is_endurance_staff (all teams).
-- No tokens/secrets exposed. Read-only. Bounded.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_pitwall_data(
    p_event_id uuid,
    p_team_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
    v_user_id        uuid;
    v_is_staff       boolean;
    v_is_team_member boolean;
    v_team_name      text;
    v_team_car       text;
    v_team_car_num   text;
    v_result         jsonb;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Check access: staff (super_admin/endurance_manager/tester) OR team member
    v_is_staff := public.is_endurance_staff(v_user_id);
    v_is_team_member := EXISTS (
        SELECT 1 FROM public.endurance_team_members etm
        WHERE etm.team_id = p_team_id AND etm.user_id = v_user_id
    );

    IF NOT v_is_staff AND NOT v_is_team_member THEN
        RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;

    -- Team info
    SELECT t.name, t.car_id, t.car_number
    INTO v_team_name, v_team_car, v_team_car_num
    FROM public.endurance_teams t
    WHERE t.id = p_team_id AND t.event_id = p_event_id;

    -- Build result
    WITH
    -- Latest V3 telemetry for this team's devices
    latest_v3 AS (
        SELECT
            stl.telemetry,
            stl.v3_normalized,
            stl.current_driver_id,
            stl.current_driver_name,
            stl.car_id,
            stl.car_name,
            stl.track_name,
            stl.track_config,
            stl.driver_id,
            stl.received_at,
            stl.race_run_id
        FROM public.simhub_telemetry_latest stl
        WHERE stl.endurance_team_id = p_team_id
          AND stl.endurance_event_id = p_event_id
        ORDER BY stl.received_at DESC
        LIMIT 1
    ),
    -- Current strategy
    strategy AS (
        SELECT row_to_json(s.*)::jsonb AS data
        FROM public.endurance_strategy_latest s
        WHERE s.team_id = p_team_id AND s.event_id = p_event_id
        LIMIT 1
    ),
    -- Recent telemetry events (timeline)
    timeline AS (
        SELECT jsonb_agg(
            jsonb_build_object(
                'event_type', e.event_type,
                'event_key', e.event_key,
                'lap', e.lap,
                'completed_laps', e.completed_laps,
                'fuel_litres', e.fuel_litres,
                'fuel_per_lap_litres', e.fuel_per_lap_litres,
                'fuel_added_est_litres', e.fuel_added_est_litres,
                'laps_remaining_est', e.laps_remaining_est,
                'driver_id', e.driver_id,
                'in_pit_lane', e.in_pit_lane,
                'incidents', e.incidents,
                'flag', e.flag,
                'stint_elapsed_s', e.stint_elapsed_s,
                'session_time_s', e.session_time_s,
                'lap_time_from_deltas_s', e.lap_time_from_deltas_s,
                'captured_at', e.captured_at,
                'payload', e.payload
            ) ORDER BY e.captured_at DESC
        ) AS events
        FROM public.endurance_telemetry_events e
        WHERE e.team_id = p_team_id AND e.event_id = p_event_id
    ),
    -- Planned stints from StintPlanner
    planned_stints AS (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', s.id,
                'driver_id', s.driver_id,
                'original_start_at', s.original_start_at,
                'original_end_at', s.original_end_at,
                'actual_start_at', s.actual_start_at,
                'actual_end_at', s.actual_end_at,
                'expected_laps', s.expected_laps,
                'fuel_litres', s.fuel_litres,
                'tyre_change', s.tyre_change,
                'double_stint', s.double_stint,
                'status', s.status,
                'notes', s.notes
            ) ORDER BY s.original_start_at
        ) AS stints
        FROM public.endurance_stints s
        WHERE s.team_id = p_team_id AND s.event_id = p_event_id
        ORDER BY s.original_start_at
        LIMIT 50
    ),
    -- Pace targets from PacePanel
    pace_targets AS (
        SELECT jsonb_agg(
            jsonb_build_object(
                'user_id', pe.user_id,
                'average_lap_seconds', pe.average_lap_seconds,
                'best_lap_seconds', pe.best_lap_seconds,
                'valid_laps', pe.valid_laps,
                'source', pe.source
            )
        ) AS targets
        FROM public.endurance_pace_entries pe
        WHERE pe.event_id = p_event_id
    )
    SELECT jsonb_build_object(
        'team', jsonb_build_object(
            'id', p_team_id,
            'name', v_team_name,
            'car_id', v_team_car,
            'car_number', v_team_car_num
        ),
        'telemetry', (SELECT row_to_json(l.*)::jsonb FROM latest_v3 l),
        'v3_normalized', (SELECT l.v3_normalized FROM latest_v3 l),
        'strategy', COALESCE((SELECT data FROM strategy), 'null'::jsonb),
        'timeline', COALESCE((SELECT events FROM timeline), '[]'::jsonb),
        'planned_stints', COALESCE((SELECT stints FROM planned_stints), '[]'::jsonb),
        'pace_targets', COALESCE((SELECT targets FROM pace_targets), '[]'::jsonb),
        'access', CASE WHEN v_is_staff THEN 'staff' ELSE 'team_member' END
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pitwall_data(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pitwall_data(uuid, uuid) TO authenticated;

-- ============================================================================
-- Rollback: DROP FUNCTION public.get_pitwall_data(uuid, uuid);
-- ============================================================================