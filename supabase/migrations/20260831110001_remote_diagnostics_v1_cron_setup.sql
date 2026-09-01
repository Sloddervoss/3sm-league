-- ============================================================================
-- Remote Diagnostics v1 — 7-day retention via pg_cron (forward migration)
-- ============================================================================
-- Deze migration is IDEMPOTENT en veilig.
-- Gebruikt de bestaande pg_cron extensie (verondersteld aanwezig op postgres DB).
--
-- Rollback: supabase/rollback/20260831110001_remote_diagnostics_v1_cron_setup.rollback.sql
-- ============================================================================

-- 1. De cleanup function moet bestaan voordat cron hem kan aanroepen.
--    Deze wordt aangemaakt door migration 20260831110000.

-- 2. Schedule de dagelijkse cleanup via pg_cron.
--    Idempotent: unschedule eerst de oude job als die bestaat, daarna opnieuw.
DO $migration$
BEGIN
    -- Verwijder oude job eerst (idempotent)
    PERFORM cron.unschedule('diagnostics-7day-cleanup');
    
    -- Schedule opnieuw: elke dag om 03:00 server-tijd
    PERFORM cron.schedule(
        'diagnostics-7day-cleanup',
        '0 3 * * *',
        $$SELECT public.simhub_cleanup_old_diagnostic_events();$$
    );
END
$migration$;