-- 3SM Endurance — Realtime-publicatie voor live samenwerking (additief).
--
-- De data-laag publiceerde alleen endurance_stints en endurance_notifications
-- via supabase_realtime. Voor live race control, stints-planner en
-- event/calendar moeten ook de events- en teamtabellen gepusht worden, zodat
-- ándere gebruikers een wijziging zien zonder te verversen.
--
-- Additief en zero-downtime: voegt alleen tabellen toe aan de bestaande
-- publicatie. De client-subscriptie (postgres_changes) respecteert RLS — dus
-- alleen rijen waarop de ingelogde rol SELECT-recht heeft worden gepusht
-- (deze endurance-tabellen zijn super-admin-only). Geen data-escape.

BEGIN;

-- Event/Cyclus & kalender
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_events;

-- Teams & leden (race control workspace)
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_teams;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_team_members;

-- Stint-planner: beschikbaarheid + geplande versies live (versies & bevestiging)
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_availability;
ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_planning_versions;

-- Stints worden reeds gepubliceerd (data-layer-migratie); hier expliciet
-- herbekrachtigd ter volledigheid (idempotent-veilig, geen dubbele rij).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'endurance_stints'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.endurance_stints;
  END IF;
END;
$$;

COMMIT;
