-- Rollback van 20260910210000_endurance_member_beta.sql
-- Draait de acht samengevoegde migraties terug in omgekeerde volgorde.
-- LET OP: dit verwijdert de capability-infrastructuur en de realtime-carrier.
-- Bestaande race-, account-, team-, stint- en devicegegevens blijven behouden.

BEGIN;

-- ============================================================
-- TERUGDRAAIEN 1/8  20260820190000_endurance_central_simhub_routing
-- ============================================================
-- Restore the exact pre-central-routing function bodies.

CREATE OR REPLACE FUNCTION public.simhub_effective_endurance_binding(p_device_id uuid)
RETURNS TABLE(event_id uuid, team_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_device public.simhub_devices%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR NOT public.can_manage_simhub()) THEN
    RETURN;
  END IF;

  SELECT device.* INTO v_device
  FROM public.simhub_devices AS device
  WHERE device.id = p_device_id AND device.revoked_at IS NULL;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_device.endurance_binding_source = 'manual'
     AND v_device.endurance_event_id IS NOT NULL
     AND v_device.endurance_team_id IS NOT NULL THEN
    RETURN QUERY SELECT v_device.endurance_event_id, v_device.endurance_team_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT team.event_id, member.team_id
  FROM public.endurance_team_members AS member
  JOIN public.endurance_teams AS team ON team.id = member.team_id
  JOIN public.endurance_events AS event ON event.id = team.event_id
  WHERE member.user_id = v_device.owner_user_id
    AND event.end_at > v_now
  ORDER BY (event.start_at <= v_now AND event.end_at >= v_now) DESC,
           event.start_at ASC,
           member.created_at DESC
  LIMIT 1;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.simhub_assign_device_to_entry(
  p_device_id UUID,
  p_endurance_event_id UUID,
  p_endurance_team_id UUID,
  p_assigned_by UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_team_event UUID;
  v_updated UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_device_id IS NULL OR p_endurance_event_id IS NULL OR p_endurance_team_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT event_id INTO v_team_event
  FROM public.endurance_teams
  WHERE id = p_endurance_team_id;
  IF v_team_event IS NULL OR v_team_event <> p_endurance_event_id THEN
    RETURN false;
  END IF;

  UPDATE public.simhub_devices
  SET endurance_event_id = p_endurance_event_id,
      endurance_team_id = p_endurance_team_id,
      endurance_binding_source = 'manual',
      race_id = NULL,
      team_id = NULL,
      updated_at = now()
  WHERE id = p_device_id AND revoked_at IS NULL
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.simhub_clear_device_entry(
  p_device_id UUID,
  p_assigned_by UUID
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
  IF p_device_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.simhub_devices
  SET endurance_event_id = NULL,
      endurance_team_id = NULL,
      endurance_binding_source = NULL,
      updated_at = now()
  WHERE id = p_device_id AND revoked_at IS NULL
  RETURNING id INTO v_updated;

  RETURN v_updated IS NOT NULL;
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

CREATE OR REPLACE FUNCTION public.endurance_auto_bind_member_device()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_team_id UUID;
  v_event_id UUID;
  v_device UUID;
  v_source TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_user_id := NEW.user_id;
    v_team_id := NEW.team_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
  ELSE
    RETURN NULL;
  END IF;

  -- Actieve device van de gebruiker (éénmalige pairing; eerste actieve).
  SELECT d.id, d.endurance_binding_source
    INTO v_device, v_source
    FROM public.simhub_devices d
   WHERE d.owner_user_id = v_user_id AND d.revoked_at IS NULL
   ORDER BY d.paired_at
   LIMIT 1;

  IF v_device IS NULL THEN
    RETURN NULL;
  END IF;

  -- Handmatige toewijzing is leidend; de automatische trigger overschrijft die niet.
  IF v_source = 'manual' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT event_id INTO v_event_id FROM public.endurance_teams WHERE id = v_team_id;
    IF v_event_id IS NULL THEN
      RETURN NULL;
    END IF;
    UPDATE public.simhub_devices
       SET endurance_event_id = v_event_id,
           endurance_team_id = v_team_id,
           endurance_binding_source = 'auto',
           updated_at = now()
     WHERE id = v_device;
    RETURN NEW;
  ELSE
    -- DELETE: ontbind alleen als het verwijderde lidmaatschap het gebonden team was.
    IF (SELECT endurance_team_id FROM public.simhub_devices WHERE id = v_device) = OLD.team_id THEN
      SELECT tm.team_id, t.event_id
        INTO v_team_id, v_event_id
        FROM public.endurance_team_members tm
        JOIN public.endurance_teams t ON t.id = tm.team_id
       WHERE tm.user_id = v_user_id
       ORDER BY tm.created_at DESC
       LIMIT 1;
      IF v_team_id IS NULL THEN
        UPDATE public.simhub_devices
           SET endurance_event_id = NULL,
               endurance_team_id = NULL,
               endurance_binding_source = NULL,
               updated_at = now()
         WHERE id = v_device;
      ELSE
        UPDATE public.simhub_devices
           SET endurance_event_id = v_event_id,
               endurance_team_id = v_team_id,
               endurance_binding_source = 'auto',
               updated_at = now()
         WHERE id = v_device;
      END IF;
    END IF;
    RETURN OLD;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.simhub_reconcile_device_latest(uuid);

-- ============================================================
-- TERUGDRAAIEN 2/8  20260820180000_endurance_realtime_server_gate
-- ============================================================
-- Rollback: restore direct filtered domain-table publication used by phase 4A.

ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_realtime_stream;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_registrations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_availability;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_pace_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_practice_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_practice_laps;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_teams;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_team_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_stints;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_planning_versions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_confirmations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_race_control_audit;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'endurance_events','endurance_registrations','endurance_availability',
    'endurance_pace_entries','endurance_practice_sessions','endurance_practice_laps',
    'endurance_teams','endurance_team_members','endurance_stints',
    'endurance_planning_versions','endurance_confirmations',
    'endurance_notifications','endurance_race_control_audit'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS endurance_realtime_enqueue_trg ON public.%I', table_name);
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.endurance_realtime_enqueue();
DROP POLICY IF EXISTS "endurance realtime stream authorized select" ON public.endurance_realtime_stream;
DROP TABLE public.endurance_realtime_stream;

-- ============================================================
-- TERUGDRAAIEN 3/8  20260820170000_endurance_realtime_matrix_publication
-- ============================================================
-- Rollback: remove only the publication entries introduced by 20260820170000.

DROP POLICY IF EXISTS "endurance race control audit managers select"
  ON public.endurance_race_control_audit;

ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_registrations;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_pace_entries;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_practice_sessions;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_practice_laps;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_confirmations;
ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_race_control_audit;

-- ============================================================
-- TERUGDRAAIEN 4/8  20260820160000_endurance_race_control_optimistic_audit
-- ============================================================
-- Rollback: Endurance Race Control optimistic concurrency + append-only audit.
-- Exacte inverse van 20260820160000; geen bestaande RPC-signature gewijzigd.

REVOKE ALL ON FUNCTION public.endurance_race_control_apply(uuid, uuid, uuid, public.endurance_race_control_op, integer, integer, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.endurance_race_control_apply(uuid, uuid, uuid, public.endurance_race_control_op, integer, integer, uuid, timestamptz, timestamptz);

REVOKE ALL ON FUNCTION public.endurance_list_race_control_audit(uuid) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.endurance_list_race_control_audit(uuid);

DROP POLICY IF EXISTS "endurance race control audit super select" ON public.endurance_race_control_audit;
DROP TABLE IF EXISTS public.endurance_race_control_audit;

DROP TYPE IF EXISTS public.endurance_race_control_op;

-- ============================================================
-- TERUGDRAAIEN 5/8  20260820140000_endurance_runtime_capabilities
-- ============================================================
-- Roll back runtime capabilities to the preceding alpha role checks.

DROP POLICY IF EXISTS "Owners can read own latest SimHub telemetry" ON public.simhub_telemetry_latest;

-- Restore the exact pre-capability pairing functions.
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


-- Restore the exact pre-capability ingest function before dropping helpers.
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

REVOKE ALL ON FUNCTION public.endurance_set_runtime_settings(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.endurance_current_capabilities() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.endurance_capabilities_for_user(UUID) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.endurance_set_runtime_settings(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.endurance_current_capabilities();
DROP FUNCTION IF EXISTS public.endurance_capabilities_for_user(UUID);
DROP TABLE IF EXISTS public.endurance_runtime_settings;

-- ============================================================
-- TERUGDRAAIEN 6/8  20260809153000_endurance_effective_telemetry_routing
-- ============================================================
DROP POLICY IF EXISTS "Staff can read active latest SimHub telemetry" ON public.simhub_telemetry_latest;
DROP FUNCTION IF EXISTS public.simhub_read_effective_endurance_latest(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.simhub_list_effective_endurance_devices(uuid, uuid);

CREATE OR REPLACE FUNCTION public.is_active_simhub_device(p_device_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.simhub_devices AS device
    WHERE device.id = p_device_id
      AND device.revoked_at IS NULL
      AND (
        (device.race_id IS NULL AND device.team_id IS NULL AND device.expires_at IS NULL)
        OR (
          device.race_id IS NOT NULL AND device.team_id IS NOT NULL
          AND device.expires_at > now()
          AND EXISTS (
            SELECT 1 FROM public.races AS race
            WHERE race.id = device.race_id
              AND race.status IN ('upcoming', 'live')
              AND race.race_date > now() - interval '36 hours'
          )
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.user_roles AS role_record
        WHERE role_record.user_id = device.owner_user_id
          AND role_record.role = 'super_admin'::public.app_role
      )
  );
$$;

DROP FUNCTION IF EXISTS public.simhub_device_matches_endurance_context(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.simhub_effective_endurance_binding(uuid);

CREATE POLICY "Staff can read active latest SimHub telemetry"
  ON public.simhub_telemetry_latest
  FOR SELECT TO authenticated
  USING (public.can_manage_simhub() AND public.is_active_simhub_device(device_id));

REVOKE ALL ON FUNCTION public.is_active_simhub_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_simhub_device(uuid) TO authenticated;

-- ============================================================
-- TERUGDRAAIEN 7/8  20260809152000_endurance_atomic_stint_replace
-- ============================================================
DROP FUNCTION IF EXISTS public.endurance_apply_stint_updates(uuid, uuid, jsonb);
-- GECORRIGEERD: deze functie bestond al vóór de migratie.
-- In plaats van droppen herstellen we de oorspronkelijke versie.
CREATE OR REPLACE FUNCTION public.endurance_replace_draft_stints(p_event_id uuid, p_team_id uuid, p_stints jsonb)
 RETURNS SETOF endurance_stints
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_event public.endurance_events%ROWTYPE;
  v_team public.endurance_teams%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_event FROM public.endurance_events WHERE id = p_event_id FOR UPDATE;
  SELECT * INTO v_team FROM public.endurance_teams WHERE id = p_team_id AND event_id = p_event_id;
  IF NOT FOUND OR v_event.id IS NULL THEN
    RAISE EXCEPTION 'Unknown event/team combination' USING ERRCODE = '22023';
  END IF;

  IF NOT public.endurance_can_manage_roster(p_event_id) AND v_team.manager_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_stints IS NULL OR jsonb_typeof(p_stints) <> 'array'
     OR jsonb_array_length(p_stints) < 1 OR jsonb_array_length(p_stints) > 200 THEN
    RAISE EXCEPTION 'Stints must be a non-empty array of at most 200 items' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.endurance_stints
    WHERE event_id = p_event_id AND team_id = p_team_id AND status <> 'draft'
  ) THEN
    RAISE EXCEPTION 'A non-draft plan already exists' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_stints) AS item(
      driver_id uuid, original_start_at timestamptz, original_end_at timestamptz,
      actual_start_at timestamptz, actual_end_at timestamptz,
      expected_laps integer, fuel_litres numeric, tyre_change boolean,
      double_stint boolean, notes text
    )
    WHERE item.original_start_at IS NULL OR item.original_end_at IS NULL
       OR item.actual_start_at IS NULL OR item.actual_end_at IS NULL
       OR item.original_start_at >= item.original_end_at
       OR item.actual_start_at >= item.actual_end_at
       OR item.actual_start_at < v_event.start_at OR item.actual_end_at > v_event.end_at
       OR item.expected_laps < 0 OR item.fuel_litres < 0
       OR (item.driver_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.endurance_team_members member
         WHERE member.team_id = p_team_id AND member.user_id = item.driver_id
       ))
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_stints) WITH ORDINALITY AS left_item(value, position)
    JOIN jsonb_array_elements(p_stints) WITH ORDINALITY AS right_item(value, position)
      ON left_item.position < right_item.position
     AND tstzrange((left_item.value->>'actual_start_at')::timestamptz, (left_item.value->>'actual_end_at')::timestamptz, '[)')
         && tstzrange((right_item.value->>'actual_start_at')::timestamptz, (right_item.value->>'actual_end_at')::timestamptz, '[)')
  ) THEN
    RAISE EXCEPTION 'Invalid or overlapping stint payload' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.endurance_stints
  WHERE event_id = p_event_id AND team_id = p_team_id AND status = 'draft';

  RETURN QUERY
  INSERT INTO public.endurance_stints (
    event_id, team_id, driver_id,
    original_start_at, original_end_at, actual_start_at, actual_end_at,
    expected_laps, fuel_litres, tyre_change, double_stint, notes, status
  )
  SELECT
    p_event_id, p_team_id, item.driver_id,
    item.original_start_at, item.original_end_at,
    item.actual_start_at, item.actual_end_at,
    item.expected_laps, item.fuel_litres,
    COALESCE(item.tyre_change, false), COALESCE(item.double_stint, false),
    item.notes, 'draft'::public.endurance_stint_status
  FROM jsonb_to_recordset(p_stints) AS item(
    driver_id uuid, original_start_at timestamptz, original_end_at timestamptz,
    actual_start_at timestamptz, actual_end_at timestamptz,
    expected_laps integer, fuel_litres numeric, tyre_change boolean,
    double_stint boolean, notes text
  )
  RETURNING *;
END;
$function$;

-- ============================================================
-- TERUGDRAAIEN 8/8  20260809150000_endurance_participant_access
-- ============================================================
DROP TRIGGER IF EXISTS trg_endurance_guard_own_notification_update ON public.endurance_notifications;
DROP TRIGGER IF EXISTS trg_endurance_guard_own_registration_update ON public.endurance_registrations;
DROP FUNCTION IF EXISTS public.endurance_guard_own_notification_update();
DROP FUNCTION IF EXISTS public.endurance_guard_own_registration_update();

DROP POLICY IF EXISTS "endurance discoverable events" ON public.endurance_events;
DROP POLICY IF EXISTS "endurance own registration select" ON public.endurance_registrations;
DROP POLICY IF EXISTS "endurance own registration insert" ON public.endurance_registrations;
DROP POLICY IF EXISTS "endurance own registration update" ON public.endurance_registrations;
DROP POLICY IF EXISTS "endurance participant availability select" ON public.endurance_availability;
DROP POLICY IF EXISTS "endurance own availability write" ON public.endurance_availability;
DROP POLICY IF EXISTS "endurance participant pace select" ON public.endurance_pace_entries;
DROP POLICY IF EXISTS "endurance own pace write" ON public.endurance_pace_entries;
DROP POLICY IF EXISTS "endurance participant teams select" ON public.endurance_teams;
DROP POLICY IF EXISTS "endurance participant team members select" ON public.endurance_team_members;
DROP POLICY IF EXISTS "endurance participant stints select" ON public.endurance_stints;
DROP POLICY IF EXISTS "endurance participant plans select" ON public.endurance_planning_versions;
DROP POLICY IF EXISTS "endurance participant confirmations select" ON public.endurance_confirmations;
DROP POLICY IF EXISTS "endurance own confirmation update" ON public.endurance_confirmations;
DROP POLICY IF EXISTS "endurance participant practice sessions select" ON public.endurance_practice_sessions;
DROP POLICY IF EXISTS "endurance participant practice laps select" ON public.endurance_practice_laps;
DROP POLICY IF EXISTS "endurance own notifications select" ON public.endurance_notifications;
DROP POLICY IF EXISTS "endurance own notifications update" ON public.endurance_notifications;

DROP FUNCTION IF EXISTS public.endurance_is_participant(uuid, uuid);
DROP FUNCTION IF EXISTS public.endurance_can_discover_event(uuid, uuid);

-- Restore the immediately preceding alpha policies.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'endurance_events','endurance_registrations','endurance_availability',
    'endurance_pace_entries','endurance_teams','endurance_team_members',
    'endurance_stints','endurance_planning_versions','endurance_confirmations',
    'endurance_notifications','endurance_audit_log','endurance_practice_sessions',
    'endurance_practice_laps'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY "endurance staff view" ON public.%I FOR SELECT TO authenticated USING (public.is_endurance_staff(auth.uid()))',
      table_name
    );
  END LOOP;
END;
$$;

CREATE POLICY "endurance staff own registration" ON public.endurance_registrations
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()));
CREATE POLICY "endurance staff own availability" ON public.endurance_availability
  FOR ALL TO authenticated
  USING (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_endurance_staff(auth.uid()));

COMMIT;
