-- ============================================================================
-- Test voor endurance_learning_summary (punt 8).
--
-- Uitvoeren binnen de migratietransactie, daarna ROLLBACK. Er blijft geen data
-- achter: elke auto, baan en run hieronder bestaat alleen tijdens deze test.
--
-- IJkpunt is de race van 24 oktober: 104 liter tank, 2,94 liter per ronde en
-- 95,67 seconden per ronde → 35,4 rondes → 56,4 minuten.
-- ============================================================================

DO $$
DECLARE
  v_rec      record;
  v_aantal   integer;
  v_run_a    uuid := '11111111-1111-1111-1111-111111111111';
  v_run_b    uuid := '22222222-2222-2222-2222-222222222222';
  v_run_c    uuid := '33333333-3333-3333-3333-333333333333';
  v_run_d    uuid := '44444444-4444-4444-4444-444444444444';
  v_track_a  constant text := '990001';
  v_track_b  constant text := '990002';
  v_track_c  constant text := '990003';
  v_track_d  constant text := '990004';
  v_start    constant timestamptz := timestamptz '2026-10-24 11:00:00+00';
BEGIN
  -- ------------------------------------------------------------------------
  -- Autospecificaties. 104 liter en een prior van 2,947 — dezelfde waarden als
  -- in de planner; het archief moet het verschil maken.
  -- ------------------------------------------------------------------------
  INSERT INTO public.endurance_car_specs (car_id, display_name, tank_capacity_litres, fuel_per_lap_prior_litres, source)
  VALUES ('w8-test-auto', 'W8 Test Auto', 104, 2.947, 'manual'),
         ('w8-test-auto-b', 'W8 Test Auto B', 104, 2.947, 'manual'),
         ('w8-test-auto-c', 'W8 Test Auto C', 104, 2.947, 'manual')
  ON CONFLICT (car_id) DO UPDATE
    SET tank_capacity_litres = EXCLUDED.tank_capacity_litres,
        fuel_per_lap_prior_litres = EXCLUDED.fuel_per_lap_prior_litres;

  -- Een catalogusrij zodat een circuitnaam naar een track-id te herleiden is.
  INSERT INTO public.endurance_iracing_events (source_key, name, year, circuit, track_id, source_hash)
  VALUES ('w8-test-circuit', 'W8 Test Circuit', 2026, 'W8 Test Circuit', 990001, 'w8-test')
  ON CONFLICT (source_key) DO NOTHING;

  -- ------------------------------------------------------------------------
  -- A. 35 schone rondes: het ijkpunt.
  -- ------------------------------------------------------------------------
  INSERT INTO public.endurance_telemetry_archive
    (event_id, team_id, race_run_id, car_id, track_id, lap, lap_time_seconds, fuel_per_lap_litres, captured_at)
  SELECT gen_random_uuid(), gen_random_uuid(), v_run_a, 'w8-test-auto', v_track_a,
         g, 95.67, 2.94, v_start + (g || ' minutes')::interval
    FROM generate_series(1, 35) AS g;

  SELECT * INTO v_rec FROM public.endurance_learning_summary('w8-test-auto', v_track_a);

  IF v_rec.sample_laps <> 35 THEN
    RAISE EXCEPTION 'A: verwachtte 35 bruikbare rondes, kreeg %', v_rec.sample_laps;
  END IF;
  IF v_rec.avg_fuel_per_lap_litres <> 2.940 THEN
    RAISE EXCEPTION 'A: verwachtte 2,940 liter per ronde, kreeg %', v_rec.avg_fuel_per_lap_litres;
  END IF;
  IF v_rec.avg_lap_seconds <> 95.670 THEN
    RAISE EXCEPTION 'A: verwachtte 95,670 s per ronde, kreeg %', v_rec.avg_lap_seconds;
  END IF;
  IF v_rec.tank_capacity_litres <> 104 THEN
    RAISE EXCEPTION 'A: verwachtte 104 liter tank, kreeg %', v_rec.tank_capacity_litres;
  END IF;
  IF v_rec.laps_per_tank <> 35.4 THEN
    RAISE EXCEPTION 'A: verwachtte 35,4 rondes per tank, kreeg %', v_rec.laps_per_tank;
  END IF;
  IF v_rec.tank_minutes <> 56.4 THEN
    RAISE EXCEPTION 'A: verwachtte 56,4 minuten tankduur, kreeg %', v_rec.tank_minutes;
  END IF;
  IF v_rec.fuel_per_lap_source <> 'archive' OR v_rec.lap_seconds_source <> 'archive' THEN
    RAISE EXCEPTION 'A: verwachtte bron archive/archive, kreeg %/%',
      v_rec.fuel_per_lap_source, v_rec.lap_seconds_source;
  END IF;

  -- Dezelfde auto, maar de planner geeft de catalogusnaam en de circuitnaam
  -- door in plaats van de iRacing-sleutels.
  SELECT * INTO v_rec FROM public.endurance_learning_summary('W8 Test Auto', 'W8 Test Circuit');
  IF v_rec.tank_minutes <> 56.4 THEN
    RAISE EXCEPTION 'A: naam→sleutel-herleiding gaf % minuten in plaats van 56,4', v_rec.tank_minutes;
  END IF;

  -- ------------------------------------------------------------------------
  -- B. 10 schone rondes plus twee uitschieters. De pitronde (400 s) en de
  --    garageronde (0,40 liter) mogen het gemiddelde niet verstellen. Het
  --    verbruik van de pitronde is geldig (11 metingen), zijn rondetijd niet.
  -- ------------------------------------------------------------------------
  INSERT INTO public.endurance_telemetry_archive
    (event_id, team_id, race_run_id, car_id, track_id, lap, lap_time_seconds, fuel_per_lap_litres, captured_at)
  SELECT gen_random_uuid(), gen_random_uuid(), v_run_b, 'w8-test-auto-b', v_track_b,
         g, 95.67, 2.94, v_start + (g || ' minutes')::interval
    FROM generate_series(1, 10) AS g;

  INSERT INTO public.endurance_telemetry_archive
    (event_id, team_id, race_run_id, car_id, track_id, lap, lap_time_seconds, fuel_per_lap_litres, captured_at)
  VALUES
    (gen_random_uuid(), gen_random_uuid(), v_run_b, 'w8-test-auto-b', v_track_b, 11, 400.0, 2.94, v_start + interval '11 minutes'),
    (gen_random_uuid(), gen_random_uuid(), v_run_b, 'w8-test-auto-b', v_track_b, 12, 95.67, 0.40, v_start + interval '12 minutes');

  SELECT * INTO v_rec FROM public.endurance_learning_summary('w8-test-auto-b', v_track_b);

  IF v_rec.sample_laps <> 11 THEN
    RAISE EXCEPTION 'B: verwachtte 11 bruikbare verbruiksmetingen na de poort, kreeg %', v_rec.sample_laps;
  END IF;
  IF v_rec.avg_fuel_per_lap_litres <> 2.940 THEN
    RAISE EXCEPTION 'B: uitschieter beïnvloedde het verbruik: %', v_rec.avg_fuel_per_lap_litres;
  END IF;
  IF v_rec.avg_lap_seconds <> 95.670 THEN
    RAISE EXCEPTION 'B: uitschieter beïnvloedde de rondetijd: %', v_rec.avg_lap_seconds;
  END IF;
  IF v_rec.tank_minutes <> 56.4 THEN
    RAISE EXCEPTION 'B: verwachtte 56,4 minuten, kreeg %', v_rec.tank_minutes;
  END IF;

  -- ------------------------------------------------------------------------
  -- C. Drie rondes: te weinig om te leren. Dan de prior, en geen tankduur —
  --    de leeslaag valt dan terug op tankDuration.ts.
  -- ------------------------------------------------------------------------
  INSERT INTO public.endurance_telemetry_archive
    (event_id, team_id, race_run_id, car_id, track_id, lap, lap_time_seconds, fuel_per_lap_litres, captured_at)
  SELECT gen_random_uuid(), gen_random_uuid(), v_run_c, 'w8-test-auto-c', v_track_c,
         g, 95.67, 2.94, v_start + (g || ' minutes')::interval
    FROM generate_series(1, 3) AS g;

  SELECT * INTO v_rec FROM public.endurance_learning_summary('w8-test-auto-c', v_track_c);

  IF v_rec.sample_laps <> 3 THEN
    RAISE EXCEPTION 'C: verwachtte 3 rondes, kreeg %', v_rec.sample_laps;
  END IF;
  IF v_rec.avg_fuel_per_lap_litres IS NOT NULL OR v_rec.avg_lap_seconds IS NOT NULL THEN
    RAISE EXCEPTION 'C: te weinig rondes maar toch een gemiddelde (%)', v_rec.avg_fuel_per_lap_litres;
  END IF;
  IF v_rec.fuel_per_lap_source <> 'spec_prior' OR v_rec.lap_seconds_source <> 'unknown' THEN
    RAISE EXCEPTION 'C: verwachtte bron spec_prior/unknown, kreeg %/%',
      v_rec.fuel_per_lap_source, v_rec.lap_seconds_source;
  END IF;
  IF v_rec.laps_per_tank <> 35.3 OR v_rec.tank_minutes IS NOT NULL THEN
    RAISE EXCEPTION 'C: verwachtte 35,3 rondes zonder tankduur, kreeg % / %',
      v_rec.laps_per_tank, v_rec.tank_minutes;
  END IF;

  -- ------------------------------------------------------------------------
  -- D. Onbekende auto: wel gemeten, geen tankinhoud. Geen verzonnen getal.
  -- ------------------------------------------------------------------------
  INSERT INTO public.endurance_telemetry_archive
    (event_id, team_id, race_run_id, car_id, track_id, lap, lap_time_seconds, fuel_per_lap_litres, captured_at)
  SELECT gen_random_uuid(), gen_random_uuid(), v_run_d, 'w8-test-onbekend', v_track_d,
         g, 95.67, 2.94, v_start + (g || ' minutes')::interval
    FROM generate_series(1, 12) AS g;

  SELECT * INTO v_rec FROM public.endurance_learning_summary('w8-test-onbekend', v_track_d);

  IF v_rec.avg_fuel_per_lap_litres <> 2.940 OR v_rec.fuel_per_lap_source <> 'archive' THEN
    RAISE EXCEPTION 'D: meting niet gebruikt (%)', v_rec.fuel_per_lap_source;
  END IF;
  IF v_rec.tank_capacity_litres IS NOT NULL OR v_rec.tank_minutes IS NOT NULL THEN
    RAISE EXCEPTION 'D: tank verzonnen (%)', v_rec.tank_capacity_litres;
  END IF;

  -- ------------------------------------------------------------------------
  -- E. Onbekende auto en baan: precies één rij, alles leeg. De leeslaag moet
  --    hierop kunnen vallen zonder op een fout te stuiten.
  -- ------------------------------------------------------------------------
  SELECT count(*) INTO v_aantal FROM public.endurance_learning_summary('bestaat-niet', '0');
  IF v_aantal <> 1 THEN
    RAISE EXCEPTION 'E: verwachtte één rij, kreeg %', v_aantal;
  END IF;

  SELECT * INTO v_rec FROM public.endurance_learning_summary('bestaat-niet', '0');
  IF v_rec.tank_minutes IS NOT NULL OR v_rec.fuel_per_lap_source <> 'unknown' THEN
    RAISE EXCEPTION 'E: onbekende auto gaf toch een waarde';
  END IF;
END $$;

ROLLBACK;
