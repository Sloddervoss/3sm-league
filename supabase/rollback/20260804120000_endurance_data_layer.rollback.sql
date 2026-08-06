BEGIN;

-- Rollback van de 3SM Endurance datalaag (Fase 2).
-- Uitsluitend objecten met de prefix `endurance_` worden verwijderd; geen
-- enkel bestaand productie-object wordt geraakt.

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
