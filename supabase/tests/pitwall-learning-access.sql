-- ============================================================================
-- T06/T08 — toegangsprobe: anon, authenticated, service_role en worker
--
-- Draai na de fixture. Alles in één transactie en aan het eind teruggedraaid.
-- De probes draaien echt onder SET LOCAL ROLE, niet alleen op has_*_privilege.
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

create or replace function pg_temp.expect_denied(p_role text, p_sql text, p_label text)
returns void language plpgsql as $$
declare
  v_ok boolean := false;
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    v_ok := true;
  exception when insufficient_privilege then
    v_ok := false;
  end;
  execute 'reset role';
  perform pg_temp.expect(not v_ok, p_label);
end $$;

create or replace function pg_temp.expect_allowed(p_role text, p_sql text, p_label text)
returns void language plpgsql as $$
declare
  v_ok boolean := false;
  v_err text;
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    v_ok := true;
  exception when others then
    v_err := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  if not v_ok then
    perform pg_temp.expect(false, p_label || ' [' || coalesce(v_err, '?') || ']');
  else
    perform pg_temp.expect(true, p_label);
  end if;
end $$;

create or replace function pg_temp.materialize_batch(p_batch uuid)
returns jsonb language plpgsql as $$
declare
  v_job uuid;
  v_token uuid;
  v_res jsonb;
begin
  select id into v_job from pitwall_learning.jobs
   where capture_batch_id = p_batch and kind = 'materialize_capture_batch';
  update pitwall_learning.jobs
     set status = 'leased', attempts = greatest(attempts, 1),
         lease_token = gen_random_uuid(), lease_owner = 'access-test',
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

do $$
declare
  v_rev uuid;
  v_out jsonb;
  v_count integer;
begin
  v_rev := pg_temp.capture_one(
    'd0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000777', 1, md5('access-probe'),
    '{"kind":"access"}'::jsonb);
  perform pg_temp.expect(v_rev is not null, 'T08 access-testrevisie bestaat');

  -- -----------------------------------------------------------------------
  -- anon
  -- -----------------------------------------------------------------------
  perform pg_temp.expect_denied('anon',
    'select count(*) from pitwall_learning.source_revisions',
    'T06 anon kan source_revisions niet lezen');
  perform pg_temp.expect_denied('anon',
    'insert into pitwall_learning.source_revisions (source_kind, device_id, source_uid, record_revision, content_hash, source_received_at, payload, quality_reasons) values (''measurement_event'',''x'',''00000000-0000-4000-8000-000000000001'',1,md5(''x''),now(),''{}'',''{non_training_eligible}'')',
    'T06 anon kan geen evidence schrijven');
  perform pg_temp.expect_denied('anon',
    'truncate pitwall_learning.source_revisions',
    'T06 anon kan evidence niet truncaten');
  perform pg_temp.expect_denied('anon',
    'select pitwall_learning.claim_jobs(1,30)',
    'T06 anon kan claim_jobs niet uitvoeren');

  -- -----------------------------------------------------------------------
  -- authenticated
  -- -----------------------------------------------------------------------
  perform pg_temp.expect_denied('authenticated',
    'select count(*) from pitwall_learning.jobs',
    'T06 authenticated kan jobs niet lezen');
  perform pg_temp.expect_denied('authenticated',
    'update pitwall_learning.runtime_settings set capture_enabled = true',
    'T06 authenticated kan kill switches niet wijzigen');
  perform pg_temp.expect_denied('authenticated',
    'truncate pitwall_learning.jobs',
    'T06 authenticated kan jobs niet truncaten');
  perform pg_temp.expect_denied('authenticated',
    'select pitwall_learning.claim_jobs(1,30)',
    'T06 authenticated kan claim_jobs niet uitvoeren');

  -- -----------------------------------------------------------------------
  -- service_role (applicatie-backend, geen learningtoegang)
  -- -----------------------------------------------------------------------
  perform pg_temp.expect_denied('service_role',
    'select count(*) from pitwall_learning.source_revisions',
    'T06 service_role kan evidence niet lezen');
  perform pg_temp.expect_denied('service_role',
    'select count(*) from pitwall_learning.jobs',
    'T06 service_role kan jobs niet lezen');
  perform pg_temp.expect_denied('service_role',
    'truncate pitwall_learning.source_revisions',
    'T06 service_role kan evidence niet truncaten');
  perform pg_temp.expect_denied('service_role',
    'select pitwall_learning.claim_jobs(1,30)',
    'T06 service_role kan claim_jobs niet uitvoeren');

  -- -----------------------------------------------------------------------
  -- worker: alleen schema-USAGE en vier functies
  -- -----------------------------------------------------------------------
  perform pg_temp.expect_denied('pitwall_learning_worker',
    'select count(*) from pitwall_learning.source_revisions',
    'T08 worker heeft geen directe SELECT op evidence');
  perform pg_temp.expect_denied('pitwall_learning_worker',
    'select count(*) from pitwall_learning.capture_batches',
    'T08 worker heeft geen directe SELECT op batches');
  perform pg_temp.expect_denied('pitwall_learning_worker',
    'select count(*) from pitwall_learning.jobs',
    'T08 worker heeft geen directe SELECT op jobs');
  perform pg_temp.expect_denied('pitwall_learning_worker',
    'insert into pitwall_learning.jobs (source_revision_id, kind) values (''00000000-0000-4000-8000-000000000777'',''source_validate'')',
    'T08 worker kan geen jobs invoegen');
  perform pg_temp.expect_denied('pitwall_learning_worker',
    'update pitwall_learning.runtime_settings set worker_enabled = false',
    'T08 worker kan kill switches niet wijzigen');
  perform pg_temp.expect_denied('pitwall_learning_worker',
    'update pitwall_learning.account_policy set capture_enabled = false',
    'T08 worker kan accountbeleid niet wijzigen');
  perform pg_temp.expect_denied('pitwall_learning_worker',
    'truncate pitwall_learning.source_revisions',
    'T08 worker kan evidence niet truncaten');
  perform pg_temp.expect_denied('pitwall_learning_worker',
    'select pitwall_learning.enqueue_job(''00000000-0000-4000-8000-000000000777'',''example_build'')',
    'T08 worker kan geen jobs enqueuen');
  perform pg_temp.expect_denied('pitwall_learning_worker',
    'select pitwall_learning.capture_source_batch(''measurement_event'',''[]''::jsonb)',
    'T08 worker kan de capture-helper niet aanroepen');

  perform pg_temp.expect_allowed('pitwall_learning_worker',
    'select pitwall_learning.claim_jobs(1,30)',
    'T08 worker mag claim_jobs uitvoeren');
  perform pg_temp.expect_allowed('pitwall_learning_worker',
    format('select pitwall_learning.worker_get_revision(%L::uuid)', v_rev::text),
    'T08 worker mag een revision via de bronfunctie lezen');
  perform pg_temp.expect_allowed('pitwall_learning_worker',
    'select pitwall_learning.finish_job(''00000000-0000-4000-8000-000000000000''::uuid, ''00000000-0000-4000-8000-000000000001''::uuid, ''done'')',
    'T08 worker mag finish_job uitvoeren');
  perform pg_temp.expect_allowed('pitwall_learning_worker',
    'select pitwall_learning.materialize_capture_batch(''00000000-0000-4000-8000-000000000000''::uuid, ''00000000-0000-4000-8000-000000000001''::uuid)',
    'T08 worker mag materialize_capture_batch uitvoeren');

  -- De bronfunctie geeft alleen de allowlisted revision, geen tabel.
  execute 'set local role pitwall_learning_worker';
  select pitwall_learning.worker_get_revision(v_rev) into v_out;
  execute 'reset role';
  perform pg_temp.expect(v_out ? 'payload' and v_out ? 'quality_reasons'
                         and v_out ? 'as_of_quality',
    'T08 worker_get_revision geeft het allowlisted bewijs');
  perform pg_temp.expect(not (v_out ? 'owner_user_id'),
    'T08 worker_get_revision lekt geen owner-id');

  -- -----------------------------------------------------------------------
  -- Export is fail-closed: flag, huidige policy en policyversie
  -- -----------------------------------------------------------------------
  update pitwall_learning.runtime_settings set worker_enabled = false where id = 1;
  execute 'set local role pitwall_learning_worker';
  select pitwall_learning.worker_get_revision(v_rev) into v_out;
  execute 'reset role';
  perform pg_temp.expect(v_out is null,
    'T08 worker_get_revision exporteert niets bij worker_enabled=false');

  update pitwall_learning.runtime_settings set worker_enabled = true where id = 1;
  update pitwall_learning.account_policy set capture_enabled = false
   where owner_user_id = 'a0000000-0000-4000-8000-000000000001';
  execute 'set local role pitwall_learning_worker';
  select pitwall_learning.worker_get_revision(v_rev) into v_out;
  execute 'reset role';
  perform pg_temp.expect(v_out is null,
    'T08 worker_get_revision exporteert niets bij ingetrokken policy');

  update pitwall_learning.account_policy
     set capture_enabled = true, policy_version = policy_version + 1
   where owner_user_id = 'a0000000-0000-4000-8000-000000000001';
  execute 'set local role pitwall_learning_worker';
  select pitwall_learning.worker_get_revision(v_rev) into v_out;
  execute 'reset role';
  perform pg_temp.expect(v_out is null,
    'T08 worker_get_revision exporteert niets na policyversiewijziging');

  update pitwall_learning.account_policy set policy_version = 1
   where owner_user_id = 'a0000000-0000-4000-8000-000000000001';
  execute 'set local role pitwall_learning_worker';
  select pitwall_learning.worker_get_revision(v_rev) into v_out;
  execute 'reset role';
  perform pg_temp.expect(v_out ? 'payload',
    'T08 worker_get_revision exporteert weer bij geldige policy');

  delete from auth.users where id = 'a0000000-0000-4000-8000-000000000001';
  execute 'set local role pitwall_learning_worker';
  select pitwall_learning.worker_get_revision(v_rev) into v_out;
  execute 'reset role';
  perform pg_temp.expect(v_out is null,
    'T08 worker_get_revision exporteert niets na ownerverwijdering');

  -- -----------------------------------------------------------------------
  -- Geen PUBLIC-grants op tabellen/functies van het private schema
  -- -----------------------------------------------------------------------
  select count(*) into v_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
   where n.nspname = 'pitwall_learning' and a.grantee = 0;
  perform pg_temp.eq(v_count, 0, 'T06 geen PUBLIC-grants op private tabellen');

  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
   where n.nspname = 'pitwall_learning' and a.grantee = 0;
  perform pg_temp.eq(v_count, 0, 'T06 geen PUBLIC-grants op private functies');

  select count(*) into v_count
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'pitwall_learning'
     and (d.defaclacl::text like '%anon=%'
          or d.defaclacl::text like '%authenticated=%'
          or d.defaclacl::text like '%service_role=%'
          or d.defaclacl::text like '%=X/%');
  perform pg_temp.eq(v_count, 0,
    'T06 default-ACL in het private schema geeft geen app-rechten');
end $$;

do $$
declare
  v_fail integer;
  v_total integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t_resultaat;
  raise notice 'pitwall-learning access: % van % PASS', v_total - v_fail, v_total;
  if v_fail > 0 then
    raise exception 'pitwall-learning access: % FAIL: %', v_fail,
      (select string_agg(label, '; ' order by label) from t_resultaat where not ok);
  end if;
end $$;

rollback;
