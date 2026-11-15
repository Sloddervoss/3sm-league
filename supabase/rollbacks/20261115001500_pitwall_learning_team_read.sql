-- Remove only the additive optional team reader; preserve baseline pitwall RPC.
BEGIN;
DROP FUNCTION IF EXISTS public.pitwall_fuel_learning_for_team_v1(uuid,uuid);
NOTIFY pgrst,'reload schema';
COMMIT;
