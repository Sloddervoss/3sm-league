-- Rollback: remove the service-only practice ingest RPC before practice tables.
BEGIN;

DROP FUNCTION IF EXISTS public.endurance_record_practice_lap(
  UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, SMALLINT, TEXT, TEXT, TIMESTAMPTZ
);

COMMIT;
