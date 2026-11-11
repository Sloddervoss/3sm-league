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
  update pitwall_learning.jobs
     set status = 'done',
         lease_token = null,
         lease_owner = null,
         lease_expires_at = null,
         finished_at = coalesce(finished_at, now()),
         updated_at = now()
   where status <> 'done';

  perform pitwall_learning.capture_source_revision(
    'measurement_event', v_dev, pg_temp.uid(100), 1, md5('job-100'),
    now(), now(), '{"kind":"job"}'::jsonb);
  perform pitwall_learning.capture_source_revision(
    'measurement_event', v_dev, pg_temp.uid(101), 1, md5('job-101'),
    now(), now(), '{"kind":"job"}'::jsonb);
  perform pitwall_learning.capture_source_revision(
    'measurement_event', v_dev, pg_temp.uid(102), 1, md5('job-102'),
    now(), now(), '{"kind":"job"}'::jsonb);

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
