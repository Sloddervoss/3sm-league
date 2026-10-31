-- ============================================================================
-- Plugin 0.7.2.0 — de verwijzing hoort bij de content-hash (open subpunt review 2)
-- Datum: 2026-10-31
--
-- Draai na de fixture en alle migraties (zie run_plugin08_proposal.sh). Alles
-- draait in één transactie die aan het eind wordt teruggedraaid.
--
-- De vraag die dit bestand beantwoordt: telt een correctie die alleen een
-- verwijzing (supersedes_*) toevoegt mee als andere inhoud? Zo nee, dan werd
-- zo'n correctie als duplicaat ingekort en verdween de verwijzing.
--
-- Bewijs:
--   S1  twee rijen met dezelfde inhoud en een ándere supersedes zijn geen
--       duplicaat (ze verschillen in de hash en staan er allebei);
--   S2  dezelfde inhoud met dezelfde supersedes is wél een duplicaat;
--   S3  de opgeslagen hash is exact de formule inclusief de verwijzing;
--   S4  hetzelfde voor rondeaggregaten (supersedes_summary_uid).
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
select device, repeat('b', 64), 'PC-SUPERSEDES', 'SIM-SUPERSEDES', event, team,
       'active_binding', 'primary'
from t_ids;

-- De fixture levert een stub voor de naamresolutie. Voor deze test de echte
-- regel: één profielnaam -> één user_id (dezelfde functie als het kernframe).
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

create or replace function pg_temp.hash_event(p_n integer, p_supersedes uuid)
returns text language sql immutable as $$
  select md5(jsonb_build_object(
           'segmentId', 'seg-1', 'observedSessionId', 'sess-1', 'pitVisitId', null,
           'kind', 'wear_refresh_confirmed',
           'observedAt', '2026-10-31T12:00:00Z'::timestamptz,
           'sessionTimeSeconds', 1000::double precision, 'sdkTick', 12345::bigint,
           'wearBefore', pg_temp.wear(12.5), 'wearAfter', pg_temp.wear(0.2),
           'setGeneration', null, 'evidence', pg_temp.evidence(),
           'confidence', 0.9::double precision,
           'supersedesEventUid', p_supersedes)::text)
$$;

-- ---------------------------------------------------------------------------
-- S1/S2 — dezelfde inhoud, andere verwijzing is geen duplicaat
-- ---------------------------------------------------------------------------
do $$
declare
  v_ack jsonb;
  v_hash_1 text;
  v_hash_2 text;
begin
  -- Eerste waarneming, zonder verwijzing.
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1',
    jsonb_build_array(pg_temp.event(50)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'S1 eerste waarneming is geaccepteerd');

  -- Herverzending van precies dezelfde rij: duplicaat.
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1',
    jsonb_build_array(pg_temp.event(50)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,duplicates}'), 1,
                     'S2 dezelfde inhoud en dezelfde supersedes is een duplicaat');
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 0,
                     'S2 een duplicaat schrijft niets');

  -- Dezelfde inhoud, maar nu met een verwijzing. Vóór deze migratie was dit een
  -- duplicaat (en verdween de verwijzing); nu is het zichtbaar andere inhoud.
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1',
    jsonb_build_array(pg_temp.event(50, jsonb_build_object(
      'supersedesEventUid', pg_temp.uid(51)))), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,duplicates}'), 0,
                     'S1 dezelfde inhoud met een andere supersedes is geen duplicaat');
  perform pg_temp.eq(v_ack #> '{events,rejected,0,reason}', '"revision_conflict"'::jsonb,
                     'S1 dezelfde revisie met andere inhoud is een zichtbaar conflict');

  -- Twee rijen met dezelfde inhoud en een verschillende verwijzing: allebei
  -- opgeslagen, met een verschillende hash.
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1',
    jsonb_build_array(
      pg_temp.event(52, jsonb_build_object('supersedesEventUid', pg_temp.uid(60))),
      pg_temp.event(53, jsonb_build_object('supersedesEventUid', pg_temp.uid(61)))),
    null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 2,
                     'S1 twee rijen met dezelfde inhoud en andere supersedes zijn allebei nieuw');

  select e.content_hash into v_hash_1 from public.simhub_measurement_events e
   where e.device_id = (select device::text from t_ids) and e.event_uid = pg_temp.uid(52);
  select e.content_hash into v_hash_2 from public.simhub_measurement_events e
   where e.device_id = (select device::text from t_ids) and e.event_uid = pg_temp.uid(53);
  perform pg_temp.expect(v_hash_1 is distinct from v_hash_2,
                         'S1 de hashes van de twee rijen verschillen');

  -- S3: de opgeslagen hash is exact de formule inclusief de verwijzing.
  perform pg_temp.eq(v_hash_1, pg_temp.hash_event(52, pg_temp.uid(60)),
                     'S3 de opgeslagen hash volgt de formule met supersedes');
  perform pg_temp.expect(v_hash_1 is distinct from
                         pg_temp.hash_event(52, null),
                         'S3 de hash zonder verwijzing is een andere waarde');

  -- Hogere revisie met de verwijzing: de correctie landt en de verwijzing staat
  -- er echt op.
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1',
    jsonb_build_array(pg_temp.event(50, jsonb_build_object(
      'recordRevision', 2,
      'supersedesEventUid', pg_temp.uid(51)))), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,superseded}'), 1,
                     'S1 een correctie met verwijzing op een hogere revisie landt');
  perform pg_temp.eq((select e.supersedes_event_uid from public.simhub_measurement_events e
                       where e.device_id = (select device::text from t_ids)
                         and e.event_uid = pg_temp.uid(50)), pg_temp.uid(51),
                     'S1 de verwijzing staat op de rij');

  -- En een replay van díe correctie is weer een duplicaat.
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1',
    jsonb_build_array(pg_temp.event(50, jsonb_build_object(
      'recordRevision', 2,
      'supersedesEventUid', pg_temp.uid(51)))), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,duplicates}'), 1,
                     'S2 dezelfde inhoud en dezelfde supersedes is opnieuw een duplicaat');
end $$;

-- ---------------------------------------------------------------------------
-- S4 — hetzelfde voor rondeaggregaten (supersedes_summary_uid)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ack jsonb;
  v_hash_1 text;
  v_hash_2 text;
  v_hash_3 text;
begin
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1', null,
    jsonb_build_array(pg_temp.lap(60)));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'S4 eerste rondeaggregaat is geaccepteerd');

  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1', null,
    jsonb_build_array(pg_temp.lap(60)));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,duplicates}'), 1,
                     'S4 dezelfde inhoud en dezelfde supersedes is een duplicaat');

  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1', null,
    jsonb_build_array(pg_temp.lap(60, jsonb_build_object(
      'supersedesSummaryUid', pg_temp.uid(1061)))));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,duplicates}'), 0,
                     'S4 dezelfde inhoud met een andere supersedes is geen duplicaat');
  perform pg_temp.eq(v_ack #> '{laps,rejected,0,reason}', '"revision_conflict"'::jsonb,
                     'S4 dezelfde revisie met andere inhoud is een zichtbaar conflict');

  -- Hogere revisie met verwijzing: landt, en de hash is de formule met de
  -- verwijzing.
  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1', null,
    jsonb_build_array(pg_temp.lap(61, jsonb_build_object(
      'supersedesSummaryUid', pg_temp.uid(1060)))));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'S4 een rondeaggregaat met verwijzing wordt opgeslagen');

  v_ack := public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-1', null,
    jsonb_build_array(pg_temp.lap(61, jsonb_build_object(
      'supersedesSummaryUid', pg_temp.uid(1060)))));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,duplicates}'), 1,
                     'S4 herverzending van die verwijzing is een duplicaat');

  -- De opgeslagen hash is de formule over de kolommen plus de verwijzing; zonder
  -- de verwijzing is het een andere waarde. Zo is te zien dat de verwijzing
  -- echt meeweegt en niet alleen in de schrijver staat.
  select l.content_hash,
         md5(jsonb_build_object(
           'segmentId', l.segment_id, 'observedSessionId', l.observed_session_id,
           'lapNumber', l.lap_number,
           'startedAt', l.started_at, 'endedAt', l.ended_at,
           'currentDriverName', l.current_driver_name,
           'aggregationVersion', l.aggregation_version, 'complete', l.complete,
           'invalidReasons', l.invalid_reasons, 'pitLap', l.pit_lap,
           'driverChanged', l.driver_changed,
           'tmin', l.track_temp_c_min, 'tmax', l.track_temp_c_max,
           'tmean', l.track_temp_c_mean, 'amean', l.air_temp_c_mean,
           'fs', l.fuel_start_litres, 'fe', l.fuel_end_litres,
           'fi', l.fuel_level_integral_litre_seconds,
           'fa', l.fuel_added_litres_observed,
           'ai', l.abs_lat_accel_integral_g_seconds,
           'ai2', l.lat_accel_squared_integral_g2_seconds,
           'amax', l.max_abs_lat_accel_g, 'ali', l.abs_long_accel_integral_g_seconds,
           'vd', l.valid_duration_seconds, 'sc', l.sample_count, 'gap', l.max_gap_seconds,
           'pitIds', l.pit_visit_ids, 'wearIds', l.wear_observation_ids,
           'cov', l.coverage,
           'supersedesSummaryUid', l.supersedes_summary_uid)::text),
         md5(jsonb_build_object(
           'segmentId', l.segment_id, 'observedSessionId', l.observed_session_id,
           'lapNumber', l.lap_number,
           'startedAt', l.started_at, 'endedAt', l.ended_at,
           'currentDriverName', l.current_driver_name,
           'aggregationVersion', l.aggregation_version, 'complete', l.complete,
           'invalidReasons', l.invalid_reasons, 'pitLap', l.pit_lap,
           'driverChanged', l.driver_changed,
           'tmin', l.track_temp_c_min, 'tmax', l.track_temp_c_max,
           'tmean', l.track_temp_c_mean, 'amean', l.air_temp_c_mean,
           'fs', l.fuel_start_litres, 'fe', l.fuel_end_litres,
           'fi', l.fuel_level_integral_litre_seconds,
           'fa', l.fuel_added_litres_observed,
           'ai', l.abs_lat_accel_integral_g_seconds,
           'ai2', l.lat_accel_squared_integral_g2_seconds,
           'amax', l.max_abs_lat_accel_g, 'ali', l.abs_long_accel_integral_g_seconds,
           'vd', l.valid_duration_seconds, 'sc', l.sample_count, 'gap', l.max_gap_seconds,
           'pitIds', l.pit_visit_ids, 'wearIds', l.wear_observation_ids,
           'cov', l.coverage)::text)
    into v_hash_1, v_hash_2, v_hash_3
    from public.simhub_lap_summaries l
   where l.device_id = (select device::text from t_ids)
     and l.summary_uid = pg_temp.uid(1061);
  perform pg_temp.eq(v_hash_1, v_hash_2,
                     'S4 de opgeslagen hash volgt de formule met supersedes');
  perform pg_temp.expect(v_hash_1 is distinct from v_hash_3,
                         'S4 de hash zonder verwijzing is een andere waarde');
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
  raise notice 'plugin08 supersedes-hash: % van % PASS', v_total - v_fail, v_total;
  if v_fail > 0 then
    raise exception 'plugin08 supersedes-hash: % FAIL: %', v_fail,
      (select string_agg(label, '; ' order by label) from t_resultaat where not ok);
  end if;
end $$;

rollback;
