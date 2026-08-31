-- ============================================================================
-- Remote Diagnostics v1 — pg_cron periodieke 7-dagen cleanup
-- Datum: 2026-08-31 | Branch: fix/endurance-alpha-hardening
-- Release: 0.3.10.0 (nog NIET gedeployed naar productie)
--
-- Deze migration voegt:
-- 1. Een cleanup-functie in de app-database (wordt door pg_cron aangeroepen)
-- 2. Instructie om de pg_cron job te schedulen vanuit de postgres DB
--    (pg_cron extension draait alleen in postgres database)
-- ============================================================================

-- Function specifiek voor periodieke cleanup. SECURITY DEFINER zodat pg_cron
-- (die als postgres draait) de functie ook kan uitvoeren.
CREATE OR REPLACE FUNCTION public.simhub_cleanup_old_diagnostic_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    DELETE FROM simhub_device_diagnostic_events
    WHERE received_at < now() - interval '7 days';
END;
$$;

-- De pg_cron extensie en scheduling zijn apart uitgevoerd op de postgres
-- database (zie supabase/rollback/20260831110000_remote_diagnostics_v1_cron_setup.sql).
-- De migration maakt alleen de functie aan; de cron job wordt bij de
-- eerste productie-deploy handmatig geactiveerd.