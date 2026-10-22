-- Overlay-snapshot v2: volgorde en relatie kloppend maken.
--
-- Vier correcties op 20261022130100:
--
-- 1. 'next' sloeg de dubbele stint niet over. Bij een double_stint (of twee
--    opeenvolgende stints van dezelfde coureur) toonde de overlay dezelfde
--    naam als 'volgende', alsof je jezelf aflost.
-- 2. 'order' bevatte ALLE stints van het event, inclusief afgeronde. De
--    ticker stond daardoor vanaf stint 4 voor de rest van de race bevroren
--    op de eerste vier namen. Nu alleen de komende wissels.
-- 3. 'isOverdue' was onbereikbaar: 'current' eiste eind > nu, terwijl
--    isOverdue nu > eind vereist. Een uitlopende stint viel weg uit current
--    in plaats van als 'loopt over' te verschijnen.
-- 4. De pace-aggregatie las driver_id en lap_time_from_deltas_s, maar de
--    live ingest (simhub_persist_v3) schrijft die kolommen niet. Daardoor was
--    pace altijd leeg en stonden de rondetijden permanent op '—'. Nu met
--    terugval op de payload die de ingest wél schrijft.
--
-- En nieuw: 'self' — wie je bent en wie je aflost. De overlay wist niet wie
-- 'jij' bent, dus kon niet zeggen 'jij neemt over van X'.

BEGIN;

CREATE OR REPLACE FUNCTION public.simhub_overlay_snapshot(
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_device public.simhub_devices%ROWTYPE;
  v_event_id uuid;
  v_team_id uuid;
  v_now timestamptz := clock_timestamp();
  v_revision text;
  v_result jsonb;
  v_current_stint uuid;
  v_current_driver uuid;
  v_owner_iracing text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('error', 'invalid_device');
  END IF;

  SELECT device.* INTO v_device
  FROM public.simhub_devices AS device
  WHERE device.token_hash = p_token_hash
    AND device.revoked_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'invalid_device');
  END IF;

  SELECT binding.event_id, binding.team_id
  INTO v_event_id, v_team_id
  FROM public.simhub_effective_endurance_binding(v_device.id) AS binding
  LIMIT 1;

  IF v_event_id IS NULL OR v_team_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_bound');
  END IF;

  SELECT profile_row.iracing_id INTO v_owner_iracing
  FROM public.profiles AS profile_row
  WHERE profile_row.user_id = v_device.owner_user_id
  LIMIT 1;

  SELECT md5(concat_ws('|',
    COALESCE((
      SELECT max(stint.updated_at)::text
      FROM public.endurance_stints AS stint
      WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id
    ), ''),
    COALESCE((
      SELECT event_row.updated_at::text
      FROM public.endurance_events AS event_row
      WHERE event_row.id = v_event_id
    ), ''),
    COALESCE((
      SELECT team.updated_at::text
      FROM public.endurance_teams AS team
      WHERE team.id = v_team_id
    ), '')
  )) INTO v_revision;

  -- De stint die nu loopt: niet-afgerond en het venster bevat nu, OF
  -- niet-afgerond en al over tijd (dan is hij 'loopt over', niet 'weg').
  SELECT ranked.id, ranked.driver_id
  INTO v_current_stint, v_current_driver
  FROM (
    SELECT
      stint.*,
      row_number() OVER (
        ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at), stint.id
      )::integer AS stint_index
    FROM public.endurance_stints AS stint
    WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id
  ) AS ranked
  WHERE ranked.status NOT IN ('completed', 'replaced', 'expired')
    AND COALESCE(ranked.actual_start_at, ranked.original_start_at) <= v_now
  ORDER BY COALESCE(ranked.actual_start_at, ranked.original_start_at) DESC
  LIMIT 1;

  WITH ranked AS (
    SELECT
      stint.*,
      row_number() OVER (
        ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at), stint.id
      )::integer AS stint_index
    FROM public.endurance_stints AS stint
    WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id
  ),
  -- Rondetijden: de ingest schrijft driver_id en lap_time_from_deltas_s niet,
  -- dus val terug op de payload die hij wél vult.
  pace AS (
    SELECT
      COALESCE(lap.driver_id, lap.payload->'identity'->>'currentDriverId') AS driver_id,
      count(*)::integer AS lap_count,
      min(COALESCE(
        lap.lap_time_from_deltas_s,
        (lap.payload->>'lastLapTimeSeconds')::numeric
      )) AS best_seconds,
      round(avg(COALESCE(
        lap.lap_time_from_deltas_s,
        (lap.payload->>'lastLapTimeSeconds')::numeric
      )), 3) AS average_seconds
    FROM public.endurance_telemetry_events AS lap
    WHERE lap.team_id = v_team_id
      AND lap.event_id = v_event_id
      AND lap.event_type = 'lap_completed'
      AND COALESCE(lap.driver_id, lap.payload->'identity'->>'currentDriverId') IS NOT NULL
      AND COALESCE(
        lap.lap_time_from_deltas_s,
        (lap.payload->>'lastLapTimeSeconds')::numeric
      ) > 0
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'contract', '3sm-overlay.v1',
    'serverTime', to_jsonb(v_now),
    'revision', v_revision,
    'event', (
      SELECT jsonb_build_object(
        'id', event_row.id,
        'name', event_row.name,
        'circuit', event_row.circuit,
        'configuration', event_row.configuration,
        'status', event_row.status,
        'startAt', event_row.start_at,
        'endAt', event_row.end_at,
        'expectedEndAt', event_row.expected_end_at
      )
      FROM public.endurance_events AS event_row
      WHERE event_row.id = v_event_id
    ),
    'team', (
      SELECT jsonb_build_object(
        'id', team.id,
        'name', team.name,
        'carNumber', team.car_number,
        'carId', team.car_id
      )
      FROM public.endurance_teams AS team
      WHERE team.id = v_team_id
    ),
    'self', jsonb_build_object(
      'userId', v_device.owner_user_id,
      'iracingId', v_owner_iracing,
      'isDriving', (v_current_driver IS NOT NULL AND v_current_driver = v_device.owner_user_id)
    ),
    'current', (
      SELECT jsonb_build_object(
        'stintId', stint.id,
        'driverId', stint.driver_id,
        'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
        'driverShort', NULLIF(upper(left(COALESCE(NULLIF(profile.iracing_name, ''), profile.display_name, '???'), 3)), '???'),
        'stintIndex', stint.stint_index,
        'startAt', COALESCE(stint.actual_start_at, stint.original_start_at),
        'endAt', COALESCE(stint.actual_end_at, stint.original_end_at),
        'status', stint.status,
        'isOverdue', v_now > COALESCE(stint.actual_end_at, stint.original_end_at),
        'isSelf', (stint.driver_id = v_device.owner_user_id),
        'tyreChange', stint.tyre_change,
        'doubleStint', stint.double_stint,
        'expectedLaps', stint.expected_laps,
        'minutesRemaining', round(extract(epoch FROM (
          COALESCE(stint.actual_end_at, stint.original_end_at) - v_now
        )) / 60.0),
        'laps', (SELECT pace.lap_count FROM pace WHERE pace.driver_id = profile.iracing_id LIMIT 1),
        'bestSeconds', (SELECT pace.best_seconds FROM pace WHERE pace.driver_id = profile.iracing_id LIMIT 1),
        'averageSeconds', (SELECT pace.average_seconds FROM pace WHERE pace.driver_id = profile.iracing_id LIMIT 1)
      )
      FROM ranked AS stint
      LEFT JOIN LATERAL (
        SELECT profile_row.iracing_name, profile_row.display_name, profile_row.iracing_id
        FROM public.profiles AS profile_row
        WHERE profile_row.user_id = stint.driver_id
        LIMIT 1
      ) AS profile ON true
      WHERE stint.id = v_current_stint
    ),
    -- De volgende stint waarin IEMAND ANDERS dan de huidige coureur rijdt.
    -- Zo toont de overlay wie je aflost, ook bij een double stint.
    'next', (
      SELECT jsonb_build_object(
        'stintId', stint.id,
        'driverId', stint.driver_id,
        'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
        'driverShort', NULLIF(upper(left(COALESCE(NULLIF(profile.iracing_name, ''), profile.display_name, '???'), 3)), '???'),
        'stintIndex', stint.stint_index,
        'startAt', COALESCE(stint.actual_start_at, stint.original_start_at),
        'endAt', COALESCE(stint.actual_end_at, stint.original_end_at),
        'minutesUntilStart', round(extract(epoch FROM (
          COALESCE(stint.actual_start_at, stint.original_start_at) - v_now
        )) / 60.0),
        'status', stint.status,
        'isSelf', (stint.driver_id = v_device.owner_user_id),
        'tyreChange', stint.tyre_change,
        'expectedLaps', stint.expected_laps,
        'laps', (SELECT pace.lap_count FROM pace WHERE pace.driver_id = profile.iracing_id LIMIT 1),
        'bestSeconds', (SELECT pace.best_seconds FROM pace WHERE pace.driver_id = profile.iracing_id LIMIT 1),
        'averageSeconds', (SELECT pace.average_seconds FROM pace WHERE pace.driver_id = profile.iracing_id LIMIT 1)
      )
      FROM ranked AS stint
      LEFT JOIN LATERAL (
        SELECT profile_row.iracing_name, profile_row.display_name, profile_row.iracing_id
        FROM public.profiles AS profile_row
        WHERE profile_row.user_id = stint.driver_id
        LIMIT 1
      ) AS profile ON true
      WHERE stint.status NOT IN ('completed', 'replaced', 'expired')
        AND COALESCE(stint.actual_start_at, stint.original_start_at) > v_now
        AND (v_current_driver IS NULL OR stint.driver_id IS DISTINCT FROM v_current_driver)
      ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at)
      LIMIT 1
    ),
    -- Alleen de komende wissels, niet de hele race vanaf stint 1.
    'order', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'stintIndex', stint.stint_index,
          'driverId', stint.driver_id,
          'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
          'driverShort', NULLIF(upper(left(COALESCE(NULLIF(profile.iracing_name, ''), profile.display_name, '???'), 3)), '???'),
          'startAt', COALESCE(stint.actual_start_at, stint.original_start_at),
          'endAt', COALESCE(stint.actual_end_at, stint.original_end_at),
          'status', stint.status,
          'isCurrent', (stint.id = v_current_stint),
          'isSelf', (stint.driver_id = v_device.owner_user_id),
          'tyreChange', stint.tyre_change,
          'expectedLaps', stint.expected_laps
        )
        ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at)
      )
      FROM (
        SELECT *
        FROM ranked AS r
        WHERE r.status NOT IN ('completed', 'replaced', 'expired')
          AND COALESCE(r.actual_start_at, r.original_start_at) > v_now
        ORDER BY COALESCE(r.actual_start_at, r.original_start_at)
        LIMIT 6
      ) AS stint
      LEFT JOIN LATERAL (
        SELECT profile_row.iracing_name, profile_row.display_name
        FROM public.profiles AS profile_row
        WHERE profile_row.user_id = stint.driver_id
        LIMIT 1
      ) AS profile ON true
    ), '[]'::jsonb),
    'race', (
      SELECT jsonb_build_object(
        'plannedStartAt', event_row.start_at,
        'plannedEndAt', event_row.end_at,
        'plannedDurationMinutes', round(extract(epoch FROM (event_row.end_at - event_row.start_at)) / 60.0)
      )
      FROM public.endurance_events AS event_row
      WHERE event_row.id = v_event_id
    ),
    'pace', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'driverId', pace.driver_id,
          'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
          'laps', pace.lap_count,
          'bestSeconds', pace.best_seconds,
          'averageSeconds', pace.average_seconds
        )
      )
      FROM pace
      LEFT JOIN public.profiles AS profile ON profile.iracing_id = pace.driver_id
    ), '[]'::jsonb),
    'warnings', (
      SELECT COALESCE(jsonb_agg(warning), '[]'::jsonb)
      FROM (
        SELECT 'plan_empty' AS warning
        WHERE NOT EXISTS (
          SELECT 1 FROM public.endurance_stints AS stint
          WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id
        )
        UNION ALL
        SELECT 'no_current_stint' AS warning
        WHERE v_current_stint IS NULL
          AND EXISTS (
            SELECT 1 FROM public.endurance_stints AS stint
            WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id
          )
        UNION ALL
        SELECT 'stint_overdue' AS warning
        WHERE EXISTS (
          SELECT 1 FROM public.endurance_stints AS stint
          WHERE stint.id = v_current_stint
            AND v_now > COALESCE(stint.actual_end_at, stint.original_end_at)
        )
      ) AS warnings
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.simhub_overlay_snapshot(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simhub_overlay_snapshot(text) TO service_role;

COMMIT;
