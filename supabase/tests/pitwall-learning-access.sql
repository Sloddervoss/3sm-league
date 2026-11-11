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

do $$
declare
  v_rev uuid;
  v_out jsonb;
  v_count integer;
begin
  perform pitwall_learning.capture_source_revision(
    'measurement_event', 'd0000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000777', 1, md5('access-probe'),
    now(), now(), '{"kind":"access"}'::jsonb);
  select id into v_rev from pitwall_learning.source_revisions
   where source_uid = '00000000-0000-4000-8000-000000000777';

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
  -- worker: alleen schema-USAGE en drie functies
  -- -----------------------------------------------------------------------
  perform pg_temp.expect_denied('pitwall_learning_worker',
    'select count(*) from pitwall_learning.source_revisions',
    'T08 worker heeft geen directe SELECT op evidence');
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
    'select pitwall_learning.capture_source_revision(''measurement_event'',''d0000000-0000-4000-8000-000000000001'',''00000000-0000-4000-8000-000000000778'',1,md5(''x''),now(),now(),''{}'')',
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
