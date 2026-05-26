-- Store richer iRacing JSON fields so completed race pages can be enriched
-- when admins re-upload/export old JSON result files.

ALTER TABLE public.race_results
  ADD COLUMN IF NOT EXISTS start_position INTEGER,
  ADD COLUMN IF NOT EXISTS laps_led INTEGER,
  ADD COLUMN IF NOT EXISTS best_lap_num INTEGER,
  ADD COLUMN IF NOT EXISTS avg_lap TEXT,
  ADD COLUMN IF NOT EXISTS car_name TEXT,
  ADD COLUMN IF NOT EXISTS club_name TEXT,
  ADD COLUMN IF NOT EXISTS reason_out TEXT;

ALTER TABLE public.races
  ADD COLUMN IF NOT EXISTS sof INTEGER,
  ADD COLUMN IF NOT EXISTS cautions INTEGER,
  ADD COLUMN IF NOT EXISTS caution_laps INTEGER,
  ADD COLUMN IF NOT EXISTS lead_changes INTEGER;
