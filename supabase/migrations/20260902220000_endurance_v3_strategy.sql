-- Telemetry V3 Phase F: server-derived endurance strategy.
-- Adds fourth derived layer (lap samples + latest strategy state + strategy RPC).
-- Base tables from earlier phases are never created or dropped here.
-- Phase E objects are read from but not owned.
\set ON_ERROR_STOP on
BEGIN;

-- ============================================================================
-- 1. Fuel-stint sequence per race run (used by the strategy function)
-- ============================================================================
CREATE SEQUENCE IF NOT EXISTS public.endurance_fuel_stint_seq;

-- ============================================================================
-- 2. Derived lap sample table: one row per completed lap per race run
-- ============================================================================
CREATE TABLE public.endurance_strategy_lap_samples (
  race_run_id uuid NOT NULL REFERENCES public.endurance_race_runs(id) ON DELETE CASCADE,
  completed_laps integer NOT NULL CHECK(completed_laps > 0),
  event_id uuid NOT NULL REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.endurance_teams(id) ON DELETE CASCADE,
  source_device_id uuid NOT NULL REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  source_session_id text NOT NULL,
  source_sequence bigint NOT NULL,
  fuel_start_litres numeric(8,3),
  fuel_end_litres numeric(8,3),
  fuel_used_litres numeric(8,3),
  lap_time_seconds numeric(8,3),
  valid_fuel_sample boolean NOT NULL DEFAULT false,
  exclusion_reason text,
  fuel_stint_id bigint NOT NULL,
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(race_run_id, completed_laps)
);
ALTER TABLE public.endurance_strategy_lap_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY endurance_strategy_lap_samples_service_role_all ON public.endurance_strategy_lap_samples
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.endurance_strategy_lap_samples FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.endurance_strategy_lap_samples TO service_role;

-- ============================================================================
-- 3. Derived strategy latest table: one row per active race run
-- ============================================================================
CREATE TABLE public.endurance_strategy_latest (
  race_run_id uuid NOT NULL REFERENCES public.endurance_race_runs(id) ON DELETE CASCADE PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.endurance_events(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.endurance_teams(id) ON DELETE CASCADE,
  fuel_per_lap_litres numeric(8,3),
  race_fuel_per_lap_litres numeric(8,3),
  fuel_laps_remaining numeric(8,1),
  valid_fuel_sample_count integer NOT NULL DEFAULT 0,
  current_stint_valid_sample_count integer NOT NULL DEFAULT 0,
  current_fuel_stint bigint NOT NULL DEFAULT 1,
  last_completed_laps integer,
  current_fuel_litres numeric(8,3),
  session_laps_remaining integer,
  fuel_to_finish_litres numeric(8,3),
  fuel_sufficient_to_finish boolean,
  strategy_status text NOT NULL DEFAULT 'insufficient_data',
  strategy_reason text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.endurance_strategy_latest ENABLE ROW LEVEL SECURITY;
CREATE POLICY endurance_strategy_latest_service_role_all ON public.endurance_strategy_latest
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY endurance_strategy_latest_staff_read ON public.endurance_strategy_latest
  FOR SELECT TO authenticated USING (public.authorized_role(public.authorized_role_id(),'staff') OR public.authorized_role(public.authorized_role_id(),'admin'));
CREATE POLICY endurance_strategy_latest_team_read ON public.endurance_strategy_latest
  FOR SELECT TO authenticated USING (public.authorized_role(public.authorized_role_id(),'staff') OR public.authorized_role(public.authorized_role_id(),'admin') OR team_id IN (SELECT public.user_teams()));
REVOKE ALL ON public.endurance_strategy_latest FROM PUBLIC, anon;
REVOKE ALL ON public.endurance_strategy_latest FROM authenticated;
GRANT SELECT ON public.endurance_strategy_latest TO authenticated;
GRANT ALL ON public.endurance_strategy_latest TO service_role;

-- ============================================================================
-- 4. Strategy update function (SECURITY DEFINER, service_role only)
-- Called from within simhub_persist_v3 transaction.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.simhub_update_strategy_v3(
  p_race_run_id uuid,
  p_device_id uuid,
  p_session_id text,
  p_sequence bigint,
  p_event_id uuid,
  p_team_id uuid,
  p_completed_laps integer,
  p_fuel_litres numeric,
  p_in_pit_lane boolean,
  p_last_lap_time_seconds numeric,
  p_session_laps_remaining integer,
  p_baseline boolean,
  p_prev_completed_laps integer,
  p_prev_in_pit_lane boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','pg_temp' AS $$
DECLARE
  sl public.endurance_strategy_latest%ROWTYPE;
  v_fuel_start numeric;
  v_fuel_end numeric;
  v_fuel_used numeric;
  v_valid boolean := false;
  v_exclusion text;
  v_fuel_stint bigint;
  v_mean numeric;
  v_race_mean numeric;
  v_race_count integer;
  v_new_fuel_laps numeric;
  v_fuel_to_finish numeric;
  v_sufficient boolean;
  v_pit_exit boolean := false;
BEGIN
  IF p_race_run_id IS NULL THEN
    RETURN;
  END IF;

  -- Current pit-exit detection: happened in THIS transaction from prev_in_pit_lane=true -> now false
  v_pit_exit := (p_prev_in_pit_lane = true AND p_in_pit_lane = false);

  -- Read or initialise strategy latest for this race run
  SELECT * INTO sl FROM public.endurance_strategy_latest
  WHERE race_run_id = p_race_run_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.endurance_strategy_latest(race_run_id, event_id, team_id)
    VALUES (p_race_run_id, p_event_id, p_team_id)
    RETURNING * INTO sl;
  END IF;

  -- Fuel-stint management: pit_exit starts a new fuel stint
  IF v_pit_exit THEN
    v_fuel_stint := nextval('public.endurance_fuel_stint_seq');
    -- Update stint counter in latest
    UPDATE public.endurance_strategy_latest
    SET current_fuel_stint = v_fuel_stint,
        current_stint_valid_sample_count = 0
    WHERE race_run_id = p_race_run_id;
    sl.current_fuel_stint := v_fuel_stint;
    sl.current_stint_valid_sample_count := 0;
  ELSE
    v_fuel_stint := sl.current_fuel_stint;
  END IF;

  -- ---- Fuel sample validity ----
  -- Valid only when ALL are true:
  --   active raceRun (already checked by p_race_run_id IS NOT NULL above)
  --   NOT baseline (would cross source boundary)
  --   completedLaps advances exactly +1
  --   prev completedLaps is not null
  --   fuelLitres is valid at BOTH boundaries
  --   previous fuel > current fuel (consumption)
  --   no inPitLane=true observed during the measured interval
  --   no source/session baseline boundary during interval

  IF p_baseline THEN
    v_valid := false;
    v_exclusion := 'source_baseline';
  ELSIF p_prev_completed_laps IS NULL OR p_completed_laps IS NULL THEN
    v_valid := false;
    v_exclusion := 'no_prior_lap';
  ELSIF p_completed_laps <> p_prev_completed_laps + 1 THEN
    v_valid := false;
    v_exclusion := 'lap_jump_or_regression';
  ELSIF p_in_pit_lane = true THEN
    -- Current snapshot has inPitLane=true → contaminated interval
    v_valid := false;
    v_exclusion := 'pit_lane_during_lap';
  ELSIF p_fuel_litres IS NULL THEN
    v_valid := false;
    v_exclusion := 'fuel_null';
  ELSE
    -- Need the fuel from the previous lap boundary (stored at that completed_laps-1 sample)
    -- OR we need to reconstruct it: it's the fuel_end_litres from the prior lap sample
    -- But wait — we need the fuel AT the previous completed_laps boundary.
    -- That fuel is: the fuel_end_litres of the previous lap sample (completed_laps-1).
    -- If there is no prior sample, we cannot validate consumption.
    SELECT fuel_start_litres, fuel_end_litres
    INTO v_fuel_start, v_fuel_end
    FROM public.endurance_strategy_lap_samples
    WHERE race_run_id = p_race_run_id AND completed_laps = p_completed_laps - 1;

    IF NOT FOUND THEN
      -- First lap of this stint/run with no prior sample — can still start accumulating
      -- Store the fuel at this lap boundary so the NEXT lap can use it as start
      v_valid := false;
      v_exclusion := 'no_prior_boundary_fuel';
      v_fuel_start := NULL;
      v_fuel_end := p_fuel_litres;
    ELSIF v_fuel_end IS NULL THEN
      v_valid := false;
      v_exclusion := 'prior_lap_no_fuel';
    ELSIF v_fuel_end <= p_fuel_litres THEN
      v_valid := false;
      v_exclusion := 'fuel_increase_or_no_change';
    ELSE
      v_fuel_used := v_fuel_end - p_fuel_litres;
      v_valid := true;
    END IF;
  END IF;

  -- ---- Lap time ----
  -- Only use valid lastLapTimeSeconds when it's non-null, > 0, and associated with a normal +1 transition
  -- Pit-lap exclusion uses the same inPitLane marker
  DECLARE
    v_lap_time numeric;
  BEGIN
    v_lap_time := p_last_lap_time_seconds;
    IF v_lap_time IS NOT NULL AND v_lap_time <= 0 THEN
      v_lap_time := NULL;
    END IF;
    -- Pit lap: exclude lap time if current snapshot is in pit lane
    IF v_lap_time IS NOT NULL AND p_in_pit_lane = true THEN
      v_lap_time := NULL;
    END IF;

    -- Insert lap sample row (always one per completed lap for auditable history)
    INSERT INTO public.endurance_strategy_lap_samples(
      race_run_id, completed_laps, event_id, team_id,
      source_device_id, source_session_id, source_sequence,
      fuel_start_litres, fuel_end_litres, fuel_used_litres,
      lap_time_seconds, valid_fuel_sample, exclusion_reason,
      fuel_stint_id, captured_at
    ) VALUES (
      p_race_run_id, p_completed_laps, p_event_id, p_team_id,
      p_device_id, p_session_id, p_sequence,
      v_fuel_start, p_fuel_litres, v_fuel_used,
      v_lap_time, v_valid, v_exclusion,
      v_fuel_stint, clock_timestamp()
    ) ON CONFLICT (race_run_id, completed_laps) DO NOTHING;
  END;

  -- ---- Strategy latest update ----
  IF v_valid THEN
    -- Recalculate current-stint mean
    SELECT avg(fuel_used_litres)::numeric(8,3), count(*)
    INTO v_mean, sl.current_stint_valid_sample_count
    FROM public.endurance_strategy_lap_samples
    WHERE race_run_id = p_race_run_id
      AND valid_fuel_sample = true
      AND fuel_stint_id = v_fuel_stint;

    -- Recalculate race mean
    SELECT avg(fuel_used_litres)::numeric(8,3), count(*)
    INTO v_race_mean, v_race_count
    FROM public.endurance_strategy_lap_samples
    WHERE race_run_id = p_race_run_id
      AND valid_fuel_sample = true;

    -- Fuel per lap (current stint)
    sl.fuel_per_lap_litres := v_mean;
    sl.race_fuel_per_lap_litres := v_race_mean;
    sl.valid_fuel_sample_count := v_race_count;

    -- Strategy status
    IF sl.current_stint_valid_sample_count = 0 THEN
      sl.strategy_status := 'insufficient_data';
    ELSIF sl.current_stint_valid_sample_count = 1 THEN
      sl.strategy_status := 'low_sample';
    ELSE
      sl.strategy_status := 'ready';
    END IF;

    -- fuelLapsRemaining = currentFuel / fuelPerLap
    IF p_fuel_litres IS NOT NULL AND p_fuel_litres > 0 AND sl.fuel_per_lap_litres IS NOT NULL AND sl.fuel_per_lap_litres > 0 THEN
      sl.fuel_laps_remaining := (p_fuel_litres / sl.fuel_per_lap_litres)::numeric(8,1);
    ELSE
      sl.fuel_laps_remaining := NULL;
    END IF;

    -- Fuel-to-finish: only when sessionLapsRemaining semantics are proven
    -- sessionLapsRemaining sentinels (-1, 32767) are already nulled by V3 parser
    IF p_session_laps_remaining IS NOT NULL AND sl.fuel_per_lap_litres IS NOT NULL AND sl.fuel_per_lap_litres > 0 THEN
      v_fuel_to_finish := (p_session_laps_remaining * sl.fuel_per_lap_litres)::numeric(8,3);
      sl.fuel_to_finish_litres := v_fuel_to_finish;

      IF p_fuel_litres IS NOT NULL THEN
        sl.fuel_sufficient_to_finish := (p_fuel_litres >= v_fuel_to_finish);
      ELSE
        sl.fuel_sufficient_to_finish := NULL;
      END IF;
    ELSE
      sl.fuel_to_finish_litres := NULL;
      sl.fuel_sufficient_to_finish := NULL;
      IF p_session_laps_remaining IS NULL AND sl.strategy_status = 'ready' THEN
        sl.strategy_reason := 'race_distance_semantics_unproven';
      END IF;
    END IF;
  END IF;

  -- Always recalculate strategy status (even without a new valid sample, e.g. after stint reset)
  IF sl.current_stint_valid_sample_count = 0 THEN
    sl.strategy_status := 'insufficient_data';
  ELSIF sl.current_stint_valid_sample_count = 1 THEN
    sl.strategy_status := 'low_sample';
  ELSE
    sl.strategy_status := 'ready';
  END IF;

  -- Update common fields every call
  sl.last_completed_laps := p_completed_laps;
  sl.current_fuel_litres := p_fuel_litres;
  sl.session_laps_remaining := p_session_laps_remaining;
  sl.updated_at := clock_timestamp();

  UPDATE public.endurance_strategy_latest SET
    fuel_per_lap_litres = sl.fuel_per_lap_litres,
    race_fuel_per_lap_litres = sl.race_fuel_per_lap_litres,
    fuel_laps_remaining = sl.fuel_laps_remaining,
    valid_fuel_sample_count = sl.valid_fuel_sample_count,
    current_stint_valid_sample_count = sl.current_stint_valid_sample_count,
    current_fuel_stint = sl.current_fuel_stint,
    last_completed_laps = sl.last_completed_laps,
    current_fuel_litres = sl.current_fuel_litres,
    session_laps_remaining = sl.session_laps_remaining,
    fuel_to_finish_litres = sl.fuel_to_finish_litres,
    fuel_sufficient_to_finish = sl.fuel_sufficient_to_finish,
    strategy_status = sl.strategy_status,
    strategy_reason = sl.strategy_reason,
    updated_at = sl.updated_at
  WHERE race_run_id = p_race_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.simhub_update_strategy_v3(uuid,uuid,text,bigint,uuid,uuid,integer,numeric,boolean,numeric,integer,boolean,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_update_strategy_v3(uuid,uuid,text,bigint,uuid,uuid,integer,numeric,boolean,numeric,integer,boolean,integer,boolean) TO service_role;
REVOKE ALL ON SEQUENCE public.endurance_fuel_stint_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.endurance_fuel_stint_seq TO service_role;

-- ============================================================================
-- 5. Replace simhub_persist_v3 to add strategy call
-- Preserves exact Phase E behavior + adds fuel/session extraction + strategy call
-- ============================================================================
CREATE OR REPLACE FUNCTION public.simhub_persist_v3(p_token_hash text,p_session_id text,p_sequence bigint,p_captured_at timestamptz,p_v3_normalized jsonb)
RETURNS TABLE(result text, received_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog','public','auth','pg_temp' AS $$
DECLARE d public.simhub_devices%ROWTYPE; s public.endurance_source_segments%ROWTYPE;
 e uuid; t uuid; r uuid; now_at timestamptz:=clock_timestamp(); nl integer; ni integer; np boolean; nf text[];
 v_session_sequence bigint; v_session_count integer;
 baseline boolean:=false; k text; payload jsonb;
 --- Phase F extractions
 v_fuel numeric; v_last_laptime numeric; v_session_laps integer;
BEGIN
 IF auth.role() <> 'service_role' THEN RETURN QUERY SELECT 'unauthorized'::text,NULL::timestamptz; RETURN; END IF;
 IF p_token_hash !~ '^[0-9a-f]{64}$' OR char_length(coalesce(p_session_id,'')) NOT BETWEEN 1 AND 120 OR p_sequence IS NULL OR p_sequence<0 OR p_captured_at IS NULL OR jsonb_typeof(p_v3_normalized)<>'object' THEN RETURN QUERY SELECT 'invalid_payload'::text,NULL::timestamptz; RETURN; END IF;
 SELECT * INTO d FROM public.simhub_devices WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'invalid_device'::text,NULL::timestamptz; RETURN; END IF;
 IF d.revoked_at IS NOT NULL THEN RETURN QUERY SELECT 'revoked'::text,NULL::timestamptz; RETURN; END IF;
 IF d.endurance_event_id IS NULL OR d.endurance_team_id IS NULL THEN RETURN QUERY SELECT 'not_bound'::text,NULL::timestamptz; RETURN; END IF;
 IF d.device_status <> 'active_binding' OR d.device_role <> 'primary' THEN RETURN QUERY SELECT 'not_authority'::text,NULL::timestamptz; RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.endurance_registrations x WHERE x.event_id=d.endurance_event_id AND x.user_id=d.owner_user_id AND x.status NOT IN ('rejected','withdrawn')) THEN RETURN QUERY SELECT 'not_registered'::text,NULL::timestamptz; RETURN; END IF;
 IF d.last_seen_at IS NOT NULL AND d.last_seen_at > now_at - interval '400 milliseconds' THEN RETURN QUERY SELECT 'rate_limited'::text,now_at; RETURN; END IF;
 SELECT last_sequence INTO v_session_sequence FROM public.simhub_device_sessions WHERE device_id=d.id AND session_id=p_session_id FOR UPDATE;
 IF FOUND AND p_sequence <= v_session_sequence THEN RETURN QUERY SELECT 'replayed'::text,now_at; RETURN; END IF;
 IF NOT FOUND THEN
   SELECT count(*) INTO v_session_count FROM public.simhub_device_sessions WHERE device_id=d.id;
   IF v_session_count >= 64 THEN RETURN QUERY SELECT 'session_limit'::text,now_at; RETURN; END IF;
   IF d.last_session_id IS NOT NULL AND (d.last_seen_at > now_at - interval '5 seconds' OR p_sequence > 5) THEN RETURN QUERY SELECT 'replayed'::text,now_at; RETURN; END IF;
 END IF;
 e:=d.endurance_event_id;t:=d.endurance_team_id;
 SELECT id INTO r FROM public.endurance_race_runs WHERE event_id=e AND team_id=t AND run_kind='race' AND status='active' LIMIT 1;
 nl:=NULLIF(p_v3_normalized#>>'{timing,completedLaps}','')::integer; ni:=NULLIF(p_v3_normalized#>>'{raceState,incidents}','')::integer; np:=NULLIF(p_v3_normalized#>>'{track,onPitRoad}','')::boolean;
 --- Phase F extractions
 v_fuel:=NULLIF(p_v3_normalized#>>'{fuel,fuelLitres}','')::numeric; v_last_laptime:=NULLIF(p_v3_normalized#>>'{timing,lastLapTimeSeconds}','')::numeric; v_session_laps:=NULLIF(p_v3_normalized#>>'{session,sessionLapsRemaining}','')::integer;
 SELECT array_agg(x ORDER BY x) INTO nf FROM (SELECT DISTINCT jsonb_array_elements_text(coalesce(p_v3_normalized#>'{session,flags}','[]'::jsonb)) x) q;
 SELECT * INTO s FROM public.endurance_source_segments WHERE device_id=d.id AND session_id=p_session_id AND event_id=e AND team_id=t FOR UPDATE;
 baseline:=NOT FOUND;
 IF NOT baseline AND p_sequence<=s.last_sequence THEN RETURN QUERY SELECT 'replayed'::text,NULL::timestamptz; RETURN; END IF;
 IF NOT baseline AND r IS NOT NULL THEN
  IF s.previous_completed_laps IS NOT NULL AND nl=s.previous_completed_laps+1 THEN k:='lap:'||nl; payload:=jsonb_build_object('completedLaps',nl,'lastLapTimeSeconds',p_v3_normalized#>>'{timing,lastLapTimeSeconds}'); INSERT INTO public.endurance_telemetry_events(device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,completed_laps,payload,race_run_id) VALUES(d.id,e,t,p_session_id,'lap_completed',k,p_sequence,p_captured_at,'simhub_v3_transition',nl,payload,r) ON CONFLICT DO NOTHING; END IF;
  IF s.previous_in_pit_lane=false AND np=true THEN INSERT INTO public.endurance_telemetry_events(device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,in_pit_lane,payload,race_run_id) VALUES(d.id,e,t,p_session_id,'pit_entry','v3:pit_entry:seq:'||p_sequence,p_sequence,p_captured_at,'simhub_v3_transition',true,jsonb_build_object('onPitRoad',true),r) ON CONFLICT DO NOTHING; END IF;
  IF s.previous_in_pit_lane=true AND np=false THEN INSERT INTO public.endurance_telemetry_events(device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,in_pit_lane,payload,race_run_id) VALUES(d.id,e,t,p_session_id,'pit_exit','v3:pit_exit:seq:'||p_sequence,p_sequence,p_captured_at,'simhub_v3_transition',false,jsonb_build_object('onPitRoad',false),r) ON CONFLICT DO NOTHING; END IF;
  IF s.previous_incidents IS NOT NULL AND ni>s.previous_incidents THEN INSERT INTO public.endurance_telemetry_events(device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,incidents,payload,race_run_id) VALUES(d.id,e,t,p_session_id,'incident_count_changed','incident:'||ni,p_sequence,p_captured_at,'simhub_v3_transition',ni,jsonb_build_object('previousIncidents',s.previous_incidents,'incidents',ni),r) ON CONFLICT DO NOTHING; END IF;
  IF s.previous_flags IS DISTINCT FROM nf AND s.previous_flags IS NOT NULL AND nf IS NOT NULL THEN INSERT INTO public.endurance_telemetry_events(device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,event_detection_source,flag,payload,race_run_id) VALUES(d.id,e,t,p_session_id,'flag_change','v3:flag_change:seq:'||p_sequence,p_sequence,p_captured_at,'simhub_v3_transition',array_to_string(nf,','),jsonb_build_object('previousFlags',s.previous_flags,'flags',nf),r) ON CONFLICT DO NOTHING; END IF;
 END IF;
 INSERT INTO public.endurance_source_segments(device_id,session_id,event_id,team_id,race_run_id,last_sequence,previous_completed_laps,previous_in_pit_lane,previous_incidents,previous_flags) VALUES(d.id,p_session_id,e,t,r,p_sequence,nl,np,ni,nf) ON CONFLICT(device_id,session_id,event_id,team_id) DO UPDATE SET race_run_id=excluded.race_run_id,last_sequence=excluded.last_sequence,previous_completed_laps=excluded.previous_completed_laps,previous_in_pit_lane=excluded.previous_in_pit_lane,previous_incidents=excluded.previous_incidents,previous_flags=excluded.previous_flags,updated_at=clock_timestamp();
 INSERT INTO public.simhub_telemetry_latest(device_id,owner_user_id,race_id,team_id,session_id,sequence,captured_at,received_at,connector_id,simhub_version,game,telemetry,endurance_event_id,endurance_team_id,race_run_id,v3_normalized) VALUES(d.id,d.owner_user_id,d.race_id,d.team_id,p_session_id,p_sequence,p_captured_at,now_at,d.connector_id,d.device_name,'IRacing','{}',e,t,r,p_v3_normalized) ON CONFLICT(device_id) DO UPDATE SET session_id=excluded.session_id,sequence=excluded.sequence,captured_at=excluded.captured_at,received_at=excluded.received_at,race_run_id=excluded.race_run_id,v3_normalized=excluded.v3_normalized;
 INSERT INTO public.simhub_device_sessions(device_id,session_id,last_sequence,first_seen_at,last_seen_at) VALUES(d.id,p_session_id,p_sequence,now_at,now_at) ON CONFLICT(device_id,session_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_seen_at=excluded.last_seen_at;
 UPDATE public.simhub_devices SET last_seen_at=now_at,last_session_id=p_session_id,last_sequence=p_sequence,updated_at=now_at WHERE id=d.id;
 --- Phase F: strategy update after all Phase E state is written
 IF r IS NOT NULL AND NOT baseline THEN
   PERFORM public.simhub_update_strategy_v3(r,d.id,p_session_id,p_sequence,e,t,nl,v_fuel,np,v_last_laptime,v_session_laps,baseline,s.previous_completed_laps,s.previous_in_pit_lane);
 END IF;
 RETURN QUERY SELECT 'accepted'::text,now_at;
END $$;
REVOKE ALL ON FUNCTION public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb) TO service_role;

COMMIT;