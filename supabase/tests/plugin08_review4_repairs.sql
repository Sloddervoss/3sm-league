-- ============================================================================
-- Plugin 0.7.2.0 — een duplicaatbevestiging overleeft de terugval (review 4)
-- Datum: 2026-10-31
--
-- Draai na de fixture en alle migraties (zie run_plugin08_proposal.sh). Alles
-- draait in één transactie die aan het eind wordt teruggedraaid.
--
-- Het geblokkeerde punt uit review 4: de terugval wiste ev_dup/lp_dup maar
-- herverwerkte alleen ins/upd. Een duplicaat dat vóór de terugval al herkend
-- was, zat niet in dat plan en verdween daardoor uit alle uitslaglijsten: geen
-- bevestiging, geen afwijzing, en dus geen manier om het uit de outbox te
-- verwijderen.
--
-- De probe is dezelfde als in de review, maar met een echte oorzaak voor de
-- terugval in plaats van een vervangen rijschrijver: een AFTER INSERT
-- statement-trigger laat het set-based statement klappen zodra het meer dan één
-- rij invoegt. De rij-voor-rij terugval schrijft per rij en komt er dus wél
-- door. Zo loopt de echte handler, met de echte schrijver.
--
-- Bewijs:
--   D1  gebeurtenis A is bevestigd als duplicaat, daarna forceert een batch met
--       B en C de terugval: A blijft in duplicates staan (met record_revision),
--       B en C worden bevestigd, geen enkele rij verdwijnt zonder uitslag;
--   D2  een duplicaat van een rij die in dezelfde batch wordt ingevoegd blijft
--       ook na de terugval een duplicaat (batchvolgorde blijft staan);
--   D3  hetzelfde voor rondeaggregaten.
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
select device, repeat('d', 64), 'PC-REVIEW4', 'SIM-REVIEW4', event, team,
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

-- Aantal keren dat een lijst een bepaald id noemt.
create or replace function pg_temp.noemt(p_ack jsonb, p_block text, p_lijst text, p_uid uuid)
returns integer language sql immutable as $$
  select count(*) from jsonb_array_elements(p_ack #> array[p_block, p_lijst]) a
   where a->>'id' = p_uid::text
$$;

-- ---------------------------------------------------------------------------
-- De terugval forceren zonder de schrijver te vervangen
-- ---------------------------------------------------------------------------
-- Een AFTER INSERT statement-trigger ziet alle rijen van één INSERT. Het
-- set-based snelpad voegt de nieuwe rijen in één statement in en klapt dus; de
-- rij-voor-rij terugval voegt per rij in en komt er door. Zo loopt de echte
-- handler met de echte schrijver, en weten we zeker dat de terugval liep.
--
-- De tellingen gaan via sequences: nextval() valt niet terug bij de exception
-- die de trigger zelf opgooit, een rij in een tabel wel.
create sequence pg_temp.p08_events_multi;
create sequence pg_temp.p08_events_single;
create sequence pg_temp.p08_laps_multi;
create sequence pg_temp.p08_laps_single;

-- Twee functies, elk met een eigen verwijzing naar de transition table: de
-- plancache van plpgsql deelt geen query tussen twee triggers.
create or replace function public.plugin08_test_force_fallback_events()
returns trigger language plpgsql as $$
declare
  v_n integer;
begin
  select count(*) into v_n from new_rows;
  if v_n > 1 then
    perform nextval('pg_temp.p08_events_multi');
    raise exception 'forced fallback' using errcode = 'P0001';
  end if;
  perform nextval('pg_temp.p08_events_single');
  return null;
end $$;

create or replace function public.plugin08_test_force_fallback_laps()
returns trigger language plpgsql as $$
declare
  v_n integer;
begin
  select count(*) into v_n from new_rows;
  if v_n > 1 then
    perform nextval('pg_temp.p08_laps_multi');
    raise exception 'forced fallback' using errcode = 'P0001';
  end if;
  perform nextval('pg_temp.p08_laps_single');
  return null;
end $$;

create trigger plugin08_test_force_fallback
  after insert on public.simhub_measurement_events
  referencing new table as new_rows
  for each statement execute function public.plugin08_test_force_fallback_events();

-- ---------------------------------------------------------------------------
-- D1 — duplicaat A blijft bevestigd als B en C de terugval forceren
-- ---------------------------------------------------------------------------
do $$
declare
  v_ack jsonb;
  v_rijen integer;
  v_uitslagen integer;
begin
  -- A staat al op de server.
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(90)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'D1 de eerste gebeurtenis is bevestigd');

  -- De probe: A opnieuw (duplicaat), plus B en C die samen het snelpad laten
  -- klappen. Vóór de reparatie verdween A hier uit alle lijsten.
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(90), pg_temp.event(91), pg_temp.event(92)), null);

  perform pg_temp.eq((select last_value::integer from pg_temp.p08_events_multi), 1,
                     'D1 de terugval liep echt (het set-based statement klapte)');
  -- Eén keer voor de eerste rij (hierboven) en één keer per rij in de terugval.
  perform pg_temp.eq((select last_value::integer from pg_temp.p08_events_single), 3,
                     'D1 de terugval schreef B en C rij voor rij');

  perform pg_temp.eq(pg_temp.noemt(v_ack, 'events', 'duplicates', pg_temp.uid(90)), 1,
                     'D1 het duplicaat A staat nog in duplicates');
  perform pg_temp.eq(pg_temp.noemt(v_ack, 'events', 'accepted', pg_temp.uid(91)), 1,
                     'D1 B is bevestigd');
  perform pg_temp.eq(pg_temp.noemt(v_ack, 'events', 'accepted', pg_temp.uid(92)), 1,
                     'D1 C is bevestigd');
  perform pg_temp.eq(v_ack #>> '{events,duplicates,0,record_revision}', '1',
                     'D1 het duplicaat noemt zijn record_revision');
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,rejected}'), 0,
                     'D1 geen enkele rij wordt afgewezen');
  perform pg_temp.eq(v_ack #>> '{events,received}', '3',
                     'D1 de ACK beschrijft de aangeboden reeks');

  -- Geen enkele rij verdwijnt zonder uitslag: iedere aangeboden rij staat
  -- precies één keer in accepted, duplicates of superseded.
  v_uitslagen := jsonb_array_length(v_ack #> '{events,accepted}')
               + jsonb_array_length(v_ack #> '{events,duplicates}')
               + jsonb_array_length(v_ack #> '{events,superseded}');
  perform pg_temp.eq(v_uitslagen, 3,
                     'D1 alle drie de rijen hebben een uitslag');

  select count(*) into v_rijen from public.simhub_measurement_events
   where event_uid in (pg_temp.uid(90), pg_temp.uid(91), pg_temp.uid(92));
  perform pg_temp.eq(v_rijen, 3, 'D1 A staat er één keer en B en C zijn erbij');
end $$;

-- ---------------------------------------------------------------------------
-- D2 — duplicaat van een rij die in dezelfde batch wordt ingevoegd
-- ---------------------------------------------------------------------------
-- Alleen de duplicatenlijst bewaren is niet genoeg: als het duplicaat bij een
-- rij hoort die pas in deze batch is ingevoegd, moet de volgorde kloppen. D
-- wordt ingevoegd (index 0) en is daarna een duplicaat (index 1); E en F dwingen
-- de terugval af.
do $$
declare
  v_ack jsonb;
  v_uitslagen integer;
begin
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(93), pg_temp.event(93), pg_temp.event(94), pg_temp.event(95)), null);

  perform pg_temp.eq((select last_value::integer from pg_temp.p08_events_multi), 2,
                     'D2 de terugval liep ook voor deze batch');
  perform pg_temp.eq((select last_value::integer from pg_temp.p08_events_single), 6,
                     'D2 de terugval schreef D, E en F rij voor rij');
  perform pg_temp.eq(pg_temp.noemt(v_ack, 'events', 'accepted', pg_temp.uid(93)), 1,
                     'D2 de ingevoegde rij D is één keer bevestigd');
  perform pg_temp.eq(pg_temp.noemt(v_ack, 'events', 'duplicates', pg_temp.uid(93)), 1,
                     'D2 het duplicaat van D blijft een duplicaat');
  perform pg_temp.eq(v_ack #>> '{events,duplicates,0,record_revision}', '1',
                     'D2 dat duplicaat noemt record_revision 1');

  v_uitslagen := jsonb_array_length(v_ack #> '{events,accepted}')
               + jsonb_array_length(v_ack #> '{events,duplicates}')
               + jsonb_array_length(v_ack #> '{events,superseded}')
               + jsonb_array_length(v_ack #> '{events,rejected}');
  perform pg_temp.eq(v_uitslagen, 4, 'D2 alle vier de rijen hebben een uitslag');
end $$;

drop trigger plugin08_test_force_fallback on public.simhub_measurement_events;

-- ---------------------------------------------------------------------------
-- D3 — hetzelfde voor rondeaggregaten
-- ---------------------------------------------------------------------------
create trigger plugin08_test_force_fallback
  after insert on public.simhub_lap_summaries
  referencing new table as new_rows
  for each statement execute function public.plugin08_test_force_fallback_laps();

do $$
declare
  v_ack jsonb;
  v_uitslagen integer;
  v_rijen integer;
begin
  -- L staat al op de server en wordt daarna als duplicaat aangeboden.
  v_ack := pg_temp.batch(null, jsonb_build_array(pg_temp.lap(90)));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'D3 de eerste ronde is bevestigd');

  v_ack := pg_temp.batch(null, jsonb_build_array(
    pg_temp.lap(90), pg_temp.lap(91), pg_temp.lap(92)));

  perform pg_temp.eq((select last_value::integer from pg_temp.p08_laps_multi), 1,
                     'D3 de terugval liep echt voor de rondeaggregaten');
  -- Eén keer voor de eerste ronde (hierboven) en één keer per ronde in de terugval.
  perform pg_temp.eq((select last_value::integer from pg_temp.p08_laps_single), 3,
                     'D3 de terugval schreef de twee nieuwe rondes rij voor rij');
  perform pg_temp.eq(pg_temp.noemt(v_ack, 'laps', 'duplicates', pg_temp.uid(1090)), 1,
                     'D3 het duplicaat L staat nog in duplicates');
  perform pg_temp.eq(v_ack #>> '{laps,duplicates,0,record_revision}', '1',
                     'D3 dat duplicaat noemt record_revision 1');
  perform pg_temp.eq(pg_temp.noemt(v_ack, 'laps', 'accepted', pg_temp.uid(1091)), 1,
                     'D3 de tweede ronde is bevestigd');
  perform pg_temp.eq(pg_temp.noemt(v_ack, 'laps', 'accepted', pg_temp.uid(1092)), 1,
                     'D3 de derde ronde is bevestigd');
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,rejected}'), 0,
                     'D3 geen enkele ronde wordt afgewezen');

  v_uitslagen := jsonb_array_length(v_ack #> '{laps,accepted}')
               + jsonb_array_length(v_ack #> '{laps,duplicates}')
               + jsonb_array_length(v_ack #> '{laps,superseded}');
  perform pg_temp.eq(v_uitslagen, 3, 'D3 alle drie de rondes hebben een uitslag');

  select count(*) into v_rijen from public.simhub_lap_summaries
   where summary_uid in (pg_temp.uid(1090), pg_temp.uid(1091), pg_temp.uid(1092));
  perform pg_temp.eq(v_rijen, 3, 'D3 L staat er één keer en de twee nieuwe rondes staan erbij');
end $$;

drop trigger plugin08_test_force_fallback on public.simhub_lap_summaries;

-- ---------------------------------------------------------------------------
-- Resultaat
-- ---------------------------------------------------------------------------
do $$
declare
  v_fail integer;
  v_total integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t_resultaat;
  raise notice 'plugin08 review4: % van % PASS', v_total - v_fail, v_total;
  if v_fail > 0 then
    raise exception 'plugin08 review4: % FAIL: %', v_fail,
      (select string_agg(label, '; ' order by label) from t_resultaat where not ok);
  end if;
end $$;

rollback;
