-- Rollback van 20261031190000_plugin08_measurement_identity.sql
-- Gegevensbehoudend: er wordt geen enkele meetrij verwijderd. Wat teruggaat is
-- code en, waar nodig, een constraint. De tabellen en hun inhoud blijven staan,
-- zodat een review of een latere herkansing de gegevens niet kwijt is.
--
-- De oude uniciteit (device_id, event_id) komt terug en event_uid mag weer leeg
-- zijn, zodat de schrijver van 20261031180300 (die alleen het tekst-ID kent) blijft
-- werken. De UUID-kolommen en hun waarden blijven staan: dat is de duurzame
-- identiteit, en die weggooien zou de outbox van elke client onbruikbaar maken.
-- Volgorde: altijd van nieuw naar oud terugdraaien (190800 eerst).
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

alter table public.simhub_measurement_events
  drop constraint if exists simhub_measurement_events_device_event_uid_key;
alter table public.simhub_measurement_events
  alter column event_uid drop not null;
alter table public.simhub_measurement_events
  add constraint simhub_measurement_events_device_event_key unique (device_id, event_id);
drop index if exists public.simhub_measurement_events_device_observed_session_idx;
drop index if exists public.simhub_lap_summaries_device_observed_session_idx;

alter table public.simhub_lap_summaries
  drop constraint if exists simhub_lap_summaries_device_summary_uid_key;
alter table public.simhub_lap_summaries
  alter column summary_uid drop not null;
alter table public.simhub_lap_summaries
  add constraint simhub_lap_summaries_device_summary_key unique (device_id, summary_id);

drop function if exists public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb);

--      de validatie, zodat een afgekeurde rij nooit een cast-exception kan geven.
create or replace function public.simhub_persist_measurement_batch(
  p_device_id uuid,
  p_session_id text,
  p_events jsonb,
  p_laps jsonb)
returns table (events_written integer, laps_written integer, rejected integer, duplicates integer)
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $function$
declare
  v_max_events constant integer := 200;
  v_max_laps constant integer := 20;
  v_device text := p_device_id::text;
  v_session text := btrim(p_session_id);

  v_events_in integer := 0;
  v_laps_in integer := 0;
  v_events_valid integer := 0;
  v_laps_valid integer := 0;
  v_events_written integer := 0;
  v_laps_written integer := 0;
begin
  if auth.role() <> 'service_role' then
    return query select 0, 0, 0, 0;
    return;
  end if;

  -- Zonder apparaat of sessie is er geen eigenaar voor de rij. Stil terug: dit is
  -- een programmeerfout in de aanroeper, niet iets om het frame voor te laten
  -- vallen.
  if p_device_id is null or char_length(coalesce(v_session, '')) not between 1 and 120 then
    return query select 0, 0, 0, 0;
    return;
  end if;

  -- Vorm- en lengtecontrole op het geheel. Een niet-array of een te lange reeks
  -- telt als één afwijzing: het is één fout van de zender, niet honderd.
  if p_events is not null then
    if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > v_max_events then
      rejected := coalesce(rejected, 0) + 1;
      p_events := null;
    else
      v_events_in := jsonb_array_length(p_events);
    end if;
  end if;

  if p_laps is not null then
    if jsonb_typeof(p_laps) <> 'array' or jsonb_array_length(p_laps) > v_max_laps then
      rejected := coalesce(rejected, 0) + 1;
      p_laps := null;
    else
      v_laps_in := jsonb_array_length(p_laps);
    end if;
  end if;

  rejected := coalesce(rejected, 0);

  -- ------------------------------------------------------------------
  -- Meetgebeurtenissen
  -- ------------------------------------------------------------------
  if p_events is not null and v_events_in > 0 then
    begin
    with src as (
      select e.value as row
        from jsonb_array_elements(p_events) as e(value)
       where jsonb_typeof(e.value) = 'object'
    ),
    ok as (
      select s.row
        from src s
       where
         -- Verplicht en streng: een stabiel ID en een soort zonder spaties of
         -- rare tekens. Zonder die twee is het geen gebeurtenis.
         (s.row->>'eventId') ~ '^[A-Za-z0-9._:-]{1,64}$'
         and (s.row->>'kind') ~ '^[a-z0-9._-]{1,64}$'
         and public.simhub_jvalid(s.row->'segmentId', 'string', 1, 64)
         and public.simhub_jvalid(s.row->'observedAt', 'timestamp')
         and public.simhub_jvalid(s.row->'sessionTimeSeconds', 'number', 0, 604800)
         and public.simhub_jvalid(s.row->'sdkTick', 'bigint', 0, 9007199254740991)
         and public.simhub_jvalid(s.row->'confidence', 'number', 0, 1)
    ),
    parsed as (
      select
        public.simhub_jtext(o.row->'eventId') as event_id,
        public.simhub_jtext(o.row->'kind') as kind,
        public.simhub_jtext(o.row->'segmentId') as segment_id,
        public.simhub_jtimestamptz(o.row->'observedAt') as observed_at,
        public.simhub_jdouble(o.row->'sessionTimeSeconds') as session_time_seconds,
        public.simhub_jbigint(o.row->'sdkTick') as sdk_tick,
        case when jsonb_typeof(o.row->'wearBefore') = 'object'
                  and pg_column_size(o.row->'wearBefore') <= 2048
             then o.row->'wearBefore' end as wear_before,
        case when jsonb_typeof(o.row->'wearAfter') = 'object'
                  and pg_column_size(o.row->'wearAfter') <= 2048
             then o.row->'wearAfter' end as wear_after,
        case when jsonb_typeof(o.row->'setGeneration') = 'object'
                  and pg_column_size(o.row->'setGeneration') <= 2048
             then o.row->'setGeneration' end as set_generation,
        case when jsonb_typeof(o.row->'evidence') = 'object'
                  and pg_column_size(o.row->'evidence') <= 4096
             then o.row->'evidence' end as evidence,
        public.simhub_jdouble(o.row->'confidence') as confidence
        from ok o
    ),
    ins as (
      insert into public.simhub_measurement_events (
        device_id, transport_session_id, segment_id, event_id, kind, observed_at,
        session_time_seconds, sdk_tick, wear_before, wear_after, set_generation,
        evidence, confidence)
      select v_device, v_session, p.segment_id, p.event_id, p.kind, p.observed_at,
             p.session_time_seconds, p.sdk_tick, p.wear_before, p.wear_after,
             p.set_generation, p.evidence, p.confidence
        from parsed p
      on conflict (device_id, event_id) do nothing
      returning 1
    )
    select (select count(*) from parsed), (select count(*) from ins)
      into v_events_valid, v_events_written;
    exception when others then
      -- Laatste vangnet: een rij die ondanks alle validatie toch een constraint
      -- raakt, kost de gebeurtenissen van dit frame en niet de batch, het frame
      -- of de rondeaggregaten.
      v_events_valid := 0;
      v_events_written := 0;
    end;
  end if;

  -- ------------------------------------------------------------------
  -- Rondeaggregaten
  -- ------------------------------------------------------------------
  if p_laps is not null and v_laps_in > 0 then
    begin
    with src as (
      select e.value as row
        from jsonb_array_elements(p_laps) as e(value)
       where jsonb_typeof(e.value) = 'object'
    ),
    ok as (
      select s.row
        from src s
       where
         (s.row->>'summaryId') ~ '^[A-Za-z0-9._:-]{1,64}$'
         -- Een ronde zonder (geldig) nummer is geen rondeaggregaat. Al het
         -- andere mag leeg zijn en blijft dan null: dekking boven volledigheid.
         and jsonb_typeof(s.row->'lapNumber') = 'number'
         and public.simhub_jvalid(s.row->'lapNumber', 'integer', 0, 100000)
         and public.simhub_jvalid(s.row->'segmentId', 'string', 1, 64)
         and public.simhub_jvalid(s.row->'startedAt', 'timestamp')
         and public.simhub_jvalid(s.row->'endedAt', 'timestamp')
         and public.simhub_jvalid(s.row->'currentDriverId', 'uuid')
         and public.simhub_jvalid(s.row->'aggregationVersion', 'integer', 1, 1000)
         and public.simhub_jvalid(s.row->'complete', 'boolean')
         and public.simhub_jvalid(s.row->'pitLap', 'boolean')
         and public.simhub_jvalid(s.row->'driverChanged', 'boolean')
         and public.simhub_jvalid(s.row->'validDurationSeconds', 'number', 0, 86400)
         and public.simhub_jvalid(s.row->'sampleCount', 'number', 0, 100000000)
         and public.simhub_jvalid(s.row->'maxGapSeconds', 'number', 0, 86400)
         and public.simhub_jvalid(s.row->'fuelStartLitres', 'number', 0, 300)
         and public.simhub_jvalid(s.row->'fuelEndLitres', 'number', 0, 300)
         and public.simhub_jvalid(s.row->'fuelAddedLitresObserved', 'number', 0, 300)
         -- Volgorde-eisen die ook als CHECK op de tabel staan. Ze hier al
         -- afvangen betekent: één onmogelijke rij wordt overgeslagen in plaats
         -- van dat de insert op de CHECK klapt.
         and (public.simhub_jtimestamptz(s.row->'startedAt') is null
              or public.simhub_jtimestamptz(s.row->'endedAt') is null
              or public.simhub_jtimestamptz(s.row->'endedAt') >= public.simhub_jtimestamptz(s.row->'startedAt'))
         and (public.simhub_jdouble(s.row->'trackTempCMin') is null
              or public.simhub_jdouble(s.row->'trackTempCMax') is null
              or public.simhub_jdouble(s.row->'trackTempCMax') >= public.simhub_jdouble(s.row->'trackTempCMin'))
    ),
    parsed as (
      select
        public.simhub_jtext(o.row->'summaryId') as summary_id,
        public.simhub_jtext(o.row->'segmentId') as segment_id,
        public.simhub_jint(o.row->'lapNumber') as lap_number,
        public.simhub_jtimestamptz(o.row->'startedAt') as started_at,
        public.simhub_jtimestamptz(o.row->'endedAt') as ended_at,
        public.simhub_juuid(o.row->'currentDriverId') as current_driver_id,
        coalesce(public.simhub_jint(o.row->'aggregationVersion'), 1) as aggregation_version,
        public.simhub_jbool(o.row->'complete') as complete,
        public.simhub_jtextarray(o.row->'invalidReasons', 16) as invalid_reasons,
        public.simhub_jbool(o.row->'pitLap') as pit_lap,
        public.simhub_jbool(o.row->'driverChanged') as driver_changed,
        public.simhub_jdouble(o.row->'trackTempCMean') as track_temp_c_mean,
        public.simhub_jdouble(o.row->'trackTempCMin') as track_temp_c_min,
        public.simhub_jdouble(o.row->'trackTempCMax') as track_temp_c_max,
        public.simhub_jdouble(o.row->'airTempCMean') as air_temp_c_mean,
        public.simhub_jdouble(o.row->'fuelStartLitres') as fuel_start_litres,
        public.simhub_jdouble(o.row->'fuelEndLitres') as fuel_end_litres,
        public.simhub_jdouble(o.row->'fuelLevelIntegralLitreSeconds') as fuel_level_integral_litre_seconds,
        public.simhub_jdouble(o.row->'fuelAddedLitresObserved') as fuel_added_litres_observed,
        public.simhub_jdouble(o.row->'absLatAccelIntegralGSeconds') as abs_lat_accel_integral_g_seconds,
        public.simhub_jdouble(o.row->'latAccelSquaredIntegralG2Seconds') as lat_accel_squared_integral_g2_seconds,
        public.simhub_jdouble(o.row->'maxAbsLatAccelG') as max_abs_lat_accel_g,
        public.simhub_jdouble(o.row->'absLongAccelIntegralGSeconds') as abs_long_accel_integral_g_seconds,
        public.simhub_jdouble(o.row->'validDurationSeconds') as valid_duration_seconds,
        public.simhub_jdouble(o.row->'sampleCount') as sample_count,
        public.simhub_jdouble(o.row->'maxGapSeconds') as max_gap_seconds,
        public.simhub_jtextarray(o.row->'pitVisitIds', 32) as pit_visit_ids,
        public.simhub_jtextarray(o.row->'wearObservationIds', 64) as wear_observation_ids
        from ok o
    ),
    ins as (
      insert into public.simhub_lap_summaries (
        summary_id, device_id, transport_session_id, segment_id, lap_number,
        started_at, ended_at, current_driver_id, aggregation_version, complete,
        invalid_reasons, pit_lap, driver_changed, track_temp_c_mean,
        track_temp_c_min, track_temp_c_max, air_temp_c_mean, fuel_start_litres,
        fuel_end_litres, fuel_level_integral_litre_seconds,
        fuel_added_litres_observed, abs_lat_accel_integral_g_seconds,
        lat_accel_squared_integral_g2_seconds, max_abs_lat_accel_g,
        abs_long_accel_integral_g_seconds, valid_duration_seconds, sample_count,
        max_gap_seconds, pit_visit_ids, wear_observation_ids)
      select p.summary_id, v_device, v_session, p.segment_id, p.lap_number,
             p.started_at, p.ended_at, p.current_driver_id, p.aggregation_version,
             p.complete, p.invalid_reasons, p.pit_lap, p.driver_changed,
             p.track_temp_c_mean, p.track_temp_c_min, p.track_temp_c_max,
             p.air_temp_c_mean, p.fuel_start_litres, p.fuel_end_litres,
             p.fuel_level_integral_litre_seconds, p.fuel_added_litres_observed,
             p.abs_lat_accel_integral_g_seconds,
             p.lat_accel_squared_integral_g2_seconds, p.max_abs_lat_accel_g,
             p.abs_long_accel_integral_g_seconds, p.valid_duration_seconds,
             p.sample_count, p.max_gap_seconds, p.pit_visit_ids,
             p.wear_observation_ids
        from parsed p
      on conflict (device_id, summary_id) do nothing
      returning 1
    )
    select (select count(*) from parsed), (select count(*) from ins)
      into v_laps_valid, v_laps_written;
    exception when others then
      v_laps_valid := 0;
      v_laps_written := 0;
    end;
  end if;

  -- Wat is afgekeurd: aangeboden min geldig. Wat dubbel was: geldig min
  -- geschreven. Zo is een replay te onderscheiden van een kapotte rij.
  events_written := coalesce(v_events_written, 0);
  laps_written := coalesce(v_laps_written, 0);
  rejected := rejected
              + (v_events_in - coalesce(v_events_valid, 0))
              + (v_laps_in - coalesce(v_laps_valid, 0));
  duplicates := (coalesce(v_events_valid, 0) - events_written)
                + (coalesce(v_laps_valid, 0) - laps_written);

  return query select events_written, laps_written, rejected, duplicates;
end;
$function$;

revoke all on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) to service_role;

