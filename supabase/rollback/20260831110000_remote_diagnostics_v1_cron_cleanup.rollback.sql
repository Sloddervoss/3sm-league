-- ============================================================================
-- Rollback: Remote Diagnostics v1 — pg_cron periodieke 7-dagen cleanup
-- ============================================================================

-- 1. Haal cron job uit de scheduler (uitvoeren op postgres DB)
-- psql -U postgres -d postgres -c "SELECT cron.unschedule('diagnostics-7day-cleanup');"

-- 2. Drop de cleanup function (uitvoeren op app-DB)
DROP FUNCTION IF EXISTS public.simhub_cleanup_old_diagnostic_events();