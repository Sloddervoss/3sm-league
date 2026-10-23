-- ============================================================================
-- Endurance — practice-ronden vastleggen in de v3-ingest
-- Datum: 2026-10-23
--
-- Het oude simhub_ingest_snapshot schreef elke afgeronde ronde naar
-- endurance_practice_laps. De v3-route deed dat niet, dus een actieve
-- practice-sessie bleef altijd leeg terwijl er wel gereden werd.
--
-- Zelfde velden als voorheen, alleen genest onder timing en fuel, met dezelfde
-- unieke sleutel zodat een ronde nooit dubbel telt.
-- ============================================================================

BEGIN;

-- De identiteitskolommen uit 20260809151000 staan niet in productie, waardoor de
-- opname daar nooit heeft kunnen werken. Hier alsnog, idempotent.
ALTER TABLE public.endurance_practice_laps
  ADD COLUMN IF NOT EXISTS source_session_id text,
  ADD COLUMN IF NOT EXISTS source_device_id uuid REFERENCES public.simhub_devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_laps integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'endurance_practice_laps_completed_laps_check'
      AND conrelid = 'public.endurance_practice_laps'::regclass
  ) THEN
    ALTER TABLE public.endurance_practice_laps
      ADD CONSTRAINT endurance_practice_laps_completed_laps_check
      CHECK (completed_laps IS NULL OR completed_laps >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS endurance_practice_laps_source_identity_uidx
  ON public.endurance_practice_laps (event_id, source_session_id, source_device_id, completed_laps)
  WHERE source_session_id IS NOT NULL AND source_device_id IS NOT NULL AND completed_laps IS NOT NULL;

CREATE OR REPLACE FUNCTION public.simhub_persist_v3(
    p_token_hash text,
    p_session_id text,
    p_sequence bigint,
    p_captured_at timestamptz,
    p_v3_normalized jsonb
) RETURNS TABLE(result text, received_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $function$

DECLARE
  d public.simhub_devices%ROWTYPE;
  s public.endurance_source_segments%ROWTYPE;
  e uuid; t uuid; r uuid;
  now_at timestamptz := clock_timestamp();
  nl integer; ni integer; np boolean; nf text[];
  v_session_sequence bigint; v_session_count integer;
  baseline boolean := false; k text; payload jsonb;
  v_fuel numeric; v_last_laptime numeric; v_session_laps integer;
  v_driver_name text; v_driver_id text;
  v_practice_session_id uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::timestamptz; RETURN;
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$'
     OR char_length(coalesce(p_session_id,'')) NOT BETWEEN 1 AND 120
     OR p_sequence IS NULL OR p_sequence < 0
     OR p_captured_at IS NULL
     OR jsonb_typeof(p_v3_normalized) <> 'object' THEN
    RETURN QUERY SELECT 'invalid_payload'::text, NULL::timestamptz; RETURN;
  END IF;

  SELECT * INTO d FROM public.simhub_devices WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid_device'::text, NULL::timestamptz; RETURN; END IF;
  IF d.revoked_at IS NOT NULL THEN RETURN QUERY SELECT 'revoked'::text, NULL::timestamptz; RETURN; END IF;

  -- Routing vereist een actieve binding. Een inschrijving is GEEN voorwaarde meer:
  -- de binding is de beheerder beslis, en een ontbrekende registratie mag een
  -- correct gekoppeld device niet stil in de device-scoped modus laten vallen.
  IF d.endurance_event_id IS NOT NULL AND d.endurance_team_id IS NOT NULL
     AND d.device_status = 'active_binding' AND d.device_role = 'primary'
  THEN
    e := d.endurance_event_id; t := d.endurance_team_id;

    SELECT id INTO r FROM public.endurance_race_runs
    WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
    LIMIT 1;

    -- Zonder actieve race run is het lap-event onbereikbaar. Start er een.
    IF r IS NULL THEN
      PERFORM public.simhub_start_race_run(e, t, 'race');
      SELECT id INTO r FROM public.endurance_race_runs
      WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
      LIMIT 1;
    END IF;
  ELSE
    e := NULL; t := NULL; r := NULL;
  END IF;

  IF d.last_seen_at IS NOT NULL AND d.last_seen_at > now_at - interval '400 milliseconds' THEN
    RETURN QUERY SELECT 'rate_limited'::text, now_at; RETURN;
  END IF;
  SELECT last_sequence INTO v_session_sequence
  FROM public.simhub_device_sessions WHERE device_id = d.id AND session_id = p_session_id FOR UPDATE;
  IF FOUND AND p_sequence <= v_session_sequence THEN
    RETURN QUERY SELECT 'replayed'::text, now_at; RETURN;
  END IF;
  IF NOT FOUND THEN
    SELECT count(*) INTO v_session_count FROM public.simhub_device_sessions WHERE device_id = d.id;
    -- Een device dat zijn plafond raakt mag niet permanent dood zijn. Ruim de
    -- oudste sessies op en houd de recente geschiedenis voor replay-detectie.
    IF v_session_count >= 64 THEN
      DELETE FROM public.simhub_device_sessions AS oud
      WHERE oud.device_id = d.id
        AND oud.session_id NOT IN (
          SELECT nieuw.session_id FROM public.simhub_device_sessions AS nieuw
          WHERE nieuw.device_id = d.id
          ORDER BY nieuw.last_seen_at DESC NULLS LAST
          LIMIT 48
        );
      SELECT count(*) INTO v_session_count FROM public.simhub_device_sessions WHERE device_id = d.id;
    END IF;
    IF v_session_count >= 64 THEN RETURN QUERY SELECT 'session_limit'::text, now_at; RETURN; END IF;
    IF d.last_session_id IS NOT NULL AND (d.last_seen_at > now_at - interval '5 seconds' OR p_sequence > 5) THEN
      RETURN QUERY SELECT 'replayed'::text, now_at; RETURN;
    END IF;
  END IF;

  nl := NULLIF(p_v3_normalized#>>'{timing,completedLaps}','')::integer;
  ni := NULLIF(p_v3_normalized#>>'{raceState,incidents}','')::integer;
  np := NULLIF(p_v3_normalized#>>'{track,onPitRoad}','')::boolean;
  v_fuel := NULLIF(p_v3_normalized#>>'{fuel,fuelLitres}','')::numeric;
  v_last_laptime := NULLIF(p_v3_normalized#>>'{timing,lastLapTimeSeconds}','')::numeric;
  v_session_laps := NULLIF(p_v3_normalized#>>'{session,sessionLapsRemaining}','')::integer;
  SELECT array_agg(x ORDER BY x) INTO nf FROM (
    SELECT DISTINCT jsonb_array_elements_text(coalesce(nullif(p_v3_normalized#>'{session,flags}', 'null'::jsonb), '[]'::jsonb)) x
  ) q;

  -- De plugin stuurt in currentDriverId in de praktijk een NAAM (SimHub's Opponent.Id).
  -- Beide velden worden daarom als naam behandeld.
  v_driver_name := nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverName}', '')), '');
  IF v_driver_name IS NULL THEN
    v_driver_name := nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverId}', '')), '');
  END IF;
  v_driver_id := public.simhub_resolve_driver_user(e, t, v_driver_name);

  -- Routing-scoped logic only when active-bound
  IF e IS NOT NULL THEN
    SELECT * INTO s FROM public.endurance_source_segments
    WHERE device_id = d.id AND session_id = p_session_id AND event_id = e AND team_id = t FOR UPDATE;
    baseline := NOT FOUND;
    IF NOT baseline AND p_sequence <= s.last_sequence THEN
      RETURN QUERY SELECT 'replayed'::text, NULL::timestamptz; RETURN;
    END IF;

    -- Practice-ronden. De oude snapshot-ingest schreef ze wel, de v3-route niet,
    -- waardoor een actieve practice-sessie altijd leeg bleef. De plugin stuurt
    -- dezelfde gegevens, alleen genest onder timing en fuel.
    IF v_last_laptime IS NOT NULL AND nl IS NOT NULL AND nl > 0
       AND v_last_laptime > 0 AND v_last_laptime <= 3600 THEN
      SELECT sess.id INTO v_practice_session_id
      FROM public.endurance_practice_sessions AS sess
      WHERE sess.event_id = e AND sess.ended_at IS NULL
      ORDER BY sess.started_at DESC
      LIMIT 1;

      IF v_practice_session_id IS NOT NULL THEN
        INSERT INTO public.endurance_practice_laps (
          session_id, event_id, user_id, car_id, circuit,
          lap_seconds, fuel_used_litres, fuel_per_lap_litres,
          incident_count, recorded_at,
          source_session_id, source_device_id, completed_laps
        ) VALUES (
          v_practice_session_id, e,
          COALESCE(NULLIF(v_driver_id, '')::uuid, d.owner_user_id),
          NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,carId}', '')), ''),
          NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,trackName}', '')), ''),
          v_last_laptime,
          NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}', '')::numeric,
          NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}', '')::numeric,
          COALESCE(ni, 0),
          p_captured_at,
          btrim(p_session_id), d.id, nl
        )
        ON CONFLICT (event_id, source_session_id, source_device_id, completed_laps)
          WHERE source_session_id IS NOT NULL AND source_device_id IS NOT NULL AND completed_laps IS NOT NULL
        DO NOTHING;
      END IF;
    END IF;
    IF NOT baseline AND r IS NOT NULL THEN
      IF s.previous_completed_laps IS NOT NULL AND nl = s.previous_completed_laps + 1 THEN
        k := 'lap:' || nl;
        payload := jsonb_build_object(
          'completedLaps', nl,
          'lastLapTimeSeconds', v_last_laptime,
          -- Identiteit mee, zodat de lees-kant altijd een bron heeft.
          'identity', coalesce(p_v3_normalized->'identity', '{}'::jsonb),
          'driverName', v_driver_name
        );
        INSERT INTO public.endurance_telemetry_events(
          device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,
          event_detection_source,completed_laps,driver_id,lap,lap_time_from_deltas_s,payload,race_run_id)
        VALUES(
          d.id,e,t,p_session_id,'lap_completed',k,p_sequence,p_captured_at,
          'simhub_v3_transition',nl,v_driver_id,nl,v_last_laptime,payload,r)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    INSERT INTO public.endurance_source_segments(
      device_id,session_id,event_id,team_id,race_run_id,last_sequence,
      previous_completed_laps,previous_in_pit_lane,previous_incidents,previous_flags)
    VALUES(d.id,p_session_id,e,t,r,p_sequence,nl,np,ni,nf)
    ON CONFLICT(device_id,session_id,event_id,team_id) DO UPDATE SET
      race_run_id=excluded.race_run_id,
      last_sequence=excluded.last_sequence,
      previous_completed_laps=excluded.previous_completed_laps,
      previous_in_pit_lane=excluded.previous_in_pit_lane,
      previous_incidents=excluded.previous_incidents,
      previous_flags=excluded.previous_flags,
      updated_at=clock_timestamp();
  END IF;

  -- Always store latest snapshot (device-scoped when unbounded: event/team/race_run NULL).
  INSERT INTO public.simhub_telemetry_latest(
    device_id,owner_user_id,race_id,team_id,session_id,sequence,captured_at,received_at,
    connector_id,simhub_version,game,telemetry,
    endurance_event_id,endurance_team_id,race_run_id,
    driver_id,current_driver_id,current_driver_name,v3_normalized)
  VALUES(d.id,d.owner_user_id,d.race_id,d.team_id,p_session_id,p_sequence,p_captured_at,now_at,
    d.connector_id,d.device_name,'IRacing','{}',
    e,t,r,
    v_driver_id,
    nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverId}','')),''),
    v_driver_name,
    p_v3_normalized)
  ON CONFLICT(device_id) DO UPDATE SET
    session_id=excluded.session_id, sequence=excluded.sequence, captured_at=excluded.captured_at,
    received_at=excluded.received_at,
    endurance_event_id=excluded.endurance_event_id, endurance_team_id=excluded.endurance_team_id,
    race_run_id=excluded.race_run_id,
    driver_id=excluded.driver_id,
    current_driver_id=excluded.current_driver_id,
    current_driver_name=excluded.current_driver_name,
    v3_normalized=excluded.v3_normalized;

  INSERT INTO public.simhub_device_sessions(device_id,session_id,last_sequence,first_seen_at,last_seen_at)
  VALUES(d.id,p_session_id,p_sequence,now_at,now_at)
  ON CONFLICT(device_id,session_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_seen_at=excluded.last_seen_at;

  UPDATE public.simhub_devices SET last_seen_at=now_at, last_session_id=p_session_id, last_sequence=p_sequence, updated_at=now_at WHERE id=d.id;

  IF e IS NOT NULL THEN
    IF r IS NOT NULL AND NOT baseline THEN
      PERFORM public.simhub_update_strategy_v3(
        r,d.id,p_session_id,p_sequence,e,t,nl,v_fuel,v_last_laptime,v_session_laps,
        baseline,s.previous_completed_laps,s.previous_in_pit_lane);
    END IF;
  END IF;

  RETURN QUERY SELECT 'accepted'::text, now_at;
END 

$function$;

COMMIT;
