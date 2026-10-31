-- ============================================================================
-- Plugin 0.8 — rollbackcontrole
-- Datum: 2026-10-31
--
-- Draai dit NA de vier rollbackbestanden, in deze volgorde:
--   20261031180300_plugin08_persist_v3_aggregates.rollback.sql
--   20261031180200_plugin08_connector_control.rollback.sql
--   20261031180100_plugin08_lap_summaries.rollback.sql
--   20261031180000_plugin08_measurement_events.rollback.sql
--
-- Wat hier bewezen wordt: na het terugdraaien is de functie weer de
-- zes-argumentversie, werkt een aanroep met vijf of zes argumenten nog steeds,
-- en bestaat de acht-argumentaanroep niet meer (42883) — dat laatste is de
-- reden dat de Edge de meetblokken alleen meestuurt als de server ze aanbiedt.
-- ============================================================================

create temp table t_resultaat (label text primary key, ok boolean not null);

create or replace function pg_temp.expect(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  insert into t_resultaat (label, ok) values (p_label, coalesce(p_ok, false))
  on conflict (label) do update set ok = excluded.ok;
end;
$$;

create or replace function pg_temp.eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void
language plpgsql
as $$
begin
  perform pg_temp.expect(p_actual is not distinct from p_expected, p_label);
end;
$$;

insert into public.simhub_devices (id, token_hash, device_name, connector_id, endurance_event_id,
                                   endurance_team_id, device_status, device_role)
values ('11111111-1111-4111-8111-111111111111', repeat('a', 64), 'PC-TEST', 'SIM-TEST',
        '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
        'active_binding', 'primary')
on conflict (id) do nothing;

set request.jwt.claim.role = 'service_role';

do $$
declare
  v_count integer;
  v_args text;
  v_ndefaults integer;
  v_result text;
  v_frame jsonb;
begin
  perform pg_temp.expect(to_regclass('public.simhub_measurement_events') is null,
                         'R1 simhub_measurement_events is weg');
  perform pg_temp.expect(to_regclass('public.simhub_lap_summaries') is null,
                         'R1 simhub_lap_summaries is weg');
  perform pg_temp.expect(to_regclass('public.simhub_connector_config') is null,
                         'R1 simhub_connector_config is weg');
  perform pg_temp.expect(to_regclass('public.simhub_connector_config_readonly') is null,
                         'R1 de publieke view is weg');
  perform pg_temp.expect(to_regclass('public.simhub_persist_measurement_batch')::text is null,
                         'R1 de meetbatch is weg');
  perform pg_temp.expect(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'simhub_jvalid'),
    'R1 de validatiehelpers zijn weg');

  select count(*), min(pg_get_function_identity_arguments(p.oid)), min(p.pronargdefaults)
    into v_count, v_args, v_ndefaults
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  perform pg_temp.eq(v_count, 1, 'R2 er is weer precies één overload');
  perform pg_temp.eq(v_args,
    'p_token_hash text, p_session_id text, p_sequence bigint, p_captured_at timestamp with time zone, p_v3_normalized jsonb, p_simhub_version text',
    'R2 de signatuur is weer die van 20261031140000 (zes parameters)');
  perform pg_temp.eq(v_ndefaults, 1, 'R2 alleen p_simhub_version heeft nog een default');

  v_frame := jsonb_build_object(
    'protocolVersion', 3, 'sequence', 10, 'capturedAt', '2026-10-31T12:00:00.000Z',
    'transportSessionId', 'sess-1',
    'identity', jsonb_build_object('currentDriverId', 'Driver One', 'currentDriverName', 'Driver One',
                                   'carId', 'car', 'carName', 'Car', 'trackName', 'Track',
                                   'trackConfig', 'GP', 'trackId', 1),
    'session', jsonb_build_object('isInCar', true, 'sessionTimeSeconds', 1000,
                                  'sessionTimeRemainingSeconds', 100, 'sessionLapsRemaining', 5,
                                  'flags', jsonb_build_array('green'), 'sessionState', 'racing'),
    'timing', jsonb_build_object('currentLapElapsedSeconds', 40, 'lastLapTimeSeconds', 120.5,
                                 'bestLapTimeSeconds', 120.5, 'completedLaps', 1),
    'position', jsonb_build_object('position', 3, 'classPosition', 2, 'gapToLeaderSeconds', 1.5),
    'track', jsonb_build_object('lapDistancePct', 0.4, 'trackSurface', 'on_track', 'onPitRoad', false),
    'fuel', jsonb_build_object('fuelLitres', 40.5, 'fuelPct', 0.5),
    'raceState', jsonb_build_object('incidents', 0),
    'pitService', jsonb_build_object('pitServiceFlagsRaw', 0, 'requiredRepairSeconds', 0,
                                     'optionalRepairSeconds', 0));

  select r.result into v_result
    from public.simhub_persist_v3(repeat('a', 64), 'sess-1', 10,
                                  '2026-10-31T12:00:00Z'::timestamptz, v_frame) r;
  perform pg_temp.eq(v_result, 'accepted', 'R2 aanroep met 5 argumenten werkt na rollback');

  update public.simhub_devices set last_seen_at = now() - interval '1 minute'
   where id = '11111111-1111-4111-8111-111111111111';
  select r.result into v_result
    from public.simhub_persist_v3(repeat('a', 64), 'sess-1', 20,
                                  '2026-10-31T12:01:00Z'::timestamptz, v_frame, null) r;
  perform pg_temp.eq(v_result, 'accepted', 'R2 aanroep met 6 argumenten werkt na rollback');

  -- De acht-argumentaanroep moet nu stuklopen. Dat is de reden dat de Edge hem
  -- alleen doet als de server de meetblokken aanbiedt.
  begin
    perform public.simhub_persist_v3(repeat('a', 64), 'sess-1', 30,
                                     '2026-10-31T12:02:00Z'::timestamptz, v_frame, null,
                                     '[]'::jsonb, '[]'::jsonb);
    perform pg_temp.expect(false, 'R2 aanroep met 8 argumenten faalt na rollback (42883)');
  exception when undefined_function then
    perform pg_temp.expect(true, 'R2 aanroep met 8 argumenten faalt na rollback (42883)');
  end;
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
