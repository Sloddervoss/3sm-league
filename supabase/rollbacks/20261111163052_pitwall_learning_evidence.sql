-- ============================================================================
-- Rollback voor 20261111163052_pitwall_learning_evidence.sql
--
-- Doel: capture veilig uitzetten, de worker-API/LOGIN afsluiten en alle
-- kill switches op FALSE zetten, zonder één bewijsrij te verwijderen.
--
-- Bewust NIET:
--   * geen DROP SCHEMA (en zeker geen CASCADE);
--   * geen DROP/TRUNCATE/DELETE van source_revisions, jobs of P2-tabellen;
--   * geen wijziging aan public-tabellen, public-policies of public-grants.
--
-- Gevolg: het private schema en alle reeds vastgelegde bewijsdata blijven
-- bestaan. De workerrol blijft als naam bestaan maar is NOLOGIN met
-- CONNECTION LIMIT 0 en heeft geen schema-USAGE of EXECUTE meer. Omdat de
-- forward-migratie een bestaand schema/rol weigert te adopteren, is een
-- echte herstart van P1 een aparte, gecontroleerde stap (schema archiveren
-- of verwijderen na expliciete goedkeuring); deze rollback doet dat nooit
-- stilzwijgend.
--
-- Forward en rollback zijn beide transactioneel aan te bieden (geen eigen
-- BEGIN/COMMIT).
-- ============================================================================

DO $guard$
BEGIN
  IF to_regnamespace('pitwall_learning') IS NULL THEN
    RAISE EXCEPTION 'pitwall_learning schema is missing; nothing to roll back';
  END IF;
END
$guard$;

SET LOCAL ROLE supabase_admin;

-- 1. Capturetriggers weg. Dit is de enige wijziging aan public-tabellen.
DROP TRIGGER IF EXISTS pitwall_learning_capture_event_ins
  ON public.simhub_measurement_events;
DROP TRIGGER IF EXISTS pitwall_learning_capture_event_upd
  ON public.simhub_measurement_events;
DROP TRIGGER IF EXISTS pitwall_learning_capture_lap_ins
  ON public.simhub_lap_summaries;
DROP TRIGGER IF EXISTS pitwall_learning_capture_lap_upd
  ON public.simhub_lap_summaries;
-- Compatibiliteit met de eerste reviewronde (twee row-triggers). Op een
-- verse forward bestaan deze niet; op een reeds opgebouwde testkloon wel.
DROP TRIGGER IF EXISTS pitwall_learning_capture_event
  ON public.simhub_measurement_events;
DROP TRIGGER IF EXISTS pitwall_learning_capture_lap
  ON public.simhub_lap_summaries;

-- 2. Alle kill switches expliciet uit, inclusief een eventueel per ongeluk
--    aangezette shadow/advice-vlag. De rij zelf blijft bestaan.
UPDATE pitwall_learning.runtime_settings
   SET capture_enabled = false,
       worker_enabled = false,
       shadow_enabled = false,
       advice_enabled = false,
       updated_at = now()
 WHERE id = 1;

-- 3. Worker-API en LOGIN afsluiten. De rol wordt niet gedropt: dat zou een
--    aparte beheeractie zijn en is niet nodig om toegang te blokkeren.
DO $revoke$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitwall_learning_worker') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA pitwall_learning FROM pitwall_learning_worker';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA pitwall_learning FROM pitwall_learning_worker';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA pitwall_learning FROM pitwall_learning_worker';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pitwall_learning FROM pitwall_learning_worker';
    EXECUTE 'ALTER ROLE pitwall_learning_worker NOLOGIN';
    EXECUTE 'ALTER ROLE pitwall_learning_worker CONNECTION LIMIT 0';
  END IF;
END
$revoke$;

-- 4. Bewijsdata blijft onaangeroerd. Geen DML op source_revisions/jobs.
