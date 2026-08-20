-- Rollback: constraint-aware planner columns.
BEGIN;

ALTER TABLE public.endurance_registrations
  DROP COLUMN IF EXISTS max_consecutive_stints,
  DROP COLUMN IF EXISTS min_rest_minutes;

COMMIT;
