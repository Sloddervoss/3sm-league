-- Rollback for 20261121120000_pace_history_identity_guard.sql
BEGIN;

DROP TRIGGER IF EXISTS simhub_telemetry_latest_pace_guard ON public.simhub_telemetry_latest;
DROP FUNCTION IF EXISTS public.simhub_pace_history_guard_v1();

COMMIT;
