-- Central SimHub telemetry relay: short-lived pairing, scoped device credentials,
-- latest-only telemetry storage and authenticated team/staff reads.
BEGIN;

CREATE TABLE public.simhub_pairing_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX simhub_pairing_codes_owner_idx
  ON public.simhub_pairing_codes (owner_user_id, created_at DESC);
CREATE INDEX simhub_pairing_codes_expiry_idx
  ON public.simhub_pairing_codes (expires_at)
  WHERE consumed_at IS NULL;


CREATE TABLE public.simhub_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  connector_id TEXT NOT NULL CHECK (char_length(connector_id) BETWEEN 1 AND 120),
  device_name TEXT NOT NULL CHECK (char_length(device_name) BETWEEN 1 AND 120),
  paired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  last_session_id TEXT,
  last_sequence BIGINT NOT NULL DEFAULT -1,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX simhub_devices_owner_idx ON public.simhub_devices (owner_user_id, paired_at DESC);
CREATE INDEX simhub_devices_race_team_idx ON public.simhub_devices (race_id, team_id);
CREATE INDEX simhub_devices_active_idx ON public.simhub_devices (token_hash) WHERE revoked_at IS NULL;

CREATE TABLE public.simhub_device_sessions (
  device_id UUID NOT NULL REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL CHECK (char_length(session_id) BETWEEN 1 AND 120),
  last_sequence BIGINT NOT NULL CHECK (last_sequence >= 0),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, session_id)
);

CREATE TABLE public.simhub_telemetry_latest (
  device_id UUID PRIMARY KEY REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  race_id UUID NOT NULL REFERENCES public.races(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL CHECK (char_length(session_id) BETWEEN 1 AND 120),
  sequence BIGINT NOT NULL CHECK (sequence >= 0),
  captured_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  connector_id TEXT NOT NULL CHECK (char_length(connector_id) BETWEEN 1 AND 120),
  simhub_version TEXT NOT NULL CHECK (char_length(simhub_version) BETWEEN 1 AND 60),
  game TEXT NOT NULL CHECK (game = 'IRacing'),
  telemetry JSONB NOT NULL CHECK (jsonb_typeof(telemetry) = 'object')
);

CREATE INDEX simhub_telemetry_latest_race_team_idx
  ON public.simhub_telemetry_latest (race_id, team_id, received_at DESC);

ALTER TABLE public.simhub_pairing_codes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.simhub_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simhub_device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simhub_telemetry_latest ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_manage_simhub()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles AS role_record
    WHERE role_record.user_id = auth.uid()
      AND role_record.role IN (
        'admin'::public.app_role,
        'super_admin'::public.app_role,
        'moderator'::public.app_role
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_active_simhub_device(p_device_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.simhub_devices AS device
    JOIN public.races AS race ON race.id = device.race_id
    WHERE device.id = p_device_id
      AND device.revoked_at IS NULL
      AND device.expires_at > now()
      AND race.status IN ('upcoming', 'live')
      AND race.race_date > now() - interval '36 hours'
      AND EXISTS (
        SELECT 1 FROM public.user_roles AS role_record
        WHERE role_record.user_id = device.owner_user_id
          AND role_record.role IN ('admin'::public.app_role, 'super_admin'::public.app_role, 'moderator'::public.app_role)
      )
  );
$$;

CREATE POLICY "Staff can read active latest SimHub telemetry"
  ON public.simhub_telemetry_latest
  FOR SELECT TO authenticated
  USING (public.can_manage_simhub() AND public.is_active_simhub_device(device_id));

CREATE OR REPLACE FUNCTION public.simhub_create_pairing_code(
  p_code_hash TEXT,
  p_owner_user_id UUID,
  p_race_id UUID,
  p_team_id UUID,
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
     OR p_owner_user_id IS NULL OR p_race_id IS NULL OR p_team_id IS NULL
     OR p_expires_at IS NULL OR p_expires_at <= now()
     OR p_expires_at > now() + interval '15 minutes' THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_user_id::TEXT, 0));

  IF NOT EXISTS (
       SELECT 1 FROM public.user_roles AS role_record
       WHERE role_record.user_id = p_owner_user_id
         AND role_record.role IN ('admin'::public.app_role, 'super_admin'::public.app_role, 'moderator'::public.app_role)
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.races AS race
       WHERE race.id = p_race_id
         AND race.status IN ('upcoming', 'live')
         AND race.race_date > now() - interval '36 hours'
     )
     OR NOT EXISTS (SELECT 1 FROM public.teams AS team WHERE team.id = p_team_id) THEN
    RETURN false;
  END IF;

  DELETE FROM public.simhub_pairing_codes
  WHERE owner_user_id = p_owner_user_id AND consumed_at IS NULL;

  INSERT INTO public.simhub_pairing_codes (code_hash, owner_user_id, race_id, team_id, expires_at)
  VALUES (p_code_hash, p_owner_user_id, p_race_id, p_team_id, p_expires_at);

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
  v_expires_at TIMESTAMPTZ;
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

  SELECT race.race_date + interval '36 hours'
  INTO v_expires_at
  FROM public.races AS race
  WHERE race.id = v_pairing.race_id
    AND race.status IN ('upcoming', 'live')
    AND race.race_date > now() - interval '36 hours'
    AND EXISTS (
      SELECT 1
      FROM public.user_roles AS role_record
      WHERE role_record.user_id = v_pairing.owner_user_id
        AND role_record.role IN (
          'admin'::public.app_role,
          'super_admin'::public.app_role,
          'moderator'::public.app_role
        )
    );

  IF v_expires_at IS NULL THEN
    RETURN QUERY SELECT 'invalid_code'::TEXT, NULL::UUID, NULL::UUID, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO public.simhub_devices (
    owner_user_id,
    race_id,
    team_id,
    token_hash,
    connector_id,
    device_name,
    expires_at
  ) VALUES (
    v_pairing.owner_user_id,
    v_pairing.race_id,
    v_pairing.team_id,
    p_token_hash,
    trim(p_connector_id),
    trim(p_device_name),
    v_expires_at
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


CREATE OR REPLACE FUNCTION public.simhub_revoke_device(
  p_device_id UUID,
  p_revoked_by UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_updated UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.simhub_devices
  SET revoked_at = now(), revoked_by = p_revoked_by, updated_at = now()
  WHERE id = p_device_id AND revoked_at IS NULL
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN RETURN false; END IF;
  DELETE FROM public.simhub_telemetry_latest WHERE device_id = v_updated;
  DELETE FROM public.simhub_device_sessions WHERE device_id = v_updated;
  RETURN true;
END;
$$;

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

  IF NOT v_device_found OR v_device.revoked_at IS NOT NULL OR v_device.expires_at <= v_now
     OR NOT EXISTS (
       SELECT 1 FROM public.races AS race
       WHERE race.id = v_device.race_id
         AND race.status IN ('upcoming', 'live')
         AND race.race_date > v_now - interval '36 hours'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.user_roles AS role_record
       WHERE role_record.user_id = v_device.owner_user_id
         AND role_record.role IN (
           'admin'::public.app_role,
           'super_admin'::public.app_role,
           'moderator'::public.app_role
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
    device_id,
    owner_user_id,
    race_id,
    team_id,
    session_id,
    sequence,
    captured_at,
    received_at,
    connector_id,
    simhub_version,
    game,
    telemetry
  ) VALUES (
    v_device.id,
    v_device.owner_user_id,
    v_device.race_id,
    v_device.team_id,
    trim(p_session_id),
    p_sequence,
    p_captured_at,
    v_now,
    trim(p_connector_id),
    trim(p_simhub_version),
    p_game,
    p_telemetry
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

REVOKE ALL ON public.simhub_pairing_codes FROM PUBLIC, anon, authenticated;

REVOKE ALL ON public.simhub_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.simhub_device_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.simhub_telemetry_latest FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.simhub_telemetry_latest TO authenticated;

REVOKE ALL ON FUNCTION public.can_manage_simhub() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_simhub() TO authenticated;
REVOKE ALL ON FUNCTION public.is_active_simhub_device(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_simhub_device(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.simhub_create_pairing_code(TEXT, UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_create_pairing_code(TEXT, UUID, UUID, UUID, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.simhub_exchange_pairing_code(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_exchange_pairing_code(TEXT, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.simhub_revoke_device(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_revoke_device(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.simhub_ingest_snapshot(TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_ingest_snapshot(TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB) TO service_role;

ALTER TABLE public.simhub_telemetry_latest REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'simhub_telemetry_latest'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.simhub_telemetry_latest;
  END IF;
END;
$$;

COMMIT;
