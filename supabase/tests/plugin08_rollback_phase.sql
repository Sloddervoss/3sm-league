-- ============================================================================
-- Plugin 0.7.2.0 — controle na het terugdraaien (reviewpunt 10)
-- Datum: 2026-10-31
--
-- Draai dit NA de rollbackketen (190800 → 180000), in dezelfde wegwerpdatabase.
-- De runner zet vóór het terugdraaien een markerrij in beide meettabellen; die
-- moet er daarna nog staan. Dat is het bewijs dat de rollback gegevensbehoudend
-- is.
--
-- Wat hier bewezen wordt:
--   1. de oude schrijver is terug (5 en 6 argumenten werken, 8 geeft 42883);
--   2. de meetgegevens en de configuratiestand zijn NIET verdwenen;
--   3. de schrijvers, de trigger en de opruimfunctie zijn wel weg.
-- ============================================================================

begin;

set local request.jwt.claim.role = 'service_role';

create temp table t_resultaat (label text primary key, ok boolean not null);

create or replace function pg_temp.expect(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  insert into t_resultaat (label, ok) values (p_label, coalesce(p_ok, false))
  on conflict (label) do update set ok = excluded.ok;
end $$;

create or replace function pg_temp.eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql as $$
begin
  perform pg_temp.expect(p_actual is not distinct from p_expected, p_label);
end $$;

insert into public.simhub_devices (id, token_hash, device_name, connector_id, endurance_event_id,
                                   endurance_team_id, device_status, device_role)
values ('11111111-1111-4111-8111-111111111111', repeat('a', 64), 'PC-TEST', 'SIM-TEST',
        '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
        'active_binding', 'primary')
on conflict (id) do nothing;

create or replace function pg_temp.frame()
returns jsonb language sql as $$
  select jsonb_build_object(
    'protocolVersion', 3, 'sequence', 5000, 'capturedAt', '2026-10-31T15:00:00.000Z',
    'transportSessionId', 'sess-1',
    'identity', jsonb_build_object('currentDriverId', 'Driver One',
                                   'currentDriverName', 'Driver One',
                                   'carId', 'car', 'carName', 'Car',
                                   'trackName', 'Track', 'trackConfig', 'GP', 'trackId', 1),
    'session', jsonb_build_object('isInCar', true, 'sessionTimeSeconds', 1000,
                                  'sessionTimeRemainingSeconds', 100, 'sessionLapsRemaining', 5,
                                  'flags', jsonb_build_array('green'), 'sessionState', 'racing'),
    'timing', jsonb_build_object('currentLapElapsedSeconds', 40, 'lastLapTimeSeconds', 120.5,
                                 'bestLapTimeSeconds', 120.5, 'completedLaps', 9),
    'position', jsonb_build_object('position', 3, 'classPosition', 2, 'gapToLeaderSeconds', 1.5),
    'track', jsonb_build_object('lapDistancePct', 0.4, 'trackSurface', 'on_track', 'onPitRoad', false),
    'fuel', jsonb_build_object('fuelLitres', 40.5, 'fuelPct', 0.5),
    'raceState', jsonb_build_object('incidents', 0),
    'pitService', jsonb_build_object('pitServiceFlagsRaw', 0, 'requiredRepairSeconds', 0,
                                     'optionalRepairSeconds', 0))
$$;

-- ============================================================================
-- 1. De oude schrijver is terug
-- ============================================================================
do $$
declare
  v_count integer;
  v_args text;
  v_result text;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  perform pg_temp.eq(v_count, 1, 'na rollback is er precies één simhub_persist_v3');

  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  perform pg_temp.eq(v_args,
    'p_token_hash text, p_session_id text, p_sequence bigint, p_captured_at timestamp with time zone, '
    || 'p_v3_normalized jsonb, p_simhub_version text',
    'na rollback heeft simhub_persist_v3 weer zes parameters');

  update public.simhub_devices set last_seen_at = now() - interval '1 minute';
  select r.result into v_result
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 5000, '2026-10-31T15:00:00Z'::timestamptz, pg_temp.frame()) r;
  perform pg_temp.eq(v_result, 'accepted', 'na rollback werkt de aanroep met vijf argumenten');

  update public.simhub_devices set last_seen_at = now() - interval '1 minute';
  select r.result into v_result
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 5001, '2026-10-31T15:01:00Z'::timestamptz,
      pg_temp.frame(), '0.7.1.2') r;
  perform pg_temp.eq(v_result, 'accepted', 'na rollback werkt de aanroep met zes argumenten');

  -- Acht argumenten bestaan niet meer: dat is de hele reden dat de Edge op
  -- 42883/PGRST202 terugvalt in plaats van het frame te verliezen.
  begin
    perform public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 5002, '2026-10-31T15:02:00Z'::timestamptz,
      pg_temp.frame(), '0.7.2.0', '[]'::jsonb, '[]'::jsonb);
    perform pg_temp.expect(false, 'na rollback geeft de achtargumentaanroep 42883');
  exception when undefined_function then
    perform pg_temp.expect(true, 'na rollback geeft de achtargumentaanroep 42883');
  end;
end
$$;

-- ============================================================================
-- 2. Geen meetgegeven is verdwenen
-- ============================================================================
do $$
declare
  v_events integer;
  v_laps integer;
  v_config integer;
begin
  perform pg_temp.expect(to_regclass('public.simhub_measurement_events') is not null,
                         'na rollback bestaat simhub_measurement_events nog');
  perform pg_temp.expect(to_regclass('public.simhub_lap_summaries') is not null,
                         'na rollback bestaat simhub_lap_summaries nog');
  perform pg_temp.expect(to_regclass('public.simhub_connector_config') is not null,
                         'na rollback bestaat simhub_connector_config nog');

  select count(*)::integer into v_events
    from public.simhub_measurement_events where kind = 'rollback-marker';
  perform pg_temp.eq(v_events, 1, 'de markerrij in de meetgebeurtenissen heeft de rollback overleefd');

  select count(*)::integer into v_laps
    from public.simhub_lap_summaries where summary_id = 'rollback-marker';
  perform pg_temp.eq(v_laps, 1, 'de markerrij in de rondeaggregaten heeft de rollback overleefd');

  select count(*)::integer into v_config from public.simhub_connector_config where id = 1;
  perform pg_temp.eq(v_config, 1, 'de configuratiestand heeft de rollback overleefd');

  perform pg_temp.expect(not exists (select 1 from pg_proc p
                                      join pg_namespace n on n.oid = p.pronamespace
                                     where n.nspname = 'public'
                                       and p.proname = 'simhub_prune_measurements'),
                         'de opruimfunctie is weg');
  perform pg_temp.expect(not exists (select 1 from pg_trigger
                                      where tgname = 'simhub_telemetry_latest_strip_measurements'),
                         'de snapshot-trigger is weg');
  perform pg_temp.expect(not exists (select 1 from pg_proc p
                                      join pg_namespace n on n.oid = p.pronamespace
                                     where n.nspname = 'public'
                                       and p.proname = 'simhub_persist_measurement_batch'),
                         'de meetbatchschrijver is weg (herstel: alleen de oude schrijver)');
end
$$;

select label, case when ok then 'PASS' else 'FAIL' end as resultaat
  from t_resultaat
 order by label;

do $$
declare
  v_fail integer;
  v_totaal integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_totaal from t_resultaat;
  raise notice 'plugin08 rollback: % van % PASS', v_totaal - v_fail, v_totaal;
  if v_fail > 0 then
    raise exception '% van % rollbacktests FAALT: %', v_fail, v_totaal,
      (select string_agg(label, ' | ' order by label) from t_resultaat where not ok);
  end if;
end
$$;

rollback;
