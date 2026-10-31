-- ============================================================================
-- TESTFIXTURE — GEEN PRODUCTIESCHEMA
-- Datum: 2026-10-31
-- Hoort bij: supabase/tests/plugin08_server_proposal.sql
--
-- Dit bestand bouwt het minimum aan tabellen, kolommen en functies dat
-- simhub_persist_v3 nodig heeft om te kunnen draaien. Het is met opzet GEEN
-- kopie van productie: alleen de kolommen die de functie werkelijk aanraakt
-- staan erin. Daarmee test je de signatuur, de argumentafhandeling, de
-- meetbatch en de idempotentie — niet de volledige productiesemantiek van
-- strategie, ankers en practice.
--
-- Draai dit in een wegwerpdatabank of wegwerpschema, nooit in productie:
--   createdb plugin08_test
--   psql -X -v ON_ERROR_STOP=1 -d plugin08_test \
--     -f supabase/tests/fixtures/plugin08_stub_schema.sql \
--     -f supabase/migrations/20261031180000_plugin08_measurement_events.sql \
--     -f supabase/migrations/20261031180100_plugin08_lap_summaries.sql \
--     -f supabase/migrations/20261031180200_plugin08_connector_control.sql \
--     -f supabase/migrations/20261031180300_plugin08_persist_v3_aggregates.sql \
--     -f supabase/tests/plugin08_server_proposal.sql
--
-- De rollbacks van de drie databestanden horen er NIET bij: die draaien de
-- tabellen weg die de tests juist controleren.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Rollen en auth, zoals Supabase die levert.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- Apparaten en sessies
-- ---------------------------------------------------------------------------
create table if not exists public.simhub_devices (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  device_name text,
  connector_id text,
  owner_user_id uuid,
  race_id uuid,
  team_id uuid,
  endurance_event_id uuid,
  endurance_team_id uuid,
  endurance_binding_source text,
  device_status text,
  device_role text,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  last_session_id text,
  last_sequence bigint,
  updated_at timestamptz default now()
);

create unique index if not exists simhub_devices_token_hash_key on public.simhub_devices (token_hash);

create table if not exists public.simhub_device_sessions (
  device_id uuid not null,
  session_id text not null,
  last_sequence bigint not null default 0,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  primary key (device_id, session_id)
);

create table if not exists public.simhub_telemetry_latest (
  device_id uuid primary key,
  owner_user_id uuid,
  race_id uuid,
  team_id uuid,
  session_id text,
  sequence bigint,
  captured_at timestamptz,
  received_at timestamptz,
  connector_id text,
  simhub_version text,
  connector_version text,
  game text,
  telemetry jsonb default '{}'::jsonb,
  endurance_event_id uuid,
  endurance_team_id uuid,
  race_run_id uuid,
  driver_id text,
  current_driver_id text,
  current_driver_name text,
  v3_normalized jsonb,
  car_id text,
  car_name text,
  track_name text,
  track_config text
);

-- ---------------------------------------------------------------------------
-- Endurance-kern (alleen wat persist_v3 leest of schrijft)
-- ---------------------------------------------------------------------------
create table if not exists public.endurance_events (
  id uuid primary key default gen_random_uuid(),
  start_at timestamptz,
  end_at timestamptz,
  iracing_catalog_event_id uuid
);

create table if not exists public.endurance_iracing_events (
  id uuid primary key default gen_random_uuid(),
  track_id integer
);

create table if not exists public.endurance_race_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid,
  team_id uuid,
  run_kind text,
  status text,
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table if not exists public.endurance_source_segments (
  device_id uuid not null,
  session_id text not null,
  event_id uuid not null,
  team_id uuid not null,
  race_run_id uuid,
  last_sequence bigint,
  previous_completed_laps integer,
  previous_in_pit_lane boolean,
  previous_incidents integer,
  previous_flags text[],
  updated_at timestamptz default now(),
  primary key (device_id, session_id, event_id, team_id)
);

create table if not exists public.endurance_strategy_lap_samples (
  id uuid primary key default gen_random_uuid(),
  race_run_id uuid,
  event_id uuid,
  team_id uuid,
  device_id uuid,
  source_device_id uuid,
  session_id text,
  completed_laps integer,
  captured_at timestamptz default now(),
  wear_fl numeric,
  wear_fr numeric,
  wear_rl numeric,
  wear_rr numeric
);

create table if not exists public.endurance_telemetry_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid,
  event_id uuid,
  team_id uuid,
  session_id text,
  event_type text,
  event_key text,
  sequence bigint,
  captured_at timestamptz,
  event_detection_source text,
  completed_laps integer,
  driver_id text,
  lap integer,
  lap_time_from_deltas_s numeric,
  payload jsonb,
  race_run_id uuid,
  in_pit_lane boolean,
  fuel_litres numeric,
  fuel_per_lap_litres numeric
);

create table if not exists public.endurance_tyre_anchors (
  id uuid primary key default gen_random_uuid(),
  event_id uuid,
  team_id uuid,
  race_run_id uuid,
  device_id uuid,
  session_id text,
  stint_no integer,
  anchor_lap integer,
  tyre_set_no integer,
  tyre_changed boolean,
  wear_fl numeric, wear_fr numeric, wear_rl numeric, wear_rr numeric,
  wear_fl_l numeric, wear_fl_m numeric, wear_fl_r numeric,
  wear_fr_l numeric, wear_fr_m numeric, wear_fr_r numeric,
  wear_rl_l numeric, wear_rl_m numeric, wear_rl_r numeric,
  wear_rr_l numeric, wear_rr_m numeric, wear_rr_r numeric,
  track_temp_c numeric,
  air_temp_c numeric,
  rubber_state text,
  wear_source text,
  wear_frozen boolean,
  anchor_usable boolean,
  captured_at timestamptz default now(),
  unique (race_run_id, stint_no)
);

create table if not exists public.endurance_practice_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid,
  circuit text,
  started_at timestamptz default now(),
  ended_at timestamptz
);

create table if not exists public.endurance_practice_laps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid,
  event_id uuid,
  user_id uuid,
  car_id text,
  car_name text,
  circuit text,
  lap_seconds numeric,
  fuel_used_litres numeric,
  fuel_per_lap_litres numeric,
  incident_count integer,
  recorded_at timestamptz,
  source_session_id text,
  source_device_id uuid,
  completed_laps integer
);

create unique index if not exists endurance_practice_laps_source_key
  on public.endurance_practice_laps (event_id, source_session_id, source_device_id, completed_laps)
  where source_session_id is not null and source_device_id is not null and completed_laps is not null;

create table if not exists public.endurance_team_members (
  team_id uuid,
  event_id uuid,
  user_id uuid
);

create table if not exists public.profiles (
  user_id uuid primary key,
  iracing_name text,
  display_name text
);

-- ---------------------------------------------------------------------------
-- Hulptaken die persist_v3 aanroept
-- ---------------------------------------------------------------------------
create or replace function public.simhub_name_key(p_name text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]', '', 'g'))
$$;

create or replace function public.simhub_resolve_driver_user(p_event uuid, p_team uuid, p_name text)
returns text
language sql
stable
as $$
  select null::text
$$;

create or replace function public.simhub_start_race_run(p_event uuid, p_team uuid, p_kind text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.endurance_race_runs (event_id, team_id, run_kind, status)
  values (p_event, p_team, p_kind, 'active')
  returning id into v_id;
  return v_id;
end
$$;

create or replace function public.simhub_update_strategy_v3(
  p_race_run uuid,
  p_device uuid,
  p_session text,
  p_sequence bigint,
  p_event uuid,
  p_team uuid,
  p_completed_laps integer,
  p_fuel numeric,
  p_in_pit boolean,
  p_last_laptime numeric,
  p_session_laps integer,
  p_baseline boolean,
  p_previous_laps integer,
  p_previous_in_pit boolean)
returns void
language plpgsql
as $$
begin
  -- Fixture: één lap-sample per ronde, zodat de functie echt iets schrijft en de
  -- wear-update erna een doel heeft.
  if p_completed_laps is not null then
    insert into public.endurance_strategy_lap_samples (
      race_run_id, event_id, team_id, device_id, source_device_id, session_id,
      completed_laps, captured_at, wear_fl, wear_fr, wear_rl, wear_rr)
    values (p_race_run, p_event, p_team, p_device, p_device, p_session,
            p_completed_laps, now(), null, null, null, null)
    on conflict do nothing;
  end if;
end
$$;

-- De rol zet de tests zelf met: set request.jwt.claim.role = 'service_role';
