-- Rollback: remove exactly the 15-argument Endurance overload, restore the
-- original 8-argument Edge contract, then remove its snapshot columns.
BEGIN;

DROP FUNCTION IF EXISTS public.simhub_ingest_snapshot(
  TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.simhub_ingest_snapshot(
  p_token_hash TEXT,
  p_session_id TEXT,
  p_sequence BIGINT,
  p_captured_at TIMESTAMPTZ,
  p_connector_id TEXT,
  p_simhub_version TEXT,
  p_game TEXT,
  p_telemetry JSONB
)
RETURNS TABLE(result TEXT, received_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_device public.simhub_devices%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_device_found BOOLEAN;
  v_session_sequence BIGINT;
  v_session_found BOOLEAN;
  v_session_count INTEGER;
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

  IF NOT v_device_found OR v_device.revoked_at IS NOT NULL
     OR NOT (
       (v_device.race_id IS NULL AND v_device.team_id IS NULL AND v_device.expires_at IS NULL)
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
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.user_roles AS role_record
       WHERE role_record.user_id = v_device.owner_user_id
         AND role_record.role = 'super_admin'::public.app_role
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
    device_id, owner_user_id, race_id, team_id, session_id, sequence, captured_at, received_at,
    connector_id, simhub_version, game, telemetry
  ) VALUES (
    v_device.id, v_device.owner_user_id, v_device.race_id, v_device.team_id,
    trim(p_session_id), p_sequence, p_captured_at, v_now, trim(p_connector_id), trim(p_simhub_version), p_game, p_telemetry
  )
  ON CONFLICT (device_id) DO UPDATE
  SET owner_user_id = EXCLUDED.owner_user_id,
      race_id = EXCLUDED.race_id,
      team_id = EXCLUDED.team_id,
      session_id = EXCLUDED.session_id,
      sequence = EXCLUDED.sequence,
      captured_at = EXCLUDED.captured_at,
      received_at = EXCLUDED.received_at,
      connector_id = EXCLUDED.connector_id,
      simhub_version = EXCLUDED.simhub_version,
      game = EXCLUDED.game,
      telemetry = EXCLUDED.telemetry;

  RETURN QUERY SELECT 'accepted'::TEXT, v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.simhub_ingest_snapshot(TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_ingest_snapshot(TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB) TO service_role;


ALTER TABLE public.simhub_telemetry_latest
  DROP COLUMN IF EXISTS endurance_event_id,
  DROP COLUMN IF EXISTS endurance_team_id,
  DROP COLUMN IF EXISTS driver_id,
  DROP COLUMN IF EXISTS current_driver_id,
  DROP COLUMN IF EXISTS current_driver_name,
  DROP COLUMN IF EXISTS car_id,
  DROP COLUMN IF EXISTS car_name,
  DROP COLUMN IF EXISTS track_name,
  DROP COLUMN IF EXISTS track_config;

COMMIT;
