-- ============================================================================
-- Plugin 0.7.2.0 — structuur, signatuur en terugwaartse compatibiliteit
-- Datum: 2026-10-31
--
-- Draai na de fixture en alle migraties (zie run_plugin08_proposal.sh).
-- Dit bestand dekt wat er aan de buitenkant niet mag veranderen: de tabellen,
-- de RLS en rechten, de signatuur van simhub_persist_v3, de configuratie-RPC en
-- het non-fatale gedrag. De inhoudelijke contracten (identiteit, revisies, ACK,
-- wear_v1, dekking, casts, retentie) staan in plugin08_review_repairs.sql.
--
-- Alles draait in één transactie die aan het eind wordt teruggedraaid.
-- ============================================================================

begin;

set local request.jwt.claim.role = 'service_role';

create temp table t_resultaat (label text primary key, ok boolean not null);
create temp table t_ctx (device_id uuid, event_id uuid, team_id uuid);

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
returns jsonb language sql as $$
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
  )
$$;

create or replace function pg_temp.ouder_dan_een_minuut()
returns void language sql as $$
  update public.simhub_devices set last_seen_at = now() - interval '1 minute'
   where id = (select device_id from t_ctx);
$$;

create or replace function pg_temp.uid(p_n integer)
returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

create or replace function pg_temp.event(p_n integer)
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
    'evidence', jsonb_build_object('version', 1, 'source', 'tire_sets_used',
                                   'channels', jsonb_build_array('tire_sets_used')),
    'wearBefore', jsonb_build_object('version', 1, 'scale', 'remaining_percent',
                                     'fl', 12.5, 'fr', 12.5, 'rl', 12.5, 'rr', 12.5),
    'wearAfter', jsonb_build_object('version', 1, 'scale', 'remaining_percent',
                                    'fl', 0.2, 'fr', 0.2, 'rl', 0.2, 'rr', 0.2),
    'setGeneration', jsonb_build_object('version', 1, 'fl', 3, 'fr', 3, 'rl', 3, 'rr', 3))
$$;

create or replace function pg_temp.group_(p_samples integer, p_duration numeric, p_gap numeric)
returns jsonb language sql immutable as $$
  select jsonb_build_object('validDurationSeconds', p_duration,
                            'sampleCount', p_samples, 'maxGapSeconds', p_gap)
$$;

create or replace function pg_temp.lap(p_n integer)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'summaryUid', pg_temp.uid(1000 + p_n),
    'summaryId', 'lap-' || p_n,
    'segmentId', 'seg-1',
    'observedSessionId', 'sess-1',
    'lapNumber', p_n,
    'startedAt', '2026-10-31T11:58:00Z',
    'endedAt', '2026-10-31T12:00:00Z',
    'currentDriverName', 'Driver One',
    'aggregationVersion', 1,
    'complete', true,
    'invalidReasons', jsonb_build_array(),
    'pitLap', false,
    'driverChanged', false,
    'trackTempCMean', 32.5, 'trackTempCMin', 31, 'trackTempCMax', 34, 'airTempCMean', 21,
    'fuelStartLitres', 42, 'fuelEndLitres', 39.5,
    'fuelLevelIntegralLitreSeconds', 4875, 'fuelAddedLitresObserved', null,
    'absLatAccelIntegralGSeconds', 220, 'latAccelSquaredIntegralG2Seconds', 380,
    'maxAbsLatAccelG', 1.85, 'absLongAccelIntegralGSeconds', 60,
    'sampleCount', 7200,
    'pitVisitIds', jsonb_build_array('pit-1'),
    'wearObservationIds', jsonb_build_array('evt-1'),
    'coverage', jsonb_build_object(
      'temperature', pg_temp.group_(2400, 120.0, 0.1),
      'fuel', pg_temp.group_(2400, 120.0, 0.1),
      'load', pg_temp.group_(2400, 120.0, 0.1)))
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

  -- De identiteitskolommen uit het contract bestaan.
  perform pg_temp.expect(exists (select 1 from pg_attribute
                                  where attrelid = 'public.simhub_measurement_events'::regclass
                                    and attname = 'event_uid' and not attisdropped),
                         'T1 simhub_measurement_events heeft event_uid');
  perform pg_temp.expect(exists (select 1 from pg_attribute
                                  where attrelid = 'public.simhub_measurement_events'::regclass
                                    and attname = 'delivered_session_id' and not attisdropped),
                         'T1 simhub_measurement_events heeft delivered_session_id');
  perform pg_temp.expect(exists (select 1 from pg_attribute
                                  where attrelid = 'public.simhub_measurement_events'::regclass
                                    and attname = 'observed_session_id' and not attisdropped),
                         'T1 simhub_measurement_events heeft observed_session_id');
  perform pg_temp.expect(exists (select 1 from pg_attribute
                                  where attrelid = 'public.simhub_lap_summaries'::regclass
                                    and attname = 'coverage' and not attisdropped),
                         'T1 simhub_lap_summaries heeft coverage');

  perform pg_temp.expect(exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'simhub_measurement_events'
       and indexdef ilike '%(device_id, observed_at DESC)%'),
    'T1 index op (device_id, observed_at desc) bestaat');
  perform pg_temp.expect(exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'simhub_measurement_events'
       and indexdef ilike '%(received_at)%'),
    'T1 index op received_at bestaat (retentie)');

  perform pg_temp.expect(not has_function_privilege('anon',
    'public.simhub_persist_measurement_batch(uuid, text, jsonb, jsonb)', 'execute'),
    'T1 anon kan de meetbatch niet aanroepen');
  perform pg_temp.expect(has_function_privilege('anon',
    'public.simhub_connector_config_public()', 'execute'),
    'T1 anon mag de publieke config lezen');
  perform pg_temp.expect(not has_function_privilege('anon',
    'public.simhub_connector_config_apply(jsonb, integer)', 'execute'),
    'T1 anon mag de config niet schrijven');
  perform pg_temp.expect(not has_function_privilege('anon',
    'public.simhub_prune_measurements(timestamptz, timestamptz, boolean)', 'execute'),
    'T1 anon mag niet opruimen');
end
$$;

-- ============================================================================
-- T2. Signatuur van simhub_persist_v3 en terugwaartse compatibiliteit
-- ============================================================================
do $$
declare
  v_count integer;
  v_args text;
  v_ndefaults integer;
  v_result text;
  v_ack jsonb;
  v_ret text;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  perform pg_temp.eq(v_count, 1, 'T2 precies één overload van simhub_persist_v3');

  select pronargs::integer, pg_get_function_identity_arguments(p.oid), pronargdefaults::integer
    into v_count, v_args, v_ndefaults
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';

  perform pg_temp.eq(v_count, 8, 'T2 simhub_persist_v3 heeft 8 parameters');
  perform pg_temp.eq(v_args,
    'p_token_hash text, p_session_id text, p_sequence bigint, p_captured_at timestamp with time zone, '
    || 'p_v3_normalized jsonb, p_simhub_version text, p_events jsonb, p_laps jsonb',
    'T2 de argumentvolgorde is die van nu, met p_events en p_laps achteraan');
  perform pg_temp.eq(v_ndefaults, 3, 'T2 de laatste drie parameters hebben een default');

  -- De retourvorm is (result, received_at, measurement_ack). Een oude client
  -- leest de eerste twee kolommen en merkt niets van de derde.
  select pg_get_function_result(p.oid) into v_ret
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  perform pg_temp.expect(v_ret like '%measurement_ack jsonb%',
                         'T2 de retourvorm heeft measurement_ack als derde kolom');

  perform pg_temp.ouder_dan_een_minuut();
  select r.result into v_result
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 10, '2026-10-31T12:00:00Z'::timestamptz,
      pg_temp.frame(1, 10, false), null, null, null) r;
  perform pg_temp.eq(v_result, 'accepted', 'T2 aanroep met 8 argumenten werkt');

  perform pg_temp.ouder_dan_een_minuut();
  select r.result into v_result
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 20, '2026-10-31T12:01:00Z'::timestamptz,
      pg_temp.frame(2, 20, false), '0.7.1.2') r;
  perform pg_temp.eq(v_result, 'accepted', 'T2 aanroep met 6 argumenten werkt (pad van main)');

  perform pg_temp.ouder_dan_een_minuut();
  select r.result, r.measurement_ack into v_result, v_ack
    from public.simhub_persist_v3(
      p_token_hash => repeat('a', 64),
      p_session_id => 'sess-1',
      p_sequence => 40,
      p_captured_at => '2026-10-31T12:03:00Z'::timestamptz,
      p_v3_normalized => pg_temp.frame(4, 40, false)) r;
  perform pg_temp.eq(v_result, 'accepted', 'T2 benoemde aanroep met 5 argumenten werkt');
  perform pg_temp.expect(v_ack is null, 'T2 zonder meetreeksen is het meetrapport null');

  perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events), 0,
                     'T2 zonder p_events worden er geen meetgebeurtenissen geschreven');
  perform pg_temp.eq((select count(*)::integer from public.simhub_lap_summaries), 0,
                     'T2 zonder p_laps worden er geen rondeaggregaten geschreven');

  -- Een frame met meetserie: alles komt aan en het ACK noemt het.
  perform pg_temp.ouder_dan_een_minuut();
  select r.result, r.measurement_ack into v_result, v_ack
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 50, '2026-10-31T12:04:00Z'::timestamptz,
      pg_temp.frame(5, 50, false), '0.7.2.0',
      jsonb_build_array(pg_temp.event(1)), jsonb_build_array(pg_temp.lap(5))) r;
  perform pg_temp.eq(v_result, 'accepted', 'T2 aanroep met meetreeksen werkt');
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'T2 het meetrapport noemt de gebeurtenis');
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'T2 het meetrapport noemt de ronde');
end
$$;

-- ============================================================================
-- T3. Servergezag over apparaat en sessie; idempotentie
-- ============================================================================
do $$
declare
  v_ack jsonb;
  v_row public.simhub_measurement_events%rowtype;
begin
  v_ack := public.simhub_persist_measurement_batch(
    (select device_id from t_ctx), 'sess-1',
    jsonb_build_array(pg_temp.event(2) || jsonb_build_object(
      'deviceId', 'client-lie', 'transportSessionId', 'client-sessie')), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'T3 een rij met client-device/sessie wordt geaccepteerd');

  select * into v_row from public.simhub_measurement_events
   where event_uid = pg_temp.uid(2);
  perform pg_temp.eq(v_row.device_id, (select device_id::text from t_ctx),
                     'T3 device_id komt van de server, niet uit de payload');
  perform pg_temp.eq(v_row.delivered_session_id, 'sess-1',
                     'T3 de afleversessie komt van de server, niet uit de payload');
  perform pg_temp.eq(v_row.observed_at, '2026-10-31T12:00:00Z'::timestamptz,
                     'T3 observedAt is als timestamptz opgeslagen');
  perform pg_temp.eq(v_row.sdk_tick, 12345::bigint, 'T3 sdkTick is opgeslagen');
  perform pg_temp.eq(v_row.confidence, 0.9::double precision, 'T3 confidence is opgeslagen');
  perform pg_temp.eq(v_row.wear_after->>'fl', '0.2', 'T3 wearAfter is opgeslagen');
  perform pg_temp.eq(v_row.set_generation->>'fl', '3', 'T3 setGeneration is opgeslagen');
  perform pg_temp.eq(v_row.evidence->>'source', 'tire_sets_used', 'T3 evidence is opgeslagen');

  -- Replay van dezelfde rij: duplicaat, geen tweede rij.
  v_ack := public.simhub_persist_measurement_batch(
    (select device_id from t_ctx), 'sess-1',
    jsonb_build_array(pg_temp.event(2) || jsonb_build_object(
      'deviceId', 'client-lie', 'transportSessionId', 'client-sessie')), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,duplicates}'), 1,
                     'T3 een replay levert een duplicaat');
  perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events
                       where event_uid = pg_temp.uid(2)), 1,
                     'T3 een replay laat het aantal rijen gelijk');
end
$$;

-- ============================================================================
-- T4. Rondeaggregaat: mapping en dekking
-- ============================================================================
do $$
declare
  v_ack jsonb;
  v_row public.simhub_lap_summaries%rowtype;
begin
  v_ack := public.simhub_persist_measurement_batch(
    (select device_id from t_ctx), 'sess-1', null, jsonb_build_array(pg_temp.lap(17)));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'T4 een rondeaggregaat wordt geaccepteerd');

  select * into v_row from public.simhub_lap_summaries where summary_uid = pg_temp.uid(1017);
  perform pg_temp.eq(v_row.device_id, (select device_id::text from t_ctx),
                     'T4 device_id komt van de server');
  perform pg_temp.eq(v_row.lap_number, 17, 'T4 lapNumber is opgeslagen');
  perform pg_temp.eq(v_row.current_driver_name, 'Driver One',
                     'T4 currentDriverName is bewaard');
  perform pg_temp.eq(v_row.current_driver_id, null::uuid,
                     'T4 zonder naam-match blijft current_driver_id leeg');
  perform pg_temp.eq(v_row.track_temp_c_mean, 32.5::double precision, 'T4 trackTempCMean is opgeslagen');
  perform pg_temp.eq(v_row.fuel_level_integral_litre_seconds, 4875::double precision,
                     'T4 brandstofniveau-integraal is opgeslagen');
  perform pg_temp.eq(v_row.max_abs_lat_accel_g, 1.85::double precision, 'T4 maxAbsLatAccelG is opgeslagen');
  perform pg_temp.eq(v_row.sample_count, 7200::bigint, 'T4 sampleCount is als bigint opgeslagen');
  perform pg_temp.eq(v_row.pit_visit_ids, array['pit-1']::text[], 'T4 pitVisitIds is opgeslagen');
  perform pg_temp.eq(v_row.wear_observation_ids, array['evt-1']::text[],
                     'T4 wearObservationIds is opgeslagen');
  perform pg_temp.eq(v_row.invalid_reasons, '{}'::text[],
                     'T4 een lege invalidReasons wordt geen null maar een lege array');
  perform pg_temp.expect(v_row.fuel_added_litres_observed is null,
                         'T4 ontbrekende tankwaarneming blijft null (geen 0)');
  perform pg_temp.eq(v_row.complete, true, 'T4 complete is opgeslagen');
  perform pg_temp.eq(v_row.coverage->'load'->>'sampleCount', '2400',
                     'T4 de dekking per groep is opgeslagen');

  v_ack := public.simhub_persist_measurement_batch(
    (select device_id from t_ctx), 'sess-1', null, jsonb_build_array(pg_temp.lap(17)));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,duplicates}'), 1,
                     'T4 een replay levert een duplicaat');
end
$$;

-- ============================================================================
-- T5. Vorm- en lengtecontrole, en non-fataal gedrag
-- ============================================================================
do $$
declare
  v_ack jsonb;
  v_result text;
  v_veel jsonb;
  v_snapshots integer;
begin
  v_ack := public.simhub_persist_measurement_batch(
    (select device_id from t_ctx), 'sess-1', '{"not":"an array"}'::jsonb, '"nope"'::jsonb);
  perform pg_temp.eq(v_ack #>> '{events,block_error}', 'not_an_array',
                     'T5 een niet-array wordt als block_error gemeld');
  perform pg_temp.eq(v_ack #>> '{laps,block_error}', 'not_an_array',
                     'T5 een niet-array ronde wordt als block_error gemeld');

  select jsonb_agg(jsonb_build_object('eventUid', pg_temp.uid(5000 + g), 'kind', 'wear_value_changed'))
    into v_veel from generate_series(1, 201) g;
  v_ack := public.simhub_persist_measurement_batch(
    (select device_id from t_ctx), 'sess-1', v_veel, null);
  perform pg_temp.eq(v_ack #>> '{events,block_error}', 'too_many',
                     'T5 een te lange reeks wordt als too_many gemeld');
  perform pg_temp.expect(not exists (select 1 from public.simhub_measurement_events
                                      where event_uid = pg_temp.uid(5001)),
                         'T5 geen enkele rij uit de te lange reeks is geschreven');

  -- De harde eis: het frame overleeft een kapotte meetbatch.
  perform pg_temp.ouder_dan_een_minuut();
  select r.result into v_result
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 60, '2026-10-31T12:05:00Z'::timestamptz,
      pg_temp.frame(6, 60, false), '0.7.2.0',
      '{"not":"an array"}'::jsonb,
      jsonb_build_array(jsonb_build_object('summaryUid', pg_temp.uid(1099), 'lapNumber', 'zeventien'))) r;
  perform pg_temp.eq(v_result, 'accepted', 'T5 kapotte meetblokken kosten het frame niet');

  select count(*) into v_snapshots from public.simhub_telemetry_latest
   where device_id = (select device_id from t_ctx);
  perform pg_temp.eq(v_snapshots, 1, 'T5 de snapshot is ondanks de kapotte meetblokken geschreven');
  perform pg_temp.expect(not exists (select 1 from public.simhub_lap_summaries
                                      where summary_uid = pg_temp.uid(1099)),
                         'T5 het kapotte rondeaggregaat is niet geschreven');
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
  v_ack jsonb;
begin
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

  begin
    insert into public.simhub_connector_config (id) values (2);
    perform pg_temp.expect(false, 'T6 een tweede configuratieregel wordt geweigerd');
  exception when check_violation then
    perform pg_temp.expect(true, 'T6 een tweede configuratieregel wordt geweigerd');
  end;

  select to_jsonb(c) into v_before from public.simhub_connector_config c where id = 1;
  select * into v_result from public.simhub_connector_config_apply('{"bogus":1}'::jsonb);
  perform pg_temp.eq(v_result.result, 'unknown_fields', 'T6 een onbekende beleidssleutel wordt geweigerd');
  select to_jsonb(c) into v_after from public.simhub_connector_config c where id = 1;
  perform pg_temp.eq(v_after, v_before, 'T6 een geweigerde patch laat de configuratie ongemoeid');

  select * into v_result from public.simhub_connector_config_apply(
    '{"sendIntervalMs":500,"sampleHz":20,"features":{"lapSummaries":true,"verzonnenFeature":true}}'::jsonb);
  perform pg_temp.eq(v_result.result, 'applied', 'T6 een geldige patch wordt toegepast');
  perform pg_temp.eq(v_result.config_revision, 2, 'T6 de revision gaat met één omhoog');

  select * into v_row from public.simhub_connector_config_public();
  perform pg_temp.eq(v_row.send_interval_ms, 500, 'T6 sendIntervalMs is opgeslagen');
  perform pg_temp.eq(v_row.features, '{"lapSummaries":true}'::jsonb,
                     'T6 een onbekende feature wordt weggefilterd en dus nooit geactiveerd');

  -- Buiten bereik: expliciet, met reden, en er blijft niets half staan.
  select * into v_result from public.simhub_connector_config_apply('{"sendIntervalMs":250}'::jsonb);
  perform pg_temp.eq(v_result.result, 'out_of_range', 'T6 250 ms wordt geweigerd (ingestgrens)');
  perform pg_temp.eq((select send_interval_ms from public.simhub_connector_config where id = 1), 500,
                     'T6 een geweigerde frequentie laat de oude waarde staan');
  perform pg_temp.eq((select config_revision from public.simhub_connector_config where id = 1), 2,
                     'T6 een geweigerde patch verhoogt de revision niet');

  select * into v_result from public.simhub_connector_config_apply('{"sampleHz":25}'::jsonb, 2);
  perform pg_temp.eq(v_result.result, 'applied', 'T6 een patch met de juiste verwachte revision wordt toegepast');
  select * into v_result from public.simhub_connector_config_apply('{"sampleHz":30}'::jsonb, 2);
  perform pg_temp.eq(v_result.result, 'revision_conflict', 'T6 een verouderde revision geeft een conflict');
  perform pg_temp.eq((select sample_hz from public.simhub_connector_config where id = 1), 25,
                     'T6 het conflict laat de waarde staan');

  set local request.jwt.claim.role = 'anon';
  select * into v_result from public.simhub_connector_config_apply('{"sampleHz":40}'::jsonb);
  perform pg_temp.eq(v_result.result, 'unauthorized', 'T6 als anon weigert de schrijver');
  perform pg_temp.eq((select count(*)::integer from public.simhub_connector_config_readonly), 1,
                     'T6 de read-only view is leesbaar voor anon');

  v_ack := public.simhub_persist_measurement_batch(
    (select device_id from t_ctx), 'sess-1', jsonb_build_array(pg_temp.event(77)), null);
  perform pg_temp.eq(v_ack #>> '{error}', 'unauthorized',
                     'T6 als anon schrijft de meetbatch niets');
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
