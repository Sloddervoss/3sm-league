-- Rollback: restore original CHECK constraint (completed_laps > 0)
-- Reverts the Phase G live fix. Only apply if you have confirmed
-- simhub_update_strategy_v3 no longer receives completedLaps=0.

BEGIN;
  ALTER TABLE public.endurance_strategy_lap_samples
    DROP CONSTRAINT IF EXISTS endurance_strategy_lap_samples_completed_laps_check;
  ALTER TABLE public.endurance_strategy_lap_samples
    ADD CONSTRAINT endurance_strategy_lap_samples_completed_laps_check
    CHECK (completed_laps > 0);
COMMIT;