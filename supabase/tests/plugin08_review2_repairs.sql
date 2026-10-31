-- ============================================================================
-- Plugin 0.7.2.0 — bewijs voor de tweede DDL-review (6.1 sol, 2026-10-31)
-- Datum: 2026-10-31
--
-- Draai na de fixture en alle migraties (zie run_plugin08_proposal.sh). Alles
-- draait in één transactie die aan het eind wordt teruggedraaid, zodat de
-- rollbackfase daarna een schone tabel ziet.
--
-- Elke sectie noemt het reviewpunt en de probe die de reviewer deed.
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

create temp table t_ids as
select '11111111-1111-4111-8111-111111111111'::uuid as device,
       '22222222-2222-4222-8222-222222222222'::uuid as event,
       '33333333-3333-4333-8333-333333333333'::uuid as team,
       '44444444-4444-4444-8444-444444444444'::uuid as driver;

create or replace function pg_temp.uid(p_n integer)
returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

insert into public.simhub_devices (
  id, token_hash, device_name, connector_id, endurance_event_id, endurance_team_id,
  device_status, device_role)
select device, repeat('b', 64), 'PC-REVIEW2', 'SIM-REVIEW2', event, team,
       'active_binding', 'primary'
from t_ids;

-- De testfixture levert een stub voor de naamresolutie (altijd null). Voor deze
-- test vervangen we hem door de echte regel: één profielnaam -> één user_id.
-- Dat is dezelfde functie die het kernframe gebruikt.
create or replace function public.simhub_resolve_driver_user(p_event uuid, p_team uuid, p_name text)
returns text language sql stable as $$
  select p.user_id::text
    from public.profiles p
   where public.simhub_name_key(p.iracing_name) = public.simhub_name_key(p_name)
      or public.simhub_name_key(p.display_name) = public.simhub_name_key(p_name)
   limit 1
$$;

insert into public.profiles (user_id, iracing_name, display_name)
select driver, 'Vincent deVos', 'Vincent de Vos' from t_ids
on conflict (user_id) do update set iracing_name = excluded.iracing_name;

insert into public.endurance_team_members (team_id, event_id, user_id)
select team, event, driver from t_ids;

-- ---------------------------------------------------------------------------
-- Kant-en-klare objecten
-- ---------------------------------------------------------------------------
create or replace function pg_temp.wear(p_fl numeric)
returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 1, 'scale', 'remaining_percent',
                            'fl', p_fl, 'fr', p_fl, 'rl', p_fl, 'rr', p_fl)
$$;

create or replace function pg_temp.evidence()
returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 1, 'source', 'tire_sets_used',
                            'channels', jsonb_build_array('tire_sets_used'))
$$;

create or replace function pg_temp.group_(p_samples integer, p_duration numeric, p_gap numeric)
returns jsonb language sql immutable as $$
  select jsonb_build_object('validDurationSeconds', p_duration,
                            'sampleCount', p_samples, 'maxGapSeconds', p_gap)
$$;

create or replace function pg_temp.coverage_full()
returns jsonb language sql immutable as $$
  select jsonb_build_object('temperature', pg_temp.group_(2400, 120.0, 0.1),
                            'fuel', pg_temp.group_(2400, 120.0, 0.1),
                            'load', pg_temp.group_(2400, 120.0, 0.1))
$$;

create or replace function pg_temp.event(p_n integer, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
           'eventUid', pg_temp.uid(p_n),
           'eventId', 'evt-' || p_n,
           'kind', 'wear_refresh_confirmed',
           'segmentId', 'seg-1',
           'observedSessionId', 'sess-1',
           'observedAt', '2026-10-31T12:00:00Z',
           'sessionTimeSeconds', 1000,
           'sdkTick', 12345,
           'confidence', 0.9,
           'evidence', pg_temp.evidence(),
           'wearBefore', pg_temp.wear(12.5),
           'wearAfter', pg_temp.wear(0.2)) || p_extra
$$;

create or replace function pg_temp.lap(p_n integer, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
           'summaryUid', pg_temp.uid(1000 + p_n),
           'summaryId', 'lap-' || p_n,
           'segmentId', 'seg-1',
           'observedSessionId', 'sess-1',
           'lapNumber', p_n,
           'startedAt', '2026-10-31T11:58:00Z',
           'endedAt', '2026-10-31T12:00:00Z',
           'currentDriverName', 'Vincent de Vos',
           'aggregationVersion', 1,
           'complete', true,
           'invalidReasons', jsonb_build_array(),
           'pitLap', false,
           'driverChanged', false,
           'trackTempCMean', 32.5, 'trackTempCMin', 31, 'trackTempCMax', 34,
           'airTempCMean', 21,
           'fuelStartLitres', 42, 'fuelEndLitres', 39.5,
           'fuelLevelIntegralLitreSeconds', 4875, 'fuelAddedLitresObserved', null,
           'absLatAccelIntegralGSeconds', 220, 'latAccelSquaredIntegralG2Seconds', 380,
           'maxAbsLatAccelG', 1.85, 'absLongAccelIntegralGSeconds', 60,
           'sampleCount', 7200,
           'pitVisitIds', jsonb_build_array('pit-1'),
           'wearObservationIds', jsonb_build_array('evt-1'),
           'coverage', pg_temp.coverage_full()) || p_extra
$$;

create or replace function pg_temp.ack_event(p_ack jsonb, p_id text)
returns jsonb language sql immutable as $$
  select coalesce((select e.value
                     from jsonb_array_elements(coalesce(p_ack #> '{events,accepted}', '[]'::jsonb)) e
                    where e.value->>'id' = p_id), 'null'::jsonb)
$$;

create or replace function pg_temp.ack_lap(p_ack jsonb, p_id text)
returns jsonb language sql immutable as $$
  select coalesce((select e.value
                     from jsonb_array_elements(coalesce(p_ack #> '{laps,accepted}', '[]'::jsonb)) e
                    where e.value->>'id' = p_id), 'null'::jsonb)
$$;

-- ---------------------------------------------------------------------------
-- P1 — rijdersemantiek: naam van de client, uuid van de server
-- ---------------------------------------------------------------------------
do $$
declare
  v_ack jsonb;
  v_row public.simhub_lap_summaries%rowtype;
  v_blocked boolean;
begin
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1', null, jsonb_build_array(pg_temp.lap(1)));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'P1 een ronde met alleen een rijdersnaam wordt geaccepteerd');

  select * into v_row from public.simhub_lap_summaries
   where device_id = (select device::text from t_ids)
     and summary_uid = pg_temp.uid(1001);
  perform pg_temp.eq(v_row.current_driver_name, 'Vincent de Vos',
                     'P1 current_driver_name is bewaard');
  perform pg_temp.eq(v_row.current_driver_id, (select driver from t_ids),
                     'P1 current_driver_id is server-side geresolveerd');

  -- De probe: een client-UUID is geen clientgegeven.
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1', null,
    jsonb_build_array(pg_temp.lap(2, jsonb_build_object(
      'currentDriverId', '44444444-4444-4444-8444-444444444444'))));
  perform pg_temp.eq(v_ack #> '{laps,rejected,0,reason}', '"client_driver_id_forbidden"'::jsonb,
                     'P1 een client-UUID in een ronde wordt geweigerd');

  -- De probe: driverChanged=true samen met een ingevulde rijder.
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1', null,
    jsonb_build_array(pg_temp.lap(3, jsonb_build_object('driverChanged', true))));
  perform pg_temp.eq(v_ack #> '{laps,rejected,0,reason}', '"driver_changed_with_driver"'::jsonb,
                     'P1 een rijderwissel met een naam wordt geweigerd');

  -- En de tweede wachter: ook een rechtstreekse insert moet eraan voldoen.
  v_blocked := false;
  begin
    insert into public.simhub_lap_summaries
      (summary_uid, summary_id, device_id, lap_number, driver_changed,
       current_driver_name, content_hash)
    values (pg_temp.uid(999), 'lap-direct', (select device::text from t_ids), 9, true,
            'Vincent de Vos', md5('x'));
  exception when check_violation then
    v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked,
                         'P1 de CHECK weigert een wissel met een rijdernaam');

  -- Een wissel zonder naam is de geldige vorm en blijft leeg.
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1', null,
    jsonb_build_array(pg_temp.lap(4, jsonb_build_object(
      'currentDriverName', null, 'driverChanged', true))));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'P1 een wissel zonder rijder wordt geaccepteerd');
  select * into v_row from public.simhub_lap_summaries
   where device_id = (select device::text from t_ids)
     and summary_uid = pg_temp.uid(1004);
  perform pg_temp.eq(v_row.current_driver_id, null::uuid,
                     'P1 zonder naam blijft de server-uuid leeg');
end $$;

-- ---------------------------------------------------------------------------
-- Resultaat
-- ---------------------------------------------------------------------------
do $$
declare
  v_fail integer;
  v_total integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t_resultaat;
  raise notice 'plugin08 review2: % van % PASS', v_total - v_fail, v_total;
  if v_fail > 0 then
    raise exception 'plugin08 review2: % FAIL: %', v_fail,
      (select string_agg(label, '; ' order by label) from t_resultaat where not ok);
  end if;
end $$;

rollback;
