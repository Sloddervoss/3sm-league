-- Endurance runtime capabilities: alpha-safe defaults with a member-open path.
-- Additive successor to the existing SimHub device/pairing/token architecture.
BEGIN;

CREATE TABLE IF NOT EXISTS public.endurance_runtime_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  member_access_enabled BOOLEAN NOT NULL DEFAULT false,
  member_pairing_enabled BOOLEAN NOT NULL DEFAULT false,
  member_ingest_enabled BOOLEAN NOT NULL DEFAULT false,
  multi_user_realtime_enabled BOOLEAN NOT NULL DEFAULT false,
  simhub_ingest_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.endurance_runtime_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.endurance_runtime_settings FROM PUBLIC, anon, authenticated;

INSERT INTO public.endurance_runtime_settings (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.endurance_capabilities_for_user(_user_id UUID)
RETURNS TABLE (
  can_access BOOLEAN,
  can_pair_own_device BOOLEAN,
  can_ingest_own_device BOOLEAN,
  can_manage_events BOOLEAN,
  can_manage_devices BOOLEAN,
  multi_user_realtime_enabled BOOLEAN,
  simhub_ingest_enabled BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staff BOOLEAN := false;
  v_manager BOOLEAN := false;
  v_member_access BOOLEAN := false;
  v_member_pairing BOOLEAN := false;
  v_member_ingest BOOLEAN := false;
  v_realtime BOOLEAN := false;
  v_ingest BOOLEAN := true;
BEGIN
  IF _user_id IS NULL THEN
    RETURN QUERY SELECT false, false, false, false, false, false, false;
    RETURN;
  END IF;

  v_staff := public.is_endurance_staff(_user_id);
  v_manager := public.is_endurance_manager(_user_id);

  SELECT
    settings.member_access_enabled,
    settings.member_pairing_enabled,
    settings.member_ingest_enabled,
    settings.multi_user_realtime_enabled,
    settings.simhub_ingest_enabled
  INTO
    v_member_access,
    v_member_pairing,
    v_member_ingest,
    v_realtime,
    v_ingest
  FROM public.endurance_runtime_settings AS settings
  WHERE settings.singleton = true;

  -- Missing settings row is deliberately alpha-safe.
  v_member_access := COALESCE(v_member_access, false);
  v_member_pairing := COALESCE(v_member_pairing, false);
  v_member_ingest := COALESCE(v_member_ingest, false);
  v_realtime := COALESCE(v_realtime, false);
  v_ingest := COALESCE(v_ingest, true);

  RETURN QUERY SELECT
    (v_staff OR v_member_access),
    (v_staff OR v_member_pairing),
    (v_ingest AND (v_staff OR v_member_ingest)),
    v_manager,
    v_manager,
    (v_realtime AND (v_staff OR v_member_access)),
    v_ingest;
END;
$$;

CREATE OR REPLACE FUNCTION public.endurance_current_capabilities()
RETURNS TABLE (
  can_access BOOLEAN,
  can_pair_own_device BOOLEAN,
  can_ingest_own_device BOOLEAN,
  can_manage_events BOOLEAN,
  can_manage_devices BOOLEAN,
  multi_user_realtime_enabled BOOLEAN,
  simhub_ingest_enabled BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.endurance_capabilities_for_user(v_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.endurance_set_runtime_settings(
  p_member_access_enabled BOOLEAN DEFAULT NULL,
  p_member_pairing_enabled BOOLEAN DEFAULT NULL,
  p_member_ingest_enabled BOOLEAN DEFAULT NULL,
  p_multi_user_realtime_enabled BOOLEAN DEFAULT NULL,
  p_simhub_ingest_enabled BOOLEAN DEFAULT NULL
)
RETURNS public.endurance_runtime_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result public.endurance_runtime_settings;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Super-admin required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.endurance_runtime_settings (
    singleton,
    member_access_enabled,
    member_pairing_enabled,
    member_ingest_enabled,
    multi_user_realtime_enabled,
    simhub_ingest_enabled,
    updated_at,
    updated_by
  ) VALUES (
    true,
    COALESCE(p_member_access_enabled, false),
    COALESCE(p_member_pairing_enabled, false),
    COALESCE(p_member_ingest_enabled, false),
    COALESCE(p_multi_user_realtime_enabled, false),
    COALESCE(p_simhub_ingest_enabled, true),
    now(),
    auth.uid()
  )
  ON CONFLICT (singleton) DO UPDATE SET
    member_access_enabled = COALESCE(p_member_access_enabled, endurance_runtime_settings.member_access_enabled),
    member_pairing_enabled = COALESCE(p_member_pairing_enabled, endurance_runtime_settings.member_pairing_enabled),
    member_ingest_enabled = COALESCE(p_member_ingest_enabled, endurance_runtime_settings.member_ingest_enabled),
    multi_user_realtime_enabled = COALESCE(p_multi_user_realtime_enabled, endurance_runtime_settings.multi_user_realtime_enabled),
    simhub_ingest_enabled = COALESCE(p_simhub_ingest_enabled, endurance_runtime_settings.simhub_ingest_enabled),
    updated_at = now(),
    updated_by = auth.uid()
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_capabilities_for_user(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.endurance_current_capabilities() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.endurance_set_runtime_settings(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.endurance_capabilities_for_user(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.endurance_current_capabilities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.endurance_set_runtime_settings(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

-- Existing pairing RPC signatures stay stable; only their authorization source
-- changes from hard-coded alpha roles to the runtime capability contract.
CREATE OR REPLACE FUNCTION public.simhub_create_device_pairing_code(
  p_code_hash TEXT,
  p_owner_user_id UUID,
  p_expires_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$'
     OR p_owner_user_id IS NULL
     OR p_expires_at IS NULL OR p_expires_at <= now()
     OR p_expires_at > now() + interval '15 minutes' THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::TEXT, 0));

  IF NOT COALESCE((SELECT caps.can_pair_own_device FROM public.endurance_capabilities_for_user(p_owner_user_id) AS caps), false) THEN
    RETURN false;
  END IF;

  DELETE FROM public.simhub_pairing_codes
  WHERE owner_user_id = p_owner_user_id AND consumed_at IS NULL;

  INSERT INTO public.simhub_pairing_codes (code_hash, owner_user_id, race_id, team_id, expires_at)
  VALUES (p_code_hash, p_owner_user_id, NULL, NULL, p_expires_at);

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.simhub_exchange_pairing_code(
  p_code_hash TEXT,
  p_token_hash TEXT,
  p_connector_id TEXT,
  p_device_name TEXT
)
RETURNS TABLE(
  result TEXT,
  device_id UUID,
  race_id UUID,
  team_id UUID,
  owner_user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_pairing public.simhub_pairing_codes%ROWTYPE;
  v_device_id UUID;
  v_device_expires_at TIMESTAMPTZ;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$'
     OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR char_length(trim(COALESCE(p_connector_id, ''))) NOT BETWEEN 1 AND 120
     OR char_length(trim(COALESCE(p_device_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RETURN QUERY SELECT 'invalid_request'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  SELECT pairing.*
  INTO v_pairing
  FROM public.simhub_pairing_codes AS pairing
  WHERE pairing.code_hash = p_code_hash
  FOR UPDATE;

  IF NOT FOUND OR v_pairing.consumed_at IS NOT NULL OR v_pairing.expires_at <= now() THEN
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  UPDATE public.simhub_pairing_codes AS pairing
  SET consumed_at = now()
  WHERE pairing.id = v_pairing.id;

  IF NOT COALESCE((SELECT caps.can_pair_own_device FROM public.endurance_capabilities_for_user(v_pairing.owner_user_id) AS caps), false) THEN
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF (v_pairing.race_id IS NULL) <> (v_pairing.team_id IS NULL) THEN
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_pairing.race_id IS NOT NULL THEN
    SELECT race.race_date + interval '36 hours'
    INTO v_device_expires_at
    FROM public.races AS race
    WHERE race.id = v_pairing.race_id
      AND race.status IN ('upcoming', 'live')
      AND race.race_date > now() - interval '36 hours';
    IF v_device_expires_at IS NULL THEN
      RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
      RETURN;
    END IF;
  ELSE
    v_device_expires_at := NULL;
  END IF;

  INSERT INTO public.simhub_devices (
    owner_user_id, race_id, team_id, token_hash, connector_id, device_name, expires_at
  ) VALUES (
    v_pairing.owner_user_id, v_pairing.race_id, v_pairing.team_id,
    p_token_hash, trim(p_connector_id), trim(p_device_name), v_device_expires_at
  )
  RETURNING id INTO v_device_id;

  RETURN QUERY SELECT
    'paired'::TEXT,
    v_device_id,
    v_pairing.race_id,
    v_pairing.team_id,
    v_pairing.owner_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.simhub_create_device_pairing_code(TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_create_device_pairing_code(TEXT, UUID, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.simhub_exchange_pairing_code(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_exchange_pairing_code(TEXT, TEXT, TEXT, TEXT) TO service_role;

DROP POLICY IF EXISTS "Owners can read own latest SimHub telemetry" ON public.simhub_telemetry_latest;
CREATE POLICY "Owners can read own latest SimHub telemetry"
  ON public.simhub_telemetry_latest
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.simhub_devices AS device
      WHERE device.id = simhub_telemetry_latest.device_id
        AND device.owner_user_id = auth.uid()
        AND device.revoked_at IS NULL
    )
  );

-- Replace the current ingest implementation in place. Runtime disablement is
-- non-destructive: it pauses frames without revoking the paired device/token.
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
  v_can_ingest BOOLEAN := false;
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

  IF v_device_found THEN
    SELECT caps.can_ingest_own_device
      INTO v_can_ingest
      FROM public.endurance_capabilities_for_user(v_device.owner_user_id) AS caps;
    IF NOT COALESCE(v_can_ingest, false) THEN
      RETURN QUERY SELECT 'ingest_disabled'::TEXT, v_now;
      RETURN;
    END IF;
  END IF;

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
     ) THEN
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
