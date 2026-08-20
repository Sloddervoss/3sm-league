-- Datum-bewuste device->eindurance-koppeling: ingest routeert naar het event
-- dat nu actief is of het eerst komt waarvan de rijder teamlid is. Handmatige
-- Apparaten-tab (binding_source='manual') blijft de default overrulen.
BEGIN;
ALTER TABLE public.endurance_practice_laps
  ADD COLUMN source_session_id text,
  ADD COLUMN source_device_id uuid REFERENCES public.simhub_devices(id) ON DELETE SET NULL,
  ADD COLUMN completed_laps integer,
  ADD CONSTRAINT endurance_practice_laps_completed_laps_check CHECK (completed_laps IS NULL OR completed_laps >= 0);
CREATE UNIQUE INDEX endurance_practice_laps_source_identity_uidx
  ON public.endurance_practice_laps (event_id, source_session_id, source_device_id, completed_laps)
  WHERE source_session_id IS NOT NULL AND source_device_id IS NOT NULL AND completed_laps IS NOT NULL;

CREATE OR REPLACE FUNCTION public.simhub_ingest_snapshot(p_token_hash text, p_session_id text, p_sequence bigint, p_captured_at timestamp with time zone, p_connector_id text, p_simhub_version text, p_game text, p_telemetry jsonb, p_driver_id text DEFAULT NULL::text, p_current_driver_id text DEFAULT NULL::text, p_current_driver_name text DEFAULT NULL::text, p_car_id text DEFAULT NULL::text, p_car_name text DEFAULT NULL::text, p_track_name text DEFAULT NULL::text, p_track_config text DEFAULT NULL::text)
 RETURNS TABLE(result text, received_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_device public.simhub_devices%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_device_found BOOLEAN;
  v_session_sequence BIGINT;
  v_session_found BOOLEAN;
  v_session_count INTEGER;
  v_registered BOOLEAN;
  v_practice_session public.endurance_practice_sessions%ROWTYPE;
  v_lap_time NUMERIC;
  v_completed_laps INTEGER;
  v_eff_event UUID;
  v_eff_team UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR char_length(trim(COALESCE(p_session_id, ''))) NOT BETWEEN 1 AND 120
     OR p_sequence IS NULL OR p_sequence < 0
     OR p_captured_at IS NULL
     OR p_captured_at < v_now - interval '1 hour'
     OR p_captured_at > v_now + interval '5 minutes'
     OR char_length(trim(COALESCE(p_connector_id, ''))) NOT BETWEEN 1 AND 120
     OR char_length(trim(COALESCE(p_simhub_version, ''))) NOT BETWEEN 1 AND 60
     OR p_game IS DISTINCT FROM 'IRacing'
     OR p_telemetry IS NULL
     OR jsonb_typeof(p_telemetry) <> 'object' THEN
    RETURN QUERY SELECT 'invalid_payload'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT device.*
  INTO v_device
  FROM public.simhub_devices AS device
  WHERE device.token_hash = p_token_hash
  FOR UPDATE;

  v_device_found := FOUND;

  -- Effectieve endurance-binding, datum-bewust: handmatig (Apparaten-tab) is
  -- leidend; anders volgt het device het event dat nu actief is of het eerst
  -- komt, waarvan de rijder teamlid is.
  IF v_device.endurance_binding_source = 'manual' AND v_device.endurance_event_id IS NOT NULL THEN
    v_eff_event := v_device.endurance_event_id;
    v_eff_team := v_device.endurance_team_id;
  ELSE
    SELECT t.event_id, tm.team_id
      INTO v_eff_event, v_eff_team
      FROM public.endurance_team_members AS tm
      JOIN public.endurance_teams AS t ON t.id = tm.team_id
      JOIN public.endurance_events AS e ON e.id = t.event_id
     WHERE tm.user_id = v_device.owner_user_id
       AND e.end_at > v_now
     ORDER BY (e.start_at <= v_now AND e.end_at >= v_now) DESC, e.start_at ASC
     LIMIT 1;
  END IF;


  IF NOT v_device_found OR v_device.revoked_at IS NOT NULL
     OR NOT (
       (v_device.race_id IS NULL AND v_device.team_id IS NULL AND v_device.expires_at IS NULL AND v_eff_event IS NULL AND v_eff_team IS NULL)
       OR (
         v_device.race_id IS NOT NULL AND v_device.team_id IS NOT NULL
         AND v_device.expires_at > v_now
         AND EXISTS (
           SELECT 1 FROM public.races AS race
           WHERE race.id = v_device.race_id
             AND race.status IN ('upcoming', 'live')
             AND race.race_date > v_now - interval '36 hours'
         )
       )
       OR (
         v_eff_event IS NOT NULL AND v_eff_team IS NOT NULL
       )
     )
     OR NOT public.is_endurance_staff(v_device.owner_user_id) THEN
    IF v_device_found THEN
      UPDATE public.simhub_devices
      SET revoked_at = COALESCE(revoked_at, v_now), updated_at = v_now
      WHERE id = v_device.id;
      DELETE FROM public.simhub_telemetry_latest WHERE device_id = v_device.id;
      DELETE FROM public.simhub_device_sessions WHERE device_id = v_device.id;
    END IF;
    RETURN QUERY SELECT 'invalid_device'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Endurance-gate: een endurance-gebonden device mag pas telemetry leveren als
  -- de eigenaar (de coureur) ingeschreven is voor het event.
  IF v_eff_event IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.endurance_registrations AS reg
      WHERE reg.event_id = v_eff_event
        AND reg.user_id = v_device.owner_user_id
        AND reg.status NOT IN ('rejected', 'withdrawn')
    ) INTO v_registered;

    IF NOT v_registered THEN
      RETURN QUERY SELECT 'not_registered'::TEXT, v_now;
      RETURN;
    END IF;

  END IF;

  IF v_device.last_seen_at IS NOT NULL
     AND v_device.last_seen_at > v_now - interval '400 milliseconds' THEN
    RETURN QUERY SELECT 'rate_limited'::TEXT, v_now;
    RETURN;
  END IF;

  SELECT session.last_sequence
  INTO v_session_sequence
  FROM public.simhub_device_sessions AS session
  WHERE session.device_id = v_device.id AND session.session_id = p_session_id
  FOR UPDATE;
  v_session_found := FOUND;

  IF NOT v_session_found THEN
    SELECT count(*)::INTEGER INTO v_session_count
    FROM public.simhub_device_sessions AS session
    WHERE session.device_id = v_device.id;
    IF v_session_count >= 64 THEN
      RETURN QUERY SELECT 'session_limit'::TEXT, v_now;
      RETURN;
    END IF;
  END IF;

  IF NOT v_session_found
     AND v_device.last_session_id IS NOT NULL
     AND (v_device.last_seen_at > v_now - interval '5 seconds' OR p_sequence > 5) THEN
    RETURN QUERY SELECT 'replayed'::TEXT, v_now;
    RETURN;
  END IF;

  IF v_session_found AND p_sequence <= v_session_sequence THEN
    RETURN QUERY SELECT 'replayed'::TEXT, v_now;
    RETURN;
  END IF;


  -- Persist each completed lap once, after replay/sequence validation.
  IF v_eff_event IS NOT NULL THEN
    SELECT session.* INTO v_practice_session
    FROM public.endurance_practice_sessions AS session
    WHERE session.event_id = v_eff_event AND session.ended_at IS NULL
    ORDER BY session.started_at DESC
    LIMIT 1;

    IF FOUND THEN
      BEGIN
        v_lap_time := (p_telemetry->>'lapTimeSeconds')::NUMERIC;
        v_completed_laps := (p_telemetry->>'completedLaps')::INTEGER;
      EXCEPTION WHEN OTHERS THEN
        v_lap_time := NULL;
        v_completed_laps := NULL;
      END;

      IF v_lap_time IS NOT NULL AND v_lap_time > 0 AND v_lap_time <= 3600
         AND v_completed_laps IS NOT NULL AND v_completed_laps > 0 THEN
        INSERT INTO public.endurance_practice_laps (
          session_id, event_id, user_id, car_id, circuit,
          lap_seconds, fuel_used_litres, fuel_per_lap_litres,
          incident_count, recorded_at,
          source_session_id, source_device_id, completed_laps
        ) VALUES (
          v_practice_session.id, v_eff_event, v_device.owner_user_id,
          NULLIF(trim(COALESCE(p_car_id, '')), ''), NULLIF(trim(COALESCE(p_track_name, '')), ''),
          v_lap_time,
          NULLIF((p_telemetry->>'fuelPerLapLitres')::TEXT, '')::NUMERIC,
          NULLIF((p_telemetry->>'fuelPerLapLitres')::TEXT, '')::NUMERIC,
          COALESCE(NULLIF((p_telemetry->>'incidents')::TEXT, '')::INTEGER, 0),
          p_captured_at, trim(p_session_id), v_device.id, v_completed_laps
        )
        ON CONFLICT (event_id, source_session_id, source_device_id, completed_laps)
          WHERE source_session_id IS NOT NULL AND source_device_id IS NOT NULL AND completed_laps IS NOT NULL
        DO NOTHING;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.simhub_device_sessions (device_id, session_id, last_sequence, first_seen_at, last_seen_at)
  VALUES (v_device.id, p_session_id, p_sequence, v_now, v_now)
  ON CONFLICT (device_id, session_id) DO UPDATE
  SET last_sequence = EXCLUDED.last_sequence, last_seen_at = EXCLUDED.last_seen_at;

  UPDATE public.simhub_devices AS device
  SET last_seen_at = v_now,
      last_session_id = p_session_id,
      last_sequence = p_sequence,
      connector_id = trim(p_connector_id),
      updated_at = v_now
  WHERE device.id = v_device.id;

  INSERT INTO public.simhub_telemetry_latest (
    device_id, owner_user_id, race_id, team_id, endurance_event_id, endurance_team_id,
    session_id, sequence, captured_at, received_at, connector_id, simhub_version, game,
    driver_id, current_driver_id, current_driver_name, car_id, car_name, track_name, track_config,
    telemetry
  ) VALUES (
    v_device.id, v_device.owner_user_id, v_device.race_id, v_device.team_id,
    v_eff_event, v_eff_team,
    trim(p_session_id), p_sequence, p_captured_at, v_now, trim(p_connector_id), trim(p_simhub_version), p_game,
    NULLIF(trim(COALESCE(p_driver_id, '')), ''), NULLIF(trim(COALESCE(p_current_driver_id, '')), ''),
    NULLIF(trim(COALESCE(p_current_driver_name, '')), ''), NULLIF(trim(COALESCE(p_car_id, '')), ''),
    NULLIF(trim(COALESCE(p_car_name, '')), ''), NULLIF(trim(COALESCE(p_track_name, '')), ''),
    NULLIF(trim(COALESCE(p_track_config, '')), ''),
    p_telemetry
  )
  ON CONFLICT (device_id) DO UPDATE
  SET owner_user_id = EXCLUDED.owner_user_id,
      race_id = EXCLUDED.race_id,
      team_id = EXCLUDED.team_id,
      endurance_event_id = EXCLUDED.endurance_event_id,
      endurance_team_id = EXCLUDED.endurance_team_id,
      session_id = EXCLUDED.session_id,
      sequence = EXCLUDED.sequence,
      captured_at = EXCLUDED.captured_at,
      received_at = EXCLUDED.received_at,
      connector_id = EXCLUDED.connector_id,
      simhub_version = EXCLUDED.simhub_version,
      game = EXCLUDED.game,
      driver_id = EXCLUDED.driver_id,
      current_driver_id = EXCLUDED.current_driver_id,
      current_driver_name = EXCLUDED.current_driver_name,
      car_id = EXCLUDED.car_id,
      car_name = EXCLUDED.car_name,
      track_name = EXCLUDED.track_name,
      track_config = EXCLUDED.track_config,
      telemetry = EXCLUDED.telemetry;

  RETURN QUERY SELECT 'accepted'::TEXT, v_now;
END;
$function$;

REVOKE ALL ON FUNCTION public.simhub_ingest_snapshot(TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_ingest_snapshot(TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
COMMIT;

