BEGIN;

-- Herstel de oude eventbrede RPC-grants voordat de nieuwe functies/tabel verdwijnen.
GRANT EXECUTE ON FUNCTION public.endurance_iracing_interest_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.endurance_set_iracing_interest(UUID, BOOLEAN) TO authenticated;

DROP FUNCTION IF EXISTS public.endurance_iracing_slot_interest_members(UUID);
DROP FUNCTION IF EXISTS public.endurance_set_iracing_slot_interest(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.endurance_iracing_slot_interest_summary();
DROP TABLE IF EXISTS public.endurance_iracing_slot_interest;

COMMIT;
