-- ============================================================================
-- Endurance — pitwall fase 0: tankcapaciteit en racedistance
-- Datum: 2026-10-24
--
-- De pitwall kan geen liters, stintlengte of pit window rekenen zonder twee
-- feiten die nergens in het schema staan:
--
--   1. De tankcapaciteit van de auto. `fuelPct` bestaat wel, maar een
--      percentage zonder noemer is een verzonnen getal.
--   2. De geplande racedistance. Van de 139 catalogus-events zijn er 122 een
--      getimede race; daarin is `sessionLapsRemaining` altijd leeg en blijft
--      `fuel_to_finish_litres` dus permanent NULL.
--
-- Beide zijn bewust NULL-baar: een onbekende tank is beter dan een geraden
-- tank. De read-laag geeft geen liters-advies zolang de waarde NULL is.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Autocatalogus — eerste car_id-gekeyde tabel in het schema
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.endurance_car_specs (
  car_id                     text PRIMARY KEY,
  display_name               text NOT NULL DEFAULT '',
  tank_capacity_litres       numeric(6,2),
  fuel_per_lap_prior_litres  numeric(5,3),
  source                     text NOT NULL DEFAULT 'manual',
  verified_at                timestamptz,
  verified_by                uuid,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'endurance_car_specs_tank_check'
      AND conrelid = 'public.endurance_car_specs'::regclass
  ) THEN
    ALTER TABLE public.endurance_car_specs
      ADD CONSTRAINT endurance_car_specs_tank_check
      CHECK (tank_capacity_litres IS NULL OR tank_capacity_litres > 0),
      ADD CONSTRAINT endurance_car_specs_prior_check
      CHECK (fuel_per_lap_prior_litres IS NULL OR fuel_per_lap_prior_litres > 0),
      ADD CONSTRAINT endurance_car_specs_source_check
      CHECK (source IN ('manual', 'telemetry', 'iracing_sdk'));
  END IF;
END $$;

COMMENT ON TABLE public.endurance_car_specs IS
  'Autocatalogus voor de pitwall: tankcapaciteit en praktijk-prior voor brandstof per ronde. NULL = onbekend, nooit een default.';
COMMENT ON COLUMN public.endurance_car_specs.tank_capacity_litres IS
  'Tankinhoud in liters. NULL betekent: geen liters-advies geven.';
COMMENT ON COLUMN public.endurance_car_specs.fuel_per_lap_prior_litres IS
  'Praktijk-prior vóór de eerste gemeten stint; bron is endurance_practice_laps.';

ALTER TABLE public.endurance_car_specs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS endurance_car_specs_read ON public.endurance_car_specs;
CREATE POLICY endurance_car_specs_read ON public.endurance_car_specs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS endurance_car_specs_staff_write ON public.endurance_car_specs;
CREATE POLICY endurance_car_specs_staff_write ON public.endurance_car_specs
  FOR ALL TO authenticated
  USING (public.is_endurance_staff(auth.uid()))
  WITH CHECK (public.is_endurance_staff(auth.uid()));

GRANT SELECT ON public.endurance_car_specs TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.endurance_car_specs TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Team-override — een teammanager mag een catalogusfout corrigeren
-- ---------------------------------------------------------------------------
ALTER TABLE public.endurance_teams
  ADD COLUMN IF NOT EXISTS tank_capacity_override_litres numeric(6,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'endurance_teams_tank_override_check'
      AND conrelid = 'public.endurance_teams'::regclass
  ) THEN
    ALTER TABLE public.endurance_teams
      ADD CONSTRAINT endurance_teams_tank_override_check
      CHECK (tank_capacity_override_litres IS NULL OR tank_capacity_override_litres > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.endurance_teams.tank_capacity_override_litres IS
  'Team-specifieke correctie op de cataloguswaarde; leeslaag gebruikt COALESCE(override, catalogus).';

-- ---------------------------------------------------------------------------
-- 3. Racedistance op het event
-- ---------------------------------------------------------------------------
ALTER TABLE public.endurance_events
  ADD COLUMN IF NOT EXISTS planned_laps integer,
  ADD COLUMN IF NOT EXISTS planned_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS race_distance_source text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'endurance_events_planned_laps_check'
      AND conrelid = 'public.endurance_events'::regclass
  ) THEN
    ALTER TABLE public.endurance_events
      ADD CONSTRAINT endurance_events_planned_laps_check
      CHECK (planned_laps IS NULL OR planned_laps > 0),
      ADD CONSTRAINT endurance_events_planned_duration_check
      CHECK (planned_duration_minutes IS NULL OR planned_duration_minutes > 0),
      ADD CONSTRAINT endurance_events_race_distance_source_check
      CHECK (race_distance_source IN ('manual', 'iracing_catalog', 'derived'));
  END IF;
END $$;

COMMENT ON COLUMN public.endurance_events.planned_laps IS
  'Rondesgeteld event. Wint in de leeslaag van planned_duration_minutes.';
COMMENT ON COLUMN public.endurance_events.planned_duration_minutes IS
  'Getimede race. Nodig omdat sessionLapsRemaining in tijdraces leeg is.';
COMMENT ON COLUMN public.endurance_events.race_distance_source IS
  'Herkomst van de afstand: handmatig, uit de iRacing-catalogus, of afgeleid.';

COMMIT;
