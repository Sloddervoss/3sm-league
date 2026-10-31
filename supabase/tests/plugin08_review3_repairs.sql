-- ============================================================================
-- Plugin 0.7.2.0 — revisies blijven monotoon binnen één batch
-- Datum: 2026-10-31
--
-- Draai na de fixture en alle migraties (zie run_plugin08_proposal.sh). Alles
-- draait in één transactie die aan het eind wordt teruggedraaid.
--
-- Eén blokkerend punt uit review 3, met zijn eigen probe:
--
--   M1  (punt 8) Een batch met dezelfde UUID en de revisies 3 én 2 bovenop een
--       bestaande revisie 1 mag niet beide inplannen. De hoogste wint, de lagere
--       krijgt stale_revision en wordt niet als opgeslagen bevestigd. De
--       rij-voor-rij terugval herclassificeert tegen de actuele rijstand.
--
-- Bewijs:
--   M1a  gebeurtenis: 1 bestaand, dan 3 en 2 in één batch -> eindstand 3, één
--        bevestiging, de ander stale;
--   M1b  hetzelfde voor rondeaggregaten;
--   M1c  de terugvalfunctie zelf: een lagere revisie dan de rij is stale en
--        schrijft niets, een hogere landt.
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
select device, repeat('c', 64), 'PC-REVIEW3', 'SIM-REVIEW3', event, team,
       'active_binding', 'primary'
from t_ids;

-- De fixture levert een stub voor de naamresolutie; deze test gebruikt de echte
-- regel (één profielnaam -> één user_id).
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

create or replace function pg_temp.batch(p_events jsonb, p_laps jsonb)
returns jsonb language sql as $$
  select public.simhub_persist_measurement_batch((select device from t_ids), 'sess-1',
                                                 p_events, p_laps)
$$;

-- Telt hoeveel bevestigingen (accepted + superseded) een UUID noemt.
create or replace function pg_temp.bevestigingen(p_ack jsonb, p_block text, p_uid uuid)
returns integer language sql immutable as $$
  select (select count(*) from jsonb_array_elements(p_ack #> array[p_block, 'accepted']) a
           where a->>'id' = p_uid::text)
       + (select count(*) from jsonb_array_elements(p_ack #> array[p_block, 'superseded']) s
           where s->>'id' = p_uid::text)
$$;

-- ---------------------------------------------------------------------------
-- M1a — gebeurtenis: bestaand 1, dan 3 en 2 in één batch
-- ---------------------------------------------------------------------------
do $$
declare
  v_ack jsonb;
  v_row public.simhub_measurement_events%rowtype;
begin
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(70, jsonb_build_object('recordRevision', 1))), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'M1a revisie 1 is de bestaande stand');

  -- De probe: dezelfde UUID, revisies 3 en 2, in één batch.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(70, jsonb_build_object('recordRevision', 3, 'confidence', 0.7)),
    pg_temp.event(70, jsonb_build_object('recordRevision', 2, 'confidence', 0.6))), null);

  select * into v_row from public.simhub_measurement_events
   where event_uid = pg_temp.uid(70);
  perform pg_temp.eq(v_row.record_revision, 3,
                     'M1a de hoogste revisie wint (eindstand 3)');
  perform pg_temp.eq(v_row.confidence, 0.7::double precision,
                     'M1a de inhoud van revisie 3 staat opgeslagen, niet die van 2');
  perform pg_temp.eq(pg_temp.bevestigingen(v_ack, 'events', pg_temp.uid(70)), 1,
                     'M1a precies één bevestiging voor deze UUID');
  perform pg_temp.eq(v_ack #>> '{events,superseded,0,record_revision}', '3',
                     'M1a de bevestiging noemt revisie 3');
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'stale_revision',
                     'M1a revisie 2 wordt stale, niet bevestigd');
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,index}', '1',
                     'M1a de afwijzing hoort bij de tweede rij (revisie 2)');
  perform pg_temp.expect(not exists (
    select 1 from jsonb_array_elements(v_ack #> '{events,superseded}') s
     where s->>'record_revision' = '2'),
    'M1a revisie 2 staat niet in de bevestigingen');
end $$;

-- ---------------------------------------------------------------------------
-- M1b — hetzelfde voor rondeaggregaten
-- ---------------------------------------------------------------------------
do $$
declare
  v_ack jsonb;
  v_row public.simhub_lap_summaries%rowtype;
begin
  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(70, jsonb_build_object('recordRevision', 1))));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'M1b revisie 1 van de ronde is de bestaande stand');

  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(70, jsonb_build_object('recordRevision', 3, 'trackTempCMean', 33.0)),
    pg_temp.lap(70, jsonb_build_object('recordRevision', 2, 'trackTempCMean', 32.0))));

  select * into v_row from public.simhub_lap_summaries
   where summary_uid = pg_temp.uid(1070);
  perform pg_temp.eq(v_row.record_revision, 3,
                     'M1b de hoogste revisie wint (eindstand 3)');
  perform pg_temp.eq(v_row.track_temp_c_mean, 33.0::double precision,
                     'M1b de inhoud van revisie 3 staat opgeslagen, niet die van 2');
  perform pg_temp.eq(pg_temp.bevestigingen(v_ack, 'laps', pg_temp.uid(1070)), 1,
                     'M1b precies één bevestiging voor deze ronde');
  perform pg_temp.eq(v_ack #>> '{laps,rejected,0,reason}', 'stale_revision',
                     'M1b revisie 2 wordt stale, niet bevestigd');
end $$;

-- ---------------------------------------------------------------------------
-- M1c — de terugvalfunctie herclassificeert tegen de actuele rijstand
-- ---------------------------------------------------------------------------
-- Het set-based snelpad plant nu hoogstens één schrijfactie per UUID, dus de
-- terugval is een wachter. Deze test roept precies de functie aan die de
-- terugval gebruikt, met een plan dat tegen de opgeslagen stand afloopt.
do $$
declare
  v_plan jsonb;
  v_uitkomst text;
  v_row public.simhub_measurement_events%rowtype;
  v_lap public.simhub_lap_summaries%rowtype;
begin
  -- uid(70) staat op revisie 3. Een plan met revisie 2 mag niets schrijven.
  v_plan := jsonb_build_object(
    'device_id', (select device::text from t_ids), 'event_uid', pg_temp.uid(70),
    'event_id', 'evt-70', 'kind', 'wear_refresh_confirmed',
    'observed_session_id', 'sess-1', 'delivered_session_id', 'sess-1',
    'transport_session_id', 'sess-1', 'segment_id', 'seg-1',
    'observed_at', '2026-10-31T12:00:00Z', 'session_time_seconds', 1000,
    'sdk_tick', 12345, 'confidence', 0.11, 'evidence', pg_temp.evidence(),
    'wear_before', pg_temp.wear(12.5), 'wear_after', pg_temp.wear(0.2),
    'record_revision', 2);
  v_uitkomst := public.simhub_apply_event_row(v_plan);
  perform pg_temp.eq(v_uitkomst, 'stale_revision',
                     'M1c de terugval noemt een lagere revisie stale');
  select * into v_row from public.simhub_measurement_events where event_uid = pg_temp.uid(70);
  perform pg_temp.eq(v_row.record_revision, 3,
                     'M1c de lagere revisie heeft niets overschreven');
  perform pg_temp.eq(v_row.confidence, 0.7::double precision,
                     'M1c de inhoud van revisie 2 is niet geschreven');

  -- En een hogere revisie landt wel, met de hash over de opgeslagen waarden.
  v_plan := v_plan || jsonb_build_object('record_revision', 4, 'confidence', 0.5);
  v_uitkomst := public.simhub_apply_event_row(v_plan);
  perform pg_temp.eq(v_uitkomst, 'superseded',
                     'M1c een hogere revisie landt via de terugval');
  select * into v_row from public.simhub_measurement_events where event_uid = pg_temp.uid(70);
  perform pg_temp.eq(v_row.record_revision, 4, 'M1c de hogere revisie staat opgeslagen');
  perform pg_temp.eq(v_row.content_hash, public.simhub_event_row_hash(v_row),
                     'M1c de hash van de terugval beschrijft de opgeslagen rij');

  -- Hetzelfde voor de ronde (staat op revisie 3).
  v_uitkomst := public.simhub_apply_lap_row(
    jsonb_build_object(
      'device_id', (select device::text from t_ids), 'summary_uid', pg_temp.uid(1070),
      'summary_id', 'lap-70', 'segment_id', 'seg-1', 'lap_number', 70,
      'observed_session_id', 'sess-1', 'delivered_session_id', 'sess-1',
      'transport_session_id', 'sess-1',
      'started_at', '2026-10-31T11:58:00Z', 'ended_at', '2026-10-31T12:00:00Z',
      'current_driver_name', 'Vincent de Vos', 'aggregation_version', 1,
      'complete', true, 'pit_lap', false, 'driver_changed', false,
      'track_temp_c_mean', 31.0, 'coverage', pg_temp.coverage_full(),
      'record_revision', 2));
  perform pg_temp.eq(v_uitkomst, 'stale_revision',
                     'M1c de terugval noemt een lagere rondevisie stale');
  select * into v_lap from public.simhub_lap_summaries where summary_uid = pg_temp.uid(1070);
  perform pg_temp.eq(v_lap.record_revision, 3, 'M1c de ronde bleef op revisie 3');
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
  raise notice 'plugin08 review3: % van % PASS', v_total - v_fail, v_total;
  if v_fail > 0 then
    raise exception 'plugin08 review3: % FAIL: %', v_fail,
      (select string_agg(label, '; ' order by label) from t_resultaat where not ok);
  end if;
end $$;

rollback;
