-- ============================================================================
-- Plugin 0.8 — simhub_persist_v3 schrijft meetgebeurtenissen en rondeaggregaten
-- Datum: 2026-10-31
-- Vorige migratie: 20261031180200_plugin08_connector_control.sql
-- Status: VOORSTEL. Niet toegepast op productie.
--
-- Wat dit bestand doet
-- --------------------
--   1. Voegt twee optionale parameters toe aan public.simhub_persist_v3:
--        p_events jsonb DEFAULT NULL   -- measurementEvents[]
--        p_laps   jsonb DEFAULT NULL   -- lapSummaries[]
--   2. Voegt de interne schrijver public.simhub_persist_measurement_batch() toe,
--      die deze twee reeksen valideert en idempotent invoegt in
--      simhub_measurement_events en simhub_lap_summaries.
--   3. Verandert verder NIETS aan het bestaande gedrag: de kern, de volgorde van
--      de bestaande parameters, de teruggeefwaarden ('accepted', 'replayed',
--      'rate_limited', 'invalid_payload', ...) en de rechten blijven gelijk.
--
-- Waarom dit de signatuur niet breekt — en waarom er toch een DROP in staat
-- ------------------------------------------------------------------------
-- In Postgres is een functie met een extra parameter DEFAULT een NIEUWE
-- overload, geen vervanging. Zonder drop zouden de zes- en de
-- acht-argumentversie naast elkaar bestaan en zou een aanroep met vijf
-- benoemde argumenten ambigu worden (42725). Daarom wordt de bestaande
-- zes-argumentdefinitie hier eerst expliciet gedropt en daarna opnieuw
-- aangemaakt met twee extra parameters ACHTERAAN, beide met DEFAULT NULL.
--
-- Gevolg, en dat is de eis:
--   * een aanroep met 5 argumenten (de Edge van 0.7.1.x doet dat) resolveert
--     naar deze functie en gedraagt zich identiek — p_events/p_laps zijn null
--     en er wordt geen enkele meetrij geschreven;
--   * een aanroep met 6 argumenten (de Edge van de huidige main) werkt ook;
--   * een aanroep met 8 argumenten schrijft de meetbatches erbij.
-- De volgorde van de bestaande zes argumenten is niet aangeraakt. Het DO-blok
-- onderaan telt de overloads en faalt met 42725 als het er niet precies één is:
-- dat is anders pas bij de eerste ingest zichtbaar.
--
-- Waarom de meetbatch niet fataal is
-- ----------------------------------
-- Een ongeldige of te grote meetreeks kost nooit het frame. De batch draait in
-- een eigen blok met een eigen exception-handler (zie de aanroep in de functie)
-- en meldt zich via RAISE WARNING. Een ontbrekende ronde is vervelend; een
-- verloren frame met ronde, brandstof en positie is erger.
--
-- Hangt af van 20261031180000, 20261031180100 en de live definitie van
-- simhub_persist_v3 uit 20261031140000 (zes parameters, p_simhub_version
-- DEFAULT NULL). De body hieronder is die definitie, ongewijzigd op de twee
-- nieuwe parameters en het meetbatch-blok na.
--
-- Geen begin/commit: atomair te draaien met psql -1.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Validatie- en extractiehelpers voor de meetbatches
-- ---------------------------------------------------------------------------
-- Waarom deze bestaan: de meetblokken komen als losse JSON-velden binnen. Eén
-- onleesbaar getal mag nooit een exception geven, want dan valt de hele batch
-- weg. `'12.5'::integer` of `'morgen'::timestamptz` gooit wél. Daarom twee
-- soorten helpers:
--
--   public.simhub_jvalid(jsonb, soort, min, max) -> boolean
--     "Mag deze rij door?" Ontbrekend of expliciet null is altijd goed (onbekend
--     is geen fout). Aanwezig maar onleesbaar of buiten bereik is fout. Met deze
--     ene functie staat de validatie in de WHERE en blijven de casts in de
--     SELECT veilig.
--
--   public.simhub_j<double|int|bigint|text|uuid|bool|timestamptz|textarray>
--     De waarde zelf, of null. Ze zijn STRICT: een ontbrekende sleutel geeft SQL
--     NULL en daar komt null uit.
--
-- Beide zijn intern (revoke van anon/authenticated); ze worden alleen door
-- simhub_persist_measurement_batch gebruikt.
create or replace function public.simhub_jvalid(
  p jsonb,
  p_kind text,
  p_min double precision default null,
  p_max double precision default null)
returns boolean
language plpgsql
immutable
as $$
declare
  v_text text;
  v_num double precision;
  v_ts timestamptz;
begin
  -- Ontbrekend (SQL null) of expliciet JSON null: niets te keuren.
  if p is null or p = 'null'::jsonb then
    return true;
  end if;

  if p_kind in ('string', 'uuid', 'timestamp') and jsonb_typeof(p) <> 'string' then
    return false;
  end if;
  if p_kind in ('number', 'integer', 'bigint') and jsonb_typeof(p) <> 'number' then
    return false;
  end if;
  if p_kind = 'boolean' and jsonb_typeof(p) <> 'boolean' then
    return false;
  end if;

  if p_kind = 'string' then
    v_text := btrim(p #>> '{}');
    return char_length(v_text) between coalesce(p_min, 1)::integer and coalesce(p_max, 64)::integer;
  end if;

  if p_kind in ('number', 'integer', 'bigint') then
    begin
      v_num := (p #>> '{}')::double precision;
    exception when others then
      return false;
    end;
    -- 'NaN'/'Infinity' zijn geldige invoer voor ::double precision en zouden
    -- elk gemiddelde vergiftigen. Ze zijn hier geen meting.
    if v_num is null
       or v_num = 'NaN'::double precision
       or v_num = 'Infinity'::double precision
       or v_num = '-Infinity'::double precision then
      return false;
    end if;
    if p_kind in ('integer', 'bigint') and v_num <> trunc(v_num) then
      return false;
    end if;
    if p_kind = 'integer' and v_num not between -2147483648 and 2147483647 then
      return false;
    end if;
    if p_kind = 'bigint' and v_num not between -9007199254740991 and 9007199254740991 then
      return false;
    end if;
    return (p_min is null or v_num >= p_min) and (p_max is null or v_num <= p_max);
  end if;

  if p_kind = 'timestamp' then
    v_text := p #>> '{}';
    -- Alleen ISO-8601 met zone. Een tijd zonder zone is geen tijd: de kolom is
    -- timestamptz en de lokale klok van een Windows-pc is geen waarnemingstijd.
    if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      return false;
    end if;
    begin
      v_ts := v_text::timestamptz;
    exception when others then
      return false;
    end;
    -- Alles buiten 2000-2100 is geen meting van deze eeuw en dus rommel.
    return v_ts between '2000-01-01T00:00:00Z'::timestamptz and '2100-01-01T00:00:00Z'::timestamptz;
  end if;

  if p_kind = 'uuid' then
    begin
      perform (p #>> '{}')::uuid;
    exception when others then
      return false;
    end;
    return true;
  end if;

  if p_kind = 'boolean' then
    return true;
  end if;

  -- Onbekende soort: nooit stil goedkeuren.
  return false;
end;
$$;

create or replace function public.simhub_jtext(p jsonb)
returns text
language sql
immutable
strict
as $$ select btrim(p #>> '{}') $$;

create or replace function public.simhub_jdouble(p jsonb)
returns double precision
language sql
immutable
strict
as $$ select (p #>> '{}')::double precision $$;

create or replace function public.simhub_jint(p jsonb)
returns integer
language sql
immutable
strict
as $$ select (p #>> '{}')::integer $$;

create or replace function public.simhub_jbigint(p jsonb)
returns bigint
language sql
immutable
strict
as $$ select (p #>> '{}')::bigint $$;

create or replace function public.simhub_juuid(p jsonb)
returns uuid
language sql
immutable
strict
as $$ select (p #>> '{}')::uuid $$;

create or replace function public.simhub_jtimestamptz(p jsonb)
returns timestamptz
language sql
immutable
strict
as $$ select (p #>> '{}')::timestamptz $$;

create or replace function public.simhub_jbool(p jsonb)
returns boolean
language sql
immutable
strict
as $$ select (p #>> '{}')::boolean $$;

-- Begrensde text[] uit een jsonb-array. Null of geen array geeft null (niet een
-- lege array: "niet meegestuurd" en "leeg" zijn verschillende dingen). Lege of
-- te lange strings vallen weg, het aantal is begrensd.
create or replace function public.simhub_jtextarray(p jsonb, p_max integer)
returns text[]
language sql
immutable
as $$
  select case
           when p is null or jsonb_typeof(p) <> 'array' then null
           -- Een lege array is 'geen redenen', niet 'onbekend': daarom
           -- coalesce naar '{}' en niet naar null.
           else coalesce((
             select array_agg(left(t.v, 64) order by t.ord)
               from jsonb_array_elements_text(p) with ordinality as t(v, ord)
              where t.ord <= p_max
                and char_length(btrim(t.v)) between 1 and 64
           ), '{}'::text[])
         end;
$$;

comment on function public.simhub_jvalid(jsonb, text, double precision, double precision) is
  'Interne validatie voor de meetbatches: ontbrekend of null is goed, aanwezig maar onleesbaar of buiten bereik is fout. Nooit een exception.';
comment on function public.simhub_jtextarray(jsonb, integer) is
  'Begrensde text[] uit een jsonb-array; null als het geen array is, strings 1-64 tekens, maximaal p_max elementen.';

revoke all on function public.simhub_jvalid(jsonb, text, double precision, double precision) from public, anon, authenticated;
revoke all on function public.simhub_jtext(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jdouble(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jint(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jbigint(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_juuid(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jtimestamptz(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jbool(jsonb) from public, anon, authenticated;
revoke all on function public.simhub_jtextarray(jsonb, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- De meetbatch: idempotent invoegen van gebeurtenissen en rondeaggregaten
-- ---------------------------------------------------------------------------
-- Waarom een eigen functie en niet inline in simhub_persist_v3: dit stuk is los
-- te testen (zie supabase/tests/plugin08_server_proposal.sql) zonder een
-- volledig frame na te bootsen. De enige aanroeper is simhub_persist_v3; anon en
-- authenticated kunnen er niet bij.
--
-- Vier harde regels:
--   1. De server is de baas over `device_id` en `transport_session_id`. Wat de
--      client daarover meeschuift wordt genegeerd: een gebeurtenis hoort bij het
--      apparaat dat hem aanbiedt, niet bij wat er in de JSON staat.
--   2. Iedere rij wordt apart gevalideerd; een ongeldige rij wordt overgeslagen
--      en geteld, de rest gaat door.
--   3. `on conflict do nothing`: een gebeurtenis of ronde die opnieuw wordt
--      aangeboden (verloren ACK) levert geen tweede rij en overschrijft niets.
--   4. De volgorde src -> ok -> parsed -> ins is bewust: de casts staan pas ná
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

comment on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) is
  'Interne schrijver voor meetgebeurtenissen en rondeaggregaten. Valideert per rij, slaat ongeldige rijen over en telt ze, en is idempotent op (device_id, event_id) en (device_id, summary_id). Device en sessie komen van de server, nooit uit de payload. Alleen aanroepbaar door simhub_persist_v3.';

revoke all on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Eerst de bestaande zes-argumentdefinitie weg; daarna bestaat er één functie.
-- ---------------------------------------------------------------------------
drop function if exists public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text);

CREATE OR REPLACE FUNCTION public.simhub_persist_v3(
  p_token_hash text,
  p_session_id text,
  p_sequence bigint,
  p_captured_at timestamp with time zone,
  p_v3_normalized jsonb,
  -- 0.8.0 herkomst: optioneel, achteraan en met default, zodat een aanroep met
  -- vijf argumenten blijft werken.
  p_simhub_version text DEFAULT NULL,
  -- 0.8.0 amendement: meetgebeurtenissen en rondeaggregaten uit hetzelfde frame.
  -- Beide zijn optioneel en staan ACHTER p_simhub_version, zodat de bestaande
  -- argumentvolgorde niet verschuift. Een 0.7.1.x-Edge die de functie met vijf
  -- benoemde argumenten aanroept, resolveert nog steeds naar deze functie.
  p_events jsonb DEFAULT NULL,
  p_laps jsonb DEFAULT NULL)
 RETURNS TABLE(result text, received_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
  d public.simhub_devices%ROWTYPE;
  s public.endurance_source_segments%ROWTYPE;
  e uuid; t uuid; r uuid;
  now_at timestamptz := clock_timestamp();
  nl integer; ni integer; np boolean;
  v_vorige_laps integer; nf text[];
  v_session_sequence bigint; v_session_count integer;
  baseline boolean := false; k text; payload jsonb;
  v_fuel numeric; v_last_laptime numeric; v_session_laps integer;
  v_driver_name text; v_driver_id text;
  v_run_laps integer; v_run_device uuid;
  v_auto_count bigint; v_auto_team uuid; v_auto_event uuid;
  v_practice_session_id uuid;
  v_practice_event_id uuid;
  -- S2 (anker): alleen op de pitvlag-overgang ingelezen. Alles nullable en
  -- null = onbekend; nooit een coalesce naar 0.
  v_anchor_fl numeric; v_anchor_fr numeric; v_anchor_rl numeric; v_anchor_rr numeric;
  v_zone_fl_l numeric;
  v_zone_fl_m numeric;
  v_zone_fl_r numeric;
  v_zone_fr_l numeric;
  v_zone_fr_m numeric;
  v_zone_fr_r numeric;
  v_zone_rl_l numeric;
  v_zone_rl_m numeric;
  v_zone_rl_r numeric;
  v_zone_rr_l numeric;
  v_zone_rr_m numeric;
  v_zone_rr_r numeric;
  v_anchor_track numeric; v_anchor_air numeric; v_anchor_rubber text;
  v_anchor_source text; v_anchor_sets integer;
  -- 0.8.0: uitkomst van de meetbatches. Bijzaak voor het frame; alleen voor de
  -- waarschuwing in de logboeken. 0/null betekent: er is niets aangeboden.
  v_agg_events integer := 0;
  v_agg_laps integer := 0;
  v_agg_rejected integer := 0;
  v_agg_duplicates integer := 0;
  -- Herkomst (0.8.0): twee losse versies, twee kolommen. Null = onbekend, en
  -- onbekend valt nooit terug op de apparaatnaam.
  v_simhub_version text;
  v_connector_version text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RETURN QUERY SELECT 'unauthorized'::text, NULL::timestamptz; RETURN;
  END IF;

  IF p_token_hash !~ '^[0-9a-f]{64}$'
     OR char_length(coalesce(p_session_id,'')) NOT BETWEEN 1 AND 120
     OR p_sequence IS NULL OR p_sequence < 0
     OR p_captured_at IS NULL
     OR jsonb_typeof(p_v3_normalized) <> 'object' THEN
    RETURN QUERY SELECT 'invalid_payload'::text, NULL::timestamptz; RETURN;
  END IF;

  -- Herkomst: de SimHub-versie en de connectorversie zijn twee verschillende
  -- dingen en horen dus in twee kolommen. Het source-blok is optioneel; ontbreekt
  -- het, dan blijft de kolom leeg in plaats van de apparaatnaam te herhalen
  -- (dat deed deze functie tot 2026-10-31: simhub_version = d.device_name).
  -- Beide kolommen hebben een CHECK van 1-60 tekens; een waarde daarbuiten zou
  -- het hele frame met 23514 laten klappen, dus die wordt null. Leeg is ook null.
  v_simhub_version := btrim(coalesce(p_simhub_version, p_v3_normalized#>>'{source,simHubVersion}', ''));
  IF char_length(v_simhub_version) NOT BETWEEN 1 AND 60 THEN v_simhub_version := NULL; END IF;
  v_connector_version := btrim(coalesce(p_v3_normalized#>>'{source,connectorVersion}', ''));
  IF char_length(v_connector_version) NOT BETWEEN 1 AND 60 THEN v_connector_version := NULL; END IF;

  SELECT * INTO d FROM public.simhub_devices WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid_device'::text, NULL::timestamptz; RETURN; END IF;
  IF d.revoked_at IS NOT NULL THEN RETURN QUERY SELECT 'revoked'::text, NULL::timestamptz; RETURN; END IF;

  -- Routing vereist een actieve binding. Een inschrijving is GEEN voorwaarde meer:
  -- de binding is de beheerder beslis, en een ontbrekende registratie mag een
  -- correct gekoppeld device niet stil in de device-scoped modus laten vallen.
  IF d.endurance_event_id IS NOT NULL AND d.endurance_team_id IS NOT NULL
     AND d.device_status = 'active_binding' AND d.device_role = 'primary'
  THEN
    e := d.endurance_event_id; t := d.endurance_team_id;

    SELECT id INTO r FROM public.endurance_race_runs
    WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
    LIMIT 1;

    -- Zonder actieve race run is het lap-event onbereikbaar. Start er een.
    IF r IS NULL THEN
      PERFORM public.simhub_start_race_run(e, t, 'race');
      SELECT id INTO r FROM public.endurance_race_runs
      WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
      LIMIT 1;
    END IF;
  ELSE
    e := NULL; t := NULL; r := NULL;
  END IF;

  IF d.last_seen_at IS NOT NULL AND d.last_seen_at > now_at - interval '400 milliseconds' THEN
    RETURN QUERY SELECT 'rate_limited'::text, now_at; RETURN;
  END IF;
  SELECT last_sequence INTO v_session_sequence
  FROM public.simhub_device_sessions WHERE device_id = d.id AND session_id = p_session_id FOR UPDATE;
  IF FOUND AND p_sequence <= v_session_sequence THEN
    RETURN QUERY SELECT 'replayed'::text, now_at; RETURN;
  END IF;
  IF NOT FOUND THEN
    SELECT count(*) INTO v_session_count FROM public.simhub_device_sessions WHERE device_id = d.id;
    -- Een device dat zijn plafond raakt mag niet permanent dood zijn. Ruim de
    -- oudste sessies op en houd de recente geschiedenis voor replay-detectie.
    IF v_session_count >= 64 THEN
      DELETE FROM public.simhub_device_sessions AS oud
      WHERE oud.device_id = d.id
        AND oud.session_id NOT IN (
          SELECT nieuw.session_id FROM public.simhub_device_sessions AS nieuw
          WHERE nieuw.device_id = d.id
          ORDER BY nieuw.last_seen_at DESC NULLS LAST
          LIMIT 48
        );
      SELECT count(*) INTO v_session_count FROM public.simhub_device_sessions WHERE device_id = d.id;
    END IF;
    IF v_session_count >= 64 THEN RETURN QUERY SELECT 'session_limit'::text, now_at; RETURN; END IF;
    IF d.last_session_id IS NOT NULL AND (d.last_seen_at > now_at - interval '5 seconds' OR p_sequence > 5) THEN
      RETURN QUERY SELECT 'replayed'::text, now_at; RETURN;
    END IF;
  END IF;

  nl := NULLIF(p_v3_normalized#>>'{timing,completedLaps}','')::integer;
  ni := NULLIF(p_v3_normalized#>>'{raceState,incidents}','')::integer;
  np := NULLIF(p_v3_normalized#>>'{track,onPitRoad}','')::boolean;
  v_fuel := NULLIF(p_v3_normalized#>>'{fuel,fuelLitres}','')::numeric;
  v_last_laptime := NULLIF(p_v3_normalized#>>'{timing,lastLapTimeSeconds}','')::numeric;
  v_session_laps := NULLIF(p_v3_normalized#>>'{session,sessionLapsRemaining}','')::integer;
  SELECT array_agg(x ORDER BY x) INTO nf FROM (
    SELECT DISTINCT jsonb_array_elements_text(coalesce(nullif(p_v3_normalized#>'{session,flags}', 'null'::jsonb), '[]'::jsonb)) x
  ) q;

  -- De plugin stuurt in currentDriverId in de praktijk een NAAM (SimHub's Opponent.Id).
  -- Beide velden worden daarom als naam behandeld.
  v_driver_name := nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverName}', '')), '');
  IF v_driver_name IS NULL THEN
    v_driver_name := nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverId}', '')), '');
  END IF;
  -- Automatische koppeling op de rijder in plaats van op het apparaat.
  -- Een device dat niet gekoppeld is hoort bij de coureur die erin zit. De naam
  -- komt uit de plugin en wordt opgezocht bij de teamleden van events die nu
  -- lopen. Alleen bij precies één team wordt er gekoppeld; bij twijfel niet.
  IF e IS NULL AND v_driver_name IS NOT NULL THEN
    WITH kandidaten AS (
      SELECT DISTINCT m.team_id, m.event_id
        FROM public.endurance_team_members m
        JOIN public.profiles p ON p.user_id = m.user_id
        JOIN public.endurance_events ev ON ev.id = m.event_id
       WHERE (public.simhub_name_key(p.iracing_name) = public.simhub_name_key(v_driver_name)
              OR public.simhub_name_key(p.display_name) = public.simhub_name_key(v_driver_name))
         AND now_at BETWEEN ev.start_at - interval '2 hours' AND ev.end_at + interval '30 minutes'
    )
    SELECT count(*), (array_agg(team_id))[1], (array_agg(event_id))[1]
      INTO v_auto_count, v_auto_team, v_auto_event
      FROM kandidaten;

    IF v_auto_count = 1 THEN
      -- Eerst de andere devices van dit team losmaken: er mag maar één primair zijn.
      UPDATE public.simhub_devices
         SET device_status = 'inactive', device_role = NULL,
             endurance_event_id = NULL, endurance_team_id = NULL,
             endurance_binding_source = NULL, updated_at = now_at
       WHERE id <> d.id AND revoked_at IS NULL
         AND endurance_team_id = v_auto_team AND endurance_event_id = v_auto_event;

      UPDATE public.simhub_devices
         SET device_status = 'active_binding', device_role = 'primary',
             endurance_event_id = v_auto_event, endurance_team_id = v_auto_team,
             endurance_binding_source = 'auto_driver', updated_at = now_at
       WHERE id = d.id;

      e := v_auto_event; t := v_auto_team;

      SELECT id INTO r FROM public.endurance_race_runs
       WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
       LIMIT 1;
      IF r IS NULL THEN
        PERFORM public.simhub_start_race_run(e, t, 'race');
        SELECT id INTO r FROM public.endurance_race_runs
         WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
         LIMIT 1;
      END IF;
    END IF;
  END IF;

  v_driver_id := public.simhub_resolve_driver_user(e, t, v_driver_name);


  -- Practice op baansleutel. Een manager opent een sessie voor een event; iedereen
  -- die op die baan rijdt telt dan mee, ook zonder teamkoppeling. Dat is nodig
  -- omdat teams pas na de practice op pace worden ingedeeld. De baan wordt
  -- gematcht op iRacings trackId tegen de catalogus van het event.
  IF v_last_laptime IS NOT NULL AND nl IS NOT NULL AND nl > 0
     AND v_last_laptime > 0 AND v_last_laptime <= 3600 THEN
    SELECT sess.id, sess.event_id INTO v_practice_session_id, v_practice_event_id
    FROM public.endurance_practice_sessions AS sess
    JOIN public.endurance_events AS ev ON ev.id = sess.event_id
    LEFT JOIN public.endurance_iracing_events AS cat ON cat.id = ev.iracing_catalog_event_id
    WHERE sess.ended_at IS NULL
      AND (
        cat.track_id = NULLIF(p_v3_normalized#>>'{identity,trackId}', '')::integer
        OR lower(btrim(coalesce(sess.circuit, ''))) = lower(btrim(coalesce(p_v3_normalized#>>'{identity,trackName}', '')))
      )
    ORDER BY sess.started_at DESC
    LIMIT 1;

    IF v_practice_session_id IS NOT NULL THEN
      INSERT INTO public.endurance_practice_laps (
        session_id, event_id, user_id, car_id, car_name, circuit,
        lap_seconds, fuel_used_litres, fuel_per_lap_litres,
        incident_count, recorded_at,
        source_session_id, source_device_id, completed_laps
      ) VALUES (
        v_practice_session_id, v_practice_event_id,
        COALESCE(NULLIF(v_driver_id, '')::uuid, d.owner_user_id),
        NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,carId}', '')), ''),
        NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,carName}', '')), ''),
        NULLIF(btrim(coalesce(p_v3_normalized#>>'{identity,trackName}', '')), ''),
        v_last_laptime,
        NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}', '')::numeric,
        NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}', '')::numeric,
        COALESCE(ni, 0),
        p_captured_at,
        btrim(p_session_id), d.id, nl
      )
      ON CONFLICT (event_id, source_session_id, source_device_id, completed_laps)
        WHERE source_session_id IS NOT NULL AND source_device_id IS NOT NULL AND completed_laps IS NOT NULL
      DO NOTHING;
    END IF;
  END IF;

  -- Routing-scoped logic only when active-bound
  IF e IS NOT NULL THEN
    SELECT * INTO s FROM public.endurance_source_segments
    WHERE device_id = d.id AND session_id = p_session_id AND event_id = e AND team_id = t FOR UPDATE;
    baseline := NOT FOUND;
    IF NOT baseline AND p_sequence <= s.last_sequence THEN
      RETURN QUERY SELECT 'replayed'::text, NULL::timestamptz; RETURN;
    END IF;

    -- Een nieuwe sessie begint weer bij ronde 0. Zonder deze controle blijft de
    -- oude race run actief en botst elke ronde op ON CONFLICT
    -- (race_run_id, completed_laps): de eerste rondes van een herstart
    -- verdwijnen dan stil, want ze bestaan al.
    --
    -- De vorige stand komt uit het laatst bijgewerkte segment van dit device,
    -- niet uit het huidige: bij een nieuwe sessie bestaat dat nog niet.
    IF nl IS NOT NULL AND r IS NOT NULL THEN
      -- Vergelijk met de laatste sample van DEZE run op HETZELFDE device.
      -- De oude code vergeleek met het eigen, mogelijk uren oude segment van dit
      -- device. Bij een coureurswissel komt de eerste ronde van een ander device
      -- met een andere tellerstand binnen, waardoor de race telkens in een nieuwe
      -- run werd geknipt (14 runs in een race van 6 uur).
      SELECT l.completed_laps, l.source_device_id
        INTO v_run_laps, v_run_device
        FROM public.endurance_strategy_lap_samples l
       WHERE l.race_run_id = r AND l.completed_laps IS NOT NULL
       ORDER BY l.captured_at DESC
       LIMIT 1;

      IF v_run_device = d.id AND v_run_laps IS NOT NULL AND nl + 2 < v_run_laps THEN
        UPDATE public.endurance_race_runs
           SET status = 'ended', ended_at = clock_timestamp()
         WHERE id = r AND status = 'active';
        PERFORM public.simhub_start_race_run(e, t, 'race');
        SELECT id INTO r FROM public.endurance_race_runs
         WHERE event_id = e AND team_id = t AND run_kind = 'race' AND status = 'active'
         LIMIT 1;
        -- Deze ronde is de nulmeting van de nieuwe run; de volgende telt.
        s.previous_completed_laps := nl;
      END IF;
    END IF;

    IF NOT baseline AND r IS NOT NULL THEN
      IF s.previous_completed_laps IS NOT NULL AND nl = s.previous_completed_laps + 1 THEN
        k := 'lap:' || nl;
        payload := jsonb_build_object(
          'completedLaps', nl,
          'lastLapTimeSeconds', v_last_laptime,
          -- Identiteit mee, zodat de lees-kant altijd een bron heeft.
          'identity', coalesce(p_v3_normalized->'identity', '{}'::jsonb),
          'driverName', v_driver_name
        );
        -- S2: in_pit_lane, fuel_litres en fuel_per_lap_litres gaan mee. Niemand
        -- schreef ze ooit, waardoor pitstops achteraf onvindbaar waren; deze drie
        -- waren altijd null, dus er kan niets op gebroken zijn.
        INSERT INTO public.endurance_telemetry_events(
          device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,
          event_detection_source,completed_laps,driver_id,lap,lap_time_from_deltas_s,payload,race_run_id,
          in_pit_lane,fuel_litres,fuel_per_lap_litres)
        VALUES(
          d.id,e,t,p_session_id,'lap_completed',k,p_sequence,p_captured_at,
          'simhub_v3_transition',nl,v_driver_id,nl,v_last_laptime,payload,r,
          np,v_fuel,NULLIF(p_v3_normalized#>>'{fuel,fuelPerLapLitres}','')::numeric)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    INSERT INTO public.endurance_source_segments(
      device_id,session_id,event_id,team_id,race_run_id,last_sequence,
      previous_completed_laps,previous_in_pit_lane,previous_incidents,previous_flags)
    VALUES(d.id,p_session_id,e,t,r,p_sequence,nl,np,ni,nf)
    ON CONFLICT(device_id,session_id,event_id,team_id) DO UPDATE SET
      race_run_id=excluded.race_run_id,
      last_sequence=excluded.last_sequence,
      previous_completed_laps=excluded.previous_completed_laps,
      previous_in_pit_lane=excluded.previous_in_pit_lane,
      previous_incidents=excluded.previous_incidents,
      previous_flags=excluded.previous_flags,
      updated_at=clock_timestamp();
  END IF;

  -- Always store latest snapshot (device-scoped when unbounded: event/team/race_run NULL).
  INSERT INTO public.simhub_telemetry_latest(
    device_id,owner_user_id,race_id,team_id,session_id,sequence,captured_at,received_at,
    connector_id,simhub_version,connector_version,game,telemetry,
    endurance_event_id,endurance_team_id,race_run_id,
    driver_id,current_driver_id,current_driver_name,v3_normalized,
      car_id,car_name,track_name,track_config)
  VALUES(d.id,d.owner_user_id,d.race_id,d.team_id,p_session_id,p_sequence,p_captured_at,now_at,
    d.connector_id,v_simhub_version,v_connector_version,'IRacing','{}',
    e,t,r,
    v_driver_id,
    nullif(btrim(coalesce(p_v3_normalized#>>'{identity,currentDriverId}','')),''),
    v_driver_name,
    p_v3_normalized,
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,carId}','')),''),
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,carName}','')),''),
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,trackName}','')),''),
      nullif(btrim(coalesce(p_v3_normalized#>>'{identity,trackConfig}','')),''))
  ON CONFLICT(device_id) DO UPDATE SET
    session_id=excluded.session_id, sequence=excluded.sequence, captured_at=excluded.captured_at,
    received_at=excluded.received_at,
    -- De versies horen bij het laatste frame. Een frame zonder source-blok wist ze
    -- naar null: onbekend blijft onbekend, en de oude apparaatnaam verdwijnt in
    -- plaats van voor altijd te blijven staan.
    simhub_version=excluded.simhub_version,
    connector_version=excluded.connector_version,
    endurance_event_id=excluded.endurance_event_id, endurance_team_id=excluded.endurance_team_id,
    race_run_id=excluded.race_run_id,
    driver_id=excluded.driver_id,
    current_driver_id=excluded.current_driver_id,
    current_driver_name=excluded.current_driver_name,
    v3_normalized=excluded.v3_normalized,
      car_id=excluded.car_id, car_name=excluded.car_name,
      track_name=excluded.track_name, track_config=excluded.track_config;

  INSERT INTO public.simhub_device_sessions(device_id,session_id,last_sequence,first_seen_at,last_seen_at)
  VALUES(d.id,p_session_id,p_sequence,now_at,now_at)
  ON CONFLICT(device_id,session_id) DO UPDATE SET last_sequence=excluded.last_sequence,last_seen_at=excluded.last_seen_at;

  UPDATE public.simhub_devices SET last_seen_at=now_at, last_session_id=p_session_id, last_sequence=p_sequence, updated_at=now_at WHERE id=d.id;

  IF e IS NOT NULL THEN
    IF r IS NOT NULL AND NOT baseline THEN
      PERFORM public.simhub_update_strategy_v3(
        r,d.id,p_session_id,p_sequence,e,t,nl,v_fuel,np,v_last_laptime,v_session_laps,
        baseline,s.previous_completed_laps,s.previous_in_pit_lane);

        -- Bandenslijtage hoort bij dezelfde ronde, maar alleen hier is de
        -- payload beschikbaar; de strategiefunctie krijgt losse getallen.
        -- Alleen vullen als het een getal is, anders blijft de kolom leeg.
        IF nl IS NOT NULL THEN
          UPDATE public.endurance_strategy_lap_samples
             SET wear_fl = CASE WHEN (p_v3_normalized->'vehicle'->'frontLeft'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'frontLeft'->>'wearPercent')::numeric END,
                 wear_fr = CASE WHEN (p_v3_normalized->'vehicle'->'frontRight'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'frontRight'->>'wearPercent')::numeric END,
                 wear_rl = CASE WHEN (p_v3_normalized->'vehicle'->'rearLeft'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'rearLeft'->>'wearPercent')::numeric END,
                 wear_rr = CASE WHEN (p_v3_normalized->'vehicle'->'rearRight'->>'wearPercent') ~ '^[0-9]+([.][0-9]+)?$' THEN (p_v3_normalized->'vehicle'->'rearRight'->>'wearPercent')::numeric END
           WHERE race_run_id = r AND completed_laps = nl
             AND wear_fl IS NULL AND wear_fr IS NULL
             AND wear_rl IS NULL AND wear_rr IS NULL;
        END IF;

        -- ------------------------------------------------------------------
        -- S2: de pitvlag-overgang. Alles wat hier gebeurt, gebeurt alleen op
        -- deze flank en nergens anders:
        --   1. de pit_entry/pit_exit-events die er nooit waren. Zonder deze
        --      events blijft pit_loss voor elke toekomstige race null, ook al
        --      staat in_pit_lane straks op de lap-rijen: derive_pit_stops()
        --      rekent met captured_at-verschillen en een stop kan midden in
        --      een ronde beginnen en eindigen.
        --   2. het banden-anker op de EXIT-overgang. Op entry staan de
        --      wear-kanalen nog op de vorige service; pas na de service staan
        --      ze op de staat van de gemonteerde banden. Wie op entry ankert,
        --      schrijft een verouderd getal als meting weg.
        --
        -- Twee harde regels:
        --   * INSERT ... SELECT ... WHERE, nooit INSERT ... VALUES. Ontbreekt
        --     vehicle in de payload (uitgebreide telemetrie uit), dan levert de
        --     WHERE nul rijen en gebeurt er niets. Een VALUES met null in een
        --     not-null-kolom zou een exception geven en daarmee de HELE
        --     snapshot terugdraaien: de coureur verliest dan zijn ronde omdat
        --     wij een anker niet konden schrijven.
        --   * Het hele blok zit in BEGIN ... EXCEPTION WHEN OTHERS THEN NULL.
        --     Een anker is bijzaak, de lap-sample is hoofdzaak. Het stille
        --     falen is detecteerbaar: nul ankers bij wel toenemende
        --     lap-samples betekent dat dit pad stuk is.
        -- ------------------------------------------------------------------
        IF nl IS NOT NULL AND np IS NOT NULL AND np IS DISTINCT FROM s.previous_in_pit_lane THEN
          BEGIN
            IF np IS TRUE THEN
              INSERT INTO public.endurance_telemetry_events(
                device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,
                event_detection_source,completed_laps,in_pit_lane,lap,payload,race_run_id)
              SELECT d.id,e,t,p_session_id,'pit_entry','pit_entry:'||p_sequence::text,p_sequence,p_captured_at,
                     'simhub_v3_transition',nl,true,nl,
                     jsonb_build_object('completedLaps',nl,'inPitLane',true),r
               WHERE s.previous_in_pit_lane IS FALSE
              ON CONFLICT DO NOTHING;
            ELSE
              INSERT INTO public.endurance_telemetry_events(
                device_id,event_id,team_id,session_id,event_type,event_key,sequence,captured_at,
                event_detection_source,completed_laps,in_pit_lane,lap,payload,race_run_id)
              SELECT d.id,e,t,p_session_id,'pit_exit','pit_exit:'||p_sequence::text,p_sequence,p_captured_at,
                     'simhub_v3_transition',nl,false,nl,
                     jsonb_build_object('completedLaps',nl,'inPitLane',false),r
               WHERE s.previous_in_pit_lane IS TRUE
              ON CONFLICT DO NOTHING;

              -- Payloadvelden één keer inlezen, met dezelfde guard als de
              -- wear-update hierboven: alleen als het een getal is.
              v_anchor_fl := CASE WHEN (p_v3_normalized#>>'{vehicle,frontLeft,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,frontLeft,wearPercent}')::numeric END;
              v_anchor_fr := CASE WHEN (p_v3_normalized#>>'{vehicle,frontRight,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,frontRight,wearPercent}')::numeric END;
              v_anchor_rl := CASE WHEN (p_v3_normalized#>>'{vehicle,rearLeft,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,rearLeft,wearPercent}')::numeric END;
              v_anchor_rr := CASE WHEN (p_v3_normalized#>>'{vehicle,rearRight,wearPercent}') ~ '^[0-9]+([.][0-9]+)?$'
                                  THEN (p_v3_normalized#>>'{vehicle,rearRight,wearPercent}')::numeric END;
              v_zone_fl_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fl,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fl,l}')::numeric END;
              v_zone_fl_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fl,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fl,m}')::numeric END;
              v_zone_fl_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fl,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fl,r}')::numeric END;
              v_zone_fr_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fr,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fr,l}')::numeric END;
              v_zone_fr_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fr,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fr,m}')::numeric END;
              v_zone_fr_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,fr,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,fr,r}')::numeric END;
              v_zone_rl_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rl,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rl,l}')::numeric END;
              v_zone_rl_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rl,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rl,m}')::numeric END;
              v_zone_rl_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rl,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rl,r}')::numeric END;
              v_zone_rr_l := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rr,l}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rr,l}')::numeric END;
              v_zone_rr_m := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rr,m}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rr,m}')::numeric END;
              v_zone_rr_r := CASE WHEN (p_v3_normalized#>>'{tyres,wearPercent,rr,r}') ~ '^[0-9]+([.][0-9]+)?$'
                                    THEN (p_v3_normalized#>>'{tyres,wearPercent,rr,r}')::numeric END;
              v_anchor_track := CASE WHEN (p_v3_normalized#>>'{tyres,environment,trackTempC}') ~ '^-?[0-9]+([.][0-9]+)?$'
                                     THEN (p_v3_normalized#>>'{tyres,environment,trackTempC}')::numeric END;
              v_anchor_air   := CASE WHEN (p_v3_normalized#>>'{tyres,environment,airTempC}') ~ '^-?[0-9]+([.][0-9]+)?$'
                                     THEN (p_v3_normalized#>>'{tyres,environment,airTempC}')::numeric END;
              v_anchor_rubber := CASE WHEN char_length(btrim(coalesce(p_v3_normalized#>>'{tyres,environment,rubberState}',''))) BETWEEN 1 AND 64
                                      THEN btrim(p_v3_normalized#>>'{tyres,environment,rubberState}') END;
              v_anchor_source := p_v3_normalized#>>'{vehicle,tyreDataMode}';
              v_anchor_sets   := CASE WHEN (p_v3_normalized#>>'{tyres,sets,used}') ~ '^[0-9]+$'
                                      THEN (p_v3_normalized#>>'{tyres,sets,used}')::integer END;

              -- stint_no en tyre_set_no komen uit het vorige anker van DEZELFDE
              -- run, niet uit de lap-samples: de lap-sample heeft geen setbegrip
              -- en fuel_stint_id is aantoonbaar onbetrouwbaar (dezelfde id dekt
              -- 1 tot 36 rondes). Het vorige anker wordt ook meegenomen als het
              -- onbruikbaar is: zo blijft de nummering aaneengesloten en blijft
              -- 'frozen' (identiek aan de vorige momentopname) detecteerbaar.
              INSERT INTO public.endurance_tyre_anchors(
                event_id,team_id,race_run_id,device_id,session_id,stint_no,anchor_lap,
                tyre_set_no,tyre_changed,
                wear_fl,wear_fr,wear_rl,wear_rr,
                wear_fl_l, wear_fl_m, wear_fl_r, wear_fr_l, wear_fr_m, wear_fr_r, wear_rl_l, wear_rl_m, wear_rl_r, wear_rr_l, wear_rr_m, wear_rr_r,
                track_temp_c,air_temp_c,rubber_state,wear_source,wear_frozen,anchor_usable,captured_at)
              SELECT e,t,r,d.id,p_session_id,x.stint_no,nl,
                     x.tyre_set_no,x.tyre_changed,
                     v_anchor_fl,v_anchor_fr,v_anchor_rl,v_anchor_rr,
                     v_zone_fl_l, v_zone_fl_m, v_zone_fl_r, v_zone_fr_l, v_zone_fr_m, v_zone_fr_r, v_zone_rl_l, v_zone_rl_m, v_zone_rl_r, v_zone_rr_l, v_zone_rr_m, v_zone_rr_r,
                     v_anchor_track,v_anchor_air,v_anchor_rubber,
                     CASE WHEN v_anchor_source = 'live' THEN 'live' ELSE 'last_available' END,
                     x.frozen, NOT x.frozen, p_captured_at
                FROM (
                  SELECT coalesce(a.stint_no, 0) + 1 AS stint_no,
                         -- set_no volgt de sim-teller (TireSetsUsed, 0-based), dus 1-based.
                         CASE WHEN v_anchor_sets IS NULL THEN NULL ELSE v_anchor_sets + 1 END AS tyre_set_no,
                         -- null = onbekend (geen teller of geen vorig anker), niet false.
                         CASE WHEN v_anchor_sets IS NULL OR a.tyre_set_no IS NULL THEN NULL
                              ELSE (v_anchor_sets + 1) <> a.tyre_set_no END AS tyre_changed,
                         coalesce(a.wear_fl = v_anchor_fl AND a.wear_fr = v_anchor_fr
                                  AND a.wear_rl = v_anchor_rl AND a.wear_rr = v_anchor_rr, false) AS frozen
                    FROM (SELECT 1) AS dummy
                    LEFT JOIN LATERAL (
                      SELECT prev.stint_no, prev.tyre_set_no,
                             prev.wear_fl, prev.wear_fr, prev.wear_rl, prev.wear_rr
                        FROM public.endurance_tyre_anchors prev
                       WHERE prev.race_run_id = r
                       ORDER BY prev.stint_no DESC
                       LIMIT 1
                    ) AS a ON true
                ) AS x
               WHERE v_anchor_fl IS NOT NULL AND v_anchor_fr IS NOT NULL
                 AND v_anchor_rl IS NOT NULL AND v_anchor_rr IS NOT NULL
                 AND s.previous_in_pit_lane IS TRUE
              ON CONFLICT (race_run_id, stint_no) DO NOTHING;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            -- Een anker is bijzaak. Nooit de snapshot laten klappen.
            NULL;
          END;
        END IF;
    END IF;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 0.8.0 — meetgebeurtenissen en rondeaggregaten
  -- ---------------------------------------------------------------------------
  -- Waarom PAS hier: het frame is op dit punt volledig verwerkt en de snapshot
  -- staat er. Een fout in de meetbatch mag nooit de ronde, de brandstof of de
  -- positie kosten (brief, paragraaf 3: ongeldige optionele meetblokken
  -- afzonderlijk afwijzen). Daarom een eigen blok met een eigen
  -- exception-handler: die draait alleen de meetbatch terug, niet het frame.
  --
  -- Waarom niet eerder: de batches hebben `d` nodig (het apparaat) en de
  -- sessie-id; en een event dat bij een afgekeurd frame hoort, hoort er niet in.
  IF p_events IS NOT NULL OR p_laps IS NOT NULL THEN
    BEGIN
      SELECT * INTO v_agg_events, v_agg_laps, v_agg_rejected, v_agg_duplicates
        FROM public.simhub_persist_measurement_batch(d.id, p_session_id, p_events, p_laps);

      -- Een afgekeurde of dubbele rij is geen fout in het frame, maar mag ook
      -- niet stil verdwijnen. De Edge logt de waarschuwing mee met het device.
      IF v_agg_rejected > 0 OR v_agg_duplicates > 0 THEN
        RAISE WARNING 'simhub_persist_v3 meetbatch: % geschreven, % afgekeurd, % dubbel (device %, sessie %)',
          v_agg_events + v_agg_laps, v_agg_rejected, v_agg_duplicates, d.id, p_session_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Nooit doorslikken zonder spoor: dit is de enige plek waar een kapotte
      -- meetbatch zichtbaar wordt.
      RAISE WARNING 'simhub_persist_v3 meetbatch mislukt: % (device %, sessie %)',
        SQLERRM, d.id, p_session_id;
    END;
  END IF;

  RETURN QUERY SELECT 'accepted'::text, now_at;
END
$function$;

-- Rechten: alleen de service-role. De Edge gebruikt de service-role key; de
-- functie controleert dat zelf ook (auth.role() <> 'service_role').
revoke all on function public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text, jsonb, jsonb)
  to service_role;

comment on function public.simhub_persist_v3(
  text, text, bigint, timestamp with time zone, jsonb, text, jsonb, jsonb) is
  'Schrijft één V3-frame weg (snapshot, events, lap-samples) en sinds 0.8.0 ook de optionele meetgebeurtenissen (p_events) en rondeaggregaten (p_laps). Beide zijn standaard null en worden per rij gevalideerd; een fout in die batches kost nooit het frame. Aanroepen met 5 of 6 argumenten blijven ongewijzigd werken.';

-- Er mag precies één overload zijn. Twee overloads maken een aanroep met vijf
-- benoemde argumenten ambigu (42725) en dat faalt pas bij het eerste frame.
do $guard$
declare
  v_overloads integer;
  v_args text;
begin
  select count(*) into v_overloads
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';

  if v_overloads <> 1 then
    select string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
      into v_args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
    raise exception 'simhub_persist_v3 heeft % overloads (42725); gevonden: %', v_overloads, v_args
      using errcode = '42725';
  end if;

  -- En de nieuwe signatuur moet exact acht parameters hebben, waarvan de laatste
  -- twee een default. Zo kan een latere `create or replace` met een andere
  -- ariteit niet stil de verkeerde functie achterlaten.
  select pronargs::text into v_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  if v_args <> '8' then
    raise exception 'simhub_persist_v3 heeft % parameters in plaats van 8', v_args;
  end if;
end
$guard$;
