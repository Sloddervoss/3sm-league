-- Phase G reconciliation: constraint change
-- Production was changed from completed_laps > 0 to completed_laps >= 0
-- during Phase G live fix because simhub_update_strategy_v3 receives
-- completedLaps=0 on first telemetry pulse (pre-lap baseline).
-- This is legitimate under the V3 contract: lap 0 is not a valid boundary
-- but the strategy function should handle it without crashing.

BEGIN;
  ALTER TABLE public.endurance_strategy_lap_samples
    DROP CONSTRAINT IF EXISTS endurance_strategy_lap_samples_completed_laps_check;
  ALTER TABLE public.endurance_strategy_lap_samples
    ADD CONSTRAINT endurance_strategy_lap_samples_completed_laps_check
    CHECK (completed_laps >= 0);
COMMIT;