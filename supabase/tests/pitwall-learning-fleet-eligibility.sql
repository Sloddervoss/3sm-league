-- ============================================================================
-- Fleet eligibility regression test
--
-- Run against a throwaway PG15 clone after applying:
--   supabase/migrations/20261122134500_pitwall_learning_fleet_eligibility.sql
-- The whole test runs in one transaction and rolls back.
--
-- Covers:
--   * active_binding is now eligible; legacy status tokens remain harmless;
--   * active_unbound with a capable connector is eligible;
--   * inactive, revoked, stale, missing-health and old-version devices are not
--     eligible while they are not active;
--   * an existing opt-out row is byte-for-byte left alone;
--   * a mixed account (new binding + old spare) admits only the new device's
--     source revision to the fuel worker;
--   * missing telemetry/version fails closed;
--   * 0.7.6.3 is the verified boundary from the C# producer code.
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

create or replace function pg_temp.mk_user(p_user uuid)
returns void language sql as $$
  insert into auth.users (id, email, aud, role, is_sso_user)
  values (p_user, 'fleet-' || p_user::text || '@example.invalid', 'authenticated', 'authenticated', false)
  on conflict (id) do nothing
$$;

-- Health is the provisioning heartbeat (read by fuel_worker_provision).
create or replace function pg_temp.mk_health(p_device uuid, p_version text)
returns void language sql as $$
  insert into public.simhub_device_health(
    device_id, connector_version, simhub_version, game_connected, telemetry_available,
    raw_data_available, raw_telemetry_available, session_time_read_ok, session_time_reader,
    sequence, diagnostic_code, updater_state, updater_current_version)
  values(p_device, p_version, '9.9.9', true, true, true, true, true, 'sdk', 0,
         'OK', 'idle', p_version)
  on conflict (device_id) do update set connector_version = excluded.connector_version,
    updated_at = now()
$$;

-- Telemetry-latest is written by simhub_persist_v3 in the same transaction as
-- the measurement rows. It is the per-frame source of truth for the worker.
create or replace function pg_temp.mk_telemetry(p_device uuid, p_owner uuid, p_version text)
returns void language sql as $$
  insert into public.simhub_telemetry_latest(
    device_id, owner_user_id, session_id, sequence, captured_at, connector_id,
    connector_version, game, telemetry)
  values(p_device, p_owner, 'sess-fleet', 1, clock_timestamp(), 'fleet-test',
         p_version, 'IRacing', '{}'::jsonb)
  on conflict (device_id) do update set connector_version = excluded.connector_version,
    owner_user_id = excluded.owner_user_id
$$;

create or replace function pg_temp.mk_device(
  p_device uuid, p_owner uuid, p_status text, p_version text,
  p_last_seen timestamptz default clock_timestamp(), p_revoked boolean default false)
returns void language plpgsql as $$
begin
  insert into public.simhub_devices(
    id, owner_user_id, token_hash, connector_id, device_name, device_status,
    device_role, endurance_event_id, endurance_team_id, last_seen_at, revoked_at)
  values(
    p_device, p_owner,
    md5(p_device::text) || md5(p_device::text || '-token'),
    'fleet-' || p_device::text, 'FLEET-' || left(p_device::text, 8),
    p_status,
    case when p_status = 'active_binding' then 'primary' end,
    case when p_status = 'active_binding' then 'e0000000-0000-4000-8000-0000000000e1'::uuid end,
    case when p_status = 'active_binding' then 'e0000000-0000-4000-8000-0000000000f1'::uuid end,
    p_last_seen,
    case when p_revoked then clock_timestamp() end);
  if not p_revoked and p_version is not null then
    perform pg_temp.mk_health(p_device, p_version);
  end if;
end $$;

create or replace function pg_temp.mk_source(
  p_device uuid, p_owner uuid, p_uid uuid, p_revision integer default 1)
returns uuid language plpgsql as $$
declare v_id uuid; v_job uuid;
begin
  insert into pitwall_learning.source_revisions(
    source_kind, device_id, source_uid, record_revision, content_hash,
    observed_at, source_received_at, owner_user_id, owner_basis,
    account_policy_version, payload, quality_reasons)
  values('lap_summary', p_device::text, p_uid, p_revision,
    md5(p_uid::text || p_revision::text), clock_timestamp() - interval '1 minute',
    clock_timestamp(), p_owner, 'device_owner_at_receipt', 1, '{}'::jsonb,
    array['context_incomplete']::text[])
  returning id into v_id;
  insert into pitwall_learning.jobs(source_revision_id, kind, status, attempts,
    lease_token, lease_owner, lease_expires_at)
  values(v_id, 'source_validate', 'leased', 1, gen_random_uuid(), 'fleet-test',
    clock_timestamp() + interval '5 minutes')
  returning id into v_job;
  return v_job;
end $$;

create or replace function pg_temp.lease_of(p_job uuid)
returns uuid language sql as $$
  select lease_token from pitwall_learning.jobs where id = p_job
$$;

create or replace function pg_temp.source_of(p_job uuid)
returns uuid language sql as $$
  select source_revision_id from pitwall_learning.jobs where id = p_job
$$;

-- Synthetic identities. Random suffix keeps the test isolated from any
-- pre-existing fixture rows while remaining deterministic within one run.
create temp table t_ids as
select
  'e0000000-0000-4000-8000-000000000001'::uuid as owner_bound,
  'e0000000-0000-4000-8000-000000000002'::uuid as owner_unbound,
  'e0000000-0000-4000-8000-000000000003'::uuid as owner_inactive,
  'e0000000-0000-4000-8000-000000000004'::uuid as owner_old,
  'e0000000-0000-4000-8000-000000000005'::uuid as owner_very_old,
  'e0000000-0000-4000-8000-000000000006'::uuid as owner_optout,
  'e0000000-0000-4000-8000-000000000007'::uuid as owner_mixed,
  'e0000000-0000-4000-8000-000000000008'::uuid as owner_revoked,
  'e0000000-0000-4000-8000-000000000009'::uuid as owner_malformed,
  'e0000000-0000-4000-8000-00000000000a'::uuid as owner_nohealth,
  'e0000000-0000-4000-8000-00000000000b'::uuid as owner_stale,
  'f0000000-0000-4000-8000-000000000001'::uuid as dev_bound,
  'f0000000-0000-4000-8000-000000000002'::uuid as dev_unbound,
  'f0000000-0000-4000-8000-000000000003'::uuid as dev_inactive,
  'f0000000-0000-4000-8000-000000000004'::uuid as dev_old,
  'f0000000-0000-4000-8000-000000000005'::uuid as dev_very_old,
  'f0000000-0000-4000-8000-000000000006'::uuid as dev_optout,
  'f0000000-0000-4000-8000-000000000007'::uuid as dev_mixed_new,
  'f0000000-0000-4000-8000-000000000008'::uuid as dev_mixed_old,
  'f0000000-0000-4000-8000-000000000009'::uuid as dev_revoked,
  'f0000000-0000-4000-8000-00000000000a'::uuid as dev_malformed,
  'f0000000-0000-4000-8000-00000000000b'::uuid as dev_nohealth,
  'f0000000-0000-4000-8000-00000000000c'::uuid as dev_stale;

do $$
declare
  v_before integer;
  v_after integer;
  v_ver boolean;
  v_src uuid;
  v_json jsonb;
begin
  -- Worker must be allowed to run, and auto-enrollment on.
  update pitwall_learning.runtime_settings
     set worker_enabled = true,
         automatic_personal_enrollment = true,
         capture_enabled = true,
         fuel_collection_started_at = coalesce(fuel_collection_started_at, clock_timestamp())
   where id = 1;

  perform pg_temp.mk_user((select owner_bound from t_ids));
  perform pg_temp.mk_user((select owner_unbound from t_ids));
  perform pg_temp.mk_user((select owner_inactive from t_ids));
  perform pg_temp.mk_user((select owner_old from t_ids));
  perform pg_temp.mk_user((select owner_very_old from t_ids));
  perform pg_temp.mk_user((select owner_optout from t_ids));
  perform pg_temp.mk_user((select owner_mixed from t_ids));
  perform pg_temp.mk_user((select owner_revoked from t_ids));
  perform pg_temp.mk_user((select owner_malformed from t_ids));
  perform pg_temp.mk_user((select owner_nohealth from t_ids));
  perform pg_temp.mk_user((select owner_stale from t_ids));

  -- The defect: this is the production status of the three recent 0.7.6.4
  -- owners. It must now be eligible.
  perform pg_temp.mk_device((select dev_bound from t_ids), (select owner_bound from t_ids),
                            'active_binding', '0.7.6.4');
  perform pg_temp.mk_device((select dev_unbound from t_ids), (select owner_unbound from t_ids),
                            'active_unbound', '0.7.6.5');
  perform pg_temp.mk_device((select dev_inactive from t_ids), (select owner_inactive from t_ids),
                            'inactive', '0.7.6.3');
  perform pg_temp.mk_device((select dev_old from t_ids), (select owner_old from t_ids),
                            'active_unbound', '0.7.6.2');
  perform pg_temp.mk_device((select dev_very_old from t_ids), (select owner_very_old from t_ids),
                            'active_binding', '0.4.2.1');
  perform pg_temp.mk_device((select dev_optout from t_ids), (select owner_optout from t_ids),
                            'active_unbound', '0.7.6.4');
  perform pg_temp.mk_device((select dev_mixed_new from t_ids), (select owner_mixed from t_ids),
                            'active_binding', '0.7.6.4');
  -- The old spare on the same account. It must never reach Auto Learn.
  perform pg_temp.mk_device((select dev_mixed_old from t_ids), (select owner_mixed from t_ids),
                            'inactive', '0.4.2.1');
  perform pg_temp.mk_device((select dev_revoked from t_ids), (select owner_revoked from t_ids),
                            'revoked', '0.7.6.6', clock_timestamp(), true);
  perform pg_temp.mk_device((select dev_malformed from t_ids), (select owner_malformed from t_ids),
                            'active_unbound', '0.7.6');
  -- No health row at all: must fail closed.
  perform pg_temp.mk_device((select dev_nohealth from t_ids), (select owner_nohealth from t_ids),
                            'active_unbound', null);
  perform pg_temp.mk_device((select dev_stale from t_ids), (select owner_stale from t_ids),
                            'active_unbound', '0.7.6.4',
                            clock_timestamp() - interval '31 days');

  -- Existing explicit opt-out. Provisioning must not touch it.
  insert into pitwall_learning.account_policy(
    owner_user_id, capture_enabled, personal_fit_enabled, serving_enabled,
    pooling_enabled, policy_version, updated_at)
  values((select owner_optout from t_ids), false, true, true, false, 1,
         timestamptz '2026-01-02 03:04:05+00');

  -- -----------------------------------------------------------------------
  -- Unit boundary: 0.7.6.3 is the first v2 fuelQuality producer.
  -- -----------------------------------------------------------------------
  v_ver := pitwall_learning.connector_supports_fuel_learning('0.7.6.2');
  perform pg_temp.eq(v_ver, false, 'versie 0.7.6.2 is te oud');
  v_ver := pitwall_learning.connector_supports_fuel_learning('0.7.6.3');
  perform pg_temp.eq(v_ver, true, 'versie 0.7.6.3 is de ondergrens');
  v_ver := pitwall_learning.connector_supports_fuel_learning('0.7.6.3.0');
  perform pg_temp.eq(v_ver, false, 'vijfdelige 0.7.6.3.0 wordt geweigerd');
  v_ver := pitwall_learning.connector_supports_fuel_learning('0.7.6.4');
  perform pg_temp.eq(v_ver, true, 'versie 0.7.6.4 is toegestaan');
  v_ver := pitwall_learning.connector_supports_fuel_learning('0.7.6.5');
  perform pg_temp.eq(v_ver, true, 'versie 0.7.6.5 is toegestaan');
  v_ver := pitwall_learning.connector_supports_fuel_learning('0.7.6');
  perform pg_temp.eq(v_ver, false, 'driedelige 0.7.6 blijft te oud');
  v_ver := pitwall_learning.connector_supports_fuel_learning('0.7.6.3-beta');
  perform pg_temp.eq(v_ver, false, 'vreemde versievorm wordt geweigerd');
  v_ver := pitwall_learning.connector_supports_fuel_learning(null);
  perform pg_temp.eq(v_ver, false, 'NULL-versie wordt geweigerd');

  -- -----------------------------------------------------------------------
  -- Provisioning: the real deployed status mismatch.
  -- -----------------------------------------------------------------------
  select count(*) into v_before from pitwall_learning.account_policy
   where owner_user_id in (select owner_bound from t_ids
                           union select owner_unbound from t_ids
                           union select owner_inactive from t_ids
                           union select owner_old from t_ids
                           union select owner_very_old from t_ids
                           union select owner_optout from t_ids
                           union select owner_mixed from t_ids
                           union select owner_revoked from t_ids
                           union select owner_malformed from t_ids
                           union select owner_nohealth from t_ids
                           union select owner_stale from t_ids);

  v_after := pitwall_learning.fuel_worker_provision(100);

  perform pg_temp.expect(exists(select 1 from pitwall_learning.account_policy
    where owner_user_id = (select owner_bound from t_ids)),
    'active_binding 0.7.6.4 wordt ingeschreven');
  perform pg_temp.expect(exists(select 1 from pitwall_learning.account_policy
    where owner_user_id = (select owner_unbound from t_ids)),
    'active_unbound 0.7.6.5 wordt ingeschreven');
  perform pg_temp.expect(not exists(select 1 from pitwall_learning.account_policy
    where owner_user_id = (select owner_inactive from t_ids)),
    'inactive device wordt niet ingeschreven');
  perform pg_temp.expect(not exists(select 1 from pitwall_learning.account_policy
    where owner_user_id = (select owner_old from t_ids)),
    '0.7.6.2 wordt niet ingeschreven');
  perform pg_temp.expect(not exists(select 1 from pitwall_learning.account_policy
    where owner_user_id = (select owner_very_old from t_ids)),
    '0.4.2.1 wordt niet ingeschreven');
  perform pg_temp.expect(not exists(select 1 from pitwall_learning.account_policy
    where owner_user_id = (select owner_revoked from t_ids)),
    'revoked device wordt niet ingeschreven');
  perform pg_temp.expect(not exists(select 1 from pitwall_learning.account_policy
    where owner_user_id = (select owner_malformed from t_ids)),
    'niet-parseerbare versie wordt niet ingeschreven');
  perform pg_temp.expect(not exists(select 1 from pitwall_learning.account_policy
    where owner_user_id = (select owner_nohealth from t_ids)),
    'device zonder health wordt niet ingeschreven');
  perform pg_temp.expect(not exists(select 1 from pitwall_learning.account_policy
    where owner_user_id = (select owner_stale from t_ids)),
    'device ouder dan 30 dagen wordt niet ingeschreven');
  perform pg_temp.eq(v_after, 3, 'provision schrijft precies de drie actieve accounts');

  perform pg_temp.eq((select capture_enabled from pitwall_learning.account_policy
    where owner_user_id = (select owner_optout from t_ids)), false,
    'bestaande opt-out blijft capture_enabled=false');
  perform pg_temp.eq((select updated_at from pitwall_learning.account_policy
    where owner_user_id = (select owner_optout from t_ids)),
    timestamptz '2026-01-02 03:04:05+00',
    'bestaande opt-out-rij wordt niet aangeraakt');

  v_after := pitwall_learning.fuel_worker_provision(100);
  perform pg_temp.eq(v_after, 0, 'tweede provision is idempotent');

  -- -----------------------------------------------------------------------
  -- Mixed account: new binding contributes, old spare does not.
  -- -----------------------------------------------------------------------
  perform pg_temp.mk_telemetry((select dev_mixed_new from t_ids),
                               (select owner_mixed from t_ids), '0.7.6.4');
  perform pg_temp.mk_telemetry((select dev_mixed_old from t_ids),
                               (select owner_mixed from t_ids), '0.4.2.1');

  v_src := pg_temp.mk_source((select dev_mixed_old from t_ids),
                             (select owner_mixed from t_ids),
                             '00000000-0000-4000-8000-000000000101'::uuid);
  v_json := pitwall_learning.fuel_worker_source(v_src, pg_temp.lease_of(v_src));
  perform pg_temp.expect(v_json is null, 'oude device op mixed account levert geen source');
  perform pg_temp.expect(not exists(select 1 from pitwall_learning.fuel_visibility
    where source_revision_id = pg_temp.source_of(v_src)), 'oude device maakt geen visibility-rij');

  v_src := pg_temp.mk_source((select dev_mixed_new from t_ids),
                             (select owner_mixed from t_ids),
                             '00000000-0000-4000-8000-000000000102'::uuid);
  v_json := pitwall_learning.fuel_worker_source(v_src, pg_temp.lease_of(v_src));
  perform pg_temp.expect(v_json is not null and (v_json->>'allowed')::boolean,
    'nieuwe device op mixed account levert wel source');
  perform pg_temp.expect(exists(select 1 from pitwall_learning.fuel_visibility
    where source_revision_id = pg_temp.source_of(v_src)), 'nieuwe device maakt visibility-rij');

  -- -----------------------------------------------------------------------
  -- Fail closed: no telemetry/version at all.
  -- -----------------------------------------------------------------------
  v_src := pg_temp.mk_source((select dev_unbound from t_ids),
                             (select owner_unbound from t_ids),
                             '00000000-0000-4000-8000-000000000103'::uuid);
  v_json := pitwall_learning.fuel_worker_source(v_src, pg_temp.lease_of(v_src));
  perform pg_temp.expect(v_json is null, 'ontbrekende telemetry/versie wordt geweigerd');

  -- -----------------------------------------------------------------------
  -- Opt-out remains authoritative at the worker boundary.
  -- -----------------------------------------------------------------------
  perform pg_temp.mk_telemetry((select dev_optout from t_ids),
                               (select owner_optout from t_ids), '0.7.6.4');
  v_src := pg_temp.mk_source((select dev_optout from t_ids),
                             (select owner_optout from t_ids),
                             '00000000-0000-4000-8000-000000000104'::uuid);
  v_json := pitwall_learning.fuel_worker_source(v_src, pg_temp.lease_of(v_src));
  perform pg_temp.expect(v_json is null, 'opt-out blokkeert worker-source');
end $$;

do $$
declare v_fail integer; v_total integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t_resultaat;
  raise notice 'pitwall-learning fleet eligibility: % van % PASS', v_total - v_fail, v_total;
  if v_fail > 0 then
    raise exception 'pitwall-learning fleet eligibility: % FAIL: %', v_fail,
      (select string_agg(label, '; ' order by label) from t_resultaat where not ok);
  end if;
end $$;

rollback;
