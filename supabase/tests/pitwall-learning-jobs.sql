-- ============================================================================
-- T08 — begrensde jobleases: SKIP LOCKED, token, expiry, backoff, dead-letter
--
-- Draai na de fixture. Alles in één transactie en aan het eind teruggedraaid.
-- De echte twee-connectietest en crashreclaim staan in
-- scripts/pitwall-learning/rehearse-p1.py (aparte processen).
-- ============================================================================

begin;

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

create or replace function pg_temp.materialize_batch(p_batch uuid)
returns jsonb language plpgsql as $$
declare
  v_job uuid;
  v_token uuid;
  v_res jsonb;
begin
  select id into v_job from pitwall_learning.jobs
   where capture_batch_id = p_batch and kind = 'materialize_capture_batch';
  if v_job is null then raise exception 'no materialize job for batch %', p_batch; end if;
  update pitwall_learning.jobs
     set status = 'leased', attempts = greatest(attempts, 1),
         lease_token = gen_random_uuid(), lease_owner = 'jobs-test',
         lease_expires_at = now() + interval '60 seconds',
         updated_at = now(), finished_at = null
   where id = v_job
   returning lease_token into v_token;
  v_res := pitwall_learning.materialize_capture_batch(v_job, v_token);
  if v_res->>'status' is distinct from 'done' then
    raise exception 'materialize failed: %', v_res;
  end if;
  return v_res;
end $$;

create or replace function pg_temp.materialize_pending()
returns integer language plpgsql as $$
declare
  v_batch uuid;
  v_count integer := 0;
begin
  for v_batch in select id from pitwall_learning.capture_batches where materialized_at is null loop
    perform pg_temp.materialize_batch(v_batch);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function pg_temp.capture_one(
  p_device text, p_uid uuid, p_rev integer, p_hash text, p_payload jsonb)
returns uuid language plpgsql as $$
declare
  v_res jsonb;
  v_batch uuid;
  v_id uuid;
begin
  v_res := pitwall_learning.capture_source_batch('measurement_event', jsonb_build_array(
    jsonb_build_object('device_id', p_device, 'source_uid', p_uid,
                       'record_revision', p_rev, 'content_hash', p_hash,
                       'observed_at', now(), 'source_received_at', now(),
                       'payload', p_payload)));
  if jsonb_array_length(v_res->'batches') = 0 then
    return null;
  end if;
  v_batch := (v_res #>> '{batches,0,batch_id}')::uuid;
  perform pg_temp.materialize_batch(v_batch);
  select id into v_id from pitwall_learning.source_revisions
   where source_kind = 'measurement_event' and device_id = p_device
     and source_uid = p_uid and record_revision = p_rev and content_hash = p_hash;
  return v_id;
end $$;

create or replace function pg_temp.capture_many(p_base integer, p_count integer)
returns void language plpgsql as $$
declare
  v_rows jsonb;
  v_res jsonb;
  v_batch uuid;
begin
  select jsonb_agg(jsonb_build_object(
           'device_id', 'd0000000-0000-4000-8000-000000000001',
           'source_uid', pg_temp.uid(p_base + k),
           'record_revision', 1,
           'content_hash', md5('job-' || (p_base + k)),
           'observed_at', now(),
           'source_received_at', now(),
           'payload', jsonb_build_object('kind', 'job')))
    into v_rows
    from generate_series(1, p_count) k;
  v_res := pitwall_learning.capture_source_batch('measurement_event', v_rows);
  v_batch := (v_res #>> '{batches,0,batch_id}')::uuid;
  perform pg_temp.materialize_batch(v_batch);
end $$;

-- Ruim achtergebleven jobs van eerdere probes op zonder een batchjob
-- onterecht als done te markeren.
create or replace function pg_temp.quiesce_jobs()
returns void language plpgsql as $$
begin
  update pitwall_learning.jobs
     set status = 'done',
         lease_token = null, lease_owner = null, lease_expires_at = null,
         finished_at = coalesce(finished_at, now()),
         updated_at = now()
   where status <> 'done'
     and kind in ('source_validate', 'example_build');
  update pitwall_learning.jobs
     set status = 'dead',
         lease_token = null, lease_owner = null, lease_expires_at = null,
         last_error_code = coalesce(last_error_code, 'harness_quiesce'),
         finished_at = coalesce(finished_at, now()),
         updated_at = now()
   where status <> 'done'
     and kind = 'materialize_capture_batch';
end $$;

do $$
declare
  v_dev text := 'd0000000-0000-4000-8000-000000000001';
  v_rev uuid;
  v_rev2 uuid;
  v_rev3 uuid;
  v_job uuid;
  v_job2 uuid;
  v_job3 uuid;
  v_claim jsonb;
  v_claim2 jsonb;
  v_token uuid;
  v_token2 uuid;
  v_res jsonb;
  v_attempts integer;
  v_next timestamptz;
  v_after timestamptz;
  v_delta numeric;
  v_count integer;
  v_blocked boolean;
begin
  -- Isoleer van eerder test-/fixturewerk in deze transactie.
  perform pg_temp.quiesce_jobs();

  perform pg_temp.capture_one(
    v_dev, pg_temp.uid(100), 1, md5('job-100'), '{"kind":"job"}'::jsonb);
  perform pg_temp.capture_one(
    v_dev, pg_temp.uid(101), 1, md5('job-101'), '{"kind":"job"}'::jsonb);
  perform pg_temp.capture_one(
    v_dev, pg_temp.uid(102), 1, md5('job-102'), '{"kind":"job"}'::jsonb);

  select id into v_rev from pitwall_learning.source_revisions
   where source_uid = pg_temp.uid(100);
  select id into v_rev2 from pitwall_learning.source_revisions
   where source_uid = pg_temp.uid(101);
  select id into v_rev3 from pitwall_learning.source_revisions
   where source_uid = pg_temp.uid(102);
  perform pg_temp.expect(v_rev is not null and v_rev2 is not null and v_rev3 is not null,
                         'T08 testrevisies bestaan');

  -- De automatische source_validate-jobs zijn hier niet het onderwerp.
  update pitwall_learning.jobs
     set status = 'done', finished_at = now(), updated_at = now()
   where kind = 'source_validate'
     and source_revision_id in (v_rev, v_rev2, v_rev3);

  -- Automatische source_validate-job is één per revisie.
  perform pg_temp.eq(
    (select count(*) from pitwall_learning.jobs where source_revision_id = v_rev),
    1, 'T08 capture maakt één source_validate-job per revisie');

  -- -----------------------------------------------------------------------
  -- Unique job per (revision, kind)
  -- -----------------------------------------------------------------------
  v_job := pitwall_learning.enqueue_job(v_rev, 'example_build');
  perform pg_temp.eq(
    (select count(*) from pitwall_learning.jobs
      where source_revision_id = v_rev and kind = 'example_build'),
    1, 'T08 example_build-job bestaat één keer');
  perform pg_temp.eq(pitwall_learning.enqueue_job(v_rev, 'example_build'), v_job,
                     'T08 enqueue is idempotent op (revision, kind)');

  -- -----------------------------------------------------------------------
  -- Claim: poging 1, lease en token
  -- -----------------------------------------------------------------------
  v_claim := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(jsonb_array_length(v_claim), 1, 'T08 eerste claim levert één job');
  perform pg_temp.eq(v_claim->0->>'job_id', v_job::text, 'T08 claim pakt de juiste job');
  perform pg_temp.eq(v_claim->0->>'attempts', '1', 'T08 claim verhoogt attempts naar 1');
  v_token := (v_claim->0->>'lease_token')::uuid;
  perform pg_temp.expect(v_token is not null, 'T08 claim geeft een lease-token');
  perform pg_temp.expect((v_claim->0->>'lease_expires_at')::timestamptz > now(),
                         'T08 lease heeft een toekomstige expiry');

  v_claim2 := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(jsonb_array_length(v_claim2), 0,
                     'T08 tweede claim ziet geen tweede vrije job');

  -- Verkeerd token wordt geweigerd.
  v_res := pitwall_learning.finish_job(v_job, gen_random_uuid(), 'done');
  perform pg_temp.eq(v_res->>'error', 'lease_mismatch',
                     'T08 finish met verkeerd token is lease_mismatch');

  -- Correct token -> done.
  v_res := pitwall_learning.finish_job(v_job, v_token, 'done');
  perform pg_temp.eq(v_res->>'status', 'done', 'T08 finish done lukt met het juiste token');
  v_res := pitwall_learning.finish_job(v_job, v_token, 'done');
  perform pg_temp.eq(v_res->>'error', 'not_leased',
                     'T08 tweede finish op dezelfde job is not_leased');

  -- -----------------------------------------------------------------------
  -- Retry/backoff en dead-letter na drie pogingen
  -- -----------------------------------------------------------------------
  v_job2 := pitwall_learning.enqueue_job(v_rev2, 'example_build');
  v_claim := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(v_claim->0->>'job_id', v_job2::text, 'T08 tweede job wordt geclaimd');
  v_token := (v_claim->0->>'lease_token')::uuid;
  v_res := pitwall_learning.finish_job(v_job2, v_token, 'retry', 'worker_timeout');
  perform pg_temp.eq(v_res->>'status', 'pending', 'T08 retry gaat terug naar pending');
  perform pg_temp.eq(v_res->>'attempts', '1', 'T08 retry bewaart poging 1');
  v_next := (v_res->>'next_attempt_at')::timestamptz;
  v_delta := extract(epoch from (v_next - now()));
  perform pg_temp.expect(v_delta between 4 and 6,
                         'T08 eerste backoff is ongeveer 5 seconden');

  v_claim := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(jsonb_array_length(v_claim), 0,
                     'T08 job met toekomstige next_attempt is niet claimbaar');

  update pitwall_learning.jobs set next_attempt_at = now() - interval '1 second'
   where id = v_job2;
  v_claim := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(v_claim->0->>'attempts', '2', 'T08 tweede poging na backoff');
  v_token := (v_claim->0->>'lease_token')::uuid;
  v_res := pitwall_learning.finish_job(v_job2, v_token, 'retry', 'worker_timeout');
  v_delta := extract(epoch from ((v_res->>'next_attempt_at')::timestamptz - now()));
  perform pg_temp.expect(v_delta between 9 and 11,
                         'T08 tweede backoff is ongeveer 10 seconden');

  update pitwall_learning.jobs set next_attempt_at = now() - interval '1 second'
   where id = v_job2;
  v_claim := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(v_claim->0->>'attempts', '3', 'T08 derde poging na backoff');
  v_token := (v_claim->0->>'lease_token')::uuid;
  v_res := pitwall_learning.finish_job(v_job2, v_token, 'retry', 'worker_timeout');
  perform pg_temp.eq(v_res->>'status', 'dead',
                     'T08 derde mislukking gaat naar dead-letter');
  perform pg_temp.eq(v_res->>'error_code', 'worker_timeout',
                     'T08 dead-letter bewaart de foutcode');

  v_claim := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(jsonb_array_length(v_claim), 0,
                     'T08 dode job wordt nooit meer geclaimd');

  -- -----------------------------------------------------------------------
  -- Lease-expiry en crashreclaim (simulatie in één sessie)
  -- -----------------------------------------------------------------------
  v_job3 := pitwall_learning.enqueue_job(v_rev3, 'example_build');
  v_claim := pitwall_learning.claim_jobs(1, 5);
  perform pg_temp.eq(v_claim->0->>'job_id', v_job3::text, 'T08 derde job geclaimd');
  v_token := (v_claim->0->>'lease_token')::uuid;
  v_attempts := (v_claim->0->>'attempts')::integer;

  -- Correct token, maar lease is verlopen: geen finish meer.
  update pitwall_learning.jobs set lease_expires_at = now() - interval '1 second'
   where id = v_job3;
  v_res := pitwall_learning.finish_job(v_job3, v_token, 'done');
  perform pg_temp.eq(v_res->>'error', 'lease_expired',
                     'T08 finish na expiry is lease_expired');

  -- Een andere werker kan de verlopen lease opnieuw claimen.
  v_claim2 := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(v_claim2->0->>'job_id', v_job3::text,
                     'T08 verlopen lease wordt opnieuw geclaimd');
  perform pg_temp.eq(v_claim2->0->>'attempts', (v_attempts + 1)::text,
                     'T08 reclaim verhoogt attempts');
  v_token2 := (v_claim2->0->>'lease_token')::uuid;
  perform pg_temp.expect(v_token2 is distinct from v_token,
                         'T08 reclaim geeft een nieuw token');
  v_res := pitwall_learning.finish_job(v_job3, v_token, 'done');
  perform pg_temp.eq(v_res->>'error', 'lease_mismatch',
                     'T08 oude token kan de reclaim niet finishen');
  v_res := pitwall_learning.finish_job(v_job3, v_token2, 'done');
  perform pg_temp.eq(v_res->>'status', 'done', 'T08 nieuwe token kan wel finishen');

  -- -----------------------------------------------------------------------
  -- Kill switch: worker uit betekent geen claims
  -- -----------------------------------------------------------------------
  update pitwall_learning.runtime_settings set worker_enabled = false where id = 1;
  v_claim := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(jsonb_array_length(v_claim), 0,
                     'T08 worker_enabled=false blokkeert claims');
  update pitwall_learning.runtime_settings set worker_enabled = true where id = 1;

  -- -----------------------------------------------------------------------
  -- Ongeldige argumenten en foutcodes
  -- -----------------------------------------------------------------------
  v_blocked := false;
  begin
    perform pitwall_learning.claim_jobs(0, 30);
  exception when others then v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked, 'T08 claim_limit 0 wordt geweigerd');

  v_blocked := false;
  begin
    perform pitwall_learning.finish_job(v_job3, v_token2, 'bogus');
  exception when others then v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked, 'T08 ongeldige outcome wordt geweigerd');

  v_blocked := false;
  begin
    perform pitwall_learning.finish_job(v_job3, v_token2, 'retry', 'Bad Code!');
  exception when others then v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked, 'T08 ongeldige foutcode wordt geweigerd');
end $$;

-- ---------------------------------------------------------------------------
-- Regressies uit de bounded-review: NULL-outcome, beleidsgebonden claim en
-- een begrensde dead-letter-sweep. Zelfde transactie en rollback.
-- ---------------------------------------------------------------------------
do $$
declare
  v_dev text := 'd0000000-0000-4000-8000-000000000001';
  v_owner uuid := 'a0000000-0000-4000-8000-000000000001';
  v_rev uuid;
  v_job uuid;
  v_claim jsonb;
  v_token uuid;
  v_blocked boolean;
  v_dead integer;
  k integer;
begin
  perform pg_temp.quiesce_jobs();

  -- -----------------------------------------------------------------------
  -- NULL is geen retry
  -- -----------------------------------------------------------------------
  perform pg_temp.capture_one(
    v_dev, pg_temp.uid(400), 1, md5('job-400'), '{"kind":"job"}'::jsonb);
  select id into v_rev from pitwall_learning.source_revisions where source_uid = pg_temp.uid(400);
  select id into v_job from pitwall_learning.jobs where source_revision_id = v_rev;
  v_claim := pitwall_learning.claim_jobs(1, 30);
  v_token := (v_claim->0->>'lease_token')::uuid;

  v_blocked := false;
  begin
    perform pitwall_learning.finish_job(v_job, v_token, NULL);
  exception when others then
    v_blocked := true;
  end;
  perform pg_temp.expect(v_blocked,
    'T08 finish_job met NULL-outcome wordt expliciet geweigerd');
  perform pg_temp.eq((select status from pitwall_learning.jobs where id = v_job),
                     'leased', 'T08 NULL-outcome laat de lease ongemoeid');
  perform pitwall_learning.finish_job(v_job, v_token, 'done');

  -- -----------------------------------------------------------------------
  -- Ingetrokken policy / gewijzigde policyversie / verwijderde owner
  -- -----------------------------------------------------------------------
  perform pg_temp.capture_one(
    v_dev, pg_temp.uid(401), 1, md5('job-401'), '{"kind":"job"}'::jsonb);
  select id into v_rev from pitwall_learning.source_revisions where source_uid = pg_temp.uid(401);

  update pitwall_learning.account_policy set capture_enabled = false
   where owner_user_id = v_owner;
  perform pg_temp.eq(jsonb_array_length(pitwall_learning.claim_jobs(5, 30)), 0,
    'T08 ingetrokken capturepolicy maakt de job niet claimbaar');

  update pitwall_learning.account_policy
     set capture_enabled = true, policy_version = policy_version + 1
   where owner_user_id = v_owner;
  perform pg_temp.eq(jsonb_array_length(pitwall_learning.claim_jobs(5, 30)), 0,
    'T08 gewijzigde policyversie maakt de oude job niet claimbaar');

  update pitwall_learning.account_policy set policy_version = 1
   where owner_user_id = v_owner;
  v_claim := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(v_claim->0->>'source_revision_id', v_rev::text,
    'T08 geldige policy maakt de job weer claimbaar');
  perform pitwall_learning.finish_job(
    (v_claim->0->>'job_id')::uuid, (v_claim->0->>'lease_token')::uuid, 'done');

  -- -----------------------------------------------------------------------
  -- Dead-letter-sweep is begrensd op 50 per claim
  -- -----------------------------------------------------------------------
  perform pg_temp.quiesce_jobs();

  perform pg_temp.capture_many(500, 60);
  update pitwall_learning.jobs j
     set status = 'pending', attempts = 3, next_attempt_at = now() - interval '1 minute',
         finished_at = null, updated_at = now()
   where j.source_revision_id in (
     select r.id from pitwall_learning.source_revisions r
      where r.source_uid in (select pg_temp.uid(500 + g) from generate_series(1, 60) g));

  perform pg_temp.capture_one(
    v_dev, pg_temp.uid(499), 1, md5('job-499'), '{"kind":"job"}'::jsonb);

  v_claim := pitwall_learning.claim_jobs(1, 30);
  select count(*) into v_dead from pitwall_learning.jobs
   where status = 'dead'
     and source_revision_id in (
       select r.id from pitwall_learning.source_revisions r
        where r.source_uid in (select pg_temp.uid(500 + g) from generate_series(1, 60) g));
  perform pg_temp.eq(v_dead, 50,
    'T08 dead-letter-sweep verwerkt per claim maximaal 50 rijen');
  perform pg_temp.eq(v_claim->0->>'source_revision_id',
    (select id::text from pitwall_learning.source_revisions where source_uid = pg_temp.uid(499)),
    'T08 begrensde sweep blokkeert of vertekent een gezonde claim niet');

  v_claim := pitwall_learning.claim_jobs(1, 30);
  perform pg_temp.eq(jsonb_array_length(v_claim), 0,
    'T08 tweede sweep ruimt de rest op en claimt niets extra');

  -- -----------------------------------------------------------------------
  -- Verwijderde owner: bewijs blijft, job wordt niet meer geclaimd
  -- -----------------------------------------------------------------------
  perform pg_temp.quiesce_jobs();
  perform pg_temp.capture_one(
    v_dev, pg_temp.uid(402), 1, md5('job-402'), '{"kind":"job"}'::jsonb);

  delete from auth.users where id = v_owner;
  perform pg_temp.eq(jsonb_array_length(pitwall_learning.claim_jobs(5, 30)), 0,
    'T08 verwijderde owner maakt de job niet claimbaar');
  perform pg_temp.expect(
    (select owner_user_id is null from pitwall_learning.source_revisions
      where source_uid = pg_temp.uid(402)),
    'T08 verwijderde owner laat het bewijs geanonimiseerd bestaan');
end $$;

-- ---------------------------------------------------------------------------
-- F2: ieder finishresultaat (done én retry) moet de actuele owner, policy en
-- policyversie opnieuw controleren. Deze blokken zijn eerst Rood op de oude
-- done-only gate en daarna groen op dezelfde gate voor retry.
-- ---------------------------------------------------------------------------
do $$
declare
  v_dev text := 'd0000000-0000-4000-8000-000000000009';
  v_owner uuid := 'a0000000-0000-4000-8000-000000000009';
  v_rev uuid;
  v_job uuid;
  v_token uuid;
  v_claim jsonb;
  v_res jsonb;
begin
  perform pg_temp.quiesce_jobs();

  insert into auth.users (id, email, aud, role, is_sso_user)
  values (v_owner, 'p1-retry-gate@example.invalid', 'authenticated', 'authenticated', false)
  on conflict (id) do nothing;

  insert into public.simhub_devices (
    id, owner_user_id, token_hash, device_name, connector_id, device_status)
  values (v_dev::uuid, v_owner, repeat('c', 64), 'P1-RETRY-GATE',
          'P1-RETRY-GATE', 'active_unbound')
  on conflict (id) do update set owner_user_id = excluded.owner_user_id;

  insert into pitwall_learning.account_policy (
    owner_user_id, capture_enabled, personal_fit_enabled,
    retention_jobs_days, retention_source_days, retention_forecast_days)
  values (v_owner, true, true, 7, 180, 90)
  on conflict (owner_user_id) do update
    set capture_enabled = true, policy_version = 1;

  update pitwall_learning.runtime_settings
     set worker_enabled = true, capture_enabled = true where id = 1;

  -- 1. Retry en done na een ingetrokken capturepolicy.
  v_rev := pg_temp.capture_one(
    v_dev, pg_temp.uid(901), 1, md5('retry-901'), '{"kind":"job"}'::jsonb);
  v_claim := pitwall_learning.claim_jobs(1, 30);
  v_job := (v_claim->0->>'job_id')::uuid;
  v_token := (v_claim->0->>'lease_token')::uuid;
  update pitwall_learning.account_policy set capture_enabled = false
   where owner_user_id = v_owner;
  v_res := pitwall_learning.finish_job(v_job, v_token, 'retry', 'probe_retry');
  perform pg_temp.eq(v_res->>'error', 'policy_revoked',
    'T08 retry na policy-revoke is policy_revoked');
  v_res := pitwall_learning.finish_job(v_job, v_token, 'done');
  perform pg_temp.eq(v_res->>'error', 'policy_revoked',
    'T08 done na policy-revoke blijft policy_revoked');
  update pitwall_learning.account_policy set capture_enabled = true
   where owner_user_id = v_owner;
  v_res := pitwall_learning.finish_job(v_job, v_token, 'done');
  perform pg_temp.eq(v_res->>'status', 'done',
    'T08 herstelde policy laat dezelfde lease alsnog done gaan');

  -- 2. Retry na een gewijzigde policyversie.
  v_rev := pg_temp.capture_one(
    v_dev, pg_temp.uid(902), 1, md5('retry-902'), '{"kind":"job"}'::jsonb);
  v_claim := pitwall_learning.claim_jobs(1, 30);
  v_job := (v_claim->0->>'job_id')::uuid;
  v_token := (v_claim->0->>'lease_token')::uuid;
  update pitwall_learning.account_policy
     set policy_version = policy_version + 1 where owner_user_id = v_owner;
  v_res := pitwall_learning.finish_job(v_job, v_token, 'retry', 'probe_retry');
  perform pg_temp.eq(v_res->>'error', 'policy_version_mismatch',
    'T08 retry na policyversiewijziging is policy_version_mismatch');
  update pitwall_learning.account_policy set policy_version = 1
   where owner_user_id = v_owner;
  v_res := pitwall_learning.finish_job(v_job, v_token, 'done');
  perform pg_temp.eq(v_res->>'status', 'done',
    'T08 gelijke policyversie laat dezelfde lease weer done gaan');

  -- 3. Retry na de worker-kill-switch.
  v_rev := pg_temp.capture_one(
    v_dev, pg_temp.uid(903), 1, md5('retry-903'), '{"kind":"job"}'::jsonb);
  v_claim := pitwall_learning.claim_jobs(1, 30);
  v_job := (v_claim->0->>'job_id')::uuid;
  v_token := (v_claim->0->>'lease_token')::uuid;
  update pitwall_learning.runtime_settings set worker_enabled = false where id = 1;
  v_res := pitwall_learning.finish_job(v_job, v_token, 'retry', 'probe_retry');
  perform pg_temp.eq(v_res->>'error', 'worker_disabled',
    'T08 retry na workerflag-uit is worker_disabled');
  update pitwall_learning.runtime_settings set worker_enabled = true where id = 1;
  v_res := pitwall_learning.finish_job(v_job, v_token, 'done');
  perform pg_temp.eq(v_res->>'status', 'done',
    'T08 workerflag aan laat dezelfde lease weer done gaan');

  -- 4. Retry en done na verwijdering van de owner (policy cascade).
  v_rev := pg_temp.capture_one(
    v_dev, pg_temp.uid(904), 1, md5('retry-904'), '{"kind":"job"}'::jsonb);
  v_claim := pitwall_learning.claim_jobs(1, 30);
  v_job := (v_claim->0->>'job_id')::uuid;
  v_token := (v_claim->0->>'lease_token')::uuid;
  delete from auth.users where id = v_owner;
  v_res := pitwall_learning.finish_job(v_job, v_token, 'retry', 'probe_retry');
  perform pg_temp.eq(v_res->>'error', 'owner_missing',
    'T08 retry na owner-delete is owner_missing');
  v_res := pitwall_learning.finish_job(v_job, v_token, 'done');
  perform pg_temp.eq(v_res->>'error', 'owner_missing',
    'T08 done na owner-delete blijft owner_missing');
  perform pg_temp.eq((select status from pitwall_learning.jobs where id = v_job),
                     'leased', 'T08 geweigerde retry laat lease/state intact');
end $$;

do $$
declare
  v_fail integer;
  v_total integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t_resultaat;
  raise notice 'pitwall-learning jobs: % van % PASS', v_total - v_fail, v_total;
  if v_fail > 0 then
    raise exception 'pitwall-learning jobs: % FAIL: %', v_fail,
      (select string_agg(label, '; ' order by label) from t_resultaat where not ok);
  end if;
end $$;

rollback;
