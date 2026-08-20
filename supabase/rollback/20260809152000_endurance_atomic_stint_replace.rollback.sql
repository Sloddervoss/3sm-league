BEGIN;
DROP FUNCTION IF EXISTS public.endurance_apply_stint_updates(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.endurance_replace_draft_stints(uuid, uuid, jsonb);
COMMIT;
