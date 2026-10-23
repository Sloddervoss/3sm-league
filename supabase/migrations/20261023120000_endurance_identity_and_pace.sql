-- ============================================================================
-- Endurance 0.6.0.0 — identiteit, rondetijden en routing
-- Datum: 2026-10-23
--
-- Lost vijf breuken op die elkaar verborgen:
--   1. routing eiste een endurance_registrations-rij -> team/event bleven NULL
--   2. er werd nooit een race run gestart -> lap_completed was onbereikbaar
--   3. de plugin stuurt currentDriverId als NAAM, niet als iRacing-id
--   4. driver_id en lap_time_from_deltas_s werden nooit weggeschreven
--   5. record_opponent_gap_samples las snake_case, de plugin stuurt camelCase
--
-- Additief: geen kolommen verwijderd, geen contractwijziging, geen Edge-wijziging.
-- De plugin hoeft niet mee te veranderen.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Naamsleutel: "Vincent deVos" en "Vincent de Vos" geven dezelfde sleutel.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.simhub_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT nullif(lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]', '', 'g')), '');
$function$;

COMMENT ON FUNCTION public.simhub_name_key(text) IS
  'Compacte naamvorm voor het matchen van iRacing-namen op profielen.';

-- ---------------------------------------------------------------------------
-- 2. Rijder resolutie: naam -> user_id, team-scoped eerst, dan globaal.
--    Geeft NULL bij geen match of bij twijfel (meerdere kandidaten).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.simhub_resolve_driver_user(
  p_event_id uuid,
  p_team_id uuid,
  p_driver_name text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  v_key text := public.simhub_name_key(p_driver_name);
  v_hits text[];
BEGIN
  IF v_key IS NULL THEN RETURN NULL; END IF;

  -- Eerst binnen het team: dat is de sterkste aanwijzing.
  IF p_team_id IS NOT NULL THEN
    SELECT array_agg(DISTINCT m.user_id::text) INTO v_hits
    FROM public.endurance_team_members m
    JOIN public.profiles p ON p.user_id = m.user_id
    WHERE m.team_id = p_team_id
      AND (public.simhub_name_key(p.iracing_name) = v_key
           OR public.simhub_name_key(p.display_name) = v_key);

    IF v_hits IS NOT NULL AND array_length(v_hits, 1) = 1 THEN
      RETURN v_hits[1];
    END IF;
    -- Meerdere teamgenoten met dezelfde naam: niet gokken.
    IF v_hits IS NOT NULL AND array_length(v_hits, 1) > 1 THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Dan globaal: iemand die (nog) niet in het team staat maar wel een profiel heeft.
  SELECT array_agg(DISTINCT p.user_id::text) INTO v_hits
  FROM public.profiles p
  WHERE public.simhub_name_key(p.iracing_name) = v_key
     OR public.simhub_name_key(p.display_name) = v_key;

  IF v_hits IS NOT NULL AND array_length(v_hits, 1) = 1 THEN
    RETURN v_hits[1];
  END IF;

  RETURN NULL;
END
$function$;

COMMENT ON FUNCTION public.simhub_resolve_driver_user(uuid, uuid, text) IS
  'Naam naar user_id. Team-scoped eerst, dan globaal. NULL bij geen match of twijfel.';

REVOKE ALL ON FUNCTION public.simhub_resolve_driver_user(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.simhub_resolve_driver_user(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.simhub_resolve_driver_user(uuid, uuid, text) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 3. simhub_persist_v3: routing zonder inschrijving, race run automatisch,
--    rijder en rondetijd weggeschreven.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.simhub_persist_v3(
  p_token_hash text,
  p_session_id text,
  p_sequence bigint,
  p_captured_at timestamp with time zone,
  p_v3_normalized jsonb
)
RETURNS TABLE(result text, received_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
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
END $function$;

-- ---------------------------------------------------------------------------
-- 4. Opponent-samples: de plugin stuurt camelCase, de functie las snake_case.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_opponent_gap_samples(
  p_race_run_id uuid,
  p_event_id uuid,
  p_team_id uuid,
  p_device_id uuid,
  p_session_id text,
  p_seq bigint,
  p_captured_at timestamp with time zone,
  p_opponents jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_bucket bigint := public.opp_sample_bucket(p_captured_at);
  v_i int := 0;
  v_opp record;
BEGIN
  IF p_opponents IS NULL OR jsonb_typeof(p_opponents) <> 'array' THEN RETURN; END IF;

  -- jsonb_to_recordset koppelt op exacte sleutelnaam; het contract is camelCase.
  FOR v_opp IN
    SELECT * FROM jsonb_to_recordset(p_opponents) AS o(
      id text, "gapToPlayerSeconds" double precision,
      "lapDistancePct" double precision, "inPit" boolean, connected boolean)
  LOOP
    IF v_i >= 40 THEN EXIT; END IF;
    IF coalesce(v_opp.id, '') = '' THEN CONTINUE; END IF;
    IF v_opp."gapToPlayerSeconds" IS NULL THEN CONTINUE; END IF;
    IF coalesce(v_opp.connected, false) IS NOT TRUE THEN CONTINUE; END IF;
    IF coalesce(v_opp."inPit", false) IS TRUE THEN CONTINUE; END IF;

    INSERT INTO public.endurance_opponent_gap_samples(
      race_run_id, event_id, team_id, device_id, session_id, opponent_id,
      sample_bucket, observed_at, seq, gap_to_player_seconds,
      lap_distance_pct, in_pit, connected)
    VALUES (
      p_race_run_id, p_event_id, p_team_id, p_device_id, p_session_id, v_opp.id,
      v_bucket, p_captured_at, p_seq, v_opp."gapToPlayerSeconds",
      v_opp."lapDistancePct", false, true)
    ON CONFLICT (race_run_id, opponent_id, sample_bucket) DO NOTHING;
    v_i := v_i + 1;
  END LOOP;

  PERFORM public.prune_opponent_gap_samples();
END;
$function$;

REVOKE ALL ON FUNCTION public.record_opponent_gap_samples(uuid,uuid,uuid,uuid,text,bigint,timestamp with time zone,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_opponent_gap_samples(uuid,uuid,uuid,uuid,text,bigint,timestamp with time zone,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.record_opponent_gap_samples(uuid,uuid,uuid,uuid,text,bigint,timestamp with time zone,jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_opponent_gap_samples(uuid,uuid,uuid,uuid,text,bigint,timestamp with time zone,jsonb) TO service_role;
