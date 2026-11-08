-- Fase 1 — één coherente pitwalllezing.
--
-- Waarom: op 2026-11-08 stond in de pitwall verse telemetrie (Ford Mustang, 8 november)
-- naast een strategie en tijdlijn van 25 oktober, uit twee verschillende oude runs.
-- De RPC koos telemetrie, strategie, tijdlijn en samples elk afzonderlijk op event/team
-- en niet op dezelfde race run, dus niets in de UI kon zien dat het om verschillende
-- races ging.
--
-- Wat dit doet: de run van het getoonde live-frame is leidend. Alleen bij een actieve,
-- verse run van dit team/event komen racegebonden blokken terug, en dan uitsluitend uit
-- die ene run. Is het event afgesloten en is er geen verse telemetrie meer, dan komen de
-- blokken uit de laatste run van dat event: dat is het archief (`context.view` =
-- 'history'), geen live race.
--
-- Anders blijven de blokken leeg en zegt `context.status` waarom (no_telemetry,
-- unlinked_telemetry, event_completed, inactive_run, stale_telemetry). De telemetrie
-- zelf blijft altijd zichtbaar; er wordt niets verzonnen en niets ouds getoond alsof
-- het actueel is.
--
-- Alleen-lezen: geen tabel, geen rij en geen andere functie verandert.

BEGIN;

-- Fase 1 — één coherente pitwalllezing.
-- Alle racegebonden blokken (strategie, tijdlijn, brandstof- en bandensamples,
-- opponenttrends, bandenmodel, pitverlies) komen uit dezelfde run als de
-- telemetrie die getoond wordt. Is daar geen geldige, actieve run voor, dan
-- blijft alleen de telemetrie staan en zegt `context` waarom.
-- Reden: op 2026-11-08 stond verse telemetrie naast een strategie en tijdlijn
-- van 25 oktober, uit twee verschillende oude runs. Niets in de UI kon dat zien.
CREATE OR REPLACE FUNCTION public.get_pitwall_data(p_event_id uuid, p_team_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
    v_user_id        uuid;
    v_is_staff       boolean;
    v_is_team_member boolean;
    v_team_name      text;
    v_team_car       text;
    v_team_car_num   text;
    v_race_run_id    uuid;
    v_live_run_id    uuid;
    v_live_received  timestamptz;
    v_event_status   text;
    v_status         text;
    v_view           text;
    v_trends         jsonb;
    v_pit_loss       jsonb;
    v_tyre           jsonb;
    v_result         jsonb;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- Beheer (super_admin, endurance_manager) OF lid van dit ene team.
    -- is_endurance_staff() zou hier ook tester toelaten, en die mocht met een
    -- gekozen p_team_id elk team lezen; dat is het lek dat dit dichtzet.
    v_is_staff := public.is_endurance_manager(v_user_id);
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

    SELECT e.status INTO v_event_status
    FROM public.endurance_events e WHERE e.id = p_event_id;

    -- Welke run hoort bij de telemetrie die we gaan tonen? Niet "de nieuwste
    -- strategie", maar de run waar het live-frame zelf bij hoort.
    SELECT stl.race_run_id, stl.received_at
    INTO v_live_run_id, v_live_received
    FROM public.simhub_telemetry_latest stl
    WHERE stl.endurance_team_id = p_team_id
      AND stl.endurance_event_id = p_event_id
    ORDER BY stl.received_at DESC
    LIMIT 1;

    IF v_live_received IS NULL THEN
        v_status := 'no_telemetry';
    ELSIF v_live_run_id IS NULL THEN
        v_status := 'unlinked_telemetry';
    ELSIF NOT EXISTS (
        SELECT 1 FROM public.endurance_race_runs r
        WHERE r.id = v_live_run_id
          AND r.event_id = p_event_id
          AND r.team_id = p_team_id
          AND r.run_kind = 'race'
          AND r.status = 'active'
    ) THEN
        v_status := CASE WHEN v_event_status = 'completed' THEN 'event_completed'
                         ELSE 'inactive_run' END;
    ELSIF v_live_received < now() - interval '5 minutes' THEN
        v_status := 'stale_telemetry';
    ELSE
        v_status := 'live';
    END IF;

    -- Welke run levert de racegebonden blokken?
    --   live     -> de run van het getoonde frame.
    --   archief  -> een afgesloten event zonder verse telemetrie: de laatste run
    --               van dat event. Zo blijft een oude race bekijkbaar.
    --   anders   -> niets. Dat is het geval van vanavond: verse telemetrie op een
    --               afgesloten event, waar een oude strategie naast stond.
    IF v_status = 'live' THEN
        v_race_run_id := v_live_run_id;
        v_view := 'live';
    ELSIF v_status = 'event_completed'
          AND (v_live_received IS NULL OR v_live_received < now() - interval '1 hour') THEN
        SELECT r.id INTO v_race_run_id
        FROM public.endurance_race_runs r
        WHERE r.event_id = p_event_id AND r.team_id = p_team_id AND r.run_kind = 'race'
        ORDER BY r.started_at DESC
        LIMIT 1;
        v_view := CASE WHEN v_race_run_id IS NULL THEN 'none' ELSE 'history' END;
    ELSE
        v_race_run_id := NULL;
        v_view := 'none';
    END IF;

    -- 0.4.3: server-side closing-rate map for this race run (bounded). Empty when none.
    v_trends := CASE WHEN v_race_run_id IS NULL THEN '{}'::jsonb
                     ELSE public.pitwall_opponent_trends_v1(v_race_run_id) END;

    IF v_race_run_id IS NULL THEN
        v_tyre := NULL;
        v_pit_loss := NULL;
    ELSE
        -- S2: anker + graad + bandbreedte. STABLE en SECURITY DEFINER, dus dit mag
        -- hier zonder extra rechten. Zonder anker (zoals 24-10) komt er graad D met
        -- state labels terug en blijft elk getal weg.
        v_tyre := public.pitwall_tyre_estimate_v1(p_event_id, p_team_id);

        -- Punt 9: gemeten pitlanetijd uit de vastgelegde stops. Null als er geen
        -- in_pit_lane-vlaggen waren; dan moet de pitwall zwijgen, niet gokken.
        v_pit_loss := public.pitwall_pit_loss_v1(p_event_id, p_team_id);
    END IF;

    -- Build result (unchanged CTEs + scenario trend key)
    WITH
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
    strategy AS (
        SELECT row_to_json(s.*)::jsonb AS data
        FROM public.endurance_strategy_latest s
        WHERE s.team_id = p_team_id AND s.event_id = p_event_id
          AND s.race_run_id = v_race_run_id
        ORDER BY s.updated_at DESC NULLS LAST
        LIMIT 1
    ),
    latest_events AS (
        SELECT e.*
        FROM public.endurance_telemetry_events e
        WHERE e.team_id = p_team_id AND e.event_id = p_event_id
          AND e.event_type <> 'sample'
          AND e.race_run_id = v_race_run_id
        ORDER BY e.captured_at DESC
        LIMIT 2000
    ),
    timeline AS (
        SELECT COALESCE(
            jsonb_agg(
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
                    'captured_at', e.captured_at
                ) ORDER BY e.captured_at DESC
            ), '[]'::jsonb
        ) AS events
        FROM latest_events e
    ),
    planned_stints AS (
        SELECT COALESCE(
            jsonb_agg(
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
            ), '[]'::jsonb
        ) AS stints
        FROM public.endurance_stints s
        WHERE s.team_id = p_team_id AND s.event_id = p_event_id
    ),
    tyre_samples AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'lap', s.completed_laps,
                    'lap_time', s.lap_time_seconds,
                    'fuel', s.fuel_end_litres,
                    'fl', s.wear_fl, 'fr', s.wear_fr,
                    'rl', s.wear_rl, 'rr', s.wear_rr,
                    'captured_at', s.captured_at
                ) ORDER BY s.completed_laps DESC
            ), '[]'::jsonb
        ) AS samples
        FROM (
            SELECT completed_laps, lap_time_seconds, fuel_end_litres,
                   wear_fl, wear_fr, wear_rl, wear_rr, captured_at
            FROM public.endurance_strategy_lap_samples
            WHERE event_id = p_event_id
              AND team_id = p_team_id
              AND race_run_id = v_race_run_id
              AND wear_fl IS NOT NULL
            ORDER BY completed_laps DESC
            LIMIT 20
        ) s
    ),
    fuel_samples AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'lap', f.completed_laps,
                    'used', f.fuel_used_litres,
                    'lap_time', f.lap_time_seconds,
                    'captured_at', f.captured_at
                ) ORDER BY f.completed_laps DESC
            ), '[]'::jsonb
        ) AS samples
        FROM (
            SELECT s.completed_laps, s.fuel_used_litres, s.lap_time_seconds, s.captured_at
            FROM public.endurance_strategy_lap_samples s
            WHERE s.event_id = p_event_id
              AND s.team_id = p_team_id
              AND s.race_run_id = v_race_run_id
              AND s.valid_fuel_sample
            ORDER BY s.completed_laps DESC
            LIMIT 20
        ) f
    ),
    pace_targets AS (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'user_id', pe.user_id,
                    'average_lap_seconds', pe.average_lap_seconds,
                    'best_lap_seconds', pe.best_lap_seconds,
                    'valid_laps', pe.valid_laps,
                    'source', pe.source
                )
            ), '[]'::jsonb
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
        -- Fase 1: expliciet waarom racegebonden blokken leeg zijn. De UI toont dit
        -- in plaats van een oude race; zonder dit veld is "leeg" niet te duiden.
        'context', jsonb_build_object(
            'status', v_status,
            'view', v_view,
            'race_run_id', v_race_run_id,
            'event_status', v_event_status,
            'telemetry_run_id', v_live_run_id,
            'telemetry_received_at', v_live_received
        ),
        'telemetry', (SELECT row_to_json(l.*)::jsonb FROM latest_v3 l),
        'v3_normalized', (SELECT l.v3_normalized FROM latest_v3 l),
        'strategy', COALESCE((SELECT data FROM strategy), 'null'::jsonb),
        'timeline', COALESCE((SELECT events FROM timeline), '[]'::jsonb),
        'planned_stints', COALESCE((SELECT stints FROM planned_stints), '[]'::jsonb),
        'pace_targets', COALESCE((SELECT targets FROM pace_targets), '[]'::jsonb),
        'opponent_trends', COALESCE(v_trends, '{}'::jsonb),
        'fuel_samples', COALESCE((SELECT samples FROM fuel_samples), '[]'::jsonb),
        -- tyre_samples is verouderd: een reeks, terwijl elke waarde in
        -- werkelijkheid een state label van een blok is. De vorm blijft staan
        -- zodat de huidige UI niets merkt; vervangen gebeurt in de UI-laag.
        'tyre_samples', COALESCE((SELECT samples FROM tyre_samples), '[]'::jsonb),
        'tyre_estimate', COALESCE(v_tyre, 'null'::jsonb),
        'pit_loss', COALESCE(v_pit_loss, 'null'::jsonb),
        'pit_lane_seconds', (v_pit_loss->>'pitLaneSeconds')::numeric,
        'access', CASE WHEN v_is_staff THEN 'staff' ELSE 'team_member' END
    ) INTO v_result;

    RETURN v_result;
END;
$function$;

COMMIT;
