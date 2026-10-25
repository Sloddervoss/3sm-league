-- ============================================================================
-- Rollback — 20261025120000_endurance_telemetry_archive
-- Datum: 2026-10-25
--
-- Draait het telemetrie-archief volledig terug: de uurlijkse taak, de
-- identiteitshulp en de tabel met alle gearchiveerde rondes.
--
-- LET OP: dit verwijdert de gearchiveerde rondes. De bron (de lap-samples in
-- endurance_strategy_lap_samples) blijft staan, dus na opnieuw toepassen van de
-- migratie vult de eerste loop het archief opnieuw — behalve voor rondes
-- waarvan de run inmiddels is opgeruimd.
-- ============================================================================

BEGIN;

-- Eerst de taak weg, anders schrijft cron in een tabel die op het punt staat te
-- verdwijnen (en faalt de job daarna elke nacht zichtbaar in cron.job_run_details).
SELECT cron.unschedule('endurance-archive')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'endurance-archive');

DROP FUNCTION IF EXISTS public.endurance_archive_tick();
DROP FUNCTION IF EXISTS public.endurance_archive_run_identity(uuid);

-- De policies en indexen hangen aan de tabel en verdwijnen mee.
DROP TABLE IF EXISTS public.endurance_telemetry_archive;

COMMIT;
