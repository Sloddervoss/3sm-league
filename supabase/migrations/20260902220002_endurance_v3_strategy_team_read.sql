-- Telemetry V3 Phase F RLS team-read correction.
-- Expands strategy_latest read access from staff-only to STAFF + OWN TEAM.
--
-- This migration is additive on top of 20260902220001 (staff-only RLS compat).
-- It replaces the team_read policy with an exact own-team membership predicate,
-- while keeping staff_read unchanged (is_endurance_staff(auth.uid())).
--
-- CONTRACT B: staff + own-team read for endurance_strategy_latest.
-- Endurance_strategy_lap_samples remains backend/service-only.
\set ON_ERROR_STOP on
BEGIN;

-- ============================================================================
-- 1. Replace team_read with exact own-team membership predicate
-- ============================================================================
DROP POLICY IF EXISTS endurance_strategy_latest_team_read ON public.endurance_strategy_latest;

CREATE POLICY endurance_strategy_latest_team_read ON public.endurance_strategy_latest
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.endurance_team_members etm
      WHERE etm.team_id = endurance_strategy_latest.team_id
        AND etm.user_id = auth.uid()
    )
  );

-- The staff_read policy (unchanged) handles staff broad access:
--   USING (public.is_endurance_staff(auth.uid()))
-- Together, PostgreSQL permissive policies OR, giving: staff OR own-team-member.

-- ============================================================================
-- 2. No changes to lap_samples (remains backend/service-only)
-- ============================================================================
-- The endurance_strategy_lap_samples table has only the service_role ALL policy.
-- No authenticated policies are added here.

-- ============================================================================
-- 3. No mutation broadening
-- ============================================================================
-- Existing grants and service_role policies are unchanged.
-- Authenticated users still have only SELECT on strategy_latest.
-- Only service_role can INSERT/UPDATE/DELETE.

COMMIT;