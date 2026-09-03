-- Telemetry V3 Phase F RLS team-read correction ROLLBACK.
-- Restores the staff-only team_read policy state from 20260902220001.
--
-- After rollback, both strategy_latest policies use:
--   USING (public.is_endurance_staff(auth.uid()))
-- matching the staff-only CONTRACT A state.
\set ON_ERROR_STOP on
BEGIN;

-- ============================================================================
-- 1. Drop the own-team membership team_read
-- ============================================================================
DROP POLICY IF EXISTS endurance_strategy_latest_team_read ON public.endurance_strategy_latest;

-- ============================================================================
-- 2. Restore staff-only team_read (identical to staff_read)
-- ============================================================================
CREATE POLICY endurance_strategy_latest_team_read ON public.endurance_strategy_latest
  FOR SELECT
  TO authenticated
  USING (public.is_endurance_staff(auth.uid()));

-- staff_read remains unchanged: USING (public.is_endurance_staff(auth.uid()))
-- Grants and other policies unchanged.

COMMIT;