-- Rollback: driver limits and practice schema. Later practice RPC/RLS changes must
-- already be rolled back; child laps are removed before their parent sessions.
BEGIN;

DROP TABLE IF EXISTS public.endurance_practice_laps;
DROP TABLE IF EXISTS public.endurance_practice_sessions;

ALTER TABLE public.endurance_registrations
  DROP COLUMN IF EXISTS max_stint_minutes,
  DROP COLUMN IF EXISTS max_total_minutes;

COMMIT;
