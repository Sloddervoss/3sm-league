-- ============================================================================
-- DISPOSABLE TEST BASELINE — GEEN PRODUCTIESCHEMA
--
-- Alleen voor de wegwerp-PostgreSQL-container
--   pitwall-learning-p2-readiness-policy-s2e2
--   database pitwall_learning_p2_readiness_policy_s2e2
--   PGDATA /work/data, Unix-socket /work/socket, listen_addresses = ''
--
-- Rollen en auth-stub. De echte tabellen komen uit de migratieketen; de
-- synthetische accounts/apparaten/policies staan in
-- pitwall-learning-p2-readiness-policy-seed.sql (na de P1-keten).
--
-- De guard weigert elke andere database, data_directory of TCP-verbinding.
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p2_readiness_policy_s2e2'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'S2E2 BASELINE: wrong database or data_directory';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'S2E2 BASELINE: TCP connection is not allowed';
  END IF;
END
$guard$;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN SUPERUSER;
  END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  aud text,
  role text,
  is_sso_user boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;
GRANT USAGE ON SCHEMA auth TO supabase_admin;
GRANT SELECT, REFERENCES ON auth.users TO supabase_admin;
GRANT SELECT ON auth.users TO anon, authenticated;
