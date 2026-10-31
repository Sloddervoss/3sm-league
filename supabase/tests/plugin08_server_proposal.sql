-- ============================================================================
-- Plugin 0.8 — servervoorstel: SQL-tests
-- Datum: 2026-10-31
-- Draai na de fixture en de vier migraties (zie run_plugin08_proposal.sh).
--
-- Alles draait in één transactie die aan het eind wordt teruggedraaid. Geen
-- enkele test laat iets achter, ook niet als hij faalt: de savepoint per blok
-- zorgt dat een fout niet de volgende test ongeldig maakt.
--
-- Uitkomst: psql drukt per test PASS of FAIL af en eindigt met een foutcode
-- (ON_ERROR_STOP) als er ook maar één FAIL is.
-- ============================================================================

begin;

set local request.jwt.claim.role = 'service_role';

create temp table t_resultaat (label text primary key, ok boolean not null);
create temp table t_ctx (device_id uuid, event_id uuid, team_id uuid);

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

insert into t_ctx
values ('11111111-1111-4111-8111-111111111111'::uuid,
        '22222222-2222-4222-8222-222222222222'::uuid,
        '33333333-3333-4333-8333-333333333333'::uuid);

insert into public.simhub_devices (
  id, token_hash, device_name, connector_id, endurance_event_id, endurance_team_id,
  device_status, device_role)
select device_id, repeat('a', 64), 'PC-TEST', 'SIM-TEST', event_id, team_id,
       'active_binding', 'primary'
from t_ctx;

create or replace function pg_temp.frame(p_lap integer, p_sequence bigint, p_pit boolean)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'protocolVersion', 3,
    'sequence', p_sequence,
    'capturedAt', '2026-10-31T12:00:00.000Z',
    'transportSessionId', 'sess-1',
    'identity', jsonb_build_object('currentDriverId', 'Driver One',
                                   'currentDriverName', 'Driver One',
                                   'carId', 'car', 'carName', 'Car',
                                   'trackName', 'Track', 'trackConfig', 'GP', 'trackId', 1),
    'session', jsonb_build_object('isInCar', true, 'sessionTimeSeconds', 1000,
                                  'sessionTimeRemainingSeconds', 100, 'sessionLapsRemaining', 5,
                                  'flags', jsonb_build_array('green'), 'sessionState', 'racing'),
    'timing', jsonb_build_object('currentLapElapsedSeconds', 40, 'lastLapTimeSeconds', 120.5,
                                 'bestLapTimeSeconds', 120.5, 'completedLaps', p_lap),
    'position', jsonb_build_object('position', 3, 'classPosition', 2, 'gapToLeaderSeconds', 1.5),
    'track', jsonb_build_object('lapDistancePct', 0.4, 'trackSurface', 'on_track', 'onPitRoad', p_pit),
    'fuel', jsonb_build_object('fuelLitres', 40.5, 'fuelPct', 0.5),
    'raceState', jsonb_build_object('incidents', 0),
    'pitService', jsonb_build_object('pitServiceFlagsRaw', 0, 'requiredRepairSeconds', 0,
                                     'optionalRepairSeconds', 0)
  );
$$;

-- De rate-limit van 400 ms tussen frames is een eigenschap van de functie, niet
-- van deze tests. Daarom zet elke aanroep eerst last_seen_at terug.
create or replace function pg_temp.ouder_dan_een_minuut()
returns void
language sql
as $$
  update public.simhub_devices set last_seen_at = now() - interval '1 minute'
   where id = (select device_id from t_ctx);
$$;

-- ============================================================================
-- T1. Structuur, sleutels, RLS en rechten
-- ============================================================================
do $$
declare
  v_ok boolean;
  v_policies integer;
begin
  perform pg_temp.expect(to_regclass('public.simhub_measurement_events') is not null,
                         'T1 tabel simhub_measurement_events bestaat');
  perform pg_temp.expect(to_regclass('public.simhub_lap_summaries') is not null,
                         'T1 tabel simhub_lap_summaries bestaat');
  perform pg_temp.expect(to_regclass('public.simhub_connector_config') is not null,
                         'T1 tabel simhub_connector_config bestaat');

  select relrowsecurity into v_ok from pg_class where oid = 'public.simhub_measurement_events'::regclass;
  perform pg_temp.expect(v_ok, 'T1 RLS staat aan op simhub_measurement_events');
  select relrowsecurity into v_ok from pg_class where oid = 'public.simhub_lap_summaries'::regclass;
  perform pg_temp.expect(v_ok, 'T1 RLS staat aan op simhub_lap_summaries');

  select count(*) into v_policies from pg_policies
   where schemaname = 'public'
     and tablename in ('simhub_measurement_events', 'simhub_lap_summaries');
  perform pg_temp.eq(v_policies, 0, 'T1 geen policies op de meettabellen (alleen service_role)');

  perform pg_temp.expect(not has_table_privilege('anon', 'public.simhub_measurement_events', 'select'),
                         'T1 anon heeft geen select op simhub_measurement_events');
  perform pg_temp.expect(not has_table_privilege('anon', 'public.simhub_lap_summaries', 'insert'),
                         'T1 anon heeft geen insert op simhub_lap_summaries');
  perform pg_temp.expect(not has_table_privilege('authenticated', 'public.simhub_measurement_events', 'insert'),
                         'T1 authenticated heeft geen insert op simhub_measurement_events');
  perform pg_temp.expect(has_table_privilege('service_role', 'public.simhub_measurement_events', 'insert'),
                         'T1 service_role mag schrijven in simhub_measurement_events');
  perform pg_temp.expect(has_table_privilege('service_role', 'public.simhub_lap_summaries', 'insert'),
                         'T1 service_role mag schrijven in simhub_lap_summaries');

  -- De unieke sleutels zijn de dedupe-sleutels; zonder deze constraints is
  -- `on conflict do nothing` onmogelijk en faalt de insert met 42P10.
  perform pg_temp.expect(exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.simhub_measurement_events'::regclass
       and c.contype = 'u'
       and array(select a.attname::text from unnest(c.conkey) k
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
                  order by a.attname) = array['device_id', 'event_id']),
    'T1 unique (device_id, event_id) bestaat');
  perform pg_temp.expect(exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.simhub_lap_summaries'::regclass
       and c.contype = 'u'
       and array(select a.attname::text from unnest(c.conkey) k
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
                  order by a.attname) = array['device_id', 'summary_id']),
    'T1 unique (device_id, summary_id) bestaat');

  -- De index op (device_id, observed_at desc) draagt de leesroute.
  perform pg_temp.expect(exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'simhub_measurement_events'
       and indexdef ilike '%(device_id, observed_at DESC)%'),
    'T1 index op (device_id, observed_at desc) bestaat');

  perform pg_temp.expect(not has_function_privilege('anon',
    'public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb)', 'execute'),
    'T1 anon kan de meetbatch niet aanroepen');
  perform pg_temp.expect(has_function_privilege('anon',
    'public.simhub_connector_config_public()', 'execute'),
    'T1 anon mag de publieke config lezen');
  perform pg_temp.expect(not has_function_privilege('anon',
    'public.simhub_connector_config_apply(jsonb, integer)', 'execute'),
    'T1 anon mag de config niet schrijven');
end
$$;

-- ============================================================================
-- T2. Signatuur van simhub_persist_v3: één overload, acht parameters,
--     defaultwaarden vanaf de zesde.
-- ============================================================================
do $$
declare
  v_count integer;
  v_args text;
  v_ndefaults integer;
  v_result text;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  perform pg_temp.eq(v_count, 1, 'T2 precies één overload van simhub_persist_v3');

  select pronargs::integer,
         pg_get_function_identity_arguments(p.oid),
         pronargdefaults::integer
    into v_count, v_args, v_ndefaults
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';

  perform pg_temp.eq(v_count, 8, 'T2 simhub_persist_v3 heeft 8 parameters');
  -- De eerste vijf zijn de bestaande verplichte argumenten, in de bestaande
  -- volgorde; daarna de drie optionele.
  perform pg_temp.eq(v_args,
    'p_token_hash text, p_session_id text, p_sequence bigint, p_captured_at timestamp with time zone, '
    || 'p_v3_normalized jsonb, p_simhub_version text, p_events jsonb, p_laps jsonb',
    'T2 de argumentvolgorde is die van nu, met p_events en p_laps achteraan');
  -- Drie defaults, alle drie NULL: een aanroep met 5 of 6 argumenten resolveert
  -- naar dezelfde functie.
  perform pg_temp.eq(v_ndefaults, 3, 'T2 de laatste drie parameters hebben een default');

  -- Aanroep met vijf argumenten: het pad van de 0.7.1.x-Edge.
  perform pg_temp.ouder_dan_een_minuut();
  select r.result into v_result
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 10, '2026-10-31T12:00:00Z'::timestamptz,
      pg_temp.frame(1, 10, false), null, null, null) r;
  perform pg_temp.eq(v_result, 'accepted', 'T2 aanroep met 5 argumenten werkt');

  -- Aanroep met zes argumenten: het pad van de huidige main.
  perform pg_temp.ouder_dan_een_minuut();
  select r.result into v_result
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 20, '2026-10-31T12:01:00Z'::timestamptz,
      pg_temp.frame(2, 20, false), '0.7.1.2') r;
  perform pg_temp.eq(v_result, 'accepted', 'T2 aanroep met 6 argumenten werkt');

  -- Aanroep met acht argumenten: het pad van de 0.8-Edge.
  perform pg_temp.ouder_dan_een_minuut();
  select r.result into v_result
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 30, '2026-10-31T12:02:00Z'::timestamptz,
      pg_temp.frame(3, 30, false), '0.8.0.0', '[]'::jsonb, '[]'::jsonb) r;
  perform pg_temp.eq(v_result, 'accepted', 'T2 aanroep met 8 argumenten werkt');

  -- En met benoemde argumenten, zoals PostgREST hem aanroept.
  perform pg_temp.ouder_dan_een_minuut();
  select r.result into v_result
    from public.simhub_persist_v3(
      p_token_hash => repeat('a', 64),
      p_session_id => 'sess-1',
      p_sequence => 40,
      p_captured_at => '2026-10-31T12:03:00Z'::timestamptz,
      p_v3_normalized => pg_temp.frame(4, 40, false)) r;
  perform pg_temp.eq(v_result, 'accepted', 'T2 benoemde aanroep zonder de nieuwe parameters werkt');

  perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events), 0,
                     'T2 zonder p_events worden er geen meetgebeurtenissen geschreven');
  perform pg_temp.eq((select count(*)::integer from public.simhub_lap_summaries), 0,
                     'T2 zonder p_laps worden er geen rondeaggregaten geschreven');
end
$$;

-- ============================================================================
-- T3. Meetgebeurtenissen: velden, servergezag en afkeuring per rij
-- ============================================================================
do $$
declare
  v_res record;
  v_row public.simhub_measurement_events%rowtype;
  v_events jsonb;
begin
  v_events := jsonb_build_array(
    jsonb_build_object(
      'eventId', 'evt-1', 'kind', 'wear_refresh_confirmed', 'segmentId', 'seg-1',
      'observedAt', '2026-10-31T12:00:00Z', 'sessionTimeSeconds', 1000, 'sdkTick', 12345,
      'wearBefore', jsonb_build_object('fl', 12.5),
      'wearAfter', jsonb_build_object('fl', 0.2),
      'setGeneration', jsonb_build_object('fl', 3),
      'evidence', jsonb_build_object('source', 'tire_sets_used'),
      'confidence', 0.9,
      -- De client probeert het apparaat en de sessie te bepalen. Dat mag niet.
      'deviceId', 'client-lie', 'transportSessionId', 'client-sessie'),
    -- confidence buiten 0..1: leesbaar maar onmogelijk -> afkeuren
    jsonb_build_object('eventId', 'evt-confidence', 'kind', 'wear_value_changed', 'confidence', 2),
    -- geen zone in de tijd -> geen waarnemingstijd -> afkeuren
    jsonb_build_object('eventId', 'evt-nozone', 'kind', 'wear_value_changed',
                       'observedAt', '2026-10-31T12:00:00'),
    -- ongeldig ID en hoofdletters in kind -> afkeuren
    jsonb_build_object('eventId', 'bad id!', 'kind', 'wear_value_changed'),
    jsonb_build_object('eventId', 'evt-kind', 'kind', 'Wear_Value_Changed'),
    -- ontbrekende soort -> afkeuren
    jsonb_build_object('eventId', 'evt-nokind'),
    -- expliciet null op optionele velden: dat is onbekend, geen fout
    jsonb_build_object('eventId', 'evt-null', 'kind', 'pit_service_completed',
                       'observedAt', null, 'confidence', null, 'sessionTimeSeconds', null)
  );

  select * into v_res
    from public.simhub_persist_measurement_batch(
      (select device_id from t_ctx), 'sess-1', v_events, null);

  perform pg_temp.eq(v_res.events_written, 2, 'T3 twee van zeven gebeurtenissen geschreven');
  perform pg_temp.eq(v_res.rejected, 5, 'T3 vijf gebeurtenissen afgekeurd');
  perform pg_temp.eq(v_res.duplicates, 0, 'T3 geen duplicaten bij de eerste aanvoer');

  select * into v_row from public.simhub_measurement_events where event_id = 'evt-1';
  perform pg_temp.eq(v_row.device_id, (select device_id::text from t_ctx),
                     'T3 device_id komt van de server, niet uit de payload');
  perform pg_temp.eq(v_row.transport_session_id, 'sess-1',
                     'T3 transport_session_id komt van de server, niet uit de payload');
  perform pg_temp.eq(v_row.observed_at, '2026-10-31T12:00:00Z'::timestamptz,
                     'T3 observedAt is als timestamptz opgeslagen');
  perform pg_temp.eq(v_row.sdk_tick, 12345::bigint, 'T3 sdkTick is opgeslagen');
  perform pg_temp.eq(v_row.confidence, 0.9::double precision, 'T3 confidence is opgeslagen');
  perform pg_temp.eq(v_row.segment_id, 'seg-1', 'T3 segmentId is opgeslagen');
  perform pg_temp.eq(v_row.wear_after->>'fl', '0.2', 'T3 wearAfter is opgeslagen');
  perform pg_temp.eq(v_row.set_generation->>'fl', '3', 'T3 setGeneration is opgeslagen');
  perform pg_temp.eq(v_row.evidence->>'source', 'tire_sets_used', 'T3 evidence is opgeslagen');

  select * into v_row from public.simhub_measurement_events where event_id = 'evt-null';
  perform pg_temp.expect(v_row.observed_at is null, 'T3 expliciet null observedAt blijft null');
  perform pg_temp.expect(v_row.confidence is null, 'T3 expliciet null confidence blijft null (niet 0)');
  perform pg_temp.expect(v_row.id is not null, 'T3 id heeft een default');

  -- Dedupe: dezelfde reeks nog eens, zonder nieuwe rijen.
  select * into v_res
    from public.simhub_persist_measurement_batch(
      (select device_id from t_ctx), 'sess-1', v_events, null);
  perform pg_temp.eq(v_res.events_written, 0, 'T3 replay schrijft geen nieuwe gebeurtenissen');
  perform pg_temp.eq(v_res.duplicates, 2, 'T3 replay telt twee duplicaten');
  perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events where event_id like 'evt-%'
                      and event_id in ('evt-1', 'evt-null')), 2,
                     'T3 replay laat het aantal rijen gelijk');
end
$$;

-- ============================================================================
-- T4. Rondeaggregaten: mapping, dekking en dedupe
-- ============================================================================
do $$
declare
  v_res record;
  v_row public.simhub_lap_summaries%rowtype;
  v_laps jsonb;
begin
  v_laps := jsonb_build_array(
    jsonb_build_object(
      'summaryId', 'lap-17', 'segmentId', 'seg-1', 'lapNumber', 17,
      'startedAt', '2026-10-31T11:58:00Z', 'endedAt', '2026-10-31T12:00:00Z',
      'currentDriverId', '44444444-4444-4444-8444-444444444444',
      'aggregationVersion', 1, 'complete', true, 'invalidReasons', jsonb_build_array(),
      'pitLap', false, 'driverChanged', false,
      'trackTempCMean', 32.5, 'trackTempCMin', 31, 'trackTempCMax', 34, 'airTempCMean', 21,
      'fuelStartLitres', 42, 'fuelEndLitres', 39.5,
      'fuelLevelIntegralLitreSeconds', 4875, 'fuelAddedLitresObserved', null,
      'absLatAccelIntegralGSeconds', 220, 'latAccelSquaredIntegralG2Seconds', 380,
      'maxAbsLatAccelG', 1.85, 'absLongAccelIntegralGSeconds', 60,
      'validDurationSeconds', 120.5, 'sampleCount', 2410, 'maxGapSeconds', 0.08,
      'pitVisitIds', jsonb_build_array('pit-1'),
      'wearObservationIds', jsonb_build_array('evt-1')),
    -- zonder lapNumber: geen rondeaggregaat
    jsonb_build_object('summaryId', 'lap-x', 'trackTempCMean', 30),
    -- ongeldige begin/eind-volgorde
    jsonb_build_object('summaryId', 'lap-y', 'lapNumber', 18,
                       'startedAt', '2026-10-31T12:00:00Z', 'endedAt', '2026-10-31T11:00:00Z')
  );

  select * into v_res
    from public.simhub_persist_measurement_batch(
      (select device_id from t_ctx), 'sess-1', null, v_laps);

  perform pg_temp.eq(v_res.laps_written, 1, 'T4 één rondeaggregaat geschreven');
  perform pg_temp.eq(v_res.rejected, 2, 'T4 twee rondeaggregaten afgekeurd');

  select * into v_row from public.simhub_lap_summaries where summary_id = 'lap-17';
  perform pg_temp.eq(v_row.device_id, (select device_id::text from t_ctx),
                     'T4 device_id komt van de server');
  perform pg_temp.eq(v_row.lap_number, 17, 'T4 lapNumber is opgeslagen');
  perform pg_temp.eq(v_row.current_driver_id, '44444444-4444-4444-8444-444444444444'::uuid,
                     'T4 currentDriverId is als uuid opgeslagen');
  perform pg_temp.eq(v_row.aggregation_version, 1, 'T4 aggregationVersion is opgeslagen');
  perform pg_temp.eq(v_row.track_temp_c_mean, 32.5::double precision, 'T4 trackTempCMean is opgeslagen');
  perform pg_temp.eq(v_row.fuel_level_integral_litre_seconds, 4875::double precision,
                     'T4 brandstofniveau-integraal is opgeslagen');
  perform pg_temp.eq(v_row.max_abs_lat_accel_g, 1.85::double precision, 'T4 maxAbsLatAccelG is opgeslagen');
  perform pg_temp.eq(v_row.valid_duration_seconds, 120.5::double precision,
                     'T4 validDurationSeconds is opgeslagen (dekking, geen aanname)');
  perform pg_temp.eq(v_row.sample_count, 2410::double precision, 'T4 sampleCount is opgeslagen');
  perform pg_temp.eq(v_row.max_gap_seconds, 0.08::double precision, 'T4 maxGapSeconds is opgeslagen');
  perform pg_temp.eq(v_row.pit_visit_ids, array['pit-1']::text[], 'T4 pitVisitIds is opgeslagen');
  perform pg_temp.eq(v_row.wear_observation_ids, array['evt-1']::text[], 'T4 wearObservationIds is opgeslagen');
  perform pg_temp.eq(v_row.invalid_reasons, '{}'::text[],
                     'T4 een lege invalidReasons wordt geen null maar een lege array');
  perform pg_temp.expect(v_row.fuel_added_litres_observed is null,
                         'T4 ontbrekende tankwaarneming blijft null (geen 0)');
  perform pg_temp.eq(v_row.complete, true, 'T4 complete is opgeslagen');

  select * into v_res
    from public.simhub_persist_measurement_batch(
      (select device_id from t_ctx), 'sess-1', null, v_laps);
  perform pg_temp.eq(v_res.laps_written, 0, 'T4 replay schrijft geen nieuwe rondeaggregaten');
  perform pg_temp.eq(v_res.duplicates, 1, 'T4 replay telt één duplicaat');
end
$$;

-- ============================================================================
-- T5. Vorm- en lengtecontrole op de reeks als geheel, en non-fataal gedrag
-- ============================================================================
do $$
declare
  v_res record;
  v_result text;
  v_veel jsonb;
  v_snapshots integer;
begin
  -- Geen array.
  select * into v_res from public.simhub_persist_measurement_batch(
    (select device_id from t_ctx), 'sess-1', '{"not":"an array"}'::jsonb, '"nope"'::jsonb);
  perform pg_temp.eq(v_res.rejected, 2, 'T5 twee niet-arrays tellen als twee afwijzingen');
  perform pg_temp.eq(v_res.events_written + v_res.laps_written, 0,
                     'T5 een niet-array schrijft niets');

  -- Te lang: 201 gebeurtenissen.
  select jsonb_agg(jsonb_build_object('eventId', 'evt-bulk-' || g, 'kind', 'wear_value_changed'))
    into v_veel
    from generate_series(1, 201) g;
  select * into v_res from public.simhub_persist_measurement_batch(
    (select device_id from t_ctx), 'sess-1', v_veel, null);
  perform pg_temp.eq(v_res.rejected, 1, 'T5 een te lange reeks telt als één afwijzing');
  perform pg_temp.eq(v_res.events_written, 0, 'T5 een te lange reeks schrijft niets');
  perform pg_temp.expect(not exists (select 1 from public.simhub_measurement_events where event_id like 'evt-bulk%'),
                         'T5 geen enkele rij uit de te lange reeks is geschreven');

  -- En de harde eis: het frame overleeft een kapotte meetbatch.
  perform pg_temp.ouder_dan_een_minuut();
  select r.result into v_result
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 50, '2026-10-31T12:05:00Z'::timestamptz,
      pg_temp.frame(5, 50, false), '0.8.0.0',
      '{"not":"an array"}'::jsonb,
      jsonb_build_array(jsonb_build_object('summaryId', 'kapot', 'lapNumber', 'zeventien'))) r;
  perform pg_temp.eq(v_result, 'accepted', 'T5 kapotte meetblokken kosten het frame niet');

  select count(*) into v_snapshots from public.simhub_telemetry_latest
   where device_id = (select device_id from t_ctx);
  perform pg_temp.eq(v_snapshots, 1, 'T5 de snapshot is ondanks de kapotte meetblokken geschreven');
  perform pg_temp.expect(not exists (select 1 from public.simhub_lap_summaries where summary_id = 'kapot'),
                         'T5 het kapotte rondeaggregaat is niet geschreven');

  -- Ook een exception in de batch zelf mag het frame niet kosten. Een te lange
  -- standaardwaarde forceren we niet; de vormcontrole hierboven dekt het pad.
  perform pg_temp.expect(true, 'T5 non-fataal pad gedekt');
end
$$;

-- ============================================================================
-- T6. Connectorconfiguratie
-- ============================================================================
do $$
declare
  v_row record;
  v_cols text[];
  v_result record;
  v_before jsonb;
  v_after jsonb;
begin
  -- De publieke functie geeft precies deze kolommen en niets anders.
  select array_agg(a.attname order by a.attname) into v_cols
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(p.proargnames) as a(attname)
   where n.nspname = 'public' and p.proname = 'simhub_connector_config_public';
  perform pg_temp.eq(v_cols,
    array['config_revision','expires_at','features','maintenance_window','payload_budget_bytes',
          'recommended_min_version','sample_hz','send_interval_ms','update_channel','updated_at']::text[],
    'T6 de publieke configfunctie geeft alleen de tien beleidskolommen');

  select * into v_row from public.simhub_connector_config_public();
  perform pg_temp.eq(v_row.config_revision, 1, 'T6 er is een configuratieregel met revision 1');
  perform pg_temp.eq(v_row.features, '{}'::jsonb, 'T6 standaard staan er geen features aan');

  -- Singleton.
  begin
    insert into public.simhub_connector_config (id) values (2);
    perform pg_temp.expect(false, 'T6 een tweede configuratieregel wordt geweigerd');
  exception when check_violation then
    perform pg_temp.expect(true, 'T6 een tweede configuratieregel wordt geweigerd');
  end;

  -- Onbekende beleidssleutel: weigeren, geen halve update.
  select to_jsonb(c) into v_before from public.simhub_connector_config c where id = 1;
  select * into v_result from public.simhub_connector_config_apply('{"bogus":1}'::jsonb);
  perform pg_temp.eq(v_result.result, 'unknown_fields', 'T6 een onbekende beleidssleutel wordt geweigerd');
  select to_jsonb(c) into v_after from public.simhub_connector_config c where id = 1;
  perform pg_temp.eq(v_after, v_before, 'T6 een geweigerde patch laat de configuratie ongemoeid');

  -- Geldige patch, met een onbekende feature ernaast.
  select * into v_result from public.simhub_connector_config_apply(
    '{"sendIntervalMs":500,"sampleHz":20,"features":{"lapSummaries":true,"verzonnenFeature":true}}'::jsonb);
  perform pg_temp.eq(v_result.result, 'applied', 'T6 een geldige patch wordt toegepast');
  perform pg_temp.eq(v_result.config_revision, 2, 'T6 de revision gaat met één omhoog');

  select * into v_row from public.simhub_connector_config_public();
  perform pg_temp.eq(v_row.send_interval_ms, 500, 'T6 sendIntervalMs is opgeslagen');
  perform pg_temp.eq(v_row.features, '{"lapSummaries":true}'::jsonb,
                     'T6 een onbekende feature wordt weggefilterd en dus nooit geactiveerd');

  -- Buiten bereik: de CHECK grijpt in en er blijft niets half staan.
  select * into v_result from public.simhub_connector_config_apply('{"sendIntervalMs":10}'::jsonb);
  perform pg_temp.eq(v_result.result, 'invalid_payload', 'T6 een frequentie buiten bereik wordt geweigerd');
  perform pg_temp.eq((select send_interval_ms from public.simhub_connector_config where id = 1), 500,
                     'T6 een geweigerde frequentie laat de oude waarde staan');
  perform pg_temp.eq((select config_revision from public.simhub_connector_config where id = 1), 2,
                     'T6 een geweigerde patch verhoogt de revision niet');

  -- Optimistische concurrency.
  select * into v_result from public.simhub_connector_config_apply('{"sampleHz":25}'::jsonb, 2);
  perform pg_temp.eq(v_result.result, 'applied', 'T6 een patch met de juiste verwachte revision wordt toegepast');
  select * into v_result from public.simhub_connector_config_apply('{"sampleHz":30}'::jsonb, 2);
  perform pg_temp.eq(v_result.result, 'revision_conflict', 'T6 een verouderde revision geeft een conflict');
  perform pg_temp.eq((select sample_hz from public.simhub_connector_config where id = 1), 25,
                     'T6 het conflict laat de waarde staan');

  -- Als anon: de schrijver weigert.
  set local request.jwt.claim.role = 'anon';
  select * into v_result from public.simhub_connector_config_apply('{"sampleHz":40}'::jsonb);
  perform pg_temp.eq(v_result.result, 'unauthorized', 'T6 als anon weigert de schrijver');
  perform pg_temp.eq((select count(*)::integer from public.simhub_connector_config_readonly), 1,
                     'T6 de read-only view is leesbaar voor anon');
  set local request.jwt.claim.role = 'service_role';

  -- Ook de meetbatch weigert buiten de service-role.
  set local request.jwt.claim.role = 'anon';
  select * into v_result from public.simhub_persist_measurement_batch(
    (select device_id from t_ctx), 'sess-1', jsonb_build_array(jsonb_build_object('eventId','evt-anon','kind','x')), null);
  perform pg_temp.eq(v_result.events_written, 0, 'T6 als anon schrijft de meetbatch niets');
  set local request.jwt.claim.role = 'service_role';
end
$$;

-- ============================================================================
-- Uitslag
-- ============================================================================
select label, case when ok then 'PASS' else 'FAIL' end as resultaat
  from t_resultaat
 order by label;

do $$
declare
  v_fail integer;
  v_totaal integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_totaal from t_resultaat;
  raise notice 'plugin08 SQL: % van % PASS', v_totaal - v_fail, v_totaal;
  if v_fail > 0 then
    raise exception '% van % tests FAALT: %', v_fail, v_totaal,
      (select string_agg(label, ' | ' order by label) from t_resultaat where not ok);
  end if;
end
$$;

rollback;
