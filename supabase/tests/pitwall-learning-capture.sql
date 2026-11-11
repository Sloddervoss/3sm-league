-- ============================================================================
-- T07 — bronrevisiecapture: gaten, dedupe, revisies en late levering
--
-- Draai na de fixture. Alles in één transactie en aan het eind teruggedraaid.
--
-- Bewijst:
--   * alleen een expliciete global+account-policy levert capture op;
--   * UID/revisie/hash-duplicaten maken geen tweede rij of job;
--   * een nieuwe revisie laat de oude immutable rij staan;
--   * dezelfde revisie met andere hash wordt als conflict bewaard;
--   * late levering en stale revisies krijgen een expliciete reden;
--   * payload is een kleine allowlist zonder note/driver_name/raw frames;
--   * ontbrekende car/track/compound/owner is unknown + non-training-eligible,
--     nooit false/100% en nooit een latere current-snapshot;
--   * de brontabellen zelf worden door capture niet gewijzigd.
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

create or replace function pg_temp.eq(p_actual anycompatible, p_expected anycompatible, p_label text)
returns void language plpgsql as $$
begin
  perform pg_temp.expect(p_actual is not distinct from p_expected, p_label);
end $$;

create temp table t_ids as
select 'd0000000-0000-4000-8000-000000000001'::uuid as device,
       'd0000000-0000-4000-8000-000000000002'::uuid as device_nopolicy,
       'd0000000-0000-4000-8000-000000000003'::uuid as device_unknown,
       'a0000000-0000-4000-8000-000000000001'::uuid as owner,
       'a0000000-0000-4000-8000-000000000002'::uuid as owner_nopolicy;

create or replace function pg_temp.uid(p_n integer)
returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0'))::uuid
$$;

create or replace function pg_temp.wear(p_fl numeric)
returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 1, 'scale', 'remaining_percent',
                            'fl', p_fl, 'fr', p_fl, 'rl', p_fl, 'rr', p_fl)
$$;

create or replace function pg_temp.evidence()
returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 1, 'source', 'tire_sets_used',
                            'channels', jsonb_build_array('tire_sets_used'),
                            'note', 'must not be captured')
$$;

create or replace function pg_temp.event(p_n integer, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
           'eventUid', pg_temp.uid(p_n),
           'eventId', 'evt-' || p_n,
           'kind', 'wear_refresh_confirmed',
           'segmentId', 'seg-p1',
           'pitVisitId', 'pit-p1',
           'observedSessionId', 'sess-p1',
           'observedAt', '2026-11-11T16:00:00Z',
           'sessionTimeSeconds', 1000,
           'sdkTick', 12345,
           'confidence', 0.9,
           'evidence', pg_temp.evidence(),
           'wearBefore', pg_temp.wear(90.0),
           'wearAfter', pg_temp.wear(89.5)) || p_extra
$$;

create or replace function pg_temp.coverage_full()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'temperature', jsonb_build_object('validDurationSeconds', 120.0,
                                      'sampleCount', 2400, 'maxGapSeconds', 0.1),
    'fuel', jsonb_build_object('validDurationSeconds', 120.0,
                               'sampleCount', 2400, 'maxGapSeconds', 0.1),
    'load', jsonb_build_object('validDurationSeconds', 120.0,
                               'sampleCount', 2400, 'maxGapSeconds', 0.1))
$$;

create or replace function pg_temp.lap(p_n integer, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
           'summaryUid', pg_temp.uid(10000 + p_n),
           'summaryId', 'lap-' || p_n,
           'segmentId', 'seg-p1',
           'observedSessionId', 'sess-p1',
           'lapNumber', p_n,
           'startedAt', '2026-11-11T15:58:00Z',
           'endedAt', '2026-11-11T16:00:00Z',
           'currentDriverName', 'Test Driver',
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
           'pitVisitIds', jsonb_build_array('pit-p1'),
           'wearObservationIds', jsonb_build_array('evt-p1'),
           'coverage', pg_temp.coverage_full()) || p_extra
$$;

create or replace function pg_temp.batch(p_events jsonb, p_laps jsonb)
returns jsonb language sql as $$
  select public.simhub_persist_measurement_batch(
    (select device from t_ids), 'sess-p1', p_events, p_laps)
$$;

create or replace function pg_temp.rev_count(p_device uuid)
returns bigint language sql as $$
  select count(*) from pitwall_learning.source_revisions where device_id = p_device::text
$$;

do $$
declare
  v_before bigint;
  v_after bigint;
  v_null_before bigint;
  v_jobs_before bigint;
  v_ack jsonb;
  v_row pitwall_learning.source_revisions%rowtype;
  v_old public.simhub_measurement_events%rowtype;
  v_src public.simhub_measurement_events%rowtype;
  v_lap pitwall_learning.source_revisions%rowtype;
  v_source_before jsonb;
  v_source_after jsonb;
  v_blocked boolean;
  v_text text;
begin
  -- -----------------------------------------------------------------------
  -- Poort: global capture uit
  -- -----------------------------------------------------------------------
  v_before := pg_temp.rev_count((select device from t_ids));
  update pitwall_learning.runtime_settings set capture_enabled = false where id = 1;
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(1)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'T07 global capture uit: ingest-ACK blijft accepted');
  perform pg_temp.eq(pg_temp.rev_count((select device from t_ids)), v_before,
                     'T07 global capture uit: geen bronrevisie');
  update pitwall_learning.runtime_settings set capture_enabled = true where id = 1;

  -- -----------------------------------------------------------------------
  -- Poort: geen account-policy
  -- -----------------------------------------------------------------------
  v_before := pg_temp.rev_count((select device_nopolicy from t_ids));
  v_ack := public.simhub_persist_measurement_batch(
    (select device_nopolicy from t_ids), 'sess-p1',
    jsonb_build_array(pg_temp.event(2)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'T07 device zonder policy: ingest-ACK blijft accepted');
  perform pg_temp.eq(pg_temp.rev_count((select device_nopolicy from t_ids)), v_before,
                     'T07 device zonder policy: geen bronrevisie');

  -- -----------------------------------------------------------------------
  -- Poort: policy expliciet uit
  -- -----------------------------------------------------------------------
  update pitwall_learning.account_policy set capture_enabled = false
   where owner_user_id = (select owner from t_ids);
  v_before := pg_temp.rev_count((select device from t_ids));
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(3)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'T07 policy uit: ingest-ACK blijft accepted');
  perform pg_temp.eq(pg_temp.rev_count((select device from t_ids)), v_before,
                     'T07 policy uit: geen bronrevisie');
  update pitwall_learning.account_policy set capture_enabled = true
   where owner_user_id = (select owner from t_ids);

  -- -----------------------------------------------------------------------
  -- Eerste echte capture + allowlist
  -- -----------------------------------------------------------------------
  v_before := pg_temp.rev_count((select device from t_ids));
  select * into v_old from public.simhub_measurement_events
   where device_id = (select device::text from t_ids)
     and event_uid = pg_temp.uid(10);
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(10)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'T07 rijke gebeurtenis wordt geaccepteerd');

  select * into v_row from pitwall_learning.source_revisions
   where source_kind = 'measurement_event'
     and device_id = (select device::text from t_ids)
     and source_uid = pg_temp.uid(10)
     and record_revision = 1;
  perform pg_temp.expect(v_row.id is not null, 'T07 rijke gebeurtenis is vastgelegd');
  perform pg_temp.eq(pg_temp.rev_count((select device from t_ids)), v_before + 1,
                     'T07 precies één bronrevisie toegevoegd');
  perform pg_temp.eq(v_row.source_kind, 'measurement_event', 'T07 source_kind event');
  perform pg_temp.eq(v_row.owner_user_id, (select owner from t_ids),
                     'T07 owner komt uit device bij receipt');
  perform pg_temp.eq(v_row.owner_basis, 'device_owner_at_receipt',
                     'T07 owner is geen observed eigendomsbewijs');
  perform pg_temp.eq(v_row.account_policy_version, 1,
                     'T07 policyversie is vastgelegd');
  perform pg_temp.eq(v_row.context_status, 'blocked_missing_identity',
                     'T07 context is expliciet geblokkeerd');
  perform pg_temp.eq(v_row.canonical_context, null::jsonb,
                     'T07 geen verzonnen canonical context');
  perform pg_temp.eq(v_row.training_eligible, false,
                     'T07 P1-rij is niet training-eligible');
  perform pg_temp.eq(v_row.as_of_quality, 'as_of_unverifiable',
                     'T07 as-of is kwalitatief onverifieerbaar');
  perform pg_temp.eq(v_row.receipt_commit_visible, false,
                     'T07 serverreceipt is niet als commit-zichtbaar gelabeld');
  perform pg_temp.expect(v_row.quality_reasons @> array['car_unknown','track_unknown',
      'compound_unknown','historical_owner_unverified','owner_at_receipt_only',
      'driver_identity_unverified','context_incomplete','non_training_eligible',
      'as_of_unverifiable','server_receipt_precommit']::text[],
    'T07 alle context-/kwalificatie-redenen staan expliciet in de rij');
  perform pg_temp.expect(pg_column_size(v_row.payload) <= 16384,
                         'T07 payload blijft binnen 16 KiB');
  perform pg_temp.expect(v_row.payload ? 'wear_before' and v_row.payload ? 'wear_after',
                         'T07 wear is als kleine waarde bewaard');
  perform pg_temp.expect(v_row.payload #> '{evidence}' ? 'note' = false,
                         'T07 evidence.note wordt niet bewaard');
  perform pg_temp.expect(not (v_row.payload ? 'car')
                     and not (v_row.payload ? 'track')
                     and not (v_row.payload ? 'compound')
                     and not (v_row.payload ? 'driver_name')
                     and not (v_row.payload ? 'current_driver_name')
                     and not (v_row.payload ? 'raw')
                     and not (v_row.payload ? 'frames')
                     and not (v_row.payload ? 'paceHistory'),
    'T07 payload bevat geen auto/baan/compound/driver/raw/tokens');

  -- De brontabel is door de trigger niet inhoudelijk gewijzigd.
  select to_jsonb(e) into v_source_before from public.simhub_measurement_events e
   where e.device_id = (select device::text from t_ids) and e.event_uid = pg_temp.uid(10);
  select * into v_src from public.simhub_measurement_events
   where device_id = (select device::text from t_ids) and event_uid = pg_temp.uid(10);
  perform pg_temp.eq(v_src.content_hash, v_row.content_hash,
                     'T07 content_hash van bron en bewijs is gelijk');
  perform pg_temp.eq(v_src.kind, 'wear_refresh_confirmed',
                     'T07 trigger wijzigt de bronkind niet');
  perform pg_temp.eq(v_src.observed_at, '2026-11-11T16:00:00Z'::timestamptz,
                     'T07 trigger wijzigt observed_at niet');

  v_jobs_before := (select count(*) from pitwall_learning.jobs);
  perform pg_temp.eq(
    (select count(*) from pitwall_learning.jobs j
      join pitwall_learning.source_revisions r on r.id = j.source_revision_id
     where r.source_uid = pg_temp.uid(10)),
    1, 'T07 capture maakt precies één source_validate-job');

  -- -----------------------------------------------------------------------
  -- Set-based: 200 events in één ingest-statement
  -- -----------------------------------------------------------------------
  v_before := pg_temp.rev_count((select device from t_ids));
  v_jobs_before := (select count(*) from pitwall_learning.jobs);
  v_ack := pg_temp.batch(
    (select jsonb_agg(pg_temp.event(1000 + k)) from generate_series(1, 200) k), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 200,
                     'T07 batch van 200 events wordt volledig geaccepteerd');
  perform pg_temp.eq(pg_temp.rev_count((select device from t_ids)), v_before + 200,
                     'T07 batch van 200 events legt 200 bronrevisies vast');
  perform pg_temp.eq((select count(*) from pitwall_learning.jobs), v_jobs_before + 200,
                     'T07 batch van 200 events maakt 200 jobs');

  -- Policy/owner worden per rij in dezelfde set geëvalueerd; één set met een
  -- device zonder policy levert alleen de bevoegde rij op.
  perform pitwall_learning.capture_source_revisions('measurement_event', jsonb_build_array(
    jsonb_build_object('device_id', (select device::text from t_ids),
                       'source_uid', pg_temp.uid(1300), 'record_revision', 1,
                       'content_hash', md5('mixed-allowed'), 'observed_at', now(),
                       'source_received_at', now(),
                       'payload', jsonb_build_object('kind', 'pit_entry')),
    jsonb_build_object('device_id', (select device_nopolicy::text from t_ids),
                       'source_uid', pg_temp.uid(1301), 'record_revision', 1,
                       'content_hash', md5('mixed-denied'), 'observed_at', now(),
                       'source_received_at', now(),
                       'payload', jsonb_build_object('kind', 'pit_entry'))));
  perform pg_temp.eq(
    (select count(*) from pitwall_learning.source_revisions
      where source_uid in (pg_temp.uid(1300), pg_temp.uid(1301))),
    1, 'T07 set-capture past de accountpolicy per rij toe');

  -- -----------------------------------------------------------------------
  -- Duplicaat UID/revisie/hash: replay en eenzelfde-versie UPDATE
  -- -----------------------------------------------------------------------
  v_before := pg_temp.rev_count((select device from t_ids));
  v_jobs_before := (select count(*) from pitwall_learning.jobs);
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(10)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,duplicates}'), 1,
                     'T07 replay is een duplicaat-ACK');
  perform pg_temp.eq(pg_temp.rev_count((select device from t_ids)), v_before,
                     'T07 replay maakt geen tweede bronrevisie');

  update public.simhub_measurement_events
     set record_revision = record_revision, content_hash = content_hash
   where device_id = (select device::text from t_ids) and event_uid = pg_temp.uid(10);
  perform pg_temp.eq(pg_temp.rev_count((select device from t_ids)), v_before,
                     'T07 zelfde revisie+hash opnieuw zien is idempotent');
  perform pg_temp.eq((select count(*) from pitwall_learning.jobs), v_jobs_before,
                     'T07 duplicaat maakt geen tweede job');

  -- -----------------------------------------------------------------------
  -- Nieuwe revisie: oude rij blijft, nieuwe rij komt ernaast
  -- -----------------------------------------------------------------------
  update public.simhub_measurement_events
     set record_revision = 2,
         content_hash = md5('p1-rev-2'),
         wear_after = pg_temp.wear(88.0),
         received_at = now()
   where device_id = (select device::text from t_ids) and event_uid = pg_temp.uid(10);

  perform pg_temp.eq(pg_temp.rev_count((select device from t_ids)), v_before + 1,
                     'T07 nieuwe revisie voegt één rij toe');
  perform pg_temp.eq(
    (select count(*) from pitwall_learning.source_revisions
      where source_kind='measurement_event'
        and device_id=(select device::text from t_ids)
        and source_uid=pg_temp.uid(10)),
    2, 'T07 oude en nieuwe revisie staan naast elkaar');
  perform pg_temp.eq(
    (select payload #>> '{wear_after,fl}' from pitwall_learning.source_revisions
      where source_uid=pg_temp.uid(10) and record_revision=1),
    '89.5', 'T07 oude revisie-payload is niet overschreven');
  perform pg_temp.eq(
    (select payload #>> '{wear_after,fl}' from pitwall_learning.source_revisions
      where source_uid=pg_temp.uid(10) and record_revision=2),
    '88.0', 'T07 nieuwe revisie-payload is vastgelegd');

  -- Zelfde revisie, andere hash: bewijs van een revision_conflict blijft staan.
  update public.simhub_measurement_events
     set content_hash = md5('p1-rev-2-conflict')
   where device_id = (select device::text from t_ids) and event_uid = pg_temp.uid(10);

  perform pg_temp.eq(
    (select count(*) from pitwall_learning.source_revisions
      where source_uid=pg_temp.uid(10) and record_revision=2),
    2, 'T07 zelfde revisie met andere hash wordt als aparte versie bewaard');
  perform pg_temp.expect(
    (select quality_reasons @> array['source_hash_revision_conflict']::text[]
       from pitwall_learning.source_revisions
      where source_uid=pg_temp.uid(10) and record_revision=2
        and content_hash=md5('p1-rev-2-conflict')),
    'T07 hashconflict krijgt een expliciete reden');

  -- -----------------------------------------------------------------------
  -- Late levering: oude observed_at, late receipt
  -- -----------------------------------------------------------------------
  v_ack := pg_temp.batch(jsonb_build_array(
    pg_temp.event(11, jsonb_build_object(
      'observedAt', (now() - interval '10 minutes')))), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'T07 late levering wordt geaccepteerd');
  perform pg_temp.expect(
    (select quality_reasons @> array['late_delivery']::text[]
       from pitwall_learning.source_revisions
      where source_uid=pg_temp.uid(11)),
    'T07 late levering krijgt een expliciete reden');
  perform pg_temp.expect(
    (select observed_at < source_received_at
       from pitwall_learning.source_revisions where source_uid=pg_temp.uid(11)),
    'T07 observed_at en receipt blijven gescheiden');

  -- -----------------------------------------------------------------------
  -- Stale revisie die later wordt afgeleverd (directe helper)
  -- -----------------------------------------------------------------------
  perform pitwall_learning.capture_source_revision(
    'measurement_event', (select device::text from t_ids), pg_temp.uid(12),
    2, md5('p1-stale-2'), now(), now(), '{"kind":"late"}'::jsonb);
  perform pitwall_learning.capture_source_revision(
    'measurement_event', (select device::text from t_ids), pg_temp.uid(12),
    1, md5('p1-stale-1'), now(), now(), '{"kind":"late"}'::jsonb);
  perform pg_temp.expect(
    (select quality_reasons @> array['stale_revision_delivered_late']::text[]
       from pitwall_learning.source_revisions
      where source_uid=pg_temp.uid(12) and record_revision=1),
    'T07 latere levering van een oudere revisie krijgt een stale-reden');

  -- -----------------------------------------------------------------------
  -- Lap summary capture: kleine allowlist, geen driver_name
  -- -----------------------------------------------------------------------
  v_ack := pg_temp.batch(null, jsonb_build_array(pg_temp.lap(20)));
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 1,
                     'T07 rondeaggregaat wordt geaccepteerd');
  select * into v_lap from pitwall_learning.source_revisions
   where source_kind='lap_summary' and source_uid=pg_temp.uid(10020);
  perform pg_temp.expect(v_lap.id is not null, 'T07 rondeaggregaat is vastgelegd');
  perform pg_temp.eq(v_lap.source_kind, 'lap_summary', 'T07 source_kind lap_summary');
  perform pg_temp.expect(not (v_lap.payload ? 'current_driver_name')
                     and not (v_lap.payload ? 'driver_name')
                     and not (v_lap.payload ? 'note'),
    'T07 lap-payload bevat geen driver_name of note');
  perform pg_temp.expect(v_lap.payload ? 'fuel_level_integral_litre_seconds',
                         'T07 lap-payload bevat de fuel-integral');
  perform pg_temp.expect(v_lap.quality_reasons @> array['context_incomplete',
                         'non_training_eligible']::text[],
    'T07 lap is ook expliciet context-geblokkeerd');

  -- -----------------------------------------------------------------------
  -- Immutability: geen UPDATE/DELETE op bewijs
  -- -----------------------------------------------------------------------
  v_blocked := false;
  begin
    update pitwall_learning.source_revisions set payload = '{}'::jsonb
     where id = v_row.id;
  exception when others then
    v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked, 'T07 evidence-update wordt geweigerd');

  v_blocked := false;
  begin
    delete from pitwall_learning.source_revisions where id = v_row.id;
  exception when others then
    v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked, 'T07 evidence-delete wordt geweigerd');

  -- -----------------------------------------------------------------------
  -- Onbekend device: geen cast/geen capture, maar wel een geldige ACK
  -- -----------------------------------------------------------------------
  v_before := pg_temp.rev_count((select device_unknown from t_ids));
  v_ack := public.simhub_persist_measurement_batch(
    (select device_unknown from t_ids), 'sess-p1',
    jsonb_build_array(pg_temp.event(13)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
                     'T07 onbekend device: ACK blijft accepted');
  perform pg_temp.eq(pg_temp.rev_count((select device_unknown from t_ids)), v_before,
                     'T07 onbekend device: geen capture en geen UUID-castfout');

  -- -----------------------------------------------------------------------
  -- Owner-verwijdering: alleen anonimiseren, nooit bewijs verwijderen
  -- -----------------------------------------------------------------------
  v_before := (select count(*) from pitwall_learning.source_revisions
                where device_id = (select device::text from t_ids)
                  and owner_user_id = (select owner from t_ids));
  -- Er kunnen al geanonimiseerde rijen van eerdere (teruggedraaide) probes
  -- bestaan; de assertie is daarom een delta, geen absolute stand.
  v_null_before := (select count(*) from pitwall_learning.source_revisions
                     where device_id = (select device::text from t_ids)
                       and owner_user_id is null and owner_basis = 'none');
  v_text := (select payload::text from pitwall_learning.source_revisions
              where source_uid = pg_temp.uid(10) and record_revision = 1);

  delete from auth.users where id = (select owner from t_ids);

  perform pg_temp.eq(
    (select count(*) from pitwall_learning.source_revisions
      where device_id = (select device::text from t_ids)
        and owner_user_id is null and owner_basis = 'none'),
    v_null_before + v_before,
    'T07 owner-verwijdering anonimiseert alle betrokken bewijsrijen');
  perform pg_temp.eq(
    (select payload::text from pitwall_learning.source_revisions
      where source_uid = pg_temp.uid(10) and record_revision = 1),
    v_text,
    'T07 owner-verwijdering laat de bewijs-payload byte-identiek');
  perform pg_temp.eq(
    (select count(*) from pitwall_learning.source_revisions
      where source_uid = pg_temp.uid(10)),
    3,
    'T07 owner-verwijdering verwijdert geen bronrevisies');
end $$;

do $$
declare
  v_fail integer;
  v_total integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t_resultaat;
  raise notice 'pitwall-learning capture: % van % PASS', v_total - v_fail, v_total;
  if v_fail > 0 then
    raise exception 'pitwall-learning capture: % FAIL: %', v_fail,
      (select string_agg(label, '; ' order by label) from t_resultaat where not ok);
  end if;
end $$;

rollback;
