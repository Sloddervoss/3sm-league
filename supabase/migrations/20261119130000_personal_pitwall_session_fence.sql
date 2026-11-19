-- Personal Pitwall: bind a public share to the *simulator* session, not only to
-- the reusable transport connection.
--
-- Why this migration exists
-- -------------------------
-- `transportSessionId` is created per connector process, not per iRacing/LMU
-- session. Practice -> qualifying -> race can therefore share one transport id,
-- one track and one race_run_id. The first share implementation compared only
-- those values plus counters relative to creation. A spectator holding an old
-- bearer link could read a later session on the same track as soon as the
-- session clock and lap counter had caught up again.
--
-- The connector already sends the real simulator identity in
-- `paceHistory.observedSessionId` ("sim-<SessionUniqueID>-s<SessionNum>", or
-- "sim-s<SessionNum>" when SimHub has no unique id). The measurement layer also
-- persists `observed_session_id` next to the transport id in
-- simhub_measurement_events / simhub_lap_summaries. This migration uses those
-- existing sources as the binding and adds an ingest-time fence so a share is
-- revoked even when no spectator is polling.
--
-- Security properties:
--  * Only opt-in shares are written; a link is still a bearer capability.
--  * A share is created only for an active session with a proven identity.
--  * Missing/ambiguous identity never discloses data.
--  * Any authoritative session change, reset, terminal signal or ingest gap
--    revokes the active share irreversibly at ingest.
--  * Reads fail closed when the current frame cannot prove the same identity.
--  * Public payload remains a bounded whitelist; raw pace history, account
--    metadata and transport/session identifiers are never returned.
--
-- This is additive: simhub_persist_v3 and the existing v1 RPCs are not edited.
-- The v1 reader/creator are revoked and replaced by v2 functions; rollback
-- re-grants the v1 surface.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Bind columns. Nullable for rollout safety; a null binding is treated as
--    unproven and can never disclose. New shares always write both values.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pitwall_shared_races
  ADD COLUMN IF NOT EXISTS observed_session_key text,
  ADD COLUMN IF NOT EXISTS track_id integer;

ALTER TABLE public.simhub_device_laps
  ADD COLUMN IF NOT EXISTS observed_session_id text;

CREATE INDEX IF NOT EXISTS simhub_device_laps_observed_session_idx
  ON public.simhub_device_laps (device_id, session_key, observed_session_id);

-- Resolver lookup by the existing delivery segment. Keeps owner discovery
-- bounded when a frame has no pace-history identity.
CREATE INDEX IF NOT EXISTS simhub_lap_summaries_device_delivered_idx
  ON public.simhub_lap_summaries (device_id, delivered_session_id);
CREATE INDEX IF NOT EXISTS simhub_measurement_events_device_delivered_idx
  ON public.simhub_measurement_events (device_id, delivered_session_id);

-- Old links were created without simulator-session provenance. They cannot be
-- proven safe, so fail closed instead of leaving a known hole open at deploy.
UPDATE public.pitwall_shared_races
SET revoked_at = pg_catalog.now(),
    revoke_reason = 'session_unproven'
WHERE revoked_at IS NULL
  AND observed_session_key IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Small, immutable identity predicates.
-- ---------------------------------------------------------------------------

-- The simulator session carried by this frame. The pace history must belong to
-- the same transport frame; a mixed/corrupt history is not identity evidence.
CREATE OR REPLACE FUNCTION public.pitwall_observed_session_v1(p_v3 jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_v3) = 'object'
     AND pg_catalog.jsonb_typeof(p_v3 -> 'paceHistory') = 'object'
     AND p_v3 #>> '{paceHistory,transportSessionId}' IS NOT NULL
     AND p_v3 #>> '{paceHistory,transportSessionId}' = p_v3 ->> 'transportSessionId'
     AND p_v3 #>> '{paceHistory,observedSessionId}' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
    THEN p_v3 #>> '{paceHistory,observedSessionId}'
  END;
$$;

REVOKE ALL ON FUNCTION public.pitwall_observed_session_v1(jsonb) FROM PUBLIC, anon, authenticated;

-- Terminal signals always win. "checkered" is included even while the state
-- string still says racing, because the flag arrives one frame earlier.
-- "meatball" is deliberately NOT terminal: it is the mechanical-warning flag
-- and real driving snapshots keep it set while the session continues.
CREATE OR REPLACE FUNCTION public.pitwall_share_terminal_v1(p_v3 jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT pg_catalog.jsonb_typeof(p_v3) = 'object'
     AND (
       pg_catalog.lower(coalesce(p_v3 #>> '{session,sessionState}', ''))
         IN ('checkered', 'cool_down', 'ended', 'not_in_world', 'stopped')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_array_elements_text(
           CASE WHEN pg_catalog.jsonb_typeof(p_v3 #> '{session,flags}') = 'array'
                THEN p_v3 #> '{session,flags}' ELSE '[]'::jsonb END
         ) AS flag(value)
         WHERE pg_catalog.lower(flag.value)
           IN ('checkered', 'checkered flag', 'black', 'disqualify')
       )
     );
$$;

REVOKE ALL ON FUNCTION public.pitwall_share_terminal_v1(jsonb) FROM PUBLIC, anon, authenticated;

-- Shareable activity. A known running state is credible on its own, but still
-- requires the driver to be in the car and a session clock of at least 20s.
-- "unknown" is explicitly NOT enough by itself: the production connector emits
-- it for live practice/race traffic, so it must be corroborated by an active
-- clock and a real lap/clock signal.
CREATE OR REPLACE FUNCTION public.pitwall_share_session_active_v2(p_v3 jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_state text;
  v_in_car boolean;
  v_time numeric;
  v_laps integer;
  v_lap_elapsed numeric;
  v_last_lap numeric;
BEGIN
  IF pg_catalog.jsonb_typeof(p_v3) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  -- Terminal overrides every other signal.
  IF public.pitwall_share_terminal_v1(p_v3) THEN
    RETURN false;
  END IF;

  BEGIN
    v_in_car := (p_v3 #>> '{session,isInCar}')::boolean;
  EXCEPTION WHEN OTHERS THEN
    v_in_car := NULL;
  END;

  IF pg_catalog.jsonb_typeof(p_v3 #> '{session,sessionTimeSeconds}') = 'number' THEN
    v_time := (p_v3 #>> '{session,sessionTimeSeconds}')::numeric;
  END IF;
  IF pg_catalog.jsonb_typeof(p_v3 #> '{timing,completedLaps}') = 'number' THEN
    v_laps := (p_v3 #>> '{timing,completedLaps}')::integer;
  END IF;
  IF pg_catalog.jsonb_typeof(p_v3 #> '{timing,currentLapElapsedSeconds}') = 'number' THEN
    v_lap_elapsed := (p_v3 #>> '{timing,currentLapElapsedSeconds}')::numeric;
  END IF;
  IF pg_catalog.jsonb_typeof(p_v3 #> '{timing,lastLapTimeSeconds}') = 'number' THEN
    v_last_lap := (p_v3 #>> '{timing,lastLapTimeSeconds}')::numeric;
  END IF;

  IF v_in_car IS NOT TRUE OR v_time IS NULL OR v_time < 20 THEN
    RETURN false;
  END IF;

  v_state := pg_catalog.lower(coalesce(p_v3 #>> '{session,sessionState}', ''));

  IF v_state IN ('racing', 'warmup', 'parade_laps', 'practice', 'qualifying',
                 'formation', 'gridding', 'countdown', 'fullcourseyellow') THEN
    RETURN true;
  END IF;

  -- Unknown state: require independent evidence that the sim is actually
  -- running for this driver. An unknown label alone can never open a share.
  IF v_state = 'unknown' OR v_state = '' THEN
    RETURN coalesce(v_laps, 0) > 0
        OR coalesce(v_lap_elapsed, 0) >= 10
        OR coalesce(v_last_lap, 0) > 0;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_share_session_active_v2(jsonb) FROM PUBLIC, anon, authenticated;

-- Public circuit identity. trackId is an official, public circuit identifier;
-- it carries no account metadata and is required for the real track geometry.
CREATE OR REPLACE FUNCTION public.pitwall_public_track_id_v1(p_v3 jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN (p_v3 #>> '{identity,trackId}') ~ '^[1-9][0-9]{0,9}$'
    THEN (p_v3 #>> '{identity,trackId}')::integer
  END;
$$;

REVOKE ALL ON FUNCTION public.pitwall_public_track_id_v1(jsonb) FROM PUBLIC, anon, authenticated;

-- Stable pseudonymous car key. The transport session is a random per-connector
-- UUID, so the same car keeps the same key while rows reorder, but the key
-- cannot be correlated across sessions and does not expose the raw opponent id
-- (which can be a driver name). Never output the raw input.
CREATE OR REPLACE FUNCTION public.pitwall_public_car_key_v1(p_session_key text, p_raw_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT 'car-' || pg_catalog.substr(
    pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(
          coalesce(nullif(p_session_key, ''), 'unbound')
          || '|' || coalesce(nullif(p_raw_id, ''), 'unknown'),
          'UTF8'
        )
      ),
      'hex'
    ),
    1, 12
  );
$$;

REVOKE ALL ON FUNCTION public.pitwall_public_car_key_v1(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Persisted session evidence for the current transport connection.
--    A frame identity wins. Without one, only a single unambiguous
--    observed_session_id from the existing server-side measurement segments
--    may be used. Two different ids for one transport connection are ambiguous
--    and resolve to NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pitwall_resolve_observed_session_v1(
  p_device_id uuid,
  p_transport_session_id text,
  p_v3 jsonb,
  p_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_frame text;
  v_count integer;
  v_latest text;
BEGIN
  v_frame := public.pitwall_observed_session_v1(p_v3);
  IF v_frame IS NOT NULL THEN
    RETURN v_frame;
  END IF;

  IF p_device_id IS NULL
     OR p_transport_session_id IS NULL
     OR char_length(p_transport_session_id) NOT BETWEEN 1 AND 120
     OR p_at IS NULL THEN
    RETURN NULL;
  END IF;

  WITH evidence AS (
    SELECT observed_session_id, received_at
    FROM public.simhub_lap_summaries
    WHERE device_id = p_device_id::text
      AND delivered_session_id = p_transport_session_id
      AND observed_session_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
      AND received_at >= p_at - interval '6 hours'
      AND received_at <= p_at + interval '10 seconds'
    UNION ALL
    SELECT observed_session_id, received_at
    FROM public.simhub_measurement_events
    WHERE device_id = p_device_id::text
      AND delivered_session_id = p_transport_session_id
      AND observed_session_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'
      AND received_at >= p_at - interval '6 hours'
      AND received_at <= p_at + interval '10 seconds'
  )
  SELECT count(DISTINCT observed_session_id),
         (pg_catalog.array_agg(observed_session_id ORDER BY received_at DESC))[1]
  INTO v_count, v_latest
  FROM evidence;

  IF v_count = 1 THEN
    RETURN v_latest;
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_resolve_observed_session_v1(uuid, text, jsonb, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Ingest-time lifecycle fence. This runs even when nobody is watching the
--    share. It is deliberately exception-safe: a fence failure must never cost
--    a telemetry frame.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pitwall_session_fence_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$
DECLARE
  v_share public.pitwall_shared_races%ROWTYPE;
  v_old_id text;
  v_new_id text;
  v_old_time numeric;
  v_new_time numeric;
  v_old_remaining numeric;
  v_new_remaining numeric;
  v_old_laps integer;
  v_new_laps integer;
  v_reason text;
BEGIN
  -- Cheap indexed probe: do nothing at all when this device is not shared.
  IF NOT EXISTS (
    SELECT 1
    FROM public.pitwall_shared_races s
    WHERE s.device_id = NEW.device_id
      AND s.revoked_at IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_share
  FROM public.pitwall_shared_races s
  WHERE s.device_id = NEW.device_id
    AND s.revoked_at IS NULL
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_share.observed_session_key IS NULL THEN
    v_reason := 'session_unproven';
  ELSIF TG_OP = 'UPDATE' AND (
       NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.track_name IS DISTINCT FROM OLD.track_name
    OR NEW.track_config IS DISTINCT FROM OLD.track_config
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
  ) THEN
    v_reason := 'session_changed';
  ELSIF public.pitwall_share_terminal_v1(NEW.v3_normalized) THEN
    v_reason := 'session_ended';
  ELSE
    v_new_id := public.pitwall_resolve_observed_session_v1(
      NEW.device_id, NEW.session_id, NEW.v3_normalized, NEW.received_at
    );

    IF v_new_id IS NULL THEN
      -- Identity was proven at creation and must remain provable. A gap in the
      -- evidence is not continuity.
      v_reason := 'session_unproven';
    ELSIF v_new_id IS DISTINCT FROM v_share.observed_session_key THEN
      v_reason := 'session_changed';
    ELSIF v_share.track_id IS NOT NULL
       AND public.pitwall_public_track_id_v1(NEW.v3_normalized) IS NOT NULL
       AND public.pitwall_public_track_id_v1(NEW.v3_normalized) IS DISTINCT FROM v_share.track_id THEN
      v_reason := 'session_changed';
    ELSIF TG_OP = 'UPDATE' THEN
      v_old_id := public.pitwall_resolve_observed_session_v1(
        OLD.device_id, OLD.session_id, OLD.v3_normalized, OLD.received_at
      );

      -- Identity disappearing and reappearing under one transport connection is
      -- not proof of the same simulator session.
      IF v_old_id IS NOT NULL AND v_old_id IS DISTINCT FROM v_new_id THEN
        v_reason := 'session_changed';
      END IF;

      IF pg_catalog.jsonb_typeof(OLD.v3_normalized #> '{session,sessionTimeSeconds}') = 'number' THEN
        v_old_time := (OLD.v3_normalized #>> '{session,sessionTimeSeconds}')::numeric;
      END IF;
      IF pg_catalog.jsonb_typeof(NEW.v3_normalized #> '{session,sessionTimeSeconds}') = 'number' THEN
        v_new_time := (NEW.v3_normalized #>> '{session,sessionTimeSeconds}')::numeric;
      END IF;
      IF pg_catalog.jsonb_typeof(OLD.v3_normalized #> '{session,sessionTimeRemainingSeconds}') = 'number' THEN
        v_old_remaining := (OLD.v3_normalized #>> '{session,sessionTimeRemainingSeconds}')::numeric;
      END IF;
      IF pg_catalog.jsonb_typeof(NEW.v3_normalized #> '{session,sessionTimeRemainingSeconds}') = 'number' THEN
        v_new_remaining := (NEW.v3_normalized #>> '{session,sessionTimeRemainingSeconds}')::numeric;
      END IF;
      IF pg_catalog.jsonb_typeof(OLD.v3_normalized #> '{timing,completedLaps}') = 'number' THEN
        v_old_laps := (OLD.v3_normalized #>> '{timing,completedLaps}')::integer;
      END IF;
      IF pg_catalog.jsonb_typeof(NEW.v3_normalized #> '{timing,completedLaps}') = 'number' THEN
        v_new_laps := (NEW.v3_normalized #>> '{timing,completedLaps}')::integer;
      END IF;

      IF v_reason IS NULL THEN
        IF v_new_time IS NOT NULL
           AND v_new_time < v_share.anchor_session_time_seconds - 10 THEN
          v_reason := 'session_reset';
        ELSIF v_new_laps IS NOT NULL
           AND v_new_laps < v_share.anchor_completed_laps THEN
          v_reason := 'session_reset';
        ELSIF v_old_time IS NOT NULL AND v_new_time IS NOT NULL
           AND v_new_time < v_old_time - 15 THEN
          v_reason := 'session_reset';
        ELSIF v_old_laps IS NOT NULL AND v_new_laps IS NOT NULL
           AND v_new_laps < v_old_laps THEN
          v_reason := 'session_reset';
        -- A new session restarts with a much larger remaining clock while the
        -- elapsed clock has not advanced normally.
        ELSIF v_old_remaining IS NOT NULL AND v_new_remaining IS NOT NULL
           AND v_new_remaining > v_old_remaining + 300
           AND coalesce(v_new_time, 0) <= coalesce(v_old_time, 0) + 60 THEN
          v_reason := 'session_reset';
        -- A hole in the ingest stream is not proven continuity. The connector
        -- can resume, but the old capability must not be reused for it.
        ELSIF NEW.received_at > OLD.received_at + interval '120 seconds' THEN
          v_reason := 'session_gap';
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    UPDATE public.pitwall_shared_races
    SET revoked_at = pg_catalog.now(),
        revoke_reason = pg_catalog.left(v_reason, 40)
    WHERE device_id = NEW.device_id
      AND revoked_at IS NULL;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block ingest. Failing to fence is handled by the fail-closed reader:
  -- a missing/ambiguous identity is never disclosed.
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_session_fence_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pitwall_session_fence_trg ON public.simhub_telemetry_latest;
CREATE TRIGGER pitwall_session_fence_trg
  AFTER INSERT OR UPDATE ON public.simhub_telemetry_latest
  FOR EACH ROW
  EXECUTE FUNCTION public.pitwall_session_fence_v1();

-- ---------------------------------------------------------------------------
-- 5. Stamp the archive row with the simulator session it belongs to, so a
--    reusable transport id can never aggregate laps from two sessions. Rows
--    without a proven identity keep NULL and are omitted from public reads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.simhub_capture_lap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_lap integer;
  v_vorige integer;
  v_tijd numeric;
  v_sessie text;
  v_driver text;
  v_device uuid;
  v_observed text;
BEGIN
  v_lap := nullif(new.v3_normalized->'timing'->>'completedLaps', '')::integer;
  if v_lap is null or v_lap <= 0 then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_vorige := nullif(old.v3_normalized->'timing'->>'completedLaps', '')::integer;
    if v_vorige is not null and v_lap <= v_vorige then
      return new;
    end if;
  end if;

  v_tijd := nullif(new.v3_normalized->'timing'->>'lastLapTimeSeconds', '')::numeric;
  v_sessie := coalesce(nullif(new.v3_normalized->>'transportSessionId', ''), 'onbekend');
  v_driver := nullif(new.current_driver_name, '');
  v_observed := public.pitwall_resolve_observed_session_v1(
    new.device_id, v_sessie, new.v3_normalized, new.received_at
  );

  select id into v_device from public.simhub_devices where connector_id = new.connector_id;
  if v_device is null then
    return new;
  end if;

  insert into public.simhub_device_laps
    (device_id, connector_id, session_key, lap_number, lap_seconds, driver_name, captured_at, observed_session_id)
  values
    (v_device, new.connector_id, v_sessie, v_lap, v_tijd, v_driver, coalesce(new.captured_at, now()), v_observed)
  on conflict (device_id, session_key, lap_number) do nothing;

  return new;
exception
  when others then
    return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Owner discovery. Adds the explicit reason so the UI can be honest about a
--    session that cannot be shared (missing identity, unknown-but-inactive).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pitwall_my_devices_v2()
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
            'shareable_reason', (
              CASE
                WHEN t.received_at IS NULL OR t.received_at <= pg_catalog.now() - interval '90 seconds' THEN 'not_fresh'
                WHEN t.session_id IS NULL THEN 'no_session'
                WHEN coalesce(t.v3_normalized #>> '{identity,trackName}', '') = '' THEN 'no_track'
                WHEN public.pitwall_share_terminal_v1(t.v3_normalized) THEN 'session_ended'
                WHEN NOT public.pitwall_share_session_active_v2(t.v3_normalized) THEN 'session_inactive'
                WHEN public.pitwall_resolve_observed_session_v1(d.id, t.session_id, t.v3_normalized, t.received_at) IS NULL THEN 'session_unproven'
              END
            ),
            'shareable', (
              t.received_at IS NOT NULL
              AND t.received_at > pg_catalog.now() - interval '90 seconds'
              AND t.session_id IS NOT NULL
              AND coalesce(t.v3_normalized #>> '{identity,trackName}', '') <> ''
              AND public.pitwall_share_session_active_v2(t.v3_normalized)
              AND public.pitwall_resolve_observed_session_v1(d.id, t.session_id, t.v3_normalized, t.received_at) IS NOT NULL
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
            AND tel.owner_user_id = d.owner_user_id
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
          AND (d.expires_at IS NULL OR d.expires_at > pg_catalog.now())
        ORDER BY ord
        LIMIT 20
      ) ranked
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_my_devices_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_my_devices_v2() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Owner detail. Both the initial authorization query and the final row query
--    are owner-bound, and the telemetry row must belong to the same owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pitwall_owner_device_detail_v2(p_device_id uuid)
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
  WHERE d.id = p_device_id
    AND d.owner_user_id = v_uid
    AND d.revoked_at IS NULL
    AND coalesce(d.device_status, '') <> 'revoked'
    AND (d.expires_at IS NULL OR d.expires_at > pg_catalog.now());

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
          AND t.owner_user_id = v_uid
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
      AND d.owner_user_id = v_uid
      AND d.revoked_at IS NULL
      AND coalesce(d.device_status, '') <> 'revoked'
      AND (d.expires_at IS NULL OR d.expires_at > pg_catalog.now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_owner_device_detail_v2(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_owner_device_detail_v2(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Share creation. Identity is mandatory and comes from the server-side
--    telemetry row (or the existing persisted measurement segments). The caller
--    can never choose session, track or owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pitwall_share_create_v2(
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
  v_track_id integer;
  v_observed text;
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
  WHERE t.device_id = v_device.id
    AND t.owner_user_id = v_uid;

  IF NOT FOUND OR v_telemetry.received_at IS NULL
     OR v_telemetry.received_at < pg_catalog.now() - interval '90 seconds' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_fresh');
  END IF;

  v_v3 := v_telemetry.v3_normalized;
  v_session_time := nullif(v_v3 #>> '{session,sessionTimeSeconds}', '')::numeric;
  v_completed_laps := nullif(v_v3 #>> '{timing,completedLaps}', '')::integer;
  v_track_name := nullif(v_v3 #>> '{identity,trackName}', '');
  v_track_config := nullif(v_v3 #>> '{identity,trackConfig}', '');
  v_track_id := public.pitwall_public_track_id_v1(v_v3);

  IF v_telemetry.session_id IS NULL
     OR v_track_name IS NULL
     OR v_session_time IS NULL OR v_session_time < 20
     OR v_completed_laps IS NULL OR v_completed_laps < 0
     OR NOT public.pitwall_share_session_active_v2(v_v3) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'not_shareable');
  END IF;

  v_observed := public.pitwall_resolve_observed_session_v1(
    v_device.id,
    v_telemetry.session_id,
    v_v3,
    v_telemetry.received_at
  );

  IF v_observed IS NULL THEN
    -- No proven simulator identity: a bearer link could survive into a later
    -- session on the same transport. Do not create one.
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'session_unproven');
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
    anchor_completed_laps, expires_at, observed_session_key, track_id
  ) VALUES (
    v_hash, v_uid, v_device.id, v_telemetry.session_id, v_track_name,
    v_track_config, v_telemetry.race_run_id, v_session_time,
    v_completed_laps, v_expires_at, v_observed, v_track_id
  );

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'token', v_token,
    'expires_at', v_expires_at,
    'created_at', pg_catalog.now(),
    'session_key', v_telemetry.session_id,
    'track_name', v_track_name,
    'track_config', v_track_config,
    'track_id', v_track_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_share_create_v2(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_share_create_v2(uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Public sector projection helper. Whitelists only the fields the timing
--    panel needs. Unknown/malformed entries are skipped individually.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pitwall_public_sector_car_v1(
  p_session_key text,
  p_car jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_key text;
  v_raw text;
  v_sectors jsonb := '[]'::jsonb;
  v_bests jsonb := '[]'::jsonb;
  v_item jsonb;
  v_idx integer;
  v_count integer;
  v_layout integer;
  v_seconds numeric;
  v_lap integer;
  v_status text;
  v_metrics jsonb;
  v_metric_count integer;
BEGIN
  IF pg_catalog.jsonb_typeof(p_car) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;

  v_raw := nullif(p_car ->> 'id', '');
  IF v_raw IS NULL OR char_length(v_raw) > 64 THEN
    RETURN NULL;
  END IF;
  v_key := public.pitwall_public_car_key_v1(p_session_key, v_raw);

  IF pg_catalog.jsonb_typeof(p_car -> 'sectors') = 'array' THEN
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_car -> 'sectors') LOOP
      BEGIN
        IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
        IF (v_item ->> 'sectorIndex') IS NULL
           OR (v_item ->> 'sectorIndex') !~ '^[0-9]{1,2}$'
           OR (v_item ->> 'sectorCount') IS NULL
           OR (v_item ->> 'sectorCount') !~ '^[0-9]{1,2}$' THEN CONTINUE; END IF;
        v_idx := (v_item ->> 'sectorIndex')::integer;
        v_count := (v_item ->> 'sectorCount')::integer;
        IF v_count NOT BETWEEN 1 AND 16 OR v_idx NOT BETWEEN 0 AND v_count - 1 THEN CONTINUE; END IF;
        IF v_layout IS NULL THEN
          v_layout := v_count;
        ELSIF v_layout <> v_count THEN
          CONTINUE;
        END IF;
        v_status := v_item ->> 'status';
        IF v_status NOT IN ('provisional', 'verified', 'invalidated') THEN CONTINUE; END IF;
        IF (v_item ->> 'lap') IS NULL OR (v_item ->> 'lap') !~ '^[0-9]{1,6}$' THEN CONTINUE; END IF;
        v_lap := (v_item ->> 'lap')::integer;
        IF v_lap NOT BETWEEN 1 AND 100000 THEN CONTINUE; END IF;

        v_seconds := NULL;
        IF v_status <> 'invalidated' THEN
          IF pg_catalog.jsonb_typeof(v_item -> 'seconds') IS DISTINCT FROM 'number' THEN CONTINUE; END IF;
          v_seconds := (v_item ->> 'seconds')::numeric;
          IF v_seconds <= 0 OR v_seconds > 86400 THEN CONTINUE; END IF;
        END IF;

        v_sectors := v_sectors || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'sectorIndex', v_idx,
            'sectorCount', v_count,
            'lap', v_lap,
            'seconds', v_seconds,
            'status', v_status,
            'referenceSeconds', CASE WHEN pg_catalog.jsonb_typeof(v_item -> 'referenceSeconds') = 'number'
                                     THEN (v_item ->> 'referenceSeconds')::numeric END,
            'revision', CASE WHEN (v_item ->> 'revision') ~ '^[0-9]{1,16}$'
                             THEN (v_item ->> 'revision')::numeric END,
            'completedSessionTimeSeconds', CASE WHEN pg_catalog.jsonb_typeof(v_item -> 'completedSessionTimeSeconds') = 'number'
                                                THEN (v_item ->> 'completedSessionTimeSeconds')::numeric END,
            'observedSessionTimeSeconds', CASE WHEN pg_catalog.jsonb_typeof(v_item -> 'observedSessionTimeSeconds') = 'number'
                                               THEN (v_item ->> 'observedSessionTimeSeconds')::numeric END
          )
        );
      EXCEPTION WHEN OTHERS THEN
        CONTINUE;
      END;
    END LOOP;
  END IF;

  IF pg_catalog.jsonb_typeof(p_car -> 'sectorBests') = 'array' THEN
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_car -> 'sectorBests') LOOP
      BEGIN
        IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN CONTINUE; END IF;
        IF (v_item ->> 'sectorIndex') IS NULL OR (v_item ->> 'sectorIndex') !~ '^[0-9]{1,2}$' THEN CONTINUE; END IF;
        v_idx := (v_item ->> 'sectorIndex')::integer;
        IF v_idx NOT BETWEEN 0 AND 15 THEN CONTINUE; END IF;
        IF pg_catalog.jsonb_typeof(v_item -> 'seconds') IS DISTINCT FROM 'number' THEN CONTINUE; END IF;
        v_seconds := (v_item ->> 'seconds')::numeric;
        IF v_seconds <= 0 OR v_seconds > 86400 THEN CONTINUE; END IF;
        v_bests := v_bests || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'sectorIndex', v_idx,
            'lap', CASE WHEN (v_item ->> 'lap') ~ '^[0-9]{1,6}$' THEN (v_item ->> 'lap')::integer END,
            'seconds', v_seconds
          )
        );
      EXCEPTION WHEN OTHERS THEN
        CONTINUE;
      END;
    END LOOP;
  END IF;

  v_metrics := '{}'::jsonb;
  v_metric_count := NULL;
  IF pg_catalog.jsonb_typeof(p_car -> 'metrics') = 'object' THEN
    IF (p_car #>> '{metrics,sectorCount}') ~ '^[0-9]{1,2}$' THEN
      v_metric_count := (p_car #>> '{metrics,sectorCount}')::integer;
      IF v_metric_count NOT BETWEEN 1 AND 16 THEN v_metric_count := NULL; END IF;
    END IF;
    v_metrics := pg_catalog.jsonb_build_object(
      'observedSessionTimeSeconds', CASE WHEN pg_catalog.jsonb_typeof(p_car #> '{metrics,observedSessionTimeSeconds}') = 'number'
                                         THEN (p_car #>> '{metrics,observedSessionTimeSeconds}')::numeric END,
      'lastLapSeconds', CASE WHEN pg_catalog.jsonb_typeof(p_car #> '{metrics,lastLapSeconds}') = 'number'
                             THEN (p_car #>> '{metrics,lastLapSeconds}')::numeric END,
      'bestLapSeconds', CASE WHEN pg_catalog.jsonb_typeof(p_car #> '{metrics,bestLapSeconds}') = 'number'
                             THEN (p_car #>> '{metrics,bestLapSeconds}')::numeric END,
      'lastLapSectorSeconds', CASE WHEN pg_catalog.jsonb_typeof(p_car #> '{metrics,lastLapSectorSeconds}') = 'array'
                                   THEN p_car #> '{metrics,lastLapSectorSeconds}' END,
      'bestLapSectorSeconds', CASE WHEN pg_catalog.jsonb_typeof(p_car #> '{metrics,bestLapSectorSeconds}') = 'array'
                                   THEN p_car #> '{metrics,bestLapSectorSeconds}' END,
      'sectorCount', coalesce(v_layout, v_metric_count),
      'sectorLap', CASE WHEN (p_car #>> '{metrics,sectorLap}') ~ '^[0-9]{1,6}$'
                        THEN (p_car #>> '{metrics,sectorLap}')::integer END,
      'lapValid', CASE WHEN pg_catalog.jsonb_typeof(p_car #> '{metrics,lapValid}') = 'boolean'
                       THEN (p_car #> '{metrics,lapValid}')::boolean END,
      'sectorSource', CASE WHEN (p_car #>> '{metrics,sectorSource}') IN ('measured', 'simhub')
                           THEN p_car #>> '{metrics,sectorSource}' END,
      'sectorErrorSeconds', CASE WHEN pg_catalog.jsonb_typeof(p_car #> '{metrics,sectorErrorSeconds}') = 'number'
                                 THEN (p_car #>> '{metrics,sectorErrorSeconds}')::numeric END
    );
  END IF;

  IF pg_catalog.jsonb_array_length(v_sectors) = 0
     AND pg_catalog.jsonb_array_length(v_bests) = 0
     AND v_metric_count IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_layout IS NOT NULL AND v_metric_count IS NOT NULL AND v_layout <> v_metric_count THEN
    v_metric_count := NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'id', v_key,
    'sectorCount', coalesce(v_layout, v_metric_count),
    'sectors', v_sectors,
    'sectorBests', v_bests,
    'metrics', v_metrics
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_public_sector_car_v1(text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Public reader. Bounded whitelist, identity-bound, terminal-first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pitwall_shared_snapshot_v2(p_token text)
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
  v_observed text;
  v_track_id integer;
  v_laps jsonb;
  v_pace jsonb;
  v_pace_history jsonb;
  v_sector_cars jsonb := '[]'::jsonb;
  v_sector_count integer := 0;
  v_sector_reason text;
  v_sector_layouts integer := 0;
  v_opponent_keys jsonb := '[]'::jsonb;
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
  v_observed := public.pitwall_resolve_observed_session_v1(
    v_share.device_id, v_telemetry.session_id, v_v3, v_telemetry.received_at
  );
  v_track_id := public.pitwall_public_track_id_v1(v_v3);

  SELECT coalesce(pg_catalog.jsonb_agg(
           public.pitwall_public_car_key_v1(
             v_share.session_key,
             coalesce(nullif(car.value ->> 'id', ''), nullif(car.value ->> 'carNumber', ''), 'unknown')
           )
         ), '[]'::jsonb)
  INTO v_opponent_keys
  FROM pg_catalog.jsonb_array_elements(
    CASE WHEN pg_catalog.jsonb_typeof(v_v3 #> '{opponents}') = 'array'
         THEN v_v3 #> '{opponents}' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS car(value, ord)
  WHERE car.ord <= 40;

  -- Terminal signals override every identity/counter check.
  IF public.pitwall_share_terminal_v1(v_v3) THEN
    UPDATE public.pitwall_shared_races
    SET revoked_at = pg_catalog.now(), revoke_reason = 'session_ended'
    WHERE id = v_share.id AND revoked_at IS NULL;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ended');
  END IF;

  -- The share exists only for the simulator session proven at creation. An
  -- absent identity is not continuity and must not disclose.
  IF v_share.observed_session_key IS NULL
     OR v_observed IS NULL
     OR v_observed IS DISTINCT FROM v_share.observed_session_key THEN
    UPDATE public.pitwall_shared_races
    SET revoked_at = pg_catalog.now(), revoke_reason = 'session_changed'
    WHERE id = v_share.id AND revoked_at IS NULL;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ended');
  END IF;

  IF v_telemetry.owner_user_id IS DISTINCT FROM v_share.owner_user_id
     OR v_telemetry.session_id IS DISTINCT FROM v_share.session_key
     OR v_track_name IS DISTINCT FROM v_share.track_name
     OR v_track_config IS DISTINCT FROM v_share.track_config
     OR v_telemetry.race_run_id IS DISTINCT FROM v_share.race_run_id
     OR (v_share.track_id IS NOT NULL AND v_track_id IS NOT NULL AND v_track_id IS DISTINCT FROM v_share.track_id)
     OR v_session_time IS NULL
     OR v_session_time < v_share.anchor_session_time_seconds - 10
     OR v_completed_laps IS NULL
     OR v_completed_laps < v_share.anchor_completed_laps THEN
    UPDATE public.pitwall_shared_races
    SET revoked_at = pg_catalog.now(), revoke_reason = 'session_ended'
    WHERE id = v_share.id AND revoked_at IS NULL;
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'ended');
  END IF;

  -- Identity is proven. Activity may legitimately pause (driver out of car, pit
  -- menu); that is a wait, not a disclosure. Terminal was handled above.
  IF NOT public.pitwall_share_session_active_v2(v_v3) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'waiting');
  END IF;

  IF v_telemetry.received_at < pg_catalog.now() - interval '90 seconds' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'stale');
  END IF;

  -- Laps are joined on the simulator session, never on the reusable transport
  -- alone. Legacy/ambiguous rows have NULL and are omitted.
  SELECT pg_catalog.jsonb_agg(lap_row ORDER BY lap_number) INTO v_laps
  FROM (
    SELECT
      l.lap_number,
      pg_catalog.jsonb_build_object('lap', l.lap_number, 'seconds', l.lap_seconds) AS lap_row
    FROM public.simhub_device_laps l
    WHERE l.device_id = v_share.device_id
      AND l.session_key = v_share.session_key
      AND l.observed_session_id = v_share.observed_session_key
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
    AND l.observed_session_id = v_share.observed_session_key
    AND l.lap_seconds IS NOT NULL
    AND l.lap_seconds BETWEEN 20 AND 600;

  -- Bounded public sector projection from the pace history that belongs to the
  -- exact bound simulator session. Raw ids, traces, account fields and the
  -- history itself never leave this function.
  v_pace_history := v_v3 -> 'paceHistory';
  BEGIN
  IF pg_catalog.jsonb_typeof(v_pace_history) = 'object'
     AND v_pace_history ->> 'observedSessionId' = v_share.observed_session_key
     AND v_pace_history ->> 'transportSessionId' = v_share.session_key
     AND (v_pace_history ->> 'updatedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([+-][0-9]{2}:[0-9]{2}|Z)?$'
     AND (v_pace_history ->> 'updatedAt')::timestamptz >= pg_catalog.now() - interval '24 hours'
     AND (v_pace_history ->> 'updatedAt')::timestamptz <= pg_catalog.now() + interval '10 seconds'
     AND pg_catalog.jsonb_typeof(v_pace_history -> 'cars') = 'array' THEN
    SELECT coalesce(pg_catalog.jsonb_agg(car_obj ORDER BY ord), '[]'::jsonb)
    INTO v_sector_cars
    FROM (
      SELECT
        public.pitwall_public_sector_car_v1(v_share.session_key, car.value) AS car_obj,
        car.ord
      FROM pg_catalog.jsonb_array_elements(v_pace_history -> 'cars')
        WITH ORDINALITY AS car(value, ord)
      WHERE car.ord <= 40
    ) projected
    WHERE car_obj IS NOT NULL;

    -- Only cars that are actually in the current bounded opponent snapshot.
    -- A stale pace car from earlier in the session is not disclosed.
    SELECT coalesce(pg_catalog.jsonb_agg(car), '[]'::jsonb)
    INTO v_sector_cars
    FROM pg_catalog.jsonb_array_elements(v_sector_cars) AS car
    WHERE v_opponent_keys @> pg_catalog.jsonb_build_array(car ->> 'id');

    SELECT pg_catalog.count(DISTINCT layout_count)
    INTO v_sector_layouts
    FROM (
      SELECT CASE WHEN (car ->> 'sectorCount') ~ '^[0-9]{1,2}$'
                  THEN (car ->> 'sectorCount')::integer END AS layout_count
      FROM pg_catalog.jsonb_array_elements(v_sector_cars) AS car
    ) layouts
    WHERE layout_count BETWEEN 1 AND 16;
  ELSE
    v_sector_reason := CASE
      WHEN pg_catalog.jsonb_typeof(v_pace_history) = 'object' THEN 'session_mismatch'
      ELSE 'no_pace_data'
    END;
  END IF;
  EXCEPTION WHEN OTHERS THEN
    -- A malformed history is an unavailable board, never an RPC failure and
    -- never a guessed layout.
    v_sector_cars := '[]'::jsonb;
    v_sector_count := 0;
    v_sector_reason := 'no_sector_data';
  END;

  IF v_sector_reason IS NULL THEN
    IF pg_catalog.jsonb_array_length(v_sector_cars) = 0 THEN
      v_sector_reason := 'no_sector_data';
    ELSIF v_sector_layouts = 1 THEN
      SELECT CASE WHEN (car ->> 'sectorCount') ~ '^[0-9]{1,2}$'
                  THEN (car ->> 'sectorCount')::integer END
      INTO v_sector_count
      FROM pg_catalog.jsonb_array_elements(v_sector_cars) AS car
      WHERE (car ->> 'sectorCount') ~ '^[0-9]{1,2}$'
      LIMIT 1;
      v_sector_reason := NULL;
    ELSE
      -- Different layouts in one history cannot be presented as one board.
      v_sector_cars := '[]'::jsonb;
      v_sector_count := 0;
      v_sector_reason := 'ambiguous_layout';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'created_at', v_share.created_at,
    'expires_at', v_share.expires_at,
    'updated_at', v_telemetry.received_at,
    'circuit', pg_catalog.jsonb_build_object(
      'trackId', v_track_id,
      'name', v_share.track_name,
      'config', v_share.track_config
    ),
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
        'trackConfig', v_v3 #>> '{identity,trackConfig}',
        'trackId', v_track_id
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
        'completedLaps', v_v3 #> '{timing,completedLaps}',
        'sector1Seconds', v_v3 #> '{timing,sector1Seconds}',
        'sector2Seconds', v_v3 #> '{timing,sector2Seconds}',
        'sector3Seconds', v_v3 #> '{timing,sector3Seconds}'
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
            'id', public.pitwall_public_car_key_v1(v_share.session_key, coalesce(nullif(car.value ->> 'id', ''), nullif(car.value ->> 'carNumber', ''), 'unknown')),
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
    'sectors', pg_catalog.jsonb_build_object(
      'available', (v_sector_count BETWEEN 1 AND 16 AND pg_catalog.jsonb_array_length(v_sector_cars) > 0),
      'reason', v_sector_reason,
      'sectorCount', v_sector_count,
      'cars', v_sector_cars
    ),
    'laps', coalesce(v_laps, '[]'::jsonb),
    'pace', v_pace
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pitwall_shared_snapshot_v2(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pitwall_shared_snapshot_v2(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Retire the transport-only v1 surface. The old snapshot could read a later
--     simulator session on the same transport; it must not remain callable.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.pitwall_shared_snapshot_v1(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pitwall_share_create_v1(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pitwall_my_devices_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pitwall_owner_device_detail_v1(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
