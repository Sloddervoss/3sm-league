-- Rollback: 20260806_endurance_auto_binding
-- Haalt de automatische device->team-koppeling + bronmarkering terug naar de
-- vorige staat (handmatige toewijzing via assign/clear blijft, zonder bronkolom).
BEGIN;

DROP TRIGGER IF EXISTS trg_endurance_auto_bind ON public.endurance_team_members;
DROP FUNCTION IF EXISTS public.endurance_auto_bind_member_device();

ALTER TABLE public.endurance_team_members
  DROP COLUMN IF EXISTS created_at;

ALTER TABLE public.simhub_devices
  DROP COLUMN IF EXISTS endurance_binding_source;

COMMIT;
