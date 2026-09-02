-- TEST FIXTURE ONLY
-- RECOVERED FROM PRODUCTION SCHEMA AUDIT on 2026-09-02.
-- DO NOT APPLY TO PRODUCTION.
-- NOT A HISTORICAL MIGRATION.
-- Reconstructs the observed PRE-PHASE-E contract only.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() NOT IN ('phase_e_test', 'test_pre_phase_e_baseline', 'test_phase_f') THEN
    RAISE EXCEPTION 'ABORT: disposable baseline fixture forbidden on database %', current_database();
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS public.simhub_devices (
  id uuid PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS public.endurance_events (
  id uuid PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS public.endurance_teams (
  id uuid PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS public.races (
  id uuid PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY
);

-- Faithful stubs for policy expressions used by the recovered production tables.
CREATE OR REPLACE FUNCTION public.can_manage_simhub()
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.is_active_simhub_device(p_device_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE TABLE public.endurance_telemetry_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  device_id uuid NOT NULL,
  event_id uuid NOT NULL,
  team_id uuid NOT NULL,
  session_id text NOT NULL,
  event_type text NOT NULL,
  event_key text NOT NULL,
  sequence bigint NOT NULL,
  captured_at timestamp with time zone NOT NULL,
  received_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  lap integer,
  completed_laps integer,
  driver_id text,
  stint_elapsed_s numeric,
  session_time_s numeric,
  fuel_litres numeric,
  fuel_per_lap_litres numeric,
  fuel_added_est_litres numeric,
  laps_remaining_est numeric,
  lap_time_from_deltas_s numeric,
  in_pit_lane boolean,
  incidents integer,
  flag text,
  is_in_car boolean,
  event_detection_source text NOT NULL,
  payload jsonb,
  CONSTRAINT endurance_telemetry_events_event_type_check CHECK (
    event_type = ANY (ARRAY['sample'::text, 'lap_completed'::text, 'pit_entry'::text,
      'pit_exit'::text, 'fuel_added'::text, 'driver_change'::text,
      'stint_start'::text, 'stint_end'::text, 'flag_change'::text,
      'car_state_change'::text])
  )
);
ALTER TABLE ONLY public.endurance_telemetry_events
  ADD CONSTRAINT endurance_telemetry_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.endurance_telemetry_events
  ADD CONSTRAINT endurance_telemetry_events_device_id_fkey FOREIGN KEY (device_id)
  REFERENCES public.simhub_devices(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.endurance_telemetry_events
  ADD CONSTRAINT endurance_telemetry_events_event_id_fkey FOREIGN KEY (event_id)
  REFERENCES public.endurance_events(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.endurance_telemetry_events
  ADD CONSTRAINT endurance_telemetry_events_team_id_fkey FOREIGN KEY (team_id)
  REFERENCES public.endurance_teams(id) ON DELETE CASCADE;
CREATE INDEX endurance_telemetry_events_context_idx
  ON public.endurance_telemetry_events (event_id, team_id, captured_at DESC);
CREATE UNIQUE INDEX endurance_telemetry_events_key_uniq
  ON public.endurance_telemetry_events (device_id, session_id, event_key);
CREATE INDEX endurance_telemetry_events_type_idx
  ON public.endurance_telemetry_events (event_id, event_type, captured_at DESC);
ALTER TABLE public.endurance_telemetry_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read full endurance telemetry events"
  ON public.endurance_telemetry_events FOR SELECT TO authenticated
  USING (public.can_manage_simhub());
GRANT ALL ON TABLE public.endurance_telemetry_events TO authenticated, service_role;

CREATE TABLE public.simhub_telemetry_latest (
  device_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  race_id uuid,
  team_id uuid,
  session_id text NOT NULL,
  sequence bigint NOT NULL,
  captured_at timestamp with time zone NOT NULL,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  connector_id text NOT NULL,
  simhub_version text NOT NULL,
  game text NOT NULL,
  telemetry jsonb NOT NULL,
  endurance_event_id uuid,
  endurance_team_id uuid,
  driver_id text,
  current_driver_id text,
  current_driver_name text,
  car_id text,
  car_name text,
  track_name text,
  track_config text,
  CONSTRAINT simhub_telemetry_latest_connector_id_check CHECK ((char_length(connector_id) >= 1) AND (char_length(connector_id) <= 120)),
  CONSTRAINT simhub_telemetry_latest_context_shape CHECK (((race_id IS NULL) AND (team_id IS NULL)) OR ((race_id IS NOT NULL) AND (team_id IS NOT NULL))),
  CONSTRAINT simhub_telemetry_latest_game_check CHECK (game = 'IRacing'::text),
  CONSTRAINT simhub_telemetry_latest_sequence_check CHECK (sequence >= 0),
  CONSTRAINT simhub_telemetry_latest_session_id_check CHECK ((char_length(session_id) >= 1) AND (char_length(session_id) <= 120)),
  CONSTRAINT simhub_telemetry_latest_simhub_version_check CHECK ((char_length(simhub_version) >= 1) AND (char_length(simhub_version) <= 60)),
  CONSTRAINT simhub_telemetry_latest_telemetry_check CHECK (jsonb_typeof(telemetry) = 'object'::text)
);
ALTER TABLE ONLY public.simhub_telemetry_latest REPLICA IDENTITY FULL;
ALTER TABLE ONLY public.simhub_telemetry_latest
  ADD CONSTRAINT simhub_telemetry_latest_pkey PRIMARY KEY (device_id);
ALTER TABLE ONLY public.simhub_telemetry_latest
  ADD CONSTRAINT simhub_telemetry_latest_device_id_fkey FOREIGN KEY (device_id)
  REFERENCES public.simhub_devices(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.simhub_telemetry_latest
  ADD CONSTRAINT simhub_telemetry_latest_owner_user_id_fkey FOREIGN KEY (owner_user_id)
  REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.simhub_telemetry_latest
  ADD CONSTRAINT simhub_telemetry_latest_race_id_fkey FOREIGN KEY (race_id)
  REFERENCES public.races(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.simhub_telemetry_latest
  ADD CONSTRAINT simhub_telemetry_latest_team_id_fkey FOREIGN KEY (team_id)
  REFERENCES public.teams(id) ON DELETE CASCADE;
CREATE INDEX simhub_telemetry_latest_race_team_idx
  ON public.simhub_telemetry_latest (race_id, team_id, received_at DESC);
ALTER TABLE public.simhub_telemetry_latest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can read active latest SimHub telemetry"
  ON public.simhub_telemetry_latest FOR SELECT TO authenticated
  USING ((public.can_manage_simhub() AND public.is_active_simhub_device(device_id)));
GRANT ALL ON TABLE public.simhub_telemetry_latest TO service_role;
GRANT SELECT ON TABLE public.simhub_telemetry_latest TO authenticated;

-- Production also grants ALL to postgres; the disposable database owner has equivalent ownership.
-- PUBLIC and anon receive no table grants in the recovered production schema.
