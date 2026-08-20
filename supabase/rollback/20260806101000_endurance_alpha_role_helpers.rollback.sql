-- Rollback: helper functions and their attached EXECUTE grants. Role-dependent
-- policies and RPC definitions must already have been restored/removed.
BEGIN;

DROP FUNCTION IF EXISTS public.is_endurance_staff(UUID);
DROP FUNCTION IF EXISTS public.is_endurance_manager(UUID);

COMMIT;
