\set ON_ERROR_STOP on

-- HARD GUARD: every mutation below is allowed only in the disposable test DB.
DO $$
BEGIN
  IF current_database() <> 'test_diagnostics_v1' THEN
    RAISE EXCEPTION 'ABORT: expected test_diagnostics_v1, got %', current_database();
  END IF;
  IF current_user <> 'supabase_admin' THEN
    RAISE EXCEPTION 'ABORT: expected supabase_admin, got %', current_user;
  END IF;
END $$;
SELECT current_database(), current_user;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), current_user) $$;

CREATE TABLE public.simhub_devices (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  connector_id text NOT NULL,
  device_name text NOT NULL,
  device_status text NOT NULL DEFAULT 'inactive',
  revoked_at timestamptz,
  last_seen_at timestamptz,
  last_session_id text,
  last_sequence bigint NOT NULL DEFAULT -1,
  paired_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.can_manage_simhub() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT true $$;

INSERT INTO auth.users(id, email) VALUES
('eeeeeeee-0000-4000-8000-000000000001', 'fixture@invalid.local');
INSERT INTO public.simhub_devices
(id, owner_user_id, token_hash, connector_id, device_name, device_status, revoked_at)
VALUES
('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-4000-8000-000000000001','bcbaa4dd4123326e25433af62da12d9f0ddbe8a9f56e9a92c8d518a8e3b5afce','E2E-A','E2E A','inactive',NULL),
('bbbbbbbb-0000-0000-0000-000000000002','eeeeeeee-0000-4000-8000-000000000001','13e2ff4814eee63d046ffd0c00a1b506a5866c596859bcd6bda02fc92c4dfb55','E2E-B','E2E B','inactive',NULL),
('cccccccc-0000-0000-0000-000000000003','eeeeeeee-0000-4000-8000-000000000001','074f21e3180de564569fea166b51551b3c7edfe31350f99baa47bec5bf2f45b4','E2E-R','E2E revoked','revoked',now()),
('dddddddd-0000-0000-0000-000000000004','eeeeeeee-0000-4000-8000-000000000001','fef18df3d890430d7f3cb107c367246bc59ea10764bd0ea06b7f578a07f42b0c','E2E-U','E2E unbound','inactive',NULL);

CREATE TABLE public.simhub_device_sessions (
  device_id uuid NOT NULL REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  last_sequence bigint NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(device_id, session_id)
);
CREATE TABLE public.simhub_telemetry_latest (
  device_id uuid PRIMARY KEY REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  sequence bigint NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  connector_id text NOT NULL,
  simhub_version text NOT NULL,
  game text NOT NULL,
  telemetry jsonb NOT NULL
);
CREATE TABLE public.endurance_telemetry_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  sequence bigint NOT NULL,
  session_time_s double precision,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, session_id, sequence)
);

CREATE OR REPLACE FUNCTION public.simhub_ingest_snapshot(
  p_token_hash text, p_session_id text, p_sequence bigint,
  p_captured_at timestamptz, p_connector_id text, p_simhub_version text,
  p_game text, p_telemetry jsonb, p_driver_id text DEFAULT NULL,
  p_current_driver_id text DEFAULT NULL, p_current_driver_name text DEFAULT NULL,
  p_car_id text DEFAULT NULL, p_car_name text DEFAULT NULL,
  p_track_name text DEFAULT NULL, p_track_config text DEFAULT NULL
) RETURNS TABLE(result text, received_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_device public.simhub_devices%ROWTYPE; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_device FROM public.simhub_devices
  WHERE token_hash = p_token_hash AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid_device'::text, NULL::timestamptz; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.simhub_device_sessions WHERE device_id=v_device.id AND session_id=p_session_id AND last_sequence >= p_sequence) THEN
    RETURN QUERY SELECT 'replayed'::text, NULL::timestamptz; RETURN;
  END IF;
  INSERT INTO public.simhub_device_sessions(device_id,session_id,last_sequence,first_seen_at,last_seen_at)
  VALUES(v_device.id,p_session_id,p_sequence,v_now,v_now)
  ON CONFLICT(device_id,session_id) DO UPDATE SET last_sequence=EXCLUDED.last_sequence,last_seen_at=EXCLUDED.last_seen_at;
  UPDATE public.simhub_devices SET last_seen_at=v_now,last_session_id=p_session_id,last_sequence=p_sequence,updated_at=v_now WHERE id=v_device.id;
  INSERT INTO public.simhub_telemetry_latest(device_id,session_id,sequence,captured_at,received_at,connector_id,simhub_version,game,telemetry)
  VALUES(v_device.id,p_session_id,p_sequence,p_captured_at,v_now,p_connector_id,p_simhub_version,p_game,p_telemetry)
  ON CONFLICT(device_id) DO UPDATE SET session_id=EXCLUDED.session_id,sequence=EXCLUDED.sequence,captured_at=EXCLUDED.captured_at,received_at=EXCLUDED.received_at,connector_id=EXCLUDED.connector_id,simhub_version=EXCLUDED.simhub_version,game=EXCLUDED.game,telemetry=EXCLUDED.telemetry;
  INSERT INTO public.endurance_telemetry_events(device_id,session_id,sequence,session_time_s,received_at)
  VALUES(v_device.id,p_session_id,p_sequence,(p_telemetry->>'sessionTimeSeconds')::double precision,v_now);
  RETURN QUERY SELECT 'accepted'::text, v_now;
END $$;

CREATE OR REPLACE FUNCTION public.diagnostics_test_database_identity()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT current_database()::text $$;

GRANT USAGE ON SCHEMA public, auth TO diagnostic_test, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO diagnostic_test, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO diagnostic_test, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO diagnostic_test, service_role;
GRANT service_role TO diagnostic_test;
NOTIFY pgrst, 'reload schema';
