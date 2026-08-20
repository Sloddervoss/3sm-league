-- Endurance Fase 3.5: Practice-opname-laag (RPC)
-- Koppelt binnengekomen telemetry aan een actieve endurance practice-sessie en
-- schrijft een ronde met de owner (user_id) van het device als coureur. Alleen
-- ingeschreven coureurs tellen mee. De client/edge function geeft de expliciete
-- sessie door (die de manager heeft gestart).
BEGIN;

CREATE OR REPLACE FUNCTION public.endurance_record_practice_lap(
  p_session_id UUID,
  p_device_token_hash TEXT,
  p_lap_seconds NUMERIC,
  p_fuel_used_litres NUMERIC,
  p_fuel_per_lap_litres NUMERIC,
  p_incident_count SMALLINT,
  p_car_id TEXT,
  p_circuit TEXT,
  p_recorded_at TIMESTAMPTZ
)
RETURNS TABLE(result TEXT, user_id UUID, lap_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_session public.endurance_practice_sessions%ROWTYPE;
  v_device public.simhub_devices%ROWTYPE;
  v_registered BOOLEAN;
  v_lap_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_session_id IS NULL
     OR p_device_token_hash IS NULL OR p_device_token_hash !~ '^[0-9a-f]{64}$'
     OR p_lap_seconds IS NULL OR p_lap_seconds <= 0 OR p_lap_seconds > 3600
     OR p_recorded_at IS NULL
     OR p_recorded_at > now() + interval '5 minutes'
     OR p_recorded_at < now() - interval '1 hour' THEN
    RETURN QUERY SELECT 'invalid_payload'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  SELECT session.* INTO v_session
  FROM public.endurance_practice_sessions AS session
  WHERE session.id = p_session_id;

  IF NOT FOUND OR v_session.ended_at IS NOT NULL THEN
    RETURN QUERY SELECT 'no_active_session'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  SELECT device.* INTO v_device
  FROM public.simhub_devices AS device
  WHERE device.token_hash = p_device_token_hash
  FOR UPDATE;

  IF NOT FOUND OR v_device.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'invalid_device'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  -- Alleen ingeschreven coureurs (niet rejected/withdrawn).
  SELECT EXISTS (
    SELECT 1 FROM public.endurance_registrations AS reg
    WHERE reg.event_id = v_session.event_id
      AND reg.user_id = v_device.owner_user_id
      AND reg.status NOT IN ('rejected', 'withdrawn')
  ) INTO v_registered;

  IF NOT v_registered THEN
    RETURN QUERY SELECT 'not_registered'::TEXT, v_device.owner_user_id, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.endurance_practice_laps (
    session_id, event_id, user_id, car_id, circuit,
    lap_seconds, fuel_used_litres, fuel_per_lap_litres,
    incident_count, recorded_at
  ) VALUES (
    v_session.id, v_session.event_id, v_device.owner_user_id,
    NULLIF(trim(p_car_id), ''), NULLIF(trim(p_circuit), ''),
    p_lap_seconds, p_fuel_used_litres, p_fuel_per_lap_litres,
    COALESCE(p_incident_count, 0), p_recorded_at
  )
  RETURNING id INTO v_lap_id;

  RETURN QUERY SELECT 'accepted'::TEXT, v_device.owner_user_id, v_lap_id;
END;
$$;

REVOKE ALL ON FUNCTION public.endurance_record_practice_lap(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, SMALLINT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.endurance_record_practice_lap(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, SMALLINT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

COMMIT;
