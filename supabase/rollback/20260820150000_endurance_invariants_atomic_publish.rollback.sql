-- Rollback: Endurance invariants + atomic plan publication.
BEGIN;

REVOKE ALL ON FUNCTION public.endurance_publish_plan(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.endurance_publish_plan(uuid, uuid, text, jsonb, jsonb);

DROP INDEX IF EXISTS public.endurance_planning_versions_one_published_per_event_team_idx;
DROP INDEX IF EXISTS public.endurance_practice_sessions_one_open_per_event_team_idx;
DROP INDEX IF EXISTS public.endurance_team_members_one_per_user_event_idx;

DROP TRIGGER IF EXISTS endurance_team_members_derive_event_trg ON public.endurance_team_members;
DROP FUNCTION IF EXISTS public.endurance_team_members_derive_event();

ALTER TABLE public.endurance_team_members
  DROP COLUMN IF EXISTS event_id;

COMMIT;