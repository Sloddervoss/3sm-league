-- ============================================================================
-- Remote Diagnostics v1 — pg_cron job scheduling (uitvoeren op postgres DB!)
-- ============================================================================
-- Dit script wordt NIET door de normale migration runner uitgevoerd.
-- Voer het éénmalig handmatig uit op de postgres database nadat de
-- migration 20260831110000 is toegepast:
--
--   psql -U postgres -d postgres -f supabase/rollback/20260831110000_remote_diagnostics_v1_cron_setup.sql
-- ============================================================================

-- pg_cron extension aanmaken (indien nog niet gedaan)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Dagelijkse cleanup: elke dag om 03:00 server-tijd.
-- pg_cron draait in de postgres database (cron.database_name), waar ook de
-- cleanup-functie en de tabellen leven (POSTGRES_DB=postgres in productie).
SELECT cron.schedule(
    'diagnostics-7day-cleanup',       -- job name (voor unschedule)
    '0 3 * * *',                       -- elke dag 3:00 AM
    $$SELECT public.simhub_cleanup_old_diagnostic_events();$$
);