-- ============================================================================
-- Rollback: SimHub Admin Read RPCs v1 — get_simhub_fleet + get_simhub_device_details
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_simhub_device_details(uuid);
DROP FUNCTION IF EXISTS public.get_simhub_fleet();