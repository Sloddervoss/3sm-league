-- ============================================================================
-- Plugin 0.7.2.0 — belastingstest op het meetpad (reviewpunt 5, "nog niet bewezen")
-- Datum: 2026-10-31
--
-- Wat dit meet, in een WEGWERPDATABASE:
--   * de latentie per frame bij de maximale batches (200 gebeurtenissen en
--     20 rondeaggregaten per frame, de databasedrempels);
--   * hetzelfde pad met veel duplicaten (een outbox die opnieuw aanbiedt), wat
--     de revisie-/dedupe-tak raakt in plaats van de insert-tak;
--   * het WAL-volume per frame (pg_wal_lsn_diff), plus de tabel- en indexgroei.
--
-- Draai met: psql -X -v ON_ERROR_STOP=1 -d <wegwerpdb> -f plugin08_load_test.sql
-- (na fixture + migraties). Het script laat niets achter: het draait in een
-- transactie die aan het eind wordt teruggedraaid.
--
-- Geen PASS/FAIL-drempel op latentie: een grens hier zou een schatting zijn.
-- Wat het script wél hard controleert: er raakt geen rij zoek en duplicaten
-- worden als duplicaat geteld. De gemeten getallen staan in de uitvoer.
-- ============================================================================

begin;

set local request.jwt.claim.role = 'service_role';

create temp table t_lat (ronde integer, soort text, ms numeric);
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

-- Eén frame met de maximale batches. p_frame bepaalt de UUID-reeks, zodat een
-- tweede ronde met dezelfde p_frame precies dezelfde rijen aanbiedt (duplicaten).
create or replace function pg_temp.frame_payload(p_frame bigint, p_events integer, p_laps integer)
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

create or replace function pg_temp.events_payload(p_frame bigint, p_events integer)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
           'eventUid', pg_temp.uid(p_frame * 100000 + g),
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
           'maxAbsLatAccelG', 1.85, 'absLongAccelIntegralG30Seconds', 60,
           'absLongAccelIntegralGSeconds', 60,
           'sampleCount', 7200,
           'pitVisitIds', jsonb_build_array('pit-load'),
           'wearObservationIds', jsonb_build_array('evt-1'),
           'coverage', jsonb_build_object(
             'temperature', pg_temp.group_(2400),
             'fuel', pg_temp.group_(2400),
             'load', pg_temp.group_(2400))))
    from generate_series(1, p_laps) g
$$;

-- ---------------------------------------------------------------------------
-- 0. Referentie: hetzelfde frame ZONDER meetreeksen (het pad van 0.7.1.x)
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
    if (select r.result from public.simhub_persist_v3(
          repeat('a', 64), 'sess-base', v_frame, '2026-10-31T12:00:00Z'::timestamptz,
          pg_temp.frame_payload(v_frame, 200, 20)) r) <> 'accepted' then
      raise exception 'referentieframe % werd niet geaccepteerd', v_frame;
    end if;
    v_t1 := clock_timestamp();
    insert into t_lat values (v_frame, 'zonder-meetreeks', extract(epoch from (v_t1 - v_t0)) * 1000);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 0b. Realistisch: de Edge-grenzen (50 gebeurtenissen, 5 rondes per frame)
-- ---------------------------------------------------------------------------
do $$
declare
  v_frame integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_ack jsonb;
begin
  for v_frame in 1..20 loop
    update public.simhub_devices set last_seen_at = now() - interval '1 minute';
    v_t0 := clock_timestamp();
    select r.measurement_ack into v_ack
      from public.simhub_persist_v3(
        repeat('a', 64), 'sess-edge', v_frame, '2026-10-31T12:00:00Z'::timestamptz,
        pg_temp.frame_payload(500 + v_frame, 50, 5), '0.7.2.0',
        pg_temp.events_payload(500 + v_frame, 50),
        pg_temp.laps_payload(500 + v_frame, 5)) r;
    v_t1 := clock_timestamp();
    if jsonb_array_length(v_ack #> '{events,accepted}') <> 50
       or jsonb_array_length(v_ack #> '{laps,accepted}') <> 5 then
      raise exception 'edge-max frame % is niet verwerkt: %', v_frame, v_ack;
    end if;
    insert into t_lat values (v_frame, 'edge-max', extract(epoch from (v_t1 - v_t0)) * 1000);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Koud: 20 frames met de maximale batches
-- ---------------------------------------------------------------------------
do $$
declare
  v_frame integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_result text;
  v_ack jsonb;
begin
  for v_frame in 1..20 loop
    update public.simhub_devices set last_seen_at = now() - interval '1 minute';
    v_t0 := clock_timestamp();
    select r.result, r.measurement_ack into v_result, v_ack
      from public.simhub_persist_v3(
        repeat('a', 64), 'sess-load', v_frame, '2026-10-31T12:00:00Z'::timestamptz,
        pg_temp.frame_payload(v_frame, 200, 20), '0.7.2.0',
        pg_temp.events_payload(v_frame, 200),
        pg_temp.laps_payload(v_frame, 20)) r;
    v_t1 := clock_timestamp();
    if v_result <> 'accepted' then
      raise exception 'frame % gaf resultaat %', v_frame, v_result;
    end if;
    if jsonb_array_length(v_ack #> '{events,accepted}') <> 200 then
      raise exception 'frame % schreef % gebeurtenissen in plaats van 200',
        v_frame, jsonb_array_length(v_ack #> '{events,accepted}');
    end if;
    if jsonb_array_length(v_ack #> '{laps,accepted}') <> 20 then
      raise exception 'frame % schreef % rondes in plaats van 20',
        v_frame, jsonb_array_length(v_ack #> '{laps,accepted}');
    end if;
    insert into t_lat values (v_frame, 'max-batch', extract(epoch from (v_t1 - v_t0)) * 1000);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Duplicaten: dezelfde 20 frames nog eens, plus één nieuwe
-- ---------------------------------------------------------------------------
do $$
declare
  v_frame integer;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_ack jsonb;
begin
  for v_frame in 1..20 loop
    update public.simhub_devices set last_seen_at = now() - interval '1 minute';
    v_t0 := clock_timestamp();
    select r.measurement_ack into v_ack
      from public.simhub_persist_v3(
        repeat('a', 64), 'sess-load', 1000 + v_frame, '2026-10-31T12:00:00Z'::timestamptz,
        pg_temp.frame_payload(v_frame, 200, 20), '0.7.2.0',
        pg_temp.events_payload(v_frame, 200),
        pg_temp.laps_payload(v_frame, 20)) r;
    v_t1 := clock_timestamp();
    if jsonb_array_length(v_ack #> '{events,duplicates}') <> 200 then
      raise exception 'herverzending % telde % duplicaten in plaats van 200',
        v_frame, jsonb_array_length(v_ack #> '{events,duplicates}');
    end if;
    insert into t_lat values (v_frame, 'duplicates', extract(epoch from (v_t1 - v_t0)) * 1000);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. WAL en groei
-- ---------------------------------------------------------------------------
create temp table t_wal as
select pg_current_wal_lsn() as lsn_voor,
       (select count(*) from public.simhub_measurement_events) as events_voor,
       (select count(*) from public.simhub_lap_summaries) as laps_voor;

do $$
declare
  v_t0 timestamptz;
  v_t1 timestamptz;
begin
  -- Eén extra frame, zodat de WAL-meting precies dat frame dekt.
  update public.simhub_devices set last_seen_at = now() - interval '1 minute';
  v_t0 := clock_timestamp();
  perform public.simhub_persist_v3(
    repeat('a', 64), 'sess-load', 2000, '2026-10-31T12:00:00Z'::timestamptz,
    pg_temp.frame_payload(99, 200, 20), '0.7.2.0',
    pg_temp.events_payload(99, 200),
    pg_temp.laps_payload(99, 20));
  v_t1 := clock_timestamp();
  insert into t_lat values (99, 'wal-frame', extract(epoch from (v_t1 - v_t0)) * 1000);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Rapport
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

select (select count(*) from public.simhub_measurement_events) as events,
       (select count(*) from public.simhub_lap_summaries) as laps,
       pg_size_pretty(pg_total_relation_size('public.simhub_measurement_events')) as events_size,
       pg_size_pretty(pg_total_relation_size('public.simhub_lap_summaries')) as laps_size;

-- WAL per frame: het verschil tussen de lsn vóór de laatste meting en nu.
select pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), lsn_voor)) as wal_voor_laatste_frame
  from t_wal;

-- Harde controle: 20 × 200 (koud) + 20 × 50 (edge-max) + 200 (wal-frame)
-- = 5200 gebeurtenissen; 20 × 20 + 20 × 5 + 20 = 520 rondeaggregaten.
-- De duplicatenronde en de referentieronde voegen niets toe.
do $$
declare
  v_events integer;
  v_laps integer;
begin
  select count(*) into v_events from public.simhub_measurement_events;
  select count(*) into v_laps from public.simhub_lap_summaries;
  if v_events <> 5200 then
    raise exception 'verwachtte 5200 gebeurtenissen, gevonden %', v_events;
  end if;
  if v_laps <> 520 then
    raise exception 'verwachtte 520 rondeaggregaten, gevonden %', v_laps;
  end if;
  raise notice 'belastingstest: % gebeurtenissen en % rondeaggregaten, geen verlies', v_events, v_laps;
end
$$;

rollback;
