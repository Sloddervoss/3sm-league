-- ============================================================================
-- DISPOSABLE TEST BASELINE — GEEN PRODUCTIESCHEMA
--
-- Alleen voor de wegwerp-PostgreSQL-container
--   pitwall-learning-p2-observation-s1
--   database pitwall_learning_p2_observation_s1
--   PGDATA /work/data, Unix-socket /work/socket, listen_addresses = ''
--
-- Dit bestand maakt uitsluitend de Supabase-rollen, het auth-schema en een
-- minimale auth.users-stub. De echte tabellen komen uit de migratieketen
-- (plugin08 20261031180000..20261031200500 + P1 20261111163052). Er is geen
-- productie-dump, geen productie-secret en geen echte rij.
--
-- De guard weigert elke andere database, data_directory of TCP-verbinding.
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p2_observation_s1'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'DISPOSABLE BASELINE: wrong database or data_directory';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'DISPOSABLE BASELINE: TCP connection is not allowed';
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
  -- Eigenaar van het private P1-schema. In de self-hosted Supabase-installatie
  -- is supabase_admin een superuser; de stub volgt dat, anders kunnen de
  -- P1-triggers op gedeelde public-tabellen niet worden gemaakt.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN SUPERUSER;
  END IF;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS auth;

-- Alleen de kolommen die de migratieketen en de P1-fixture werkelijk aanraken.
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
-- De private P1-objecten zijn eigendom van supabase_admin en verwijzen/lezen
-- auth.users. In de echte Supabase-installatie is dat een geprivilegieerde rol;
-- deze stub maakt alleen de rechten expliciet die de migratieketen nodig heeft.
GRANT USAGE ON SCHEMA auth TO supabase_admin;
GRANT SELECT, REFERENCES ON auth.users TO supabase_admin;
GRANT SELECT ON auth.users TO anon, authenticated;

-- Test-only spoor voor de v1-hashvector vóór de migratie. Wordt aan het eind
-- van de rollbacktest weer verwijderd; het maakt geen deel uit van de
-- migratie en is geen productieobject.
CREATE TABLE IF NOT EXISTS public.t13_test_vectors (
  label text PRIMARY KEY,
  hash text NOT NULL,
  payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
