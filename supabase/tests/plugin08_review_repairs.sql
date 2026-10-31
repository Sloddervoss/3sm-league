-- ============================================================================
-- Plugin 0.7.2.0 — bewijs voor de reparaties uit de DDL-review van 6.1 sol
-- Datum: 2026-10-31
--
-- Draai na de fixture en alle migraties (zie run_plugin08_proposal.sh). Alles
-- draait in één transactie die aan het eind wordt teruggedraaid.
--
-- Elke sectie noemt het reviewpunt. De probes die de reviewer met de hand deed
-- ("banana", complete zonder dekking, 1.0 als integer, NaN/Infinity, dubbele
-- revisie, reconnect) staan er letterlijk in.
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

-- Vaste UUID's, zodat de tests leesbaar blijven.
create temp table t_ids as
select '11111111-1111-4111-8111-111111111111'::uuid as device,
       '22222222-2222-4222-8222-222222222222'::uuid as event,
       '33333333-3333-4333-8333-333333333333'::uuid as team;

create or replace function pg_temp.uid(p_n integer)
returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

insert into public.simhub_devices (
  id, token_hash, device_name, connector_id, endurance_event_id, endurance_team_id,
  device_status, device_role)
select device, repeat('a', 64), 'PC-TEST', 'SIM-TEST', event, team,
       'active_binding', 'primary'
from t_ids;

create or replace function pg_temp.rate_ok()
returns void language sql as $$
  update public.simhub_devices set last_seen_at = now() - interval '1 minute';
$$;

-- ---------------------------------------------------------------------------
-- Kant-en-klare objecten die aan het contract voldoen
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

create or replace function pg_temp.setgen()
returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 1, 'fl', 3, 'fr', 3, 'rl', 3, 'rr', 3)
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
           'kind', 'wear_refresh_confirmed',
           'segmentId', 'seg-1',
           'observedSessionId', 'sess-1',
           'observedAt', '2026-10-31T12:00:00Z',
           'sessionTimeSeconds', 1000,
           'sdkTick', 12345,
           'confidence', 0.9,
           'evidence', pg_temp.evidence(),
           'wearBefore', pg_temp.wear(12.5),
           'wearAfter', pg_temp.wear(0.2),
           'setGeneration', pg_temp.setgen()
         ) || p_extra
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
           'currentDriverName', 'Repair Driver',
           'aggregationVersion', 1,
           'complete', true,
           'invalidReasons', jsonb_build_array(),
           'pitLap', false,
           'driverChanged', false,
           'trackTempCMean', 32.5, 'trackTempCMin', 31, 'trackTempCMax', 34,
           'airTempCMean', 21,
           'fuelStartLitres', 42, 'fuelEndLitres', 39.5,
           'fuelLevelIntegralLitreSeconds', 4875, 'fuelAddedLitresObserved', null,
           'absLatAccelIntegralGSeconds', 220,
           'latAccelSquaredIntegralG2Seconds', 380,
           'maxAbsLatAccelG', 1.85,
           'absLongAccelIntegralGSeconds', 60,
           'sampleCount', 7200,
           'pitVisitIds', jsonb_build_array('pit-1'),
           'wearObservationIds', jsonb_build_array('evt-1'),
           'coverage', pg_temp.coverage_full()
         ) || p_extra
$$;

create or replace function pg_temp.frame()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'protocolVersion', 3, 'sequence', 1, 'capturedAt', '2026-10-31T12:00:00.000Z',
    'transportSessionId', 'sess-1',
    'identity', jsonb_build_object('currentDriverId', 'Driver One',
                                   'currentDriverName', 'Driver One',
                                   'carId', 'car', 'carName', 'Car',
                                   'trackName', 'Track', 'trackConfig', 'GP', 'trackId', 1),
    'session', jsonb_build_object('isInCar', true, 'sessionTimeSeconds', 1000,
                                  'sessionTimeRemainingSeconds', 100,
                                  'sessionLapsRemaining', 5,
                                  'flags', jsonb_build_array('green'), 'sessionState', 'racing'),
    'timing', jsonb_build_object('currentLapElapsedSeconds', 40, 'lastLapTimeSeconds', 120.5,
                                 'bestLapTimeSeconds', 120.5, 'completedLaps', 3),
    'position', jsonb_build_object('position', 3, 'classPosition', 2, 'gapToLeaderSeconds', 1.5),
    'track', jsonb_build_object('lapDistancePct', 0.4, 'trackSurface', 'on_track', 'onPitRoad', false),
    'fuel', jsonb_build_object('fuelLitres', 40.5, 'fuelPct', 0.5),
    'raceState', jsonb_build_object('incidents', 0),
    'pitService', jsonb_build_object('pitServiceFlagsRaw', 0, 'requiredRepairSeconds', 0,
                                     'optionalRepairSeconds', 0))
$$;

create or replace function pg_temp.batch(p_events jsonb, p_laps jsonb)
returns jsonb language sql as $$
  select public.simhub_persist_measurement_batch(
           (select device from t_ids), 'sess-2', p_events, p_laps)
$$;

-- Dezelfde batch, maar met een expliciete afleversessie (reconnect).
create or replace function pg_temp.batch_session(p_session text, p_events jsonb, p_laps jsonb)
returns jsonb language sql as $$
  select public.simhub_persist_measurement_batch(
           (select device from t_ids), p_session, p_events, p_laps)
$$;

-- ============================================================================
-- R1. Duurzame identiteit (reviewpunt 1)
-- ============================================================================
do $$
declare
  v_ack jsonb;
  v_ack2 jsonb;
  v_row public.simhub_measurement_events%rowtype;
  v_n integer;
begin
  -- Zonder UUID is het geen gebeurtenis. Het tekst-ID alleen is niet genoeg.
  v_ack := pg_temp.batch(jsonb_build_array(
    jsonb_build_object('eventId', 'evt-1', 'kind', 'wear_value_changed')), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'event_uid_missing',
                     'R1 een gebeurtenis zonder eventUid wordt afgewezen');
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,index}', '0',
                     'R1 de afwijzing noemt de positie in de reeks');

  -- Een nieuwe transportsessie met een opnieuw begonnen teller ('evt-1') mag
  -- niet stil verdwijnen: een ander UUID is een andere gebeurtenis.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(1, jsonb_build_object('eventId', 'evt-1')),
    pg_temp.event(2, jsonb_build_object('eventId', 'evt-1', 'segmentId', 'seg-2'))), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 2,
                     'R1 hetzelfde tekstlabel met twee UUID''s levert twee rijen');

  select * into v_row from public.simhub_measurement_events where event_uid = pg_temp.uid(1);
  perform pg_temp.eq(v_row.observed_session_id, 'sess-1',
                     'R1 observed_session_id komt van de client');
  perform pg_temp.eq(v_row.delivered_session_id, 'sess-2',
                     'R1 delivered_session_id komt van de server');
  perform pg_temp.eq(v_row.event_id, 'evt-1', 'R1 het tekstlabel blijft bewaard');

  -- Reconnect: dezelfde UUID, andere afleversessie. Dat is een duplicaat, geen
  -- tweede rij en geen wijziging van de oorspronkelijke waarnemingscontext.
  v_ack := pg_temp.batch_session('sess-9', jsonb_build_array(pg_temp.event(1)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,duplicates}'), 1,
                     'R1 reconnect levert een duplicaat, geen nieuwe rij');
  select * into v_row from public.simhub_measurement_events where event_uid = pg_temp.uid(1);
  perform pg_temp.eq(v_row.observed_session_id, 'sess-1',
                     'R1 reconnect overschrijft de waarnemingssessie niet');
  perform pg_temp.eq(v_row.delivered_session_id, 'sess-2',
                     'R1 reconnect overschrijft de afleversessie niet');

  -- Procesherstart: nieuwe sessie, oude outbox. Nog steeds hetzelfde UUID.
  v_ack2 := pg_temp.batch_session('sess-10', jsonb_build_array(pg_temp.event(1)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack2 #> '{events,duplicates}'), 1,
                     'R1 procesherstart met oude outbox levert een duplicaat');
  perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events
                       where event_uid = pg_temp.uid(1)), 1,
                     'R1 er staat nog steeds precies één rij');

  -- Herzending uit een oude outbox, eerste keer NA een nieuwe simsessie: het
  -- apparaat zit nu in sess-3, de waarneming is van sess-1, en het UUID is nieuw.
  v_ack := pg_temp.batch_session('sess-3', jsonb_build_array(
    pg_temp.event(5, jsonb_build_object('observedSessionId', 'sess-1'))), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'R1 een oude outbox-waarneming wordt na reconnect geaccepteerd');
  select * into v_row from public.simhub_measurement_events where event_uid = pg_temp.uid(5);
  perform pg_temp.eq(v_row.observed_session_id, 'sess-1',
                     'R1 de oorspronkelijke sessie blijft zichtbaar na late levering');
  perform pg_temp.eq(v_row.delivered_session_id, 'sess-3',
                     'R1 de afleversessie is de sessie van nu');

  -- De uniciteit hangt niet aan de sessie: de oude unieke sleutel is weg.
  perform pg_temp.expect(not exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.simhub_measurement_events'::regclass
       and c.contype = 'u'
       and array(select a.attname::text from unnest(c.conkey) k
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
                  order by a.attname) = array['device_id', 'event_id']),
    'R1 de oude unieke sleutel (device_id, event_id) bestaat niet meer');
  perform pg_temp.expect(exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.simhub_measurement_events'::regclass
       and c.contype = 'u'
       and array(select a.attname::text from unnest(c.conkey) k
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
                  order by a.attname) = array['device_id', 'event_uid']),
    'R1 de unieke sleutel is (device_id, event_uid)');
  perform pg_temp.expect(exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.simhub_lap_summaries'::regclass
       and c.contype = 'u'
       and array(select a.attname::text from unnest(c.conkey) k
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
                  order by a.attname) = array['device_id', 'summary_uid']),
    'R1 de unieke sleutel van de ronde is (device_id, summary_uid)');
end
$$;

-- ============================================================================
-- R2. Revisies (reviewpunt 2)
-- ============================================================================
do $$
declare
  v_ack jsonb;
  v_row public.simhub_measurement_events%rowtype;
begin
  -- Eerste stand.
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(20)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'R2 de eerste stand wordt geaccepteerd');

  -- Hogere revisie met andere inhoud: de rij wordt bijgewerkt.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(20, jsonb_build_object('recordRevision', 2, 'confidence', 0.95,
                                         'kind', 'wear_refresh_corrected'))), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,superseded}'), 1,
                     'R2 een hogere revisie wordt als superseded gemeld');
  select * into v_row from public.simhub_measurement_events where event_uid = pg_temp.uid(20);
  perform pg_temp.eq(v_row.record_revision, 2, 'R2 de rij staat op revisie 2');
  perform pg_temp.eq(v_row.confidence, 0.95::double precision,
                     'R2 confidence is bijgewerkt (geen DO NOTHING meer)');
  perform pg_temp.eq(v_row.kind, 'wear_refresh_corrected', 'R2 kind is bijgewerkt');

  -- Dezelfde revisie met andere inhoud: expliciet conflict, geen stille negeer.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(20, jsonb_build_object('recordRevision', 2, 'confidence', 0.5))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'revision_conflict',
                     'R2 dezelfde revisie met andere inhoud is een expliciet conflict');
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 0,
                     'R2 een conflict schrijft niets');
  select * into v_row from public.simhub_measurement_events where event_uid = pg_temp.uid(20);
  perform pg_temp.eq(v_row.confidence, 0.95::double precision,
                     'R2 een conflict laat de opgeslagen waarde staan');

  -- Dezelfde revisie met dezelfde inhoud: duplicaat.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(20, jsonb_build_object('recordRevision', 2, 'confidence', 0.95,
                                         'kind', 'wear_refresh_corrected'))), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,duplicates}'), 1,
                     'R2 dezelfde revisie met dezelfde inhoud is een duplicaat');

  -- Lagere revisie: verouderd, niet toepassen.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(20, jsonb_build_object('recordRevision', 1))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'stale_revision',
                     'R2 een lagere revisie wordt als verouderd afgewezen');

  -- Bevestiging als nieuwe gebeurtenis met een verwijzing naar de vorige.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(21, jsonb_build_object('kind', 'wear_refresh_confirmed',
                                         'supersedesEventUid', pg_temp.uid(20)))), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'R2 een bevestiging als nieuwe gebeurtenis wordt geaccepteerd');
  select * into v_row from public.simhub_measurement_events where event_uid = pg_temp.uid(21);
  perform pg_temp.eq(v_row.supersedes_event_uid, pg_temp.uid(20),
                     'R2 de verwijzing naar de bevestigde waarneming is opgeslagen');
  perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events
                       where event_uid = pg_temp.uid(20)), 1,
                     'R2 de oorspronkelijke waarneming blijft bestaan');
end
$$;

-- ============================================================================
-- R3. ACK per rij, ook bij parserafkeuring (reviewpunt 3)
-- ============================================================================
do $$
declare
  v_ack jsonb;
  v_ack2 jsonb;
  v_result text;
  v_frame_ack jsonb;
begin
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(30, jsonb_build_object('kind', 'wear_value_changed')),
    jsonb_build_object('eventUid', 'niet-een-uuid', 'kind', 'wear_value_changed'),
    pg_temp.event(31, jsonb_build_object('confidence', 2))
  ), null);
  perform pg_temp.expect(v_ack ? 'events' and v_ack ? 'laps', 'R3 het rapport heeft events en laps');
  perform pg_temp.expect(jsonb_typeof(v_ack #> '{events,accepted}') = 'array',
                         'R3 accepted is een lijst met ID''s');
  perform pg_temp.expect(jsonb_array_length(v_ack #> '{events,rejected}') >= 2,
                         'R3 afgekeurde rijen staan met reden in het rapport');
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'event_uid_invalid',
                     'R3 een ongeldig UUID heeft een eigen reden');
  perform pg_temp.eq(v_ack #>> '{events,rejected,1,reason}', 'confidence_invalid',
                     'R3 confidence buiten 0..1 heeft een eigen reden');

  -- Reeks als geheel afgekeurd: dat staat in block_error, niet stil.
  v_ack := pg_temp.batch('{"nope":true}'::jsonb, null);
  perform pg_temp.eq(v_ack #>> '{events,block_error}', 'not_an_array',
                     'R3 een niet-array wordt als block_error gemeld');

  -- En het frame-ACK draagt het meetrapport.
  perform pg_temp.rate_ok();
  select r.result, r.measurement_ack into v_result, v_frame_ack
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 900, '2026-10-31T13:00:00Z'::timestamptz,
      pg_temp.frame(), '0.7.2.0',
      jsonb_build_array(pg_temp.event(40)),
      jsonb_build_array(pg_temp.lap(40))) r;
  perform pg_temp.eq(v_result, 'accepted', 'R3 het frame wordt geaccepteerd');
  perform pg_temp.expect(v_frame_ack is not null, 'R3 het frame-ACK bevat het meetrapport');
  perform pg_temp.eq(jsonb_array_length(v_frame_ack #> '{events,accepted}'), 1,
                     'R3 het frame-ACK noemt de geaccepteerde gebeurtenis');
  perform pg_temp.eq(jsonb_array_length(v_frame_ack #> '{laps,accepted}'), 1,
                     'R3 het frame-ACK noemt het geaccepteerde rondeaggregaat');

  -- Een replay van het frame schrijft niets en zegt dat ook.
  perform pg_temp.rate_ok();
  select r.result, r.measurement_ack into v_result, v_frame_ack
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 900, '2026-10-31T13:00:01Z'::timestamptz,
      pg_temp.frame(), '0.7.2.0',
      jsonb_build_array(pg_temp.event(41)), null) r;
  perform pg_temp.eq(v_result, 'replayed', 'R3 een herhaald frame wordt als replayed gemeld');
  perform pg_temp.eq(v_frame_ack #>> '{error}', 'frame_replayed',
                     'R3 het ACK van een replay zegt dat er niets is opgeslagen');

  -- Zonder meetreeksen blijft het ACK leeg maar wel aanwezig (geen null-claim).
  perform pg_temp.rate_ok();
  select r.result, r.measurement_ack into v_result, v_frame_ack
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 901, '2026-10-31T13:00:02Z'::timestamptz,
      pg_temp.frame(), '0.7.2.0') r;
  perform pg_temp.eq(v_result, 'accepted', 'R3 een frame zonder meetreeksen blijft werken');
  perform pg_temp.expect(v_frame_ack is null, 'R3 zonder meetreeksen is er geen meetrapport');
end
$$;

-- ============================================================================
-- R4. wear_v1, evidence_v1 en setGeneration (reviewpunt 4)
-- ============================================================================
do $$
declare
  v_ack jsonb;
  v_row public.simhub_measurement_events%rowtype;
  v_ok boolean;
begin
  -- De letterlijke probe uit de review.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(50, jsonb_build_object('wearAfter', jsonb_build_object('fl', 'banana')))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'wear_after_contract',
                     'R4 wearAfter met "banana" wordt afgewezen');

  -- Ontbrekende hoek.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(51, jsonb_build_object('wearAfter',
      jsonb_build_object('version', 1, 'scale', 'remaining_percent', 'fl', 1, 'fr', 1, 'rl', 1)))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'wear_after_contract',
                     'R4 wear zonder alle vier hoeken wordt afgewezen');

  -- Verkeerde schaal.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(52, jsonb_build_object('wearAfter', pg_temp.wear(1) || jsonb_build_object('scale', 'fraction')))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'wear_after_contract',
                     'R4 een andere schaal dan remaining_percent wordt afgewezen');

  -- Onbekende sleutel.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(53, jsonb_build_object('wearAfter', pg_temp.wear(1) || jsonb_build_object('grip', 5)))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'wear_after_contract',
                     'R4 een onbekende sleutel in wear wordt afgewezen');

  -- Buiten 0..100.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(54, jsonb_build_object('wearAfter', pg_temp.wear(101)))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'wear_after_contract',
                     'R4 wear boven 100 wordt afgewezen');

  -- Bewijsgrond en confidence zijn verplicht bij een wear-waarneming.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(55, jsonb_build_object('evidence', 'null'::jsonb))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'evidence_missing',
                     'R4 wear zonder bewijsgrond wordt afgewezen');
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(56, jsonb_build_object('confidence', 'null'::jsonb))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'confidence_missing',
                     'R4 wear zonder confidence wordt afgewezen');
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(57, jsonb_build_object('evidence', jsonb_build_object('source', 'x')))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'evidence_contract',
                     'R4 bewijs zonder kanalen wordt afgewezen');

  -- En de geldige vorm komt er wel door, met de schaal expliciet opgeslagen.
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(58)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'R4 een geldige wear_v1-waarneming wordt geaccepteerd');
  select * into v_row from public.simhub_measurement_events where event_uid = pg_temp.uid(58);
  perform pg_temp.eq(v_row.wear_after->>'scale', 'remaining_percent',
                     'R4 de schaal staat expliciet in de opgeslagen waarde');
  perform pg_temp.eq(v_row.wear_after->>'fl', '0.2', 'R4 de hoekwaarde is opgeslagen');

  -- De CHECK is de tweede wachter: ook een rechtstreekse insert faalt.
  begin
    insert into public.simhub_measurement_events
      (device_id, event_uid, kind, wear_after, evidence, confidence, content_hash)
    values ((select device::text from t_ids), gen_random_uuid(), 'x',
            jsonb_build_object('fl', 'banana'), pg_temp.evidence(), 1, md5('probe'));
    perform pg_temp.expect(false, 'R4 de CHECK weigert "banana" ook bij een directe insert');
  exception when check_violation then
    perform pg_temp.expect(true, 'R4 de CHECK weigert "banana" ook bij een directe insert');
  end;
end
$$;

-- ============================================================================
-- R5. Dekking per metriekgroep (reviewpunt 5)
-- ============================================================================
do $$
declare
  v_ack jsonb;
  v_row public.simhub_lap_summaries%rowtype;
  v_type text;
  v_ok boolean;
begin
  -- De letterlijke probe: complete=true en een integraal, zonder dekking.
  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(60, jsonb_build_object('coverage', 'null'::jsonb))));
  perform pg_temp.eq(v_ack #>> '{laps,rejected,0,reason}', 'coverage_missing:temperature',
                     'R5 temperaturen zonder dekking worden afgewezen');

  -- Alleen temperatuurdekking, maar wel een brandstofintegraal.
  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(61, jsonb_build_object('coverage',
      jsonb_build_object('temperature', pg_temp.group_(2400, 120.0, 0.1))))));
  perform pg_temp.eq(v_ack #>> '{laps,rejected,0,reason}', 'coverage_missing:fuel',
                     'R5 een integraal zonder brandstofdekking wordt afgewezen');

  -- Dekking zonder samples is geen dekking.
  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(62, jsonb_build_object('coverage', jsonb_build_object(
      'temperature', pg_temp.group_(0, 0, 0),
      'fuel', pg_temp.group_(0, 0, 0),
      'load', pg_temp.group_(0, 0, 0))))));
  perform pg_temp.expect(v_ack #>> '{laps,rejected,0,reason}' like 'coverage%',
                         'R5 dekking zonder samples wordt afgewezen');

  -- Groepen gedekt, maar het gat is te groot: dan is de ronde niet compleet.
  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(66, jsonb_build_object('coverage', jsonb_build_object(
      'temperature', pg_temp.group_(2400, 120.0, 12.0),
      'fuel', pg_temp.group_(2400, 120.0, 0.1),
      'load', pg_temp.group_(2400, 120.0, 0.1))))));
  perform pg_temp.eq(v_ack #>> '{laps,rejected,0,reason}', 'complete_without_coverage',
                     'R5 complete=true met een te groot gat is geen complete meting');

  -- Onbekende groep.
  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(63, jsonb_build_object('coverage',
      pg_temp.coverage_full() || jsonb_build_object('brakes', pg_temp.group_(10, 1, 0))))));
  perform pg_temp.eq(v_ack #>> '{laps,rejected,0,reason}', 'coverage_contract',
                     'R5 een onbekende dekkingsgroep wordt afgewezen');

  -- Geldige dekking: de vlakke kolommen worden afgeleid, niet overgenomen.
  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(64, jsonb_build_object('validDurationSeconds', 1,
                                       'sampleCount', 1,
                                       'maxGapSeconds', 99))));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'R5 een volledig gedekte ronde wordt geaccepteerd');
  select * into v_row from public.simhub_lap_summaries where summary_uid = pg_temp.uid(1064);
  perform pg_temp.eq(v_row.sample_count, 7200::bigint,
                     'R5 sample_count is de som van de groepen (7200), niet de payload (1)');
  perform pg_temp.eq(v_row.valid_duration_seconds, 120.0::double precision,
                     'R5 de meetduur komt uit de dekking');
  perform pg_temp.eq(v_row.max_gap_seconds, 0.1::double precision,
                     'R5 het grootste gat komt uit de dekking');
  perform pg_temp.eq(v_row.coverage->'fuel'->>'sampleCount', '2400',
                     'R5 de dekking per groep is opgeslagen');

  -- Fractioneel sampleCount bestaat niet meer.
  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(65, jsonb_build_object('sampleCount', 0.5))));
  perform pg_temp.eq(v_ack #>> '{laps,rejected,0,reason}', 'sample_count_invalid',
                     'R5 sampleCount 0.5 wordt afgewezen');

  select format_type(a.atttypid, a.atttypmod) into v_type
    from pg_attribute a
   where a.attrelid = 'public.simhub_lap_summaries'::regclass and a.attname = 'sample_count';
  perform pg_temp.eq(v_type, 'bigint', 'R5 sample_count is bigint');

  -- Directe insert met een integraal zonder dekking: de CHECK grijpt in.
  begin
    insert into public.simhub_lap_summaries
      (summary_uid, device_id, lap_number, fuel_level_integral_litre_seconds, sample_count, content_hash)
    values (gen_random_uuid(), (select device::text from t_ids), 1, 100, 0, md5('probe'));
    perform pg_temp.expect(false, 'R5 de CHECK weigert een integraal zonder dekking');
  exception when check_violation then
    perform pg_temp.expect(true, 'R5 de CHECK weigert een integraal zonder dekking');
  end;
end
$$;

-- ============================================================================
-- R6. Veilige casts en foutisolatie per rij (reviewpunt 6)
-- ============================================================================
do $$
declare
  v_ack jsonb;
  v_row public.simhub_lap_summaries%rowtype;
begin
  -- NaN en Infinity zijn geldige float8-invoer voor PostgreSQL en dus precies
  -- waar het misging. Ze zijn hier geen meting.
  v_ack := pg_temp.batch(null, jsonb_build_array(
    jsonb_build_object('summaryUid', pg_temp.uid(1070), 'lapNumber', 70,
                       'trackTempCMean', 'NaN')));
  perform pg_temp.eq(v_ack #>> '{laps,rejected,0,reason}', 'temperature_invalid',
                     'R6 "NaN" als temperatuur wordt afgewezen');
  v_ack := pg_temp.batch(null, jsonb_build_array(
    jsonb_build_object('summaryUid', pg_temp.uid(1071), 'lapNumber', 71,
                       'fuelLevelIntegralLitreSeconds', 'Infinity')));
  perform pg_temp.eq(v_ack #>> '{laps,rejected,0,reason}', 'fuel_invalid',
                     'R6 "Infinity" als integraal wordt afgewezen');
  v_ack := pg_temp.batch(null, jsonb_build_array(
    jsonb_build_object('summaryUid', pg_temp.uid(1072), 'lapNumber', 72,
                       'absLatAccelIntegralGSeconds', '-Infinity')));
  perform pg_temp.eq(v_ack #>> '{laps,rejected,0,reason}', 'load_invalid',
                     'R6 "-Infinity" als belastingintegraal wordt afgewezen');
  perform pg_temp.expect(not exists (
    select 1 from public.simhub_lap_summaries
     where summary_uid in (pg_temp.uid(1070), pg_temp.uid(1071), pg_temp.uid(1072))),
    'R6 geen enkele NaN/Infinity-rij is opgeslagen');

  -- 1.0 als integer: werkt, want de cast loopt via numeric.
  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(73, jsonb_build_object('lapNumber', 73.0))));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'R6 lapNumber 73.0 (JSON-getal) wordt geaccepteerd');
  select * into v_row from public.simhub_lap_summaries where summary_uid = pg_temp.uid(1073);
  perform pg_temp.eq(v_row.lap_number, 73, 'R6 73.0 is als integer 73 opgeslagen');

  -- 73.5 is geen ronde.
  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(74, jsonb_build_object('lapNumber', 73.5))));
  perform pg_temp.eq(v_ack #>> '{laps,rejected,0,reason}', 'lap_number_invalid',
                     'R6 lapNumber 73.5 wordt per rij afgewezen');

  -- Foutisolatie: één rij die een constraint raakt kost niet de andere rijen.
  begin
    alter table public.simhub_measurement_events
      add constraint t_probe_boom check (kind <> 'boom');
    v_ack := pg_temp.batch(jsonb_build_array(
      pg_temp.event(80, jsonb_build_object('kind', 'boom')),
      pg_temp.event(81)), null);
    perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                       'R6 een constraint-fout in één rij kost de andere rij niet');
    perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'row_failed:23514',
                       'R6 de gefaalde rij staat met SQLSTATE in het rapport');
    perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events
                         where event_uid = pg_temp.uid(81)), 1,
                       'R6 de gezonde rij is gewoon geschreven');
    alter table public.simhub_measurement_events drop constraint t_probe_boom;
  exception when others then
    begin
      alter table public.simhub_measurement_events drop constraint if exists t_probe_boom;
    exception when others then null;
    end;
    raise;
  end;

  -- En de helpers zelf: geen exception, wel null.
  perform pg_temp.expect(public.simhub_jvalid('"NaN"'::jsonb, 'number') is false,
                         'R6 jvalid keurt de tekst "NaN" af');
  perform pg_temp.expect(public.simhub_jvalid('"1e400"'::jsonb, 'number') is false,
                         'R6 jvalid keurt een waarde buiten float8-bereik af');
  perform pg_temp.eq(public.simhub_jint('1.0'::jsonb), 1, 'R6 simhub_jint maakt van 1.0 een 1');
end
$$;

-- ============================================================================
-- R7. Snapshotisolatie (reviewpunt 7)
-- ============================================================================
do $$
declare
  v_frame jsonb;
  v_result text;
  v_snapshot jsonb;
begin
  -- Een frame waarin de meetserie (foutief) tóch in de snapshot zou zitten.
  v_frame := pg_temp.frame()
             || jsonb_build_object('measurementEvents', jsonb_build_array(pg_temp.event(90)))
             || jsonb_build_object('lapSummaries', jsonb_build_array(pg_temp.lap(90)));

  perform pg_temp.rate_ok();
  select r.result into v_result
    from public.simhub_persist_v3(
      repeat('a', 64), 'sess-1', 910, '2026-10-31T14:00:00Z'::timestamptz,
      v_frame, '0.7.2.0',
      jsonb_build_array(pg_temp.event(90)),
      jsonb_build_array(pg_temp.lap(90))) r;
  perform pg_temp.eq(v_result, 'accepted', 'R7 het frame met meetserie wordt geaccepteerd');

  select v3_normalized into v_snapshot
    from public.simhub_telemetry_latest where device_id = (select device from t_ids);
  perform pg_temp.expect(not (v_snapshot ? 'measurementEvents'),
                         'R7 measurementEvents staat niet in de snapshot');
  perform pg_temp.expect(not (v_snapshot ? 'lapSummaries'),
                         'R7 lapSummaries staat niet in de snapshot');
  perform pg_temp.eq(v_snapshot #>> '{timing,completedLaps}', '3',
                     'R7 de kerntelemetrie staat er wel gewoon in');

  -- De gegevens zijn niet verdwenen: ze staan in de eigen, afgeschermde tabel.
  perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events
                       where event_uid = pg_temp.uid(90)), 1,
                     'R7 de gebeurtenis staat in simhub_measurement_events');
  perform pg_temp.eq((select count(*)::integer from public.simhub_lap_summaries
                       where summary_uid = pg_temp.uid(1090)), 1,
                     'R7 het rondeaggregaat staat in simhub_lap_summaries');

  -- En authenticated kan er niet bij.
  perform pg_temp.expect(not has_table_privilege('authenticated', 'public.simhub_measurement_events', 'select'),
                         'R7 authenticated heeft geen select op de meetgebeurtenissen');
  perform pg_temp.expect(not has_table_privilege('authenticated', 'public.simhub_lap_summaries', 'select'),
                         'R7 authenticated heeft geen select op de rondeaggregaten');
  perform pg_temp.expect(not exists (select 1 from pg_policies
                                      where schemaname = 'public'
                                        and tablename in ('simhub_measurement_events', 'simhub_lap_summaries')),
                         'R7 er staan geen policies open op de meettabellen');
end
$$;

-- Als authenticated: de leesroute is echt dicht (42501), niet alleen "geen recht".
do $$
declare
  v_events_denied boolean := false;
  v_laps_denied boolean := false;
begin
  set local role authenticated;
  begin
    perform 1 from public.simhub_measurement_events limit 1;
  exception when insufficient_privilege then
    v_events_denied := true;
  end;
  begin
    perform 1 from public.simhub_lap_summaries limit 1;
  exception when insufficient_privilege then
    v_laps_denied := true;
  end;
  reset role;

  perform pg_temp.expect(v_events_denied,
                         'R7 authenticated krijgt een fout bij het lezen van de meetgebeurtenissen');
  perform pg_temp.expect(v_laps_denied,
                         'R7 authenticated krijgt een fout bij het lezen van de rondeaggregaten');
end
$$;

-- ============================================================================
-- R8. Grenzen van control en ingest (reviewpunt 8)
-- ============================================================================
do $$
declare
  v_result record;
  v_def text;
  v_ack jsonb;
  v_big text;
begin
  -- De grenzen in de DDL.
  perform pg_temp.expect(pg_get_constraintdef(oid) like '%400%'
                         and pg_get_constraintdef(oid) like '%10000%',
    'R8 de CHECK op send_interval_ms begint bij 400 ms')
    from pg_constraint where conname = 'simhub_connector_config_send_interval_range';
  perform pg_temp.expect(pg_get_constraintdef(oid) like '%24576%',
    'R8 de CHECK op payload_budget_bytes eindigt bij 24576')
    from pg_constraint where conname = 'simhub_connector_config_payload_budget_range';

  -- En die grens is dezelfde als de rate-limit in de schrijver.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'simhub_persist_v3';
  perform pg_temp.expect(v_def like '%400 milliseconds%',
                         'R8 simhub_persist_v3 gebruikt dezelfde 400 ms');

  -- Wat ingest weigert, mag control niet publiceren.
  select * into v_result from public.simhub_connector_config_apply('{"sendIntervalMs":250}'::jsonb);
  perform pg_temp.eq(v_result.result, 'out_of_range',
                     'R8 sendIntervalMs 250 wordt geweigerd');
  perform pg_temp.eq(v_result.rejection_detail, 'sendIntervalMs:400..10000',
                     'R8 de afwijzing noemt de band');
  select * into v_result from public.simhub_connector_config_apply('{"payloadBudgetBytes":262144}'::jsonb);
  perform pg_temp.eq(v_result.result, 'out_of_range',
                     'R8 payloadBudgetBytes 262144 wordt geweigerd');
  select * into v_result from public.simhub_connector_config_apply(
    '{"sendIntervalMs":400,"payloadBudgetBytes":24576,"sampleHz":20}'::jsonb);
  perform pg_temp.eq(v_result.result, 'applied', 'R8 de ingestgrenzen zelf worden geaccepteerd');

  -- Features: alleen booleans. "true" als string werd eerder opgeslagen én als
  -- ignored gemeld.
  select * into v_result from public.simhub_connector_config_apply(
    '{"features":{"measurementEvents":"true","lapSummaries":null,"environment":true}}'::jsonb);
  perform pg_temp.eq(v_result.result, 'applied', 'R8 een features-patch met rommel wordt toegepast');
  perform pg_temp.eq((select features from public.simhub_connector_config where id = 1),
                     '{"environment":true}'::jsonb,
                     'R8 alleen boolean-features worden opgeslagen');
  perform pg_temp.expect(v_result.ignored_feature_keys @> array['measurementEvents', 'lapSummaries'],
                         'R8 de niet-boolean sleutels worden als ignored gemeld');

  -- Te groot bewijs: een expliciete afwijzing, geen stille null.
  select jsonb_agg(jsonb_build_object('channel', 'kanaal_' || g, 'noot', repeat('x', 120)))
    into v_big from generate_series(1, 60) g;
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(95, jsonb_build_object('evidence',
      jsonb_build_object('version', 1, 'source', 'tire_sets_used',
                         'channels', jsonb_build_array('tire_sets_used'),
                         'note', repeat('x', 200)) || jsonb_build_object('blob', v_big)))), null);
  perform pg_temp.eq(v_ack #>> '{events,rejected,0,reason}', 'evidence_too_large',
                     'R8 te groot bewijs wordt expliciet afgewezen');
  perform pg_temp.expect(not exists (select 1 from public.simhub_measurement_events
                                      where event_uid = pg_temp.uid(95)),
                         'R8 een afgewezen bewijsveld levert geen geaccepteerde rij op');
end
$$;

-- ============================================================================
-- R12. Retentie (reviewpunt 12)
-- ============================================================================
do $$
declare
  v_row record;
  v_oud integer;
begin
  -- Oude rijen in de tabel zetten (buiten de schrijver om, dat mag als
  -- service_role in deze testtransactie).
  insert into public.simhub_measurement_events
    (device_id, event_uid, kind, observed_session_id, delivered_session_id, received_at, content_hash)
  values
    ((select device::text from t_ids), gen_random_uuid(), 'oud', 's', 'd', now() - interval '200 days', md5('a')),
    ((select device::text from t_ids), gen_random_uuid(), 'oud', 's', 'd', now() - interval '80 days', md5('b')),
    ((select device::text from t_ids), gen_random_uuid(), 'jong', 's', 'd', now(), md5('c'));
  select count(*)::integer into v_oud from public.simhub_measurement_events where kind = 'oud';

  select * into v_row from public.simhub_prune_measurements();
  perform pg_temp.eq(v_row.dry_run, true, 'R12 de opruimfunctie is standaard een proef');
  perform pg_temp.eq(v_row.events_deleted >= 1, true,
                     'R12 de proef telt de rijen ouder dan 90 dagen');
  perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events where kind = 'oud'),
                     v_oud, 'R12 een proef verwijdert niets');

  select * into v_row from public.simhub_prune_measurements(null, null, false);
  perform pg_temp.eq(v_row.dry_run, false, 'R12 een echte opruiming meldt dat hij niets droog deed');
  perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events
                       where kind = 'oud' and received_at < now() - interval '90 days'), 0,
                     'R12 de rij ouder dan 90 dagen is verwijderd');
  perform pg_temp.eq((select count(*)::integer from public.simhub_measurement_events
                       where kind = 'oud' and received_at > now() - interval '90 days'), 1,
                     'R12 de rij binnen de termijn blijft staan');

  begin
    perform public.simhub_prune_measurements(now() - interval '1 day');
    perform pg_temp.expect(false, 'R12 een bewaartermijn korter dan 30 dagen wordt geweigerd');
  exception when invalid_parameter_value then
    perform pg_temp.expect(true, 'R12 een bewaartermijn korter dan 30 dagen wordt geweigerd');
  end;

  set local request.jwt.claim.role = 'anon';
  begin
    perform public.simhub_prune_measurements(null, null, false);
    perform pg_temp.expect(false, 'R12 anon mag niet opruimen');
  exception when insufficient_privilege then
    perform pg_temp.expect(true, 'R12 anon mag niet opruimen');
  end;
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
  raise notice 'plugin08 review: % van % PASS', v_totaal - v_fail, v_totaal;
  if v_fail > 0 then
    raise exception '% van % tests FAALT: %', v_fail, v_totaal,
      (select string_agg(label, ' | ' order by label) from t_resultaat where not ok);
  end if;
end
$$;

rollback;
