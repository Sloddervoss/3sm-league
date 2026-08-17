BEGIN;

-- Rollback: verwijder de door deze migratie toegevoegde realtime-publicatie.
-- Laat endurance_stints staan (die werd door de data-layer-migratie toegevoegd).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'endurance_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_events;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'endurance_teams'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_teams;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'endurance_team_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_team_members;
  END IF;
END;
$$;

COMMIT;