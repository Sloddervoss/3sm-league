-- Compacte momentopname voor de endurance-overlay.
-- Auth: service_role only (de Edge-route doet de tokencontrole).
-- Geeft nooit een token terug en leest geen payloads.
--
-- Let op: endurance_stints heeft geen stint_index-kolom. De volgorde wordt
-- daarom server-side bepaald met row_number() op de geplande/werkelijke start.
-- stint.driver_id is een auth-user-id (endurance_team_members.user_id); de
-- naam komt uit profiles.user_id. Telemetry-laprijen gebruiken het iRacing-id,
-- dat via profiles.iracing_id aan een naam wordt gekoppeld.

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

  WITH ranked AS (
    SELECT
      stint.*,
      row_number() OVER (
        ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at), stint.id
      )::integer AS stint_index
    FROM public.endurance_stints AS stint
    WHERE stint.team_id = v_team_id AND stint.event_id = v_event_id
  ),
  pace AS (
    SELECT
      lap.driver_id,
      count(*)::integer AS lap_count,
      min(lap.lap_time_from_deltas_s) AS best_seconds,
      round(avg(lap.lap_time_from_deltas_s), 3) AS average_seconds
    FROM public.endurance_telemetry_events AS lap
    WHERE lap.team_id = v_team_id
      AND lap.event_id = v_event_id
      AND lap.event_type = 'lap_completed'
      AND lap.driver_id IS NOT NULL
      AND lap.lap_time_from_deltas_s IS NOT NULL
      AND lap.lap_time_from_deltas_s > 0
    GROUP BY lap.driver_id
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
    'current', (
      SELECT jsonb_build_object(
        'stintId', stint.id,
        'driverId', stint.driver_id,
        'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
        'stintIndex', stint.stint_index,
        'startAt', COALESCE(stint.actual_start_at, stint.original_start_at),
        'endAt', COALESCE(stint.actual_end_at, stint.original_end_at),
        'status', stint.status,
        'isOverdue', v_now > COALESCE(stint.actual_end_at, stint.original_end_at)
                     AND stint.status NOT IN ('completed', 'replaced', 'expired'),
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
        AND COALESCE(stint.actual_start_at, stint.original_start_at) <= v_now
        AND COALESCE(stint.actual_end_at, stint.original_end_at) > v_now
      ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at)
      LIMIT 1
    ),
    'next', (
      SELECT jsonb_build_object(
        'stintId', stint.id,
        'driverId', stint.driver_id,
        'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
        'stintIndex', stint.stint_index,
        'startAt', COALESCE(stint.actual_start_at, stint.original_start_at),
        'endAt', COALESCE(stint.actual_end_at, stint.original_end_at),
        'minutesUntilStart', round(extract(epoch FROM (
          COALESCE(stint.actual_start_at, stint.original_start_at) - v_now
        )) / 60.0),
        'status', stint.status,
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
      ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at)
      LIMIT 1
    ),
    'order', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'stintIndex', stint.stint_index,
          'driverId', stint.driver_id,
          'driverName', COALESCE(NULLIF(profile.iracing_name, ''), NULLIF(profile.display_name, ''), 'Coureur'),
          'startAt', COALESCE(stint.actual_start_at, stint.original_start_at),
          'endAt', COALESCE(stint.actual_end_at, stint.original_end_at),
          'status', stint.status,
          'tyreChange', stint.tyre_change,
          'expectedLaps', stint.expected_laps
        )
        ORDER BY COALESCE(stint.actual_start_at, stint.original_start_at)
      )
      FROM ranked AS stint
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
        ORDER BY pace.average_seconds
      )
      FROM pace
      LEFT JOIN LATERAL (
        SELECT profile_row.iracing_name, profile_row.display_name
        FROM public.profiles AS profile_row
        WHERE profile_row.iracing_id = pace.driver_id
           OR profile_row.user_id::text = pace.driver_id
        ORDER BY (profile_row.iracing_id = pace.driver_id) DESC
        LIMIT 1
      ) AS profile ON true
    ), '[]'::jsonb),
    'warnings', COALESCE((
      SELECT jsonb_agg(warning.code)
      FROM (
        SELECT 'plan_empty' AS code
        WHERE NOT EXISTS (SELECT 1 FROM ranked)
        UNION ALL
        SELECT 'no_current_stint' AS code
        WHERE EXISTS (SELECT 1 FROM ranked)
          AND NOT EXISTS (
            SELECT 1 FROM ranked AS stint
            WHERE stint.status NOT IN ('completed', 'replaced', 'expired')
              AND COALESCE(stint.actual_start_at, stint.original_start_at) <= v_now
              AND COALESCE(stint.actual_end_at, stint.original_end_at) > v_now
          )
      ) AS warning
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.simhub_overlay_snapshot(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_overlay_snapshot(text) TO service_role;

-- De overlay leest per poll de stints van één team/event en de leden van één
-- gebruiker. Beide indexen voorkomen een sequential scan tijdens een race.
CREATE INDEX IF NOT EXISTS endurance_stints_team_event_start_idx
  ON public.endurance_stints (team_id, event_id, original_start_at);

CREATE INDEX IF NOT EXISTS endurance_team_members_user_idx
  ON public.endurance_team_members (user_id);
