-- ============================================================================
-- Rollback — 20261024130000_endurance_pitwall_car_specs_and_distance
-- Datum: 2026-10-24
--
-- Draait de pitwall fase 0 volledig terug. De autocatalogus is nieuw en kan
-- zonder verlies verdwijnen (er is nog geen data die alleen daar leeft). De
-- kolommen op endurance_teams en endurance_events bevatten na terugdraaien
-- geen data meer; verwijderen is dan de enige juiste stap, want een
-- achtergebleven kolom met NULL suggereert een meting die er niet is.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS endurance_car_specs_staff_write ON public.endurance_car_specs;
DROP POLICY IF EXISTS endurance_car_specs_read ON public.endurance_car_specs;
DROP TABLE IF EXISTS public.endurance_car_specs;

ALTER TABLE public.endurance_teams
  DROP CONSTRAINT IF EXISTS endurance_teams_tank_override_check,
  DROP COLUMN IF EXISTS tank_capacity_override_litres;

ALTER TABLE public.endurance_events
  DROP CONSTRAINT IF EXISTS endurance_events_planned_laps_check,
  DROP CONSTRAINT IF EXISTS endurance_events_planned_duration_check,
  DROP CONSTRAINT IF EXISTS endurance_events_race_distance_source_check,
  DROP COLUMN IF EXISTS planned_laps,
  DROP COLUMN IF EXISTS planned_duration_minutes,
  DROP COLUMN IF EXISTS race_distance_source;

COMMIT;
