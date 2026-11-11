-- ============================================================================
-- T06 — private schema, rollen, constraints en gesloten rechten
--
-- Draai na de forward-migratie. Het script draait in één transactie en
-- draait aan het eind terug; het wijzigt geen blijvende data.
--
-- Bewijst:
--   * schema/objecten bestaan, owner supabase_admin, RLS aan, geen policies;
--   * de vijfdelige identiteit en de jobs-uniciteit zijn echte constraints;
--   * geen USAGE/SELECT/INSERT/UPDATE/DELETE/EXECUTE voor
--     PUBLIC/anon/authenticated/service_role;
--   * de workerrol heeft alleen schema-USAGE en vier EXECUTE-grants;
--   * bestaande public-relations, -policies, -ACLs en de ingest-functie zijn
--     ongewijzigd; alleen vier statement-level capturetriggers zijn toegevoegd.
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

do $$
declare
  v_count integer;
  v_text text;
  v_bool boolean;
  v_table text;
begin
  -- -----------------------------------------------------------------------
  -- Schema en objecten
  -- -----------------------------------------------------------------------
  perform pg_temp.expect(to_regnamespace('pitwall_learning') is not null,
                         'T06 schema pitwall_learning bestaat');
  perform pg_temp.eq(
    (select nspowner::regrole::text from pg_namespace where nspname = 'pitwall_learning'),
    'supabase_admin', 'T06 schema-owner is supabase_admin');

  select count(*) into v_count
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'pitwall_learning' and c.relkind = 'r';
  perform pg_temp.eq(v_count, 10, 'T06 tien private tabellen');

  for v_table in
    select unnest(array['runtime_settings','account_policy','capture_batches',
                        'source_revisions','jobs',
                        'models','examples','predictions','evaluations','deployments'])
  loop
    perform pg_temp.expect(
      (select relrowsecurity from pg_class
        where oid = format('pitwall_learning.%I', v_table)::regclass),
      format('T06 RLS staat aan op %s', v_table));
  end loop;

  perform pg_temp.eq(
    (select count(*) from pg_policies where schemaname = 'pitwall_learning'),
    0, 'T06 geen enkele policy in het private schema');

  -- -----------------------------------------------------------------------
  -- Vijfdelige identiteit en job-uniciteit
  -- -----------------------------------------------------------------------
  select pg_get_constraintdef(oid) into v_text
    from pg_constraint
   where conrelid = 'pitwall_learning.source_revisions'::regclass
     and conname = 'source_revisions_identity_key';
  perform pg_temp.expect(
    v_text like '%UNIQUE (source_kind, device_id, source_uid, record_revision, content_hash)%',
    'T06 source_revisions heeft de vijfdelige unique key');

  select pg_get_constraintdef(oid) into v_text
    from pg_constraint
   where conrelid = 'pitwall_learning.jobs'::regclass
     and conname = 'jobs_revision_kind_key';
  perform pg_temp.expect(
    v_text like '%UNIQUE (source_revision_id, kind)%',
    'T06 jobs is uniek per revision en kind');

  -- Claim en dead-letter-sweep hebben elk een eigen, begrensbaar indexpad.
  perform pg_temp.eq(
    (select count(*) from pg_indexes
      where schemaname = 'pitwall_learning'
        and indexname in ('jobs_claim_idx', 'jobs_expiry_idx', 'jobs_deadletter_idx')),
    3, 'T06 jobclaim en dead-letter hebben begrensde indexen');

  -- Batch-outbox en jobreferentie zijn echte constraints, niet alleen
  -- afspraken in de worker.
  perform pg_temp.eq(
    (select count(*) from pg_indexes
      where schemaname = 'pitwall_learning' and indexname = 'jobs_batch_kind_key'),
    1, 'T06 jobs heeft één unieke materialisatiejob per batch');
  select pg_get_constraintdef(oid) into v_text
    from pg_constraint
   where conrelid = 'pitwall_learning.jobs'::regclass
     and conname = 'jobs_reference_shape';
  perform pg_temp.expect(
    v_text like '%source_revision_id IS NOT NULL%'
    and v_text like '%capture_batch_id IS NULL%'
    and v_text like '%materialize_capture_batch%',
    'T06 jobreferentie is exact één van revision of batch');
  perform pg_temp.eq(
    (select count(*) from pg_constraint
      where conrelid = 'pitwall_learning.source_revisions'::regclass
        and conname = 'source_revisions_batch_fkey'),
    1, 'T06 revisie heeft een provenance-FK naar de batch');
  select pg_get_constraintdef(oid) into v_text
    from pg_constraint
   where conrelid = 'pitwall_learning.capture_batches'::regclass
     and conname = 'capture_batches_payload_shape';
  perform pg_temp.expect(
    v_text like '%jsonb_array_length(payload) = item_count%'
    and v_text like '%262144%',
    'T06 batchpayload is begrensd op item_count en 256 KiB');
  perform pg_temp.eq(
    (select count(*) from pg_constraint
      where conrelid = 'pitwall_learning.capture_batches'::regclass
        and conname = 'capture_batches_materialization_shape'),
    1, 'T06 batchmateriaalbewijs heeft een shape-constraint');
  perform pg_temp.eq(
    (select count(*) from pg_trigger
      where tgrelid = 'pitwall_learning.capture_batches'::regclass
        and tgname = 'capture_batches_immutable' and not tgisinternal),
    1, 'T06 capture_batches heeft een immutability-trigger');
  perform pg_temp.eq(
    (select count(*) from pg_trigger
      where tgrelid = 'pitwall_learning.jobs'::regclass
        and tgname = 'jobs_materialization_proof' and not tgisinternal),
    1, 'T06 jobs heeft een materiaalbewijs-trigger');
  perform pg_temp.eq(
    (select count(*) from pg_trigger
      where tgrelid = 'pitwall_learning.jobs'::regclass
        and tgname = 'jobs_source_revision_valid' and not tgisinternal),
    1, 'T06 jobs heeft een smalle source-revisionvalidatie');
  perform pg_temp.eq(
    (select count(*) from pg_constraint
      where conrelid = 'pitwall_learning.jobs'::regclass
        and conname = 'jobs_revision_fkey'),
    0, 'T06 jobs heeft geen brede FK-lock naar source_revisions');

  select pg_get_constraintdef(oid) into v_text
    from pg_constraint
   where conrelid = 'pitwall_learning.source_revisions'::regclass
     and conname = 'source_revisions_not_training_eligible_p1';
  perform pg_temp.expect(v_text like '%training_eligible = false%',
                         'T06 P1-rijen zijn niet training-eligible');

  select pg_get_constraintdef(oid) into v_text
    from pg_constraint
   where conrelid = 'pitwall_learning.account_policy'::regclass
     and conname = 'account_policy_no_pooling_p1';
  perform pg_temp.expect(v_text like '%pooling_enabled = false%',
                         'T06 pooling is in P1 hard uitgesloten');

  select pg_get_constraintdef(oid) into v_text
    from pg_constraint
   where conrelid = 'pitwall_learning.account_policy'::regclass
     and conname = 'account_policy_retention_jobs';
  perform pg_temp.expect(v_text like '%<= 7%',
                         'T06 retentie jobs is gemaximeerd op 7 dagen');
  select pg_get_constraintdef(oid) into v_text
    from pg_constraint
   where conrelid = 'pitwall_learning.account_policy'::regclass
     and conname = 'account_policy_retention_source';
  perform pg_temp.expect(v_text like '%<= 180%',
                         'T06 retentie bron is gemaximeerd op 180 dagen');
  select pg_get_constraintdef(oid) into v_text
    from pg_constraint
   where conrelid = 'pitwall_learning.account_policy'::regclass
     and conname = 'account_policy_retention_forecast';
  perform pg_temp.expect(v_text like '%<= 90%',
                         'T06 retentie forecast is gemaximeerd op 90 dagen');

  -- Immutability-trigger aanwezig.
  perform pg_temp.eq(
    (select count(*) from pg_trigger
      where tgrelid = 'pitwall_learning.source_revisions'::regclass
        and tgname = 'source_revisions_immutable' and not tgisinternal),
    1, 'T06 source_revisions heeft een immutability-trigger');

  -- -----------------------------------------------------------------------
  -- Defaults: kill switches uit, geen accountseed, P2+ leeg
  -- -----------------------------------------------------------------------
  perform pg_temp.eq(
    (select count(*) from pg_attrdef d join pg_attribute a
       on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = 'pitwall_learning.runtime_settings'::regclass
        and a.attname in ('capture_enabled','worker_enabled','shadow_enabled','advice_enabled')
        and pg_get_expr(d.adbin, d.adrelid) = 'false'),
    4, 'T06 alle vier kill switches default FALSE');
  perform pg_temp.eq(
    (select count(*) from pitwall_learning.runtime_settings),
    1, 'T06 runtime_settings is één singleton');
  perform pg_temp.eq(
    (select count(*) from pitwall_learning.models)
    + (select count(*) from pitwall_learning.examples)
    + (select count(*) from pitwall_learning.predictions)
    + (select count(*) from pitwall_learning.evaluations)
    + (select count(*) from pitwall_learning.deployments),
    0, 'T06 P2+-tabellen zijn in P1 leeg');

  -- -----------------------------------------------------------------------
  -- Workerrol: flags, geen wachtwoord, geen privilege-escalatie
  -- -----------------------------------------------------------------------
  select rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
         and not rolreplication and not rolbypassrls and not rolinherit
         and rolconnlimit = 2
         and rolpassword is null
    into v_bool
    from pg_authid where rolname = 'pitwall_learning_worker';
  perform pg_temp.expect(v_bool,
    'T06 workerrol is LOGIN zonder wachtwoord, niet-super, NOINHERIT, limit 2');

  perform pg_temp.expect(
    not pg_has_role('pitwall_learning_worker', 'supabase_admin', 'member'),
    'T06 worker is geen lid van supabase_admin');
  perform pg_temp.expect(
    not pg_has_role('pitwall_learning_worker', 'pg_read_all_data', 'member'),
    'T06 worker is geen lid van pg_read_all_data');
  perform pg_temp.expect(
    not pg_has_role('pitwall_learning_worker', 'service_role', 'member'),
    'T06 worker is geen lid van service_role');

  -- -----------------------------------------------------------------------
  -- Gesloten rechten
  -- -----------------------------------------------------------------------
  perform pg_temp.expect(
    not has_schema_privilege('anon', 'pitwall_learning', 'USAGE'),
    'T06 anon heeft geen schema-USAGE');
  perform pg_temp.expect(
    not has_schema_privilege('authenticated', 'pitwall_learning', 'USAGE'),
    'T06 authenticated heeft geen schema-USAGE');
  perform pg_temp.expect(
    not has_schema_privilege('service_role', 'pitwall_learning', 'USAGE'),
    'T06 service_role heeft geen schema-USAGE');
  perform pg_temp.expect(
    has_schema_privilege('pitwall_learning_worker', 'pitwall_learning', 'USAGE'),
    'T06 worker heeft schema-USAGE');

  for v_table in
    select unnest(array['runtime_settings','account_policy','capture_batches',
                        'source_revisions','jobs',
                        'models','examples','predictions','evaluations','deployments'])
  loop
    perform pg_temp.expect(
      not has_table_privilege('anon', format('pitwall_learning.%I', v_table), 'SELECT'),
      format('T06 anon kan %s niet lezen', v_table));
    perform pg_temp.expect(
      not has_table_privilege('authenticated', format('pitwall_learning.%I', v_table), 'SELECT'),
      format('T06 authenticated kan %s niet lezen', v_table));
    perform pg_temp.expect(
      not has_table_privilege('service_role', format('pitwall_learning.%I', v_table), 'SELECT'),
      format('T06 service_role kan %s niet lezen', v_table));
    perform pg_temp.expect(
      not has_table_privilege('pitwall_learning_worker', format('pitwall_learning.%I', v_table), 'SELECT'),
      format('T06 worker heeft geen directe SELECT op %s', v_table));
    perform pg_temp.expect(
      not has_table_privilege('pitwall_learning_worker', format('pitwall_learning.%I', v_table), 'INSERT')
      and not has_table_privilege('pitwall_learning_worker', format('pitwall_learning.%I', v_table), 'UPDATE')
      and not has_table_privilege('pitwall_learning_worker', format('pitwall_learning.%I', v_table), 'DELETE')
      and not has_table_privilege('pitwall_learning_worker', format('pitwall_learning.%I', v_table), 'TRUNCATE'),
      format('T06 worker heeft geen schrijf-/TRUNCATE-recht op %s', v_table));
  end loop;

  perform pg_temp.expect(
    not has_function_privilege('anon',
      'pitwall_learning.claim_jobs(integer,integer)', 'EXECUTE'),
    'T06 anon kan claim_jobs niet uitvoeren');
  perform pg_temp.expect(
    not has_function_privilege('authenticated',
      'pitwall_learning.claim_jobs(integer,integer)', 'EXECUTE'),
    'T06 authenticated kan claim_jobs niet uitvoeren');
  perform pg_temp.expect(
    not has_function_privilege('service_role',
      'pitwall_learning.claim_jobs(integer,integer)', 'EXECUTE'),
    'T06 service_role kan claim_jobs niet uitvoeren');

  perform pg_temp.expect(
    has_function_privilege('pitwall_learning_worker',
      'pitwall_learning.claim_jobs(integer,integer)', 'EXECUTE'),
    'T06 worker mag claim_jobs uitvoeren');
  perform pg_temp.expect(
    has_function_privilege('pitwall_learning_worker',
      'pitwall_learning.finish_job(uuid,uuid,text,text)', 'EXECUTE'),
    'T06 worker mag finish_job uitvoeren');
  perform pg_temp.expect(
    has_function_privilege('pitwall_learning_worker',
      'pitwall_learning.worker_get_revision(uuid)', 'EXECUTE'),
    'T06 worker mag worker_get_revision uitvoeren');
  perform pg_temp.expect(
    has_function_privilege('pitwall_learning_worker',
      'pitwall_learning.materialize_capture_batch(uuid,uuid)', 'EXECUTE'),
    'T06 worker mag materialize_capture_batch uitvoeren');
  perform pg_temp.expect(
    not has_function_privilege('pitwall_learning_worker',
      'pitwall_learning.enqueue_job(uuid,text)', 'EXECUTE'),
    'T06 worker mag geen jobs enqueuen');
  perform pg_temp.expect(
    not has_function_privilege('pitwall_learning_worker',
      'pitwall_learning.capture_source_batch(text,jsonb)', 'EXECUTE'),
    'T06 worker mag de capture-helper niet aanroepen');

  -- -----------------------------------------------------------------------
  -- SECURITY DEFINER: owner en gepinde search_path
  -- -----------------------------------------------------------------------
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'pitwall_learning'
     and p.prosecdef
     and p.proconfig @> array['search_path=pg_catalog, pitwall_learning, pg_temp'];
  perform pg_temp.eq(v_count, 14,
    'T06 alle veertien private functies zijn SECDEF met gepinde search_path');

  -- Capture werkt met een vaste, functie-lokale lock_timeout. Geen
  -- handmatige set_config/restore meer die door een fout kan blijven hangen.
  perform pg_temp.eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'pitwall_learning'
        and p.proname in ('capture_source_batch',
                          'capture_measurement_events_insert','capture_measurement_events_update',
                          'capture_lap_summaries_insert','capture_lap_summaries_update')
        and p.proconfig @> array['lock_timeout=50ms']),
    5, 'T06 alle capturefuncties hebben functie-lokale lock_timeout=50ms');
  perform pg_temp.eq(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'pitwall_learning'
        and p.proname like 'capture%'
        and pg_get_functiondef(p.oid) like '%set_config(%'),
    0, 'T06 capture herstelt lock_timeout niet meer handmatig');

  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'pitwall_learning' and p.proowner::regrole::text <> 'supabase_admin';
  perform pg_temp.eq(v_count, 0, 'T06 alle private functies zijn eigendom van supabase_admin');

  -- Geen context-snapshot of auto/track/compound als bron voor capture.
  select string_agg(pg_get_functiondef(p.oid), E'\n') into v_text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'pitwall_learning'
     and p.proname in ('capture_source_batch',
                       'capture_measurement_events_insert','capture_measurement_events_update',
                       'capture_lap_summaries_insert','capture_lap_summaries_update');
  perform pg_temp.expect(v_text not like '%simhub_telemetry_latest%',
    'T06 capture leest geen current-snapshot');
  perform pg_temp.expect(v_text not like '%n.car_id%'
                     and v_text not like '%n.track_name%'
                     and v_text not like '%n.track_config%'
                     and v_text not like '%n.compound%'
                     and v_text not like '%simhub_telemetry_latest%',
    'T06 capture kopieert geen car/track/compound');
  perform pg_temp.expect(v_text not like '%n.current_driver_name%'
                     and v_text not like '%n.current_driver_id%',
    'T06 capture bewaart geen driver_name/driver_id');

  -- -----------------------------------------------------------------------
  -- Default privileges zijn geen sluitende garantie
  -- -----------------------------------------------------------------------
  -- ALTER DEFAULT PRIVILEGES ... REVOKE kan de ingebouwde globale default
  -- (PUBLIC EXECUTE op functies) niet intrekken. Deze probe maakt dat
  -- expliciet en bewijst dat per-object-revoke nodig blijft. Alles wordt in
  -- de testtransactie teruggedraaid.
  execute 'set local role supabase_admin';
  execute 'create function pitwall_learning.p1_default_probe() returns integer language sql as ''select 1''';
  execute 'reset role';
  perform pg_temp.expect(
    has_function_privilege('anon', 'pitwall_learning.p1_default_probe()', 'EXECUTE'),
    'T06 nieuwe functie krijgt nog steeds globale PUBLIC EXECUTE (defaults zijn geen garantie)');
  execute 'revoke all on function pitwall_learning.p1_default_probe() from public, anon, authenticated, service_role';
  perform pg_temp.expect(
    not has_function_privilege('anon', 'pitwall_learning.p1_default_probe()', 'EXECUTE'),
    'T06 per-object REVOKE sluit een nieuwe functie expliciet');
  execute 'drop function pitwall_learning.p1_default_probe()';

  -- -----------------------------------------------------------------------
  -- Bestaande public-baseline ongewijzigd
  -- -----------------------------------------------------------------------
  perform pg_temp.eq(
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f')),
    99, 'T06 public-relations blijven 99');
  perform pg_temp.eq(
    (select count(*) from pg_policies where schemaname = 'public'),
    165, 'T06 public-policies blijven 165');
  perform pg_temp.eq(
    (select md5(string_agg(tablename||'|'||policyname||'|'||roles::text||'|'||cmd||'|'||
                           coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n'
                           order by tablename, policyname))
       from pg_policies where schemaname = 'public'),
    '3c1e74552b5c9da34aeb663084dc848d',
    'T06 public-policy-inhoud is byte-identiek');
  perform pg_temp.eq(
    (select md5(pg_get_functiondef(
       'public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb)'::regprocedure))),
    '6d98493868e34e2ed459687d6161837f',
    'T06 bestaande ingest-functie is byte-identiek');
  perform pg_temp.eq(
    (select md5(string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull,
                           ',' order by attnum))
       from pg_attribute
      where attrelid = 'public.simhub_measurement_events'::regclass
        and attnum > 0 and not attisdropped),
    '159a097070a34d41b39bf45afbaa9ee6',
    'T06 events-kolommen zijn ongewijzigd');
  perform pg_temp.eq(
    (select md5(string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull,
                           ',' order by attnum))
       from pg_attribute
      where attrelid = 'public.simhub_lap_summaries'::regclass
        and attnum > 0 and not attisdropped),
    '3bdf75bb87fa688cab6ac7c3dd5928db',
    'T06 laps-kolommen zijn ongewijzigd');
  perform pg_temp.eq(
    (select coalesce(array_to_string(relacl,'|'),'NULL')
       from pg_class where oid = 'public.simhub_measurement_events'::regclass),
    'supabase_admin=arwdDxt/supabase_admin|postgres=arwdDxt/supabase_admin|service_role=arwdDxt/supabase_admin',
    'T06 events-ACL is ongewijzigd');
  perform pg_temp.eq(
    (select coalesce(array_to_string(relacl,'|'),'NULL')
       from pg_class where oid = 'public.simhub_lap_summaries'::regclass),
    'supabase_admin=arwdDxt/supabase_admin|postgres=arwdDxt/supabase_admin|service_role=arwdDxt/supabase_admin',
    'T06 laps-ACL is ongewijzigd');
  perform pg_temp.eq(
    (select count(*) from pg_policies
      where schemaname='public' and tablename in ('simhub_measurement_events','simhub_lap_summaries')),
    0, 'T06 geen policies toegevoegd aan de brontabellen');

  perform pg_temp.eq(
    (select count(*) from pg_trigger
      where not tgisinternal
        and tgrelid in ('public.simhub_measurement_events'::regclass,
                        'public.simhub_lap_summaries'::regclass)),
    4, 'T06 precies vier statement-capturetriggers op de twee brontabellen');
  perform pg_temp.eq(
    (select count(*) from pg_trigger
      where not tgisinternal
        and tgrelid in ('public.simhub_measurement_events'::regclass,
                        'public.simhub_lap_summaries'::regclass)
        and tgname in ('pitwall_learning_capture_event_ins',
                       'pitwall_learning_capture_event_upd',
                       'pitwall_learning_capture_lap_ins',
                       'pitwall_learning_capture_lap_upd')),
    4, 'T06 de vier triggers zijn de capturetriggers');
  -- Alle vier zijn FOR EACH STATEMENT; geen row-trigger meer per meting.
  perform pg_temp.eq(
    (select count(*) from pg_trigger
      where not tgisinternal
        and tgrelid in ('public.simhub_measurement_events'::regclass,
                        'public.simhub_lap_summaries'::regclass)
        and (tgtype & 1) = 0),
    4, 'T06 alle capturetriggers zijn statement-level');

  perform pg_temp.eq(
    (select count(*) from pg_trigger
      where not tgisinternal and tgname like 'pitwall_learning%'
        and tgrelid not in ('public.simhub_measurement_events'::regclass,
                            'public.simhub_lap_summaries'::regclass)),
    0, 'T06 geen full-frame of andere brontriggers');
end $$;

do $$
declare
  v_fail integer;
  v_total integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t_resultaat;
  raise notice 'pitwall-learning schema: % van % PASS', v_total - v_fail, v_total;
  if v_fail > 0 then
    raise exception 'pitwall-learning schema: % FAIL: %', v_fail,
      (select string_agg(label, '; ' order by label) from t_resultaat where not ok);
  end if;
end $$;

rollback;
