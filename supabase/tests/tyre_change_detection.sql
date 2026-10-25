-- Test voor de bandenwissel-detectie (punten 23 en 24 van de na-de-race-lijst).
--
-- Draai in een transactie en sluit af met ROLLBACK: er blijft niets staan.
--   psql "$DATABASE_URL" -f supabase/tests/tyre_change_detection.sql
--
-- De waarden komen uit de race van 24-10:
--   * zeven rondes lang exact 81,3 / 85,3 / 88,9 / 89,2  -> bevroren
--   * de stop van 23:56: 81->89, 85->90, 89->90, 89->91   -> geen wissel
--     (rechts-achter gaat maar 1 punt omhoog: dat is een tussenstand)
--   * de stop van 00:22: alles naar 99,6                  -> wel een wissel
-- Daarnaast: een sprong zonder pitstop mag geen event geven, een gat in de
-- rondes mag geen delta geven, en drie gelijke rondes zijn nog niet bevroren.

begin;

do $test$
declare
  v_owner      uuid;
  v_event      uuid := 'aaaaaaa1-0000-4000-8000-000000000001';
  v_team_a     uuid := 'aaaaaaa1-0000-4000-8000-0000000000a1';
  v_team_b     uuid := 'aaaaaaa1-0000-4000-8000-0000000000b1';
  v_device     uuid := 'aaaaaaa1-0000-4000-8000-0000000000d1';
  v_run_a      uuid;
  v_run_b      uuid;
  v_n          integer;
  v_delta      numeric;
  v_flag       boolean;
  v_frozen     integer;
  v_len        smallint;
  v_events     integer;
  v_tick       record;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);

  -- Een device hoort bij een profiel; de test leent er een in plaats van er
  -- zelf een te maken (profielen hangen aan auth.users).
  select p.user_id into v_owner from public.profiles p
   where p.user_id is not null limit 1;
  if v_owner is null then
    raise exception 'test heeft een bestaand profiel nodig';
  end if;

  insert into public.endurance_events (id, name, circuit, configuration, start_at, end_at, visibility, status)
  values (v_event, 'Tyre change test', 'Test', '', now() - interval '3 hours', now() + interval '2 hours', 'hidden', 'live');

  insert into public.endurance_teams (id, event_id, name, car_number)
  values (v_team_a, v_event, 'Team A', '901'),
         (v_team_b, v_event, 'Team B', '902');

  insert into public.simhub_devices
    (id, owner_user_id, token_hash, connector_id, device_name,
     endurance_event_id, endurance_team_id, endurance_binding_source, device_status, device_role)
  values (v_device, v_owner, md5(random()::text) || md5(random()::text), 'tyre-test', 'tyre-test',
          v_event, v_team_a, 'manual', 'active_binding', 'primary');

  insert into public.endurance_race_runs (event_id, team_id, run_kind, status, started_at)
  values (v_event, v_team_a, 'race', 'active', now() - interval '3 hours')
  returning id into v_run_a;

  insert into public.endurance_race_runs (event_id, team_id, run_kind, status, started_at)
  values (v_event, v_team_b, 'race', 'active', now() - interval '3 hours')
  returning id into v_run_b;

  -- ---- Team A: de echte race van 24-10 ----
  -- Rondes 1-8: zeven keer hetzelfde beeld plus de meting waar het mee begon.
  insert into public.endurance_strategy_lap_samples
    (race_run_id, completed_laps, event_id, team_id,
     source_device_id, source_session_id, source_sequence,
     lap_time_seconds, valid_fuel_sample, exclusion_reason, fuel_stint_id, captured_at,
     wear_fl, wear_fr, wear_rl, wear_rr)
  select v_run_a, g.lap, v_event, v_team_a,
         v_device, 'sess-a', g.lap,
         100.0 + g.lap, false, null, 100, now() - interval '3 hours' + (g.lap || ' minutes')::interval,
         81.3, 85.3, 88.9, 89.2
    from generate_series(1, 8) as g(lap);

  -- De stop van 23:56: 81->89, 85->90, 89->90, 89->91. Geen nieuwe set.
  insert into public.endurance_strategy_lap_samples
    (race_run_id, completed_laps, event_id, team_id,
     source_device_id, source_session_id, source_sequence,
     lap_time_seconds, valid_fuel_sample, exclusion_reason, fuel_stint_id, captured_at,
     wear_fl, wear_fr, wear_rl, wear_rr)
  values (v_run_a, 9, v_event, v_team_a, v_device, 'sess-a', 9,
          180.0, false, 'pit_lane_during_lap', 100, now() - interval '2 hours 30 minutes',
          89.0, 90.0, 90.0, 91.0);

  -- Drie rustige rondes daarna.
  insert into public.endurance_strategy_lap_samples
    (race_run_id, completed_laps, event_id, team_id,
     source_device_id, source_session_id, source_sequence,
     lap_time_seconds, valid_fuel_sample, exclusion_reason, fuel_stint_id, captured_at,
     wear_fl, wear_fr, wear_rl, wear_rr)
  select v_run_a, g.lap, v_event, v_team_a,
         v_device, 'sess-a', g.lap,
         100.0, false, null, 100, now() - interval '2 hours' + (g.lap || ' minutes')::interval,
         89.0 - (g.lap - 9) * 0.4,
         90.0 - (g.lap - 9) * 0.4,
         90.0 - (g.lap - 9) * 0.4,
         91.0 - (g.lap - 9) * 0.4
    from generate_series(10, 12) as g(lap);

  -- De stop van 00:22: een echte nieuwe set, net onder 100.
  insert into public.endurance_strategy_lap_samples
    (race_run_id, completed_laps, event_id, team_id,
     source_device_id, source_session_id, source_sequence,
     lap_time_seconds, valid_fuel_sample, exclusion_reason, fuel_stint_id, captured_at,
     wear_fl, wear_fr, wear_rl, wear_rr)
  values (v_run_a, 13, v_event, v_team_a, v_device, 'sess-a', 13,
          190.0, false, 'pit_lane_during_lap', 100, now() - interval '1 hour 40 minutes',
          99.6, 99.6, 99.6, 99.6);

  -- En twee rondes op de nieuwe set.
  insert into public.endurance_strategy_lap_samples
    (race_run_id, completed_laps, event_id, team_id,
     source_device_id, source_session_id, source_sequence,
     lap_time_seconds, valid_fuel_sample, exclusion_reason, fuel_stint_id, captured_at,
     wear_fl, wear_fr, wear_rl, wear_rr)
  select v_run_a, g.lap, v_event, v_team_a,
         v_device, 'sess-a', g.lap,
         99.0, false, null, 100, now() - interval '1 hour' + (g.lap || ' minutes')::interval,
         99.6 - (g.lap - 13) * 0.4,
         99.6 - (g.lap - 13) * 0.4,
         99.6 - (g.lap - 13) * 0.4,
         99.6 - (g.lap - 13) * 0.4
    from generate_series(14, 15) as g(lap);

  -- Half binnen: alleen links-voor. Telt niet als meting.
  insert into public.endurance_strategy_lap_samples
    (race_run_id, completed_laps, event_id, team_id,
     source_device_id, source_session_id, source_sequence,
     lap_time_seconds, valid_fuel_sample, exclusion_reason, fuel_stint_id, captured_at,
     wear_fl)
  values (v_run_a, 16, v_event, v_team_a, v_device, 'sess-a', 16, 98.0, false, null, 100,
          now() - interval '50 minutes', 98.4);

  -- ---- Team B: sprong zonder pitstop, en een gat in de rondes ----
  insert into public.endurance_strategy_lap_samples
    (race_run_id, completed_laps, event_id, team_id,
     source_device_id, source_session_id, source_sequence,
     lap_time_seconds, valid_fuel_sample, exclusion_reason, fuel_stint_id, captured_at,
     wear_fl, wear_fr, wear_rl, wear_rr)
  values
    (v_run_b, 1, v_event, v_team_b, v_device, 'sess-b', 1, 100.0, false, null, 100,
     now() - interval '3 hours', 70.0, 70.0, 70.0, 70.0),
    (v_run_b, 2, v_event, v_team_b, v_device, 'sess-b', 2, 100.0, false, null, 100,
     now() - interval '2 hours 50 minutes', 69.0, 69.0, 69.0, 69.0),
    -- Ronde 3 ontbreekt: over dat gat heen is geen delta te berekenen.
    (v_run_b, 4, v_event, v_team_b, v_device, 'sess-b', 4, 100.0, false, null, 100,
     now() - interval '2 hours 30 minutes', 80.0, 80.0, 80.0, 80.0);

  -- ---- De detectie ----
  perform public.endurance_detect_tyre_changes(v_event, null);

  -- Team A: 15 echte metingen (ronde 16 is half en telt niet mee).
  select count(*) into v_n
    from public.endurance_strategy_lap_samples
   where event_id = v_event and team_id = v_team_a
     and wear_fl is not null and wear_fr is not null
     and wear_rl is not null and wear_rr is not null;
  if v_n <> 15 then
    raise exception 'verwacht 15 metingen voor team A, gevonden %', v_n;
  end if;

  -- De acht gelijke rondes zijn bevroren, met de lengte erbij.
  select count(*) into v_frozen
    from public.endurance_strategy_lap_samples
   where event_id = v_event and team_id = v_team_a and wear_frozen;
  if v_frozen <> 8 then
    raise exception 'verwacht 8 bevroren samples, gevonden %', v_frozen;
  end if;

  select wear_frozen_laps into v_len
    from public.endurance_strategy_lap_samples
   where race_run_id = v_run_a and completed_laps = 1;
  if v_len is distinct from 8 then
    raise exception 'verwacht een reeks van 8 rondes op ronde 1, gevonden %', v_len;
  end if;

  -- De tussenstand van 23:56 is geen bandenwissel, ook al is het een pitstop.
  select tyre_change_detected into v_flag
    from public.endurance_strategy_lap_samples
   where race_run_id = v_run_a and completed_laps = 9;
  if coalesce(v_flag, false) then
    raise exception 'de tussenstand op ronde 9 is ten onrechte als wissel gemarkeerd';
  end if;

  -- De echte wissel van 00:22 wel, en de delta staat op de meting.
  select tyre_change_detected, wear_delta_fl into v_flag, v_delta
    from public.endurance_strategy_lap_samples
   where race_run_id = v_run_a and completed_laps = 13;
  if not coalesce(v_flag, false) then
    raise exception 'de nieuwe set op ronde 13 is niet als wissel gemarkeerd';
  end if;
  if v_delta is distinct from 11.8 then
    raise exception 'verwacht delta 11.8 op ronde 13, gevonden %', v_delta;
  end if;

  -- Precies een event, met de vier delta''s in de payload.
  select count(*) into v_events
    from public.endurance_telemetry_events
   where team_id = v_team_a and event_type = 'tyre_change';
  if v_events <> 1 then
    raise exception 'verwacht 1 tyre_change-event voor team A, gevonden %', v_events;
  end if;

  select count(*) into v_n
    from public.endurance_telemetry_events
   where team_id = v_team_a
     and event_type = 'tyre_change'
     and completed_laps = 13
     and event_key = 'tyre_change:13'
     and event_detection_source = 'tyre_wear_jump'
     and (payload->'delta'->>'rr')::numeric = 9.8
     and payload->'previous_frozen' = 'false'::jsonb;
  if v_n <> 1 then
    raise exception 'het tyre_change-event mist de juiste payload';
  end if;

  -- Team B: een sprong van 11 punten zonder pitstop is geen wissel, en over
  -- het gat heen is de delta onbekend in plaats van 11.
  select count(*) into v_events
    from public.endurance_telemetry_events
   where team_id = v_team_b and event_type = 'tyre_change';
  if v_events <> 0 then
    raise exception 'team B kreeg % tyre_change-events zonder pitstop', v_events;
  end if;

  select wear_delta_fl into v_delta
    from public.endurance_strategy_lap_samples
   where race_run_id = v_run_b and completed_laps = 4;
  if v_delta is not null then
    raise exception 'over een gat hoort de delta leeg te zijn, gevonden %', v_delta;
  end if;

  -- Drie gelijke rondes zijn nog niet bevroren; team B heeft er nul.
  select count(*) into v_frozen
    from public.endurance_strategy_lap_samples
   where event_id = v_event and team_id = v_team_b and wear_frozen;
  if v_frozen <> 0 then
    raise exception 'team B heeft % bevroren samples, verwacht 0', v_frozen;
  end if;

  -- Idempotent: nog een keer draaien mag geen tweede event opleveren.
  perform public.endurance_detect_tyre_changes(v_event, null);
  select count(*) into v_events
    from public.endurance_telemetry_events
   where team_id = v_team_a and event_type = 'tyre_change';
  if v_events <> 1 then
    raise exception 'tweede run maakte een dubbel event (%), % stuks', v_events, v_events;
  end if;

  -- En de klok-taak loopt door de lopende events heen zonder fouten. Het aantal
  -- is niet vast te zetten: er kunnen andere events lopen.
  select * into v_tick from public.endurance_tick_tyre_changes();
  if v_tick.events is null or v_tick.events < 1 then
    raise exception 'de klok-taak vond geen enkele wissel (%)', v_tick.events;
  end if;

  raise notice 'tyre_change_detection: alle controles geslaagd';
end;
$test$;

rollback;
