-- ============================================================================
-- T09 — dunne capture-outbox en uitgestelde materialisatie
--
-- Draai na de fixture. Alles in één transactie en aan het eind teruggedraaid.
--
-- Bewijst:
--   * één batch per owner per source-statement, geen detailrijen vóór COMMIT;
--   * 20 wire-events + 3 laps geven precies twee batchrecords en twee jobs;
--   * 200 DB-only events blijven binnen het expliciete batchbudget;
--   * de ingest-ACK blijft accepted als de outbox zelf faalt;
--   * materialisatie is begrensd, atomair en idempotent;
--   * een materialisatiejob kan niet 'done' worden zonder bewijs;
--   * policy/owner/versie worden bij materialisatie opnieuw fail-closed
--     gecontroleerd; de owner is bevroren op receipt;
--   * batches zijn immutable en bevatten geen owner-ID in de item-JSON.
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
           'segmentId', 'seg-thin',
           'pitVisitId', 'pit-thin',
           'observedSessionId', 'sess-thin',
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
           'segmentId', 'seg-thin',
           'observedSessionId', 'sess-thin',
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
           'pitVisitIds', jsonb_build_array('pit-thin'),
           'wearObservationIds', jsonb_build_array('evt-thin'),
           'coverage', pg_temp.coverage_full()) || p_extra
$$;

create or replace function pg_temp.batch(p_events jsonb, p_laps jsonb)
returns jsonb language sql as $$
  select public.simhub_persist_measurement_batch(
    'd0000000-0000-4000-8000-000000000001', 'sess-thin', p_events, p_laps)
$$;

-- Leaseer en materialiseer één batch via de echte RPC. Geen daemon.
create or replace function pg_temp.materialize_batch(p_batch uuid)
returns jsonb language plpgsql as $$
declare
  v_job uuid;
  v_token uuid;
  v_res jsonb;
begin
  select j.id into v_job
    from pitwall_learning.jobs j
   where j.capture_batch_id = p_batch
     and j.kind = 'materialize_capture_batch';
  if v_job is null then
    raise exception 'no materialize job for batch %', p_batch;
  end if;
  update pitwall_learning.jobs
     set status = 'leased',
         attempts = greatest(attempts, 1),
         lease_token = gen_random_uuid(),
         lease_owner = 'thin-test:' || pg_backend_pid(),
         lease_expires_at = now() + interval '60 seconds',
         updated_at = now(),
         finished_at = null
   where id = v_job
   returning lease_token into v_token;
  v_res := pitwall_learning.materialize_capture_batch(v_job, v_token);
  return v_res;
end $$;

do $thin$
declare
  v_start timestamptz := clock_timestamp();
  v_ack jsonb;
  v_batches_before integer;
  v_rev_before integer;
  v_jobs_before integer;
  v_ev_batch uuid;
  v_lap_batch uuid;
  v_stress_batch uuid;
  v_one_batch uuid;
  v_one_job uuid;
  v_one_token uuid;
  v_owner_a uuid := 'a0000000-0000-4000-8000-000000000001';
  v_owner_b uuid := 'a0000000-0000-4000-8000-000000000002';
  v_res jsonb;
  v_batch record;
  v_rev pitwall_learning.source_revisions%rowtype;
  v_payload_before text;
  v_payload_size integer;
  v_item_size integer;
  v_blocked boolean;
  v_count integer;
  v_text text;
begin
  -- -----------------------------------------------------------------------
  -- 1. Normale wire-vorm: 20 events + 3 laps -> 2 batches, 0 revisies
  -- -----------------------------------------------------------------------
  v_batches_before := (select count(*) from pitwall_learning.capture_batches);
  v_rev_before := (select count(*) from pitwall_learning.source_revisions);
  v_jobs_before := (select count(*) from pitwall_learning.jobs);

  v_ack := pg_temp.batch(
    (select jsonb_agg(pg_temp.event(2000 + k)) from generate_series(1, 20) k),
    (select jsonb_agg(pg_temp.lap(20 + k)) from generate_series(1, 3) k));

  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 20,
    'T09 ACK accepteert 20 wire-events');
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{laps,accepted}'), 3,
    'T09 ACK accepteert 3 rondeaggregaten');
  perform pg_temp.eq((select count(*) from pitwall_learning.capture_batches), v_batches_before + 2,
    'T09 20 events + 3 laps geven precies twee batchrecords');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions), v_rev_before,
    'T09 vóór materialisatie zijn er nul detailrevisies');
  perform pg_temp.eq((select count(*) from pitwall_learning.jobs), v_jobs_before + 2,
    'T09 vóór materialisatie zijn er precies twee materialisatiejobs');

  select id into v_ev_batch from pitwall_learning.capture_batches
   where source_kind = 'measurement_event' and received_at >= v_start
   order by received_at desc limit 1;
  select id into v_lap_batch from pitwall_learning.capture_batches
   where source_kind = 'lap_summary' and received_at >= v_start
   order by received_at desc limit 1;

  select * into v_batch from pitwall_learning.capture_batches where id = v_ev_batch;
  perform pg_temp.eq(v_batch.item_count, 20, 'T09 eventbatch bevat 20 items');
  perform pg_temp.eq(v_batch.owner_user_id, v_owner_a, 'T09 batch heeft getypeerde receipt-owner');
  perform pg_temp.eq(v_batch.owner_basis, 'device_owner_at_receipt',
    'T09 batch-owner is receipt-owner, geen latere device-eigenaar');
  perform pg_temp.eq(v_batch.account_policy_version, 1,
    'T09 batch bewaart de policyversie van receipt');
  perform pg_temp.eq(v_batch.receipt_commit_visible, false,
    'T09 batch is niet als commit-zichtbaar gelabeld');
  perform pg_temp.eq(v_batch.as_of_quality, 'as_of_unverifiable',
    'T09 batch-as-of blijft onverifieerbaar');
  perform pg_temp.eq(jsonb_array_length(v_batch.payload), 20,
    'T09 batchpayload is de compacte itemarray');
  perform pg_temp.eq((select item_count from pitwall_learning.capture_batches where id = v_lap_batch), 3,
    'T09 lapbatch bevat 3 items');

  select max(pg_column_size(x)) into v_item_size
    from pitwall_learning.capture_batches b,
         jsonb_array_elements(b.payload) x
   where b.id in (v_ev_batch, v_lap_batch);
  perform pg_temp.expect(v_item_size <= 16384, 'T09 elk batchitem blijft <= 16 KiB');
  perform pg_temp.expect((select pg_column_size(payload) from pitwall_learning.capture_batches
                           where id = v_ev_batch) <= 262144,
    'T09 eventbatch blijft <= 256 KiB');
  perform pg_temp.expect(not exists (
      select 1 from pitwall_learning.capture_batches b, jsonb_array_elements(b.payload) x
       where b.id in (v_ev_batch, v_lap_batch)
         and (x ? 'owner_user_id' or x ? 'owner' or x ? 'account_policy_version')),
    'T09 item-JSON bevat geen owner/policyveld');
  perform pg_temp.eq(position(v_owner_a::text in
      (select payload::text from pitwall_learning.capture_batches where id = v_ev_batch)), 0,
    'T09 item-JSON bevat de owner-UUID niet als tekst');
  perform pg_temp.expect(not exists (
      select 1 from pitwall_learning.capture_batches b, jsonb_array_elements(b.payload) x
       where b.id = v_ev_batch
         and ((x->'payload') ? 'note'
              or (x->'payload') ? 'current_driver_name'
              or (x->'payload') ? 'driver_name'
              or (x->'payload') ? 'frames')),
    'T09 batchpayoad bevat geen note/naam/frames');

  perform pg_temp.eq(
    (select count(*) from pitwall_learning.jobs where capture_batch_id in (v_ev_batch, v_lap_batch)
       and kind = 'materialize_capture_batch' and source_revision_id is null),
    2, 'T09 beide batches hebben exact één materialisatiejob zonder revision');

  -- -----------------------------------------------------------------------
  -- 2. DB-only stress: 200 events blijven één begrensde batch
  -- -----------------------------------------------------------------------
  v_batches_before := (select count(*) from pitwall_learning.capture_batches);
  v_ack := pg_temp.batch(
    (select jsonb_agg(pg_temp.event(3000 + k)) from generate_series(1, 200) k), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 200,
    'T09 200-event DB-batch wordt volledig geaccepteerd');

  select id into v_stress_batch from pitwall_learning.capture_batches
   where source_kind = 'measurement_event' and item_count = 200
   order by received_at desc limit 1;
  perform pg_temp.expect(v_stress_batch is not null, 'T09 200-eventbatch bestaat');
  perform pg_temp.eq((select count(*) from pitwall_learning.capture_batches), v_batches_before + 1,
    'T09 200 events geven één batchrecord');
  perform pg_temp.expect((select pg_column_size(payload) from pitwall_learning.capture_batches
                           where id = v_stress_batch) <= 262144,
    'T09 200-eventbatch blijft <= 256 KiB');

  -- -----------------------------------------------------------------------
  -- 2b. Een batch boven 256 KiB wordt geweigerd, niet in stukken geknipt
  -- -----------------------------------------------------------------------
  v_batches_before := (select count(*) from pitwall_learning.capture_batches);
  v_blocked := false;
  begin
    perform pitwall_learning.capture_source_batch('measurement_event',
      (select jsonb_agg(jsonb_build_object(
          'device_id', 'd0000000-0000-4000-8000-000000000001',
          'source_uid', pg_temp.uid(5000 + k),
          'record_revision', 1,
          'content_hash', md5('oversized-' || k),
          'observed_at', now(),
          'source_received_at', now(),
          'payload', jsonb_build_object('kind', 'oversized', 'blob', repeat('x', 16000))))
         from generate_series(1, 17) k));
  exception when others then
    v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked,
    'T09 batch boven 256 KiB wordt expliciet geweigerd');
  perform pg_temp.eq((select count(*) from pitwall_learning.capture_batches), v_batches_before,
    'T09 geweigerde oversized batch laat geen half record achter');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions
                       where source_uid between pg_temp.uid(5001) and pg_temp.uid(5017)), 0,
    'T09 geweigerde oversized batch materialiseert niets');

  -- -----------------------------------------------------------------------
  -- 3. Outboxfout mag de ingest-ACK nooit beïnvloeden
  -- -----------------------------------------------------------------------
  create or replace function pg_temp.fail_batch_insert()
  returns trigger language plpgsql as $$
  begin
    raise exception 'synthetic outbox failure';
  end $$;
  create trigger test_fail_batch_insert
    before insert on pitwall_learning.capture_batches
    for each row execute function pg_temp.fail_batch_insert();

  v_batches_before := (select count(*) from pitwall_learning.capture_batches);
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(4000)), null);
  perform pg_temp.eq(jsonb_array_length(v_ack #> '{events,accepted}'), 1,
    'T09 outboxfout: ingest-ACK blijft accepted');
  perform pg_temp.eq((select count(*) from pitwall_learning.capture_batches), v_batches_before,
    'T09 outboxfout: geen half batchrecord');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions where source_uid = pg_temp.uid(4000)),
    0, 'T09 outboxfout: geen detailrevisie');
  perform pg_temp.eq(current_setting('lock_timeout'), '0',
    'T09 outboxfout: functie-lokale lock_timeout is hersteld');

  drop trigger test_fail_batch_insert on pitwall_learning.capture_batches;
  drop function pg_temp.fail_batch_insert();

  -- -----------------------------------------------------------------------
  -- 4. Echte materialisatie: per-source insert + source_validate-job
  -- -----------------------------------------------------------------------
  v_rev_before := (select count(*) from pitwall_learning.source_revisions);
  v_jobs_before := (select count(*) from pitwall_learning.jobs);
  v_res := pg_temp.materialize_batch(v_ev_batch);
  perform pg_temp.eq(v_res->>'ok', 'true', 'T09 materialisatie-RPC is ok');
  perform pg_temp.eq(v_res->>'status', 'done', 'T09 batchjob is done na materialisatie');
  perform pg_temp.eq((v_res->>'inserted')::integer, 20,
    'T09 materialisatie voegt 20 revisies toe');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions), v_rev_before + 20,
    'T09 materialisatie voegt precies 20 detailrevisies toe');
  perform pg_temp.eq((select count(*) from pitwall_learning.jobs), v_jobs_before + 20,
    'T09 materialisatie voegt precies 20 source_validate-jobs toe');
  perform pg_temp.expect(
    (select materialized_at is not null and materialized_items = 20
       from pitwall_learning.capture_batches where id = v_ev_batch),
    'T09 batch bewaart materialisatiebewijs');
  perform pg_temp.eq(
    (select status from pitwall_learning.jobs where capture_batch_id = v_ev_batch
       and kind = 'materialize_capture_batch'), 'done',
    'T09 materialisatiejob is done');

  select * into v_rev from pitwall_learning.source_revisions
   where source_uid = pg_temp.uid(2001);
  perform pg_temp.eq(v_rev.owner_user_id, v_owner_a,
    'T09 revisie-owner is de bevroren receipt-owner');
  perform pg_temp.eq(v_rev.capture_batch_id, v_ev_batch,
    'T09 revisie verwijst naar de batch');
  perform pg_temp.eq(v_rev.account_policy_version, 1,
    'T09 revisie bewaart de batch-policyversie');
  perform pg_temp.eq(v_rev.context_status, 'blocked_missing_identity',
    'T09 revisie blijft context-geblokkeerd');
  perform pg_temp.eq(v_rev.canonical_context, null::jsonb,
    'T09 geen verzonnen canonical context');
  perform pg_temp.eq(v_rev.as_of_quality, 'as_of_unverifiable',
    'T09 revisie-as-of blijft onverifieerbaar');
  perform pg_temp.eq(v_rev.receipt_commit_visible, false,
    'T09 serverreceipt is geen commit-zichtbaarheid');
  perform pg_temp.eq(v_rev.training_eligible, false,
    'T09 P1-revisie is niet training-eligible');
  perform pg_temp.expect(v_rev.quality_reasons @> array[
      'car_unknown','track_unknown','compound_unknown','historical_owner_unverified',
      'owner_at_receipt_only','driver_identity_unverified','context_incomplete',
      'non_training_eligible','as_of_unverifiable','server_receipt_precommit']::text[],
    'T09 revisie draagt alle expliciete contextredenen');
  perform pg_temp.expect(v_rev.payload #> '{evidence}' ? 'note' = false,
    'T09 note is niet in de gematerialiseerde payload');
  perform pg_temp.expect(not (v_rev.payload ? 'current_driver_name'),
    'T09 geen driver_name in de gematerialiseerde payload');

  -- -----------------------------------------------------------------------
  -- 5. Een batchjob kan niet 'done' zonder materiaalbewijs
  -- -----------------------------------------------------------------------
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(4100)), null);
  select b.id into v_one_batch from pitwall_learning.capture_batches b
   where b.source_kind = 'measurement_event' and b.received_at >= v_start
     and exists (select 1 from jsonb_array_elements(b.payload) x
                  where (x->>'source_uid')::uuid = pg_temp.uid(4100));
  select id into v_one_job from pitwall_learning.jobs
   where capture_batch_id = v_one_batch and kind = 'materialize_capture_batch';
  update pitwall_learning.jobs
     set status = 'leased', attempts = 1, lease_token = gen_random_uuid(),
         lease_owner = 'thin-test', lease_expires_at = now() + interval '60 seconds',
         updated_at = now()
   where id = v_one_job
   returning lease_token into v_one_token;

  v_res := pitwall_learning.finish_job(v_one_job, v_one_token, 'done');
  perform pg_temp.eq(v_res->>'error', 'materialization_required',
    'T09 finish_job weigert done zonder materialisatie');
  perform pg_temp.eq((select status from pitwall_learning.jobs where id = v_one_job), 'leased',
    'T09 geweigerde done laat de lease intact');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions
                       where source_uid = pg_temp.uid(4100)), 0,
    'T09 geweigerde done materialiseert niets');
  perform pg_temp.expect((select materialized_at is null from pitwall_learning.capture_batches
                           where id = v_one_batch),
    'T09 geweigerde done laat de batch ongematerialiseerd');

  v_blocked := false;
  begin
    update pitwall_learning.jobs set status = 'done', finished_at = now()
     where id = v_one_job;
  exception when others then
    v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked,
    'T09 directe done-update zonder bewijs wordt door de trigger geweigerd');
  perform pg_temp.eq((select status from pitwall_learning.jobs where id = v_one_job), 'leased',
    'T09 directe done-update laat de job leased');

  v_res := pitwall_learning.materialize_capture_batch(v_one_job, v_one_token);
  perform pg_temp.eq(v_res->>'status', 'done', 'T09 materiaal-RPC werkt na de weigering');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions
                       where source_uid = pg_temp.uid(4100)), 1,
    'T09 materiaal-RPC materialiseert de rij alsnog');

  -- -----------------------------------------------------------------------
  -- 6. Idempotente replay: dezelfde items in een nieuwe batch
  -- -----------------------------------------------------------------------
  v_payload_before := (select payload::text from pitwall_learning.capture_batches where id = v_ev_batch);
  v_rev_before := (select count(*) from pitwall_learning.source_revisions);
  v_jobs_before := (select count(*) from pitwall_learning.jobs
                     where kind = 'source_validate');
  v_res := pitwall_learning.capture_source_batch('measurement_event', v_payload_before::jsonb);
  perform pg_temp.eq(v_res->>'items', '20', 'T09 replay-capture maakt een nieuwe batch met 20 items');
  v_one_batch := (v_res #>> '{batches,0,batch_id}')::uuid;
  v_res := pg_temp.materialize_batch(v_one_batch);
  perform pg_temp.eq((v_res->>'inserted')::integer, 0,
    'T09 replay-materialisatie voegt geen duplicate revisies toe');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions), v_rev_before,
    'T09 replay laat het aantal revisies gelijk');
  perform pg_temp.eq((select count(*) from pitwall_learning.jobs
                       where kind = 'source_validate'), v_jobs_before,
    'T09 replay voegt geen duplicate source_validate-jobs toe');
  perform pg_temp.expect((select materialized_at is not null from pitwall_learning.capture_batches
                           where id = v_one_batch),
    'T09 replay-batch krijgt materiaalbewijs');

  -- -----------------------------------------------------------------------
  -- 7. Owner bevroren op receipt; latere device-eigenaar telt niet
  -- -----------------------------------------------------------------------
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(4200)), null);
  select b.id into v_one_batch from pitwall_learning.capture_batches b
   where b.source_kind = 'measurement_event'
     and exists (select 1 from jsonb_array_elements(b.payload) x
                  where (x->>'source_uid')::uuid = pg_temp.uid(4200));
  update public.simhub_devices
     set owner_user_id = v_owner_b
   where id = 'd0000000-0000-4000-8000-000000000001';
  v_res := pg_temp.materialize_batch(v_one_batch);
  perform pg_temp.eq(
    (select owner_user_id from pitwall_learning.source_revisions where source_uid = pg_temp.uid(4200)),
    v_owner_a, 'T09 materialisatie gebruikt de receipt-owner, niet de latere device-owner');
  update public.simhub_devices
     set owner_user_id = v_owner_a
   where id = 'd0000000-0000-4000-8000-000000000001';

  -- -----------------------------------------------------------------------
  -- 8. Policy/owner fail-closed bij materialisatie
  -- -----------------------------------------------------------------------
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(4300)), null);
  select b.id into v_one_batch from pitwall_learning.capture_batches b
   where b.source_kind = 'measurement_event'
     and exists (select 1 from jsonb_array_elements(b.payload) x
                  where (x->>'source_uid')::uuid = pg_temp.uid(4300));
  select id into v_one_job from pitwall_learning.jobs
   where capture_batch_id = v_one_batch and kind = 'materialize_capture_batch';
  update pitwall_learning.jobs
     set status = 'leased', attempts = 1, lease_token = gen_random_uuid(),
         lease_owner = 'thin-test', lease_expires_at = now() + interval '60 seconds',
         updated_at = now()
   where id = v_one_job
   returning lease_token into v_one_token;

  update pitwall_learning.account_policy set capture_enabled = false
   where owner_user_id = v_owner_a;
  v_res := pitwall_learning.materialize_capture_batch(v_one_job, v_one_token);
  perform pg_temp.eq(v_res->>'error', 'policy_revoked',
    'T09 materialisatie weigert bij ingetrokken policy');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions
                       where source_uid = pg_temp.uid(4300)), 0,
    'T09 ingetrokken policy materialiseert niets');
  perform pg_temp.eq((select status from pitwall_learning.jobs where id = v_one_job), 'leased',
    'T09 ingetrokken policy laat de job niet done');

  update pitwall_learning.account_policy
     set capture_enabled = true, policy_version = policy_version + 1
   where owner_user_id = v_owner_a;
  v_res := pitwall_learning.materialize_capture_batch(v_one_job, v_one_token);
  perform pg_temp.eq(v_res->>'error', 'policy_version_mismatch',
    'T09 materialisatie weigert bij policyversiewijziging');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions
                       where source_uid = pg_temp.uid(4300)), 0,
    'T09 policyversiewijziging materialiseert niets');

  update pitwall_learning.account_policy set policy_version = 1
   where owner_user_id = v_owner_a;
  v_res := pitwall_learning.materialize_capture_batch(v_one_job, v_one_token);
  perform pg_temp.eq(v_res->>'status', 'done',
    'T09 geldige policy materialiseert de wachtende batch alsnog');

  -- -----------------------------------------------------------------------
  -- 9. Batch-immutability en privacy bij owner-verwijdering
  -- -----------------------------------------------------------------------
  v_payload_before := (select payload::text from pitwall_learning.capture_batches where id = v_ev_batch);
  v_blocked := false;
  begin
    update pitwall_learning.capture_batches set payload = '[]'::jsonb where id = v_ev_batch;
  exception when others then v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked, 'T09 batchpayload-update wordt geweigerd');

  v_blocked := false;
  begin
    delete from pitwall_learning.capture_batches where id = v_ev_batch;
  exception when others then v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked, 'T09 batch-delete wordt geweigerd');

  -- Nieuwe batch voor de owner-deletetest.
  v_ack := pg_temp.batch(jsonb_build_array(pg_temp.event(4400)), null);
  select b.id into v_one_batch from pitwall_learning.capture_batches b
   where b.source_kind = 'measurement_event'
     and exists (select 1 from jsonb_array_elements(b.payload) x
                  where (x->>'source_uid')::uuid = pg_temp.uid(4400));
  v_payload_before := (select payload::text from pitwall_learning.capture_batches where id = v_one_batch);
  select id into v_one_job from pitwall_learning.jobs
   where capture_batch_id = v_one_batch and kind = 'materialize_capture_batch';
  update pitwall_learning.jobs
     set status = 'leased', attempts = 1, lease_token = gen_random_uuid(),
         lease_owner = 'thin-test', lease_expires_at = now() + interval '60 seconds',
         updated_at = now()
   where id = v_one_job
   returning lease_token into v_one_token;

  delete from auth.users where id = v_owner_a;

  perform pg_temp.eq(
    (select owner_user_id from pitwall_learning.capture_batches where id = v_one_batch),
    null::uuid, 'T09 owner-verwijdering anonimiseert de batch-owner');
  perform pg_temp.eq(
    (select owner_basis from pitwall_learning.capture_batches where id = v_one_batch),
    'none', 'T09 geanonimiseerde batch heeft owner_basis none');
  perform pg_temp.eq(
    (select payload::text from pitwall_learning.capture_batches where id = v_one_batch),
    v_payload_before, 'T09 owner-verwijdering laat de batchpayload byte-identiek');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions
                       where source_uid = pg_temp.uid(4400)), 0,
    'T09 owner-verwijdering vóór materialisatie levert geen revisie');

  v_res := pitwall_learning.materialize_capture_batch(v_one_job, v_one_token);
  perform pg_temp.eq(v_res->>'error', 'owner_missing',
    'T09 materialisatie weigert na owner-verwijdering');
  perform pg_temp.eq((select count(*) from pitwall_learning.source_revisions
                       where source_uid = pg_temp.uid(4400)), 0,
    'T09 owner-verwijdering materialiseert niets');
  perform pg_temp.eq((select status from pitwall_learning.jobs where id = v_one_job), 'leased',
    'T09 owner-verwijdering laat de job niet done');
end $thin$;

do $$
declare
  v_fail integer;
  v_total integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t_resultaat;
  raise notice 'pitwall-learning thin-outbox: % van % PASS', v_total - v_fail, v_total;
  if v_fail > 0 then
    raise exception 'pitwall-learning thin-outbox: % FAIL: %', v_fail,
      (select string_agg(label, '; ' order by label) from t_resultaat where not ok);
  end if;
end $$;

rollback;
