-- ============================================================================
-- Plugin 0.7.2.0 — belastingstest op het meetpad (review 2, punt 8)
-- Datum: 2026-10-31
--
-- Wat dit meet, in een WEGWERPDATABASE:
--   * het pad zonder meetreeksen (referentie, 0.7.1.x);
--   * het gekozen wire-maximum 20 events / 3 rondes per frame;
--   * de databasedrempel 200 / 20 per frame (capaciteit, geen wireprofiel);
--   * 50 / 5 per frame, de oude "edge-max" die nu boven de bytegrens ligt;
--   * dezelfde batches nog eens (duplicaten: de classificatietak);
--   * een batch met twee dezelfde UUID's, wat het set-based snelpad laat
--     terugvallen op de rij-voor-rij lus.
--   * het WAL-volume per frame.
--
-- Draai met: psql -X -v ON_ERROR_STOP=1 -d <wegwerpdb> -f plugin08_load_test.sql
-- (na fixture + migraties). Het script draait in een transactie die aan het
-- eind wordt teruggedraaid.
--
-- Geen PASS/FAIL-drempel op latentie: een grens hier zou een schatting zijn.
-- Wat het script wél hard controleert: geen rij raakt zoek, duplicaten worden
-- als duplicaat geteld en de terugval geeft dezelfde uitkomst.
-- ============================================================================

begin;

set local request.jwt.claim.role = 'service_role';

create temp table t_lat (ronde integer, soort text, ms numeric);
create temp table t_wal (soort text, bytes bigint, ms numeric);
create temp table t_ctx as
select '11111111-1111-4111-8111-111111111111'::uuid as device,
       '22222222-2222-4222-8222-222222222222'::uuid as event,
       '33333333-3333-4333-8333-333333333333'::uuid as team;

insert into public.simhub_devices (
  id, token_hash, device_name, connector_id, endurance_event_id, endurance_team_id,
  device_status, device_role)
select device, repeat('a', 64), 'PC-LOAD', 'SIM-LOAD', event, team, 'active_binding', 'primary'
from t_ctx;

create or replace function pg_temp.uid(p_n bigint)
returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad((p_n % 1000000000000)::text, 12, '0'))::uuid
$$;

create or replace function pg_temp.group_(p_samples integer)
returns jsonb language sql immutable as $$
  select jsonb_build_object('validDurationSeconds', 120.0, 'sampleCount', p_samples, 'maxGapSeconds', 0.1)
$$;

create or replace function pg_temp.frame_payload(p_frame bigint)
returns jsonb language sql as $$
  select jsonb_build_object(
    'protocolVersion', 3,
    'sequence', p_frame,
    'capturedAt', '2026-10-31T12:00:00.000Z',
    'transportSessionId', 'sess-load',
    'identity', jsonb_build_object('currentDriverId', 'Load Driver',
                                   'currentDriverName', 'Load Driver',
                                   'carId', 'car', 'carName', 'Car',
                                   'trackName', 'Track', 'trackConfig', 'GP', 'trackId', 1),
    'session', jsonb_build_object('isInCar', true, 'sessionTimeSeconds', 1000,
                                  'sessionTimeRemainingSeconds', 6000, 'sessionLapsRemaining', 100,
                                  'flags', jsonb_build_array('green'), 'sessionState', 'racing'),
    'timing', jsonb_build_object('currentLapElapsedSeconds', 40, 'lastLapTimeSeconds', 120.5,
                                 'bestLapTimeSeconds', 120.5, 'completedLaps', p_frame),
    'position', jsonb_build_object('position', 3, 'classPosition', 2, 'gapToLeaderSeconds', 1.5),
    'track', jsonb_build_object('lapDistancePct', 0.4, 'trackSurface', 'on_track', 'onPitRoad', false),
    'fuel', jsonb_build_object('fuelLitres', 40.5, 'fuelPct', 0.5),
    'raceState', jsonb_build_object('incidents', 0),
    'pitService', jsonb_build_object('pitServiceFlagsRaw', 0, 'requiredRepairSeconds', 0,
                                     'optionalRepairSeconds', 0))
$$;

-- p_dubbel: als true bevat de reeks één UUID twee keer. Dat dwingt in de
-- database het set-based snelpad tot de rij-voor-rij terugval.
create or replace function pg_temp.events_payload(p_frame bigint, p_events integer, p_dubbel boolean default false)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
           'eventUid', case when p_dubbel and g = p_events
                            then pg_temp.uid(p_frame * 100000 + 1)
                            else pg_temp.uid(p_frame * 100000 + g) end,
           'eventId', 'evt-' || g,
           'kind', 'wear_refresh_confirmed',
           'segmentId', 'seg-load',
           'observedSessionId', 'sess-load',
           'observedAt', '2026-10-31T12:00:00Z',
           'sessionTimeSeconds', 1000 + g,
           'sdkTick', 100000 + g,
           'confidence', 0.9,
           'evidence', jsonb_build_object('version', 1, 'source', 'tire_sets_used',
                                          'channels', jsonb_build_array('tire_sets_used', 'tyre_temp')),
           'wearBefore', jsonb_build_object('version', 1, 'scale', 'remaining_percent',
                                            'fl', 12.5, 'fr', 12.5, 'rl', 13.0, 'rr', 13.0),
           'wearAfter', jsonb_build_object('version', 1, 'scale', 'remaining_percent',
                                           'fl', 0.2, 'fr', 0.2, 'rl', 0.3, 'rr', 0.3),
           'setGeneration', jsonb_build_object('version', 1, 'fl', 3, 'fr', 3, 'rl', 3, 'rr', 3)))
    from generate_series(1, p_events) g
$$;

create or replace function pg_temp.laps_payload(p_frame bigint, p_laps integer)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
           'summaryUid', pg_temp.uid(900000000 + p_frame * 1000 + g),
           'summaryId', 'lap-' || g,
           'segmentId', 'seg-load',
           'observedSessionId', 'sess-load',
           'lapNumber', g,
           'startedAt', '2026-10-31T11:58:00Z',
           'endedAt', '2026-10-31T12:00:00Z',
           'currentDriverName', 'Load Driver',
           'aggregationVersion', 1,
           'complete', true,
           'invalidReasons', jsonb_build_array(),
           'pitLap', false,
           'driverChanged', false,
           'trackTempCMean', 32.5, 'trackTempCMin', 31, 'trackTempCMax', 34, 'airTempCMean', 21,
           'fuelStartLitres', 42, 'fuelEndLitres', 39.5,
           'fuelLevelIntegralLitreSeconds', 4875,
           'absLatAccelIntegralGSeconds', 220, 'latAccelSquaredIntegralG2Seconds', 380,
           'maxAbsLatAccelG', 1.85, 'absLongAccelIntegralGSeconds', 60,
           'sampleCount', 7200,
           'pitVisitIds', jsonb_build_array('pit-load'),
           'wearObservationIds', jsonb_build_array('evt-1'),
           'coverage', jsonb_build_object(
             'temperature', pg_temp.group_(2400),
             'fuel', pg_temp.group_(2400),
             'load', pg_temp.group_(2400))))
    from generate_series(1, p_laps) g
$$;

-- Eén frame door de echte schrijver. Geeft de ACK terug.
create or replace function pg_temp.run_frame(
  p_session text, p_seq bigint, p_frame bigint, p_events integer, p_laps integer,
  p_dubbel boolean default false)
returns jsonb language plpgsql as $$
declare
  v_ack jsonb;
begin
  update public.simhub_devices set last_seen_at = now() - interval '1 minute';
  select r.measurement_ack into v_ack
    from public.simhub_persist_v3(
      repeat('a', 64), p_session, p_seq, '2026-10-31T12:00:00Z'::timestamptz,
      pg_temp.frame_payload(p_frame), '0.7.2.0',
      pg_temp.events_payload(p_frame, p_events, p_dubbel),
      pg_temp.laps_payload(p_frame, p_laps)) r;
  return v_ack;
end $$;

-- ---------------------------------------------------------------------------
-- A. Referentie: hetzelfde frame ZONDER meetreeksen (pad van 0.7.1.x)
-- ---------------------------------------------------------------------------
do $$
declare
  v_frame integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
begin
  for v_frame in 1..20 loop
    update public.simhub_devices set last_seen_at = now() - interval '1 minute';
    v_t0 := clock_timestamp();
    perform public.simhub_persist_v3(
      repeat('a', 64), 'sess-base', v_frame, '2026-10-31T12:00:00Z'::timestamptz,
      pg_temp.frame_payload(v_frame));
    v_t1 := clock_timestamp();
    insert into t_lat values (v_frame, 'A zonder-meetreeks', extract(epoch from (v_t1 - v_t0)) * 1000);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- B. Het gekozen wire-maximum: 20 events / 3 rondes
-- ---------------------------------------------------------------------------
do $$
declare
  v_frame integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_ack jsonb;
begin
  for v_frame in 1..20 loop
    v_t0 := clock_timestamp();
    v_ack := pg_temp.run_frame('sess-edge', v_frame, 500 + v_frame, 20, 3);
    v_t1 := clock_timestamp();
    if jsonb_array_length(v_ack #> '{events,accepted}') <> 20
       or jsonb_array_length(v_ack #> '{laps,accepted}') <> 3 then
      raise exception 'wire-max frame % is niet verwerkt: %', v_frame, v_ack;
    end if;
    insert into t_lat values (v_frame, 'B wire-max 20/3', extract(epoch from (v_t1 - v_t0)) * 1000);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- C. 50 / 5 per frame (de oude edge-max; boven de bytegrens, databasecapaciteit)
-- ---------------------------------------------------------------------------
do $$
declare
  v_frame integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_ack jsonb;
begin
  for v_frame in 1..20 loop
    v_t0 := clock_timestamp();
    v_ack := pg_temp.run_frame('sess-50', v_frame, 600 + v_frame, 50, 5);
    v_t1 := clock_timestamp();
    if jsonb_array_length(v_ack #> '{events,accepted}') <> 50
       or jsonb_array_length(v_ack #> '{laps,accepted}') <> 5 then
      raise exception '50/5 frame % is niet verwerkt: %', v_frame, v_ack;
    end if;
    insert into t_lat values (v_frame, 'C 50/5', extract(epoch from (v_t1 - v_t0)) * 1000);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- D. Databasedrempel: 200 / 20 per frame (capaciteit, geen wireprofiel)
-- ---------------------------------------------------------------------------
do $$
declare
  v_frame integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_ack jsonb;
begin
  for v_frame in 1..10 loop
    v_t0 := clock_timestamp();
    v_ack := pg_temp.run_frame('sess-dbmax', v_frame, 700 + v_frame, 200, 20);
    v_t1 := clock_timestamp();
    if jsonb_array_length(v_ack #> '{events,accepted}') <> 200 then
      raise exception 'db-max frame % is niet verwerkt: %', v_frame, v_ack;
    end if;
    insert into t_lat values (v_frame, 'D db-max 200/20', extract(epoch from (v_t1 - v_t0)) * 1000);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- E. Duplicaten: dezelfde 20/3-batches nog eens
-- ---------------------------------------------------------------------------
do $$
declare
  v_frame integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_ack jsonb;
begin
  for v_frame in 1..20 loop
    v_t0 := clock_timestamp();
    v_ack := pg_temp.run_frame('sess-edge', v_frame, 500 + v_frame, 20, 3);
    v_t1 := clock_timestamp();
    if jsonb_array_length(v_ack #> '{events,duplicates}') <> 20
       or jsonb_array_length(v_ack #> '{laps,duplicates}') <> 3 then
      raise exception 'herverzending % telde % duplicaten: %',
        v_frame, jsonb_array_length(v_ack #> '{events,duplicates}'), v_ack;
    end if;
    insert into t_lat values (v_frame, 'E duplicaten 20/3', extract(epoch from (v_t1 - v_t0)) * 1000);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- F. Terugval: één UUID twee keer in de batch (set-based faalt, lus doet het)
-- ---------------------------------------------------------------------------
do $$
declare
  v_frame integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_ack jsonb;
begin
  for v_frame in 1..20 loop
    v_t0 := clock_timestamp();
    v_ack := pg_temp.run_frame('sess-fallback', v_frame, 900 + v_frame, 20, 3, true);
    v_t1 := clock_timestamp();
    -- De tweede rij met dezelfde UUID en dezelfde revisie maar andere inhoud
    -- is een conflict; de eerste is gewoon geaccepteerd. De terugval mag geen
    -- rij stil laten verdwijnen.
    if jsonb_array_length(v_ack #> '{events,accepted}') <> 19
       or jsonb_array_length(v_ack #> '{events,rejected}') <> 1
       or v_ack #>> '{events,rejected,0,reason}' <> 'revision_conflict' then
      raise exception 'terugvalframe % gaf % accepted / % afgekeurd: %',
        v_frame, jsonb_array_length(v_ack #> '{events,accepted}'),
        jsonb_array_length(v_ack #> '{events,rejected}'), v_ack;
    end if;
    insert into t_lat values (v_frame, 'F terugval 20/3', extract(epoch from (v_t1 - v_t0)) * 1000);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- G. WAL per frame, per profiel
-- ---------------------------------------------------------------------------
-- pg_current_wal_insert_lsn() schuift op zodra WAL wordt ingevoegd; de flush-LSN
-- (pg_current_wal_lsn) blijft binnen één transactie staan en is hier dus
-- onbruikbaar. pg_wal_lsn_diff geeft het aantal bytes ertussen.
do $$
declare
  v_before pg_lsn;
  v_after pg_lsn;
  v_t0 timestamptz;
  v_t1 timestamptz;
begin
  v_before := pg_current_wal_insert_lsn();
  v_t0 := clock_timestamp();
  perform pg_temp.run_frame('sess-wal', 1, 3001, 20, 3);
  v_t1 := clock_timestamp();
  v_after := pg_current_wal_insert_lsn();
  insert into t_wal values ('wire-max 20/3', pg_wal_lsn_diff(v_after, v_before)::bigint,
                            extract(epoch from (v_t1 - v_t0)) * 1000);

  v_before := pg_current_wal_insert_lsn();
  v_t0 := clock_timestamp();
  perform pg_temp.run_frame('sess-wal', 2, 3002, 50, 5);
  v_t1 := clock_timestamp();
  v_after := pg_current_wal_insert_lsn();
  insert into t_wal values ('50/5', pg_wal_lsn_diff(v_after, v_before)::bigint,
                            extract(epoch from (v_t1 - v_t0)) * 1000);

  v_before := pg_current_wal_insert_lsn();
  v_t0 := clock_timestamp();
  perform pg_temp.run_frame('sess-wal', 3, 3003, 20, 3, true);
  v_t1 := clock_timestamp();
  v_after := pg_current_wal_insert_lsn();
  insert into t_wal values ('terugval 20/3', pg_wal_lsn_diff(v_after, v_before)::bigint,
                            extract(epoch from (v_t1 - v_t0)) * 1000);
end $$;

-- ---------------------------------------------------------------------------
-- Rapport
-- ---------------------------------------------------------------------------
select soort,
       count(*) as frames,
       round(avg(ms)::numeric, 1) as gemiddeld_ms,
       round(percentile_cont(0.5) within group (order by ms)::numeric, 1) as p50_ms,
       round(percentile_cont(0.95) within group (order by ms)::numeric, 1) as p95_ms,
       round(max(ms)::numeric, 1) as max_ms
  from t_lat
 group by soort
 order by soort;

select soort, bytes as wal_bytes, round(ms::numeric, 1) as ms
  from t_wal order by soort;

select (select count(*) from public.simhub_measurement_events) as events,
       (select count(*) from public.simhub_lap_summaries) as laps,
       pg_size_pretty(pg_total_relation_size('public.simhub_measurement_events')) as events_size,
       pg_size_pretty(pg_total_relation_size('public.simhub_lap_summaries')) as laps_size;

-- Harde controle op verlies:
--   B: 20 × 20 events, 20 × 3 laps
--   C: 20 × 50, 20 × 5
--   D: 10 × 200, 10 × 20
--   E: duplicaten, geen nieuwe rijen
--   F: 20 × 19, 20 × 3
--   G: 20 + 50 + 19 events, 3 + 5 + 3 laps
do $$
declare
  v_events integer;
  v_laps integer;
begin
  select count(*) into v_events from public.simhub_measurement_events;
  select count(*) into v_laps from public.simhub_lap_summaries;
  if v_events <> 400 + 1000 + 2000 + 380 + 89 then
    raise exception 'verwachtte % gebeurtenissen, gevonden %', 400 + 1000 + 2000 + 380 + 89, v_events;
  end if;
  if v_laps <> 60 + 100 + 200 + 60 + 11 then
    raise exception 'verwachtte % rondeaggregaten, gevonden %', 60 + 100 + 200 + 60 + 11, v_laps;
  end if;
  raise notice 'belastingstest: % gebeurtenissen en % rondeaggregaten, geen verlies', v_events, v_laps;
end
$$;

rollback;
