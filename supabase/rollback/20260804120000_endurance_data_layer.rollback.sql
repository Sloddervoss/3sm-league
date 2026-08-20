BEGIN;

-- Rollback of the Endurance data layer after all later Endurance rollbacks.
-- Remove publication membership and triggers before dependent tables/functions.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'endurance_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_notifications;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'endurance_stints'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.endurance_stints;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS endurance_stints_touch ON public.endurance_stints;
DROP TRIGGER IF EXISTS endurance_teams_touch ON public.endurance_teams;
DROP TRIGGER IF EXISTS endurance_events_touch ON public.endurance_events;
DROP FUNCTION IF EXISTS public.endurance_touch_updated_at();

DROP TABLE IF EXISTS public.endurance_audit_log;
DROP TABLE IF EXISTS public.endurance_notifications;
DROP TABLE IF EXISTS public.endurance_confirmations;
DROP TABLE IF EXISTS public.endurance_planning_versions;
DROP TABLE IF EXISTS public.endurance_stints;
DROP TABLE IF EXISTS public.endurance_team_members;
DROP TABLE IF EXISTS public.endurance_teams;
DROP TABLE IF EXISTS public.endurance_pace_entries;
DROP TABLE IF EXISTS public.endurance_availability;
DROP TABLE IF EXISTS public.endurance_registrations;
DROP TABLE IF EXISTS public.endurance_events;

DROP TYPE IF EXISTS public.endurance_notification_type;
DROP TYPE IF EXISTS public.endurance_confirmation_status;
DROP TYPE IF EXISTS public.endurance_team_role;
DROP TYPE IF EXISTS public.endurance_stint_status;
DROP TYPE IF EXISTS public.endurance_availability_type;
DROP TYPE IF EXISTS public.endurance_registration_status;
DROP TYPE IF EXISTS public.endurance_event_visibility;
DROP TYPE IF EXISTS public.endurance_event_status;

COMMIT;
