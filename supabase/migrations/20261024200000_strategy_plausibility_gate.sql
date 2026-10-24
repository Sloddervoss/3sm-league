-- Plausibiliteitspoort op de verbruiksmetingen.
--
-- De bestaande validatie kijkt naar continuiteit: een ronde moet precies een
-- verder zijn, de auto mag niet in de pitstraat staan en de brandstof moet
-- dalen. Een auto die in de garage staat voldoet daar allemaal aan -- die
-- levert een "ronde" van zes minuten met een half litertje, en dat kwam als
-- geldige meting binnen.
--
-- Nu twee extra eisen, met de laatste twintig geldige metingen als maatstaf:
--   * rondetijd niet meer dan 25% boven de beste ronde
--   * verbruik niet minder dan 40% van de mediaan
-- Onbruikbare rijen worden gemarkeerd, niet verwijderd.

CREATE OR REPLACE FUNCTION public.simhub_update_strategy_v3(p_race_run_id uuid, p_device_id uuid, p_session_id text, p_sequence bigint, p_event_id uuid, p_team_id uuid, p_completed_laps integer, p_fuel_litres numeric, p_in_pit_lane boolean, p_last_lap_time_seconds numeric, p_session_laps_remaining integer, p_baseline boolean, p_prev_completed_laps integer, p_prev_in_pit_lane boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
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
    v_best_lap numeric;
    v_mediaan_verbruik numeric;
  BEGIN
    v_lap_time := p_last_lap_time_seconds;
    IF v_lap_time IS NOT NULL AND v_lap_time <= 0 THEN
      v_lap_time := NULL;
    END IF;
    -- Pit lap: exclude lap time if current snapshot is in pit lane
    IF v_lap_time IS NOT NULL AND p_in_pit_lane = true THEN
      v_lap_time := NULL;
    END IF;

    -- Plausibiliteitspoort: een auto in de garage levert een "ronde" van zes
    -- minuten met een half litertje. Continu, geen pitlane, brandstof gedaald:
    -- alle eerdere controles keuren hem goed, en hij trekt de mediaan omlaag.
    -- Markeren, niet wissen -- later is te zien wat er gebeurde.
    IF v_valid THEN
      SELECT min(lap_time_seconds) FILTER (WHERE lap_time_seconds > 20),
             percentile_disc(0.5) WITHIN GROUP (ORDER BY fuel_used_litres)
        INTO v_best_lap, v_mediaan_verbruik
        FROM (
          SELECT lap_time_seconds, fuel_used_litres
            FROM public.endurance_strategy_lap_samples
           WHERE event_id = p_event_id AND team_id = p_team_id
             AND valid_fuel_sample
           ORDER BY captured_at DESC
           LIMIT 20
        ) recent;

      IF v_best_lap IS NOT NULL AND v_lap_time IS NOT NULL
         AND v_lap_time > v_best_lap * 1.25 THEN
        v_valid := false;
        v_exclusion := 'implausible_lap_time';
      ELSIF v_mediaan_verbruik IS NOT NULL AND v_mediaan_verbruik > 0
            AND v_fuel_used < v_mediaan_verbruik * 0.4 THEN
        v_valid := false;
        v_exclusion := 'implausible_fuel_used';
      END IF;
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
$function$;
