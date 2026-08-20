-- Verruim de device-only pairing-RPC's naar endurance-ster (super_admin,
-- endurance_manager, tester) zodat testers/endurance-managers hun EIGEN device
-- kunnen koppelen. Legacy race/team-binding en alle beheeracties blijven
-- super_admin-only. Additief t.o.v. bestaande flow.
BEGIN;

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

  IF NOT public.is_endurance_staff(p_owner_user_id) THEN
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

  IF NOT public.is_endurance_staff(v_pairing.owner_user_id) THEN
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

COMMIT;
