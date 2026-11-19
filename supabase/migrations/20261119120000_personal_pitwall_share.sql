-- Personal premium Pitwall + opt-in spectator sharing.
--
-- Design notes (security first):
--  * The owner's connector is resolved on the server from auth.uid() and
--    public.simhub_devices.owner_user_id. No device name, connector id or
--    admin fleet RPC is used to decide which device belongs to the caller.
--  * A share is a bearer capability. The plaintext token exists only in the
--    owner's browser (URL fragment) and in the create response. At rest only a
--    SHA-256 hash is stored. No service-role key, analytics, cache or local
--    storage is involved.
--  * Sharing is opt-in and fails closed: one active share per device, a
--    bounded freshness window at create and read time, a hard absolute TTL,
--    and an explicit session/track/race identity binding.
--  * The public reader gets a deliberately small, typed race projection. It
--    never receives raw telemetry, account/device identifiers, archive rows,
--    fleet data or any management surface.
BEGIN;

CREATE TABLE IF NOT EXISTS public.pitwall_shared_races (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  session_key text NOT NULL CHECK (char_length(session_key) BETWEEN 1 AND 120),
  track_name text NOT NULL CHECK (char_length(track_name) BETWEEN 1 AND 160),
  track_config text CHECK (track_config IS NULL OR char_length(track_config) BETWEEN 1 AND 120),
  race_run_id uuid,
  anchor_session_time_seconds numeric NOT NULL CHECK (anchor_session_time_seconds >= 20),
  anchor_completed_laps integer NOT NULL CHECK (anchor_completed_laps >= 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 1 AND 40),
  CONSTRAINT pitwall_shared_races_ttl_shape CHECK (expires_at > created_at),
  CONSTRAINT pitwall_shared_races_ttl_absolute CHECK (expires_at <= created_at + interval '6 hours')
);

CREATE INDEX IF NOT EXISTS pitwall_shared_races_owner_idx
  ON public.pitwall_shared_races (owner_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pitwall_shared_races_one_active_idx
  ON public.pitwall_shared_races (device_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.pitwall_shared_races ENABLE ROW LEVEL SECURITY;

-- The owner may see the lifecycle metadata of their own share, never the hash.
CREATE POLICY pitwall_shared_races_owner_select
  ON public.pitwall_shared_races
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

REVOKE ALL ON TABLE public.pitwall_shared_races FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, owner_user_id, device_id, session_key, track_name, track_config,
  race_run_id, created_at, expires_at, revoked_at, revoke_reason
) ON public.pitwall_shared_races TO authenticated;

-- Only active race/practice/qualifying sessions are shareable. "checkered"
-- is treated as terminal even when the state string lags one frame behind.
CREATE OR REPLACE FUNCTION public.pitwall_share_session_active_v1(p_v3 jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce(lower(p_v3 #>> '{session,sessionState}'), '') IN ('racing', 'practice', 'qualifying', 'warmup')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements_text(
         CASE WHEN pg_catalog.jsonb_typeof(p_v3 #> '{session,flags}') = 'array'
              THEN p_v3 #> '{session,flags}' ELSE '[]'::jsonb END
       ) AS flag(value)
       WHERE lower(flag.value) IN ('checkered', 'checkered flag', 'black')
     );
$$;

REVOKE ALL ON FUNCTION public.pitwall_share_session_active_v1(jsonb) FROM PUBLIC, anon, authenticated;

-- Owner-scoped device inventory. This is the only discovery path used by the
-- personal Pitwall. It returns no token hash and no other user's device.
CREATE OR REPLACE FUNCTION public.pitwall_my_devices_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'devices',
    coalesce((
      SELECT pg_catalog.jsonb_agg(device_row ORDER BY ord)
      FROM (
        SELECT
          pg_catalog.jsonb_build_object(
            'id', d.id,
            'name', d.device_name,
            'status', d.device_status,
            'last_seen_at', d.last_seen_at,
            'online', (d.last_seen_at IS NOT NULL AND d.last_seen_at > pg_catalog.now() - interval '5 minutes'),
            'telemetry_received_at', t.received_at,
            'fresh', (t.received_at IS NOT NULL AND t.received_at > pg_catalog.now() - interval '90 seconds'),
            'session_key', t.session_id,
            'track_name', t.v3_normalized #>> '{identity,trackName}',
            'track_config', t.v3_normalized #>> '{identity,trackConfig}',
            'driver_name', t.v3_normalized #>> '{identity,currentDriverName}',
            'session_state', t.v3_normalized #>> '{session,sessionState}',
            'shareable', (
              t.received_at IS NOT NULL
              AND t.received_at > pg_catalog.now() - interval '90 seconds'
              AND t.session_id IS NOT NULL
              AND coalesce(t.v3_normalized #>> '{identity,trackName}', '') <> ''
              AND public.pitwall_share_session_active_v1(t.v3_normalized)
              AND coalesce(nullif(t.v3_normalized #>> '{session,sessionTimeSeconds}', '')::numeric, -1) >= 20
            ),
            'share_active', (s.id IS NOT NULL),
            'share_created_at', s.created_at,
            'share_expires_at', s.expires_at
          ) AS device_row,
          row_number() OVER (
            ORDER BY (t.received_at IS NOT NULL AND t.received_at > pg_catalog.now() - interval '90 seconds') DESC,
                     t.received_at DESC NULLS LAST,
                     d.paired_at DESC
          ) AS ord
        FROM public.simhub_devices d
        LEFT JOIN LATERAL (
          SELECT tel.device_id, tel.session_id, tel.received_at, tel.v3_normalized
          FROM public.simhub_telemetry_latest tel
          WHERE tel.device_id = d.id
        ) t ON true
        LEFT JOIN LATERAL (
          SELECT share.id, share.created_at, share.expires_at
          FROM public.pitwall_shared_races share
          WHERE share.device_id = d.id
            AND share.owner_user_id = v_uid
            AND share.revoked_at IS NULL
            AND share.expires_at > pg_catalog.now()
          ORDER BY share.created_at DESC
          LIMIT 1
        ) s ON true
        WHERE d.owner_user_id = v_uid
          AND d.revoked_at IS NULL
          AND coalesce(d.device_status, '') <> 'revoked'
        ORDER BY ord
        LIMIT 20
      ) ranked
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_my_devices_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_my_devices_v1() TO authenticated;

-- Owner-only live detail. Mirrors the bounded shape the premium panels already
-- consume, but gates on owner_user_id instead of the admin capability and does
-- not expose the raw telemetry blob or other users' data.
CREATE OR REPLACE FUNCTION public.pitwall_owner_device_detail_v1(p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_device public.simhub_devices%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_device
  FROM public.simhub_devices d
  WHERE d.id = p_device_id AND d.owner_user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT pg_catalog.jsonb_build_object(
      'device', pg_catalog.jsonb_build_object(
        'id', d.id,
        'device_name', d.device_name,
        'device_status', d.device_status,
        'device_role', d.device_role,
        'revoked_at', d.revoked_at,
        'last_seen_at', d.last_seen_at,
        'last_session_id', d.last_session_id,
        'last_sequence', d.last_sequence,
        'endurance_event_id', d.endurance_event_id,
        'endurance_team_id', d.endurance_team_id,
        'endurance_binding_source', d.endurance_binding_source,
        'paired_at', d.paired_at
      ),
      'health', (
        SELECT pg_catalog.to_jsonb(h) - 'updated_at'
        FROM public.simhub_device_health h
        WHERE h.device_id = d.id
      ),
      'telemetry', (
        SELECT pg_catalog.jsonb_build_object(
          'device_id', t.device_id,
          'session_id', t.session_id,
          'sequence', t.sequence,
          'captured_at', t.captured_at,
          'received_at', t.received_at,
          'connector_id', t.connector_id,
          'simhub_version', t.simhub_version,
          'game', t.game,
          'endurance_event_id', t.endurance_event_id,
          'endurance_team_id', t.endurance_team_id,
          'driver_id', t.driver_id,
          'current_driver_id', t.current_driver_id,
          'current_driver_name', t.current_driver_name,
          'car_id', t.car_id,
          'car_name', t.car_name,
          'track_name', t.track_name,
          'track_config', t.track_config,
          'race_run_id', t.race_run_id,
          'v3_normalized', public.simhub_pace_project_v1(t.v3_normalized)
        )
        FROM public.simhub_telemetry_latest t
        WHERE t.device_id = d.id
      ),
      'endurance_event', (
        SELECT pg_catalog.jsonb_build_object('id', e.id, 'name', e.name)
        FROM public.endurance_events e
        WHERE e.id = d.endurance_event_id
      ),
      'endurance_team', (
        SELECT pg_catalog.jsonb_build_object('id', tm.id, 'name', tm.name)
        FROM public.endurance_teams tm
        WHERE tm.id = d.endurance_team_id
      ),
      'diagnostic_events', '[]'::jsonb
    )
    FROM public.simhub_devices d
    WHERE d.id = v_device.id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_owner_device_detail_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_owner_device_detail_v1(uuid) TO authenticated;

-- Opt-in share creation. The caller cannot choose a token, owner, session or
-- track: all are derived from the current server-side telemetry row. Any
-- previous active share for the device is revoked first, so a fresh link is
-- unambiguous.
CREATE OR REPLACE FUNCTION public.pitwall_share_create_v1(
  p_device_id uuid,
  p_ttl_seconds integer DEFAULT 14400
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_device public.simhub_devices%ROWTYPE;
  v_telemetry public.simhub_telemetry_latest%ROWTYPE;
  v_ttl integer;
  v_token text;
  v_hash text;
  v_v3 jsonb;
  v_session_time numeric;
  v_completed_laps integer;
  v_track_name text;
  v_track_config text;
  v_expires_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 300 OR p_ttl_seconds > 21600 THEN
    RAISE EXCEPTION 'Invalid share lifetime' USING ERRCODE = '22023';
  END IF;
  v_ttl := p_ttl_seconds;

  SELECT * INTO v_device
  FROM public.simhub_devices d
  WHERE d.id = p_device_id
  FOR UPDATE;

  IF NOT FOUND OR v_device.owner_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF v_device.revoked_at IS NOT NULL
     OR coalesce(v_device.device_status, '') = 'revoked'
     OR (v_device.expires_at IS NOT NULL AND v_device.expires_at <= pg_catalog.now()) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'device_unavailable');
  END IF;

  SELECT * INTO v_telemetry
  FROM public.simhub_telemetry_latest t
  WHERE t.device_id = v_device.id;

  IF NOT FOUND OR v_telemetry.received_at IS NULL
     OR v_telemetry.received_at < pg_catalog.now() - interval '90 seconds'
     OR v_telemetry.owner_user_id IS DISTINCT FROM v_uid THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_fresh');
  END IF;

  v_v3 := v_telemetry.v3_normalized;
  v_session_time := nullif(v_v3 #>> '{session,sessionTimeSeconds}', '')::numeric;
  v_completed_laps := nullif(v_v3 #>> '{timing,completedLaps}', '')::integer;
  v_track_name := nullif(v_v3 #>> '{identity,trackName}', '');
  v_track_config := nullif(v_v3 #>> '{identity,trackConfig}', '');

  IF v_telemetry.session_id IS NULL
     OR v_track_name IS NULL
     OR v_session_time IS NULL OR v_session_time < 20
     OR v_completed_laps IS NULL OR v_completed_laps < 0
     OR NOT public.pitwall_share_session_active_v1(v_v3) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_shareable');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_device.id::text, 0));

  UPDATE public.pitwall_shared_races
  SET revoked_at = pg_catalog.now(),
      revoke_reason = 'superseded'
  WHERE device_id = v_device.id
    AND revoked_at IS NULL;

  v_token := replace(pg_catalog.gen_random_uuid()::text, '-', '')
          || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  v_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')),
    'hex'
  );
  v_expires_at := pg_catalog.now() + pg_catalog.make_interval(secs => v_ttl);

  INSERT INTO public.pitwall_shared_races (
    token_hash, owner_user_id, device_id, session_key, track_name,
    track_config, race_run_id, anchor_session_time_seconds,
    anchor_completed_laps, expires_at
  ) VALUES (
    v_hash, v_uid, v_device.id, v_telemetry.session_id, v_track_name,
    v_track_config, v_telemetry.race_run_id, v_session_time,
    v_completed_laps, v_expires_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'token', v_token,
    'expires_at', v_expires_at,
    'created_at', pg_catalog.now(),
    'session_key', v_telemetry.session_id,
    'track_name', v_track_name,
    'track_config', v_track_config
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_share_create_v1(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_share_create_v1(uuid, integer) TO authenticated;

-- Immediate backend revoke. The old URL is invalid from the next read on.
CREATE OR REPLACE FUNCTION public.pitwall_share_revoke_v1(p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_revoked integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.simhub_devices d
    WHERE d.id = p_device_id AND d.owner_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.pitwall_shared_races
  SET revoked_at = pg_catalog.now(),
      revoke_reason = 'owner'
  WHERE device_id = p_device_id
    AND owner_user_id = v_uid
    AND revoked_at IS NULL;

  GET DIAGNOSTICS v_revoked = ROW_COUNT;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'revoked', v_revoked);
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_share_revoke_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_share_revoke_v1(uuid) TO authenticated;

-- Public anon reader. Every branch fails closed; the only successful response
-- is a bounded, typed race projection for the exact owner/device/session/track
-- that was shared. Terminal or identity-mismatched shares are revoked on read.
CREATE OR REPLACE FUNCTION public.pitwall_shared_snapshot_v1(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_hash text;
  v_share public.pitwall_shared_races%ROWTYPE;
  v_device public.simhub_devices%ROWTYPE;
  v_telemetry public.simhub_telemetry_latest%ROWTYPE;
  v_v3 jsonb;
  v_track_name text;
  v_track_config text;
  v_session_time numeric;
  v_completed_laps integer;
  v_laps jsonb;
  v_pace jsonb;
BEGIN
  IF p_token IS NULL OR char_length(p_token) <> 64 OR p_token !~ '^[0-9a-f]{64}$' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  v_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')),
    'hex'
  );

  SELECT * INTO v_share
  FROM public.pitwall_shared_races s
  WHERE s.token_hash = v_hash;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'invalid');
  END IF;

  IF v_share.revoked_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ended');
  END IF;

  IF v_share.expires_at <= pg_catalog.now() THEN
    UPDATE public.pitwall_shared_races
    SET revoked_at = pg_catalog.now(), revoke_reason = 'expired'
    WHERE id = v_share.id AND revoked_at IS NULL;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ended');
  END IF;

  SELECT * INTO v_device
  FROM public.simhub_devices d
  WHERE d.id = v_share.device_id;

  IF NOT FOUND
     OR v_device.owner_user_id IS DISTINCT FROM v_share.owner_user_id
     OR v_device.revoked_at IS NOT NULL
     OR coalesce(v_device.device_status, '') = 'revoked'
     OR (v_device.expires_at IS NOT NULL AND v_device.expires_at <= pg_catalog.now()) THEN
    UPDATE public.pitwall_shared_races
    SET revoked_at = pg_catalog.now(), revoke_reason = 'device_revoked'
    WHERE id = v_share.id AND revoked_at IS NULL;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ended');
  END IF;

  SELECT * INTO v_telemetry
  FROM public.simhub_telemetry_latest t
  WHERE t.device_id = v_share.device_id;

  IF NOT FOUND OR v_telemetry.received_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'waiting');
  END IF;

  v_v3 := v_telemetry.v3_normalized;
  v_track_name := nullif(v_v3 #>> '{identity,trackName}', '');
  v_track_config := nullif(v_v3 #>> '{identity,trackConfig}', '');
  v_session_time := nullif(v_v3 #>> '{session,sessionTimeSeconds}', '')::numeric;
  v_completed_laps := nullif(v_v3 #>> '{timing,completedLaps}', '')::integer;

  IF v_telemetry.owner_user_id IS DISTINCT FROM v_share.owner_user_id
     OR v_telemetry.session_id IS DISTINCT FROM v_share.session_key
     OR v_track_name IS DISTINCT FROM v_share.track_name
     OR v_track_config IS DISTINCT FROM v_share.track_config
     OR v_telemetry.race_run_id IS DISTINCT FROM v_share.race_run_id
     OR v_session_time IS NULL
     OR v_session_time < v_share.anchor_session_time_seconds - 10
     OR v_completed_laps IS NULL
     OR v_completed_laps < v_share.anchor_completed_laps
     OR NOT public.pitwall_share_session_active_v1(v_v3) THEN
    UPDATE public.pitwall_shared_races
    SET revoked_at = pg_catalog.now(), revoke_reason = 'session_ended'
    WHERE id = v_share.id AND revoked_at IS NULL;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ended');
  END IF;

  IF v_telemetry.received_at < pg_catalog.now() - interval '90 seconds' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'stale');
  END IF;

  SELECT pg_catalog.jsonb_agg(lap_row ORDER BY lap_number) INTO v_laps
  FROM (
    SELECT
      l.lap_number,
      pg_catalog.jsonb_build_object('lap', l.lap_number, 'seconds', l.lap_seconds) AS lap_row
    FROM public.simhub_device_laps l
    WHERE l.device_id = v_share.device_id
      AND l.session_key = v_share.session_key
      AND l.lap_seconds IS NOT NULL
      AND l.lap_seconds BETWEEN 20 AND 600
    ORDER BY l.lap_number DESC
    LIMIT 20
  ) recent;

  SELECT pg_catalog.jsonb_build_object(
    'fastest', min(l.lap_seconds),
    'median', pg_catalog.percentile_cont(0.5) WITHIN GROUP (ORDER BY l.lap_seconds),
    'count', count(*)
  ) INTO v_pace
  FROM public.simhub_device_laps l
  WHERE l.device_id = v_share.device_id
    AND l.session_key = v_share.session_key
    AND l.lap_seconds IS NOT NULL
    AND l.lap_seconds BETWEEN 20 AND 600;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'created_at', v_share.created_at,
    'expires_at', v_share.expires_at,
    'updated_at', v_telemetry.received_at,
    'track', pg_catalog.jsonb_build_object(
      'name', v_share.track_name,
      'config', v_share.track_config
    ),
    'session', pg_catalog.jsonb_build_object(
      'driver', v_v3 #>> '{identity,currentDriverName}',
      'car', v_v3 #>> '{identity,carName}',
      'state', v_v3 #>> '{session,sessionState}'
    ),
    'v3', pg_catalog.jsonb_build_object(
      'capturedAt', v_v3 #>> '{capturedAt}',
      'identity', pg_catalog.jsonb_build_object(
        'currentDriverName', v_v3 #>> '{identity,currentDriverName}',
        'carName', v_v3 #>> '{identity,carName}',
        'trackName', v_v3 #>> '{identity,trackName}',
        'trackConfig', v_v3 #>> '{identity,trackConfig}'
      ),
      'session', pg_catalog.jsonb_build_object(
        'isInCar', v_v3 #> '{session,isInCar}',
        'sessionTimeSeconds', v_v3 #> '{session,sessionTimeSeconds}',
        'sessionTimeRemainingSeconds', v_v3 #> '{session,sessionTimeRemainingSeconds}',
        'sessionLapsRemaining', v_v3 #> '{session,sessionLapsRemaining}',
        'flags', coalesce(v_v3 #> '{session,flags}', '[]'::jsonb),
        'sessionState', v_v3 #>> '{session,sessionState}'
      ),
      'timing', pg_catalog.jsonb_build_object(
        'currentLapElapsedSeconds', v_v3 #> '{timing,currentLapElapsedSeconds}',
        'lastLapTimeSeconds', v_v3 #> '{timing,lastLapTimeSeconds}',
        'bestLapTimeSeconds', v_v3 #> '{timing,bestLapTimeSeconds}',
        'completedLaps', v_v3 #> '{timing,completedLaps}'
      ),
      'position', pg_catalog.jsonb_build_object(
        'position', v_v3 #> '{position,position}',
        'classPosition', v_v3 #> '{position,classPosition}',
        'gapToLeaderSeconds', v_v3 #> '{position,gapToLeaderSeconds}'
      ),
      'track', pg_catalog.jsonb_build_object(
        'lapDistancePct', v_v3 #> '{track,lapDistancePct}',
        'trackSurface', v_v3 #>> '{track,trackSurface}',
        'onPitRoad', v_v3 #> '{track,onPitRoad}'
      ),
      'fuel', pg_catalog.jsonb_build_object(
        'fuelLitres', v_v3 #> '{fuel,fuelLitres}',
        'fuelPct', v_v3 #> '{fuel,fuelPct}',
        'fuelCapacityLitres', v_v3 #> '{fuel,fuelCapacityLitres}',
        'fuelPerLapLitres', v_v3 #> '{fuel,fuelPerLapLitres}',
        'lapsRemaining', v_v3 #> '{fuel,lapsRemaining}'
      ),
      'tyres', pg_catalog.jsonb_build_object(
        'compoundId', v_v3 #> '{tyres,compoundId}',
        'sets', CASE WHEN pg_catalog.jsonb_typeof(v_v3 #> '{tyres,sets}') = 'object' THEN
          pg_catalog.jsonb_build_object(
            'used', v_v3 #> '{tyres,sets,used}',
            'available', v_v3 #> '{tyres,sets,available}',
            'frontLeft', v_v3 #> '{tyres,sets,frontLeft}',
            'frontRight', v_v3 #> '{tyres,sets,frontRight}',
            'rearLeft', v_v3 #> '{tyres,sets,rearLeft}',
            'rearRight', v_v3 #> '{tyres,sets,rearRight}'
          ) ELSE NULL END
      ),
      'vehicle', pg_catalog.jsonb_build_object(
        'speedKph', v_v3 #> '{vehicle,speedKph}',
        'gear', v_v3 #>> '{vehicle,gear}',
        'sector1Seconds', v_v3 #> '{vehicle,sector1Seconds}',
        'sector2Seconds', v_v3 #> '{vehicle,sector2Seconds}',
        'sector3Seconds', v_v3 #> '{vehicle,sector3Seconds}',
        'tyreDataMode', v_v3 #>> '{vehicle,tyreDataMode}',
        'pressureUnit', v_v3 #>> '{vehicle,pressureUnit}',
        'temperatureUnit', v_v3 #>> '{vehicle,temperatureUnit}',
        'frontLeft', CASE WHEN pg_catalog.jsonb_typeof(v_v3 #> '{vehicle,frontLeft}') = 'object' THEN
          pg_catalog.jsonb_build_object(
            'wearPercent', v_v3 #> '{vehicle,frontLeft,wearPercent}',
            'temperature', v_v3 #> '{vehicle,frontLeft,temperature}',
            'pressure', v_v3 #> '{vehicle,frontLeft,pressure}'
          ) ELSE NULL END,
        'frontRight', CASE WHEN pg_catalog.jsonb_typeof(v_v3 #> '{vehicle,frontRight}') = 'object' THEN
          pg_catalog.jsonb_build_object(
            'wearPercent', v_v3 #> '{vehicle,frontRight,wearPercent}',
            'temperature', v_v3 #> '{vehicle,frontRight,temperature}',
            'pressure', v_v3 #> '{vehicle,frontRight,pressure}'
          ) ELSE NULL END,
        'rearLeft', CASE WHEN pg_catalog.jsonb_typeof(v_v3 #> '{vehicle,rearLeft}') = 'object' THEN
          pg_catalog.jsonb_build_object(
            'wearPercent', v_v3 #> '{vehicle,rearLeft,wearPercent}',
            'temperature', v_v3 #> '{vehicle,rearLeft,temperature}',
            'pressure', v_v3 #> '{vehicle,rearLeft,pressure}'
          ) ELSE NULL END,
        'rearRight', CASE WHEN pg_catalog.jsonb_typeof(v_v3 #> '{vehicle,rearRight}') = 'object' THEN
          pg_catalog.jsonb_build_object(
            'wearPercent', v_v3 #> '{vehicle,rearRight,wearPercent}',
            'temperature', v_v3 #> '{vehicle,rearRight,temperature}',
            'pressure', v_v3 #> '{vehicle,rearRight,pressure}'
          ) ELSE NULL END
      ),
      'opponents', coalesce((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', 'opponent-' || car.ord,
            'carName', car.value #>> '{carName}',
            'carNumber', car.value #>> '{carNumber}',
            'driverName', car.value #>> '{driverName}',
            'teamName', car.value #>> '{teamName}',
            'carClass', car.value #>> '{carClass}',
            'position', car.value #> '{position}',
            'classPosition', car.value #> '{classPosition}',
            'lap', car.value #> '{lap}',
            'lapDistancePct', car.value #> '{lapDistancePct}',
            'gapToPlayerSeconds', car.value #> '{gapToPlayerSeconds}',
            'gapToLeaderSeconds', car.value #> '{gapToLeaderSeconds}',
            'lastLapSeconds', car.value #> '{lastLapSeconds}',
            'bestLapSeconds', car.value #> '{bestLapSeconds}',
            'inPit', car.value #> '{inPit}',
            'connected', car.value #> '{connected}',
            'isPlayer', car.value #> '{isPlayer}'
          ) ORDER BY car.ord
        )
        FROM pg_catalog.jsonb_array_elements(
          CASE WHEN pg_catalog.jsonb_typeof(v_v3 #> '{opponents}') = 'array'
               THEN v_v3 #> '{opponents}' ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS car(value, ord)
        WHERE car.ord <= 40
      ), '[]'::jsonb)
    ),
    'laps', coalesce(v_laps, '[]'::jsonb),
    'pace', v_pace
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_shared_snapshot_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_shared_snapshot_v1(text) TO anon, authenticated;

COMMIT;
