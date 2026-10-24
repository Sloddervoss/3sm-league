-- ============================================================================
-- Endurance — tankinhoud automatisch leren uit de telemetrie
-- Datum: 2026-10-24
--
-- Niemand kent alle tankinhouden uit het hoofd, en gokken is erger dan niets
-- weten. iRacing publiceert DriverCarFuelMaxLtr in de sessiegegevens; de
-- connector stuurt die sinds 0.6.0.1 mee als fuel.fuelCapacityLitres.
--
-- Deze trigger vult de autocatalogus zodra zo'n waarde binnenkomt. Hij raakt de
-- bestaande producer (simhub_update_strategy_v3) niet aan: het is een aparte
-- AFTER-trigger op de latest-tabel, dus een fout hier kan de ingest niet breken.
--
-- De waarde wordt alleen overschreven als hij afwijkt; een handmatig
-- geverifieerde waarde blijft dus staan tenzij de sim iets anders zegt.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.simhub_capture_car_spec()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_cap   numeric;
  v_prior numeric;
BEGIN
  IF NEW.car_id IS NULL OR NEW.v3_normalized IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_cap := NULLIF(NEW.v3_normalized #>> '{fuel,fuelCapacityLitres}', '')::numeric;
    v_prior := NULLIF(NEW.v3_normalized #>> '{fuel,fuelPerLapLitres}', '')::numeric;
  EXCEPTION WHEN others THEN
    RETURN NEW;  -- een rare waarde mag de ingest nooit blokkeren
  END;

  IF v_cap IS NULL OR v_cap <= 0 OR v_cap > 300 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.endurance_car_specs
    (car_id, display_name, tank_capacity_litres, fuel_per_lap_prior_litres, source, updated_at)
  VALUES
    (NEW.car_id,
     COALESCE(NULLIF(NEW.car_name, ''), NEW.car_id),
     v_cap,
     CASE WHEN v_prior > 0 AND v_prior < 100 THEN v_prior ELSE NULL END,
     'iracing_sdk',
     now())
  ON CONFLICT (car_id) DO UPDATE SET
    tank_capacity_litres = EXCLUDED.tank_capacity_litres,
    fuel_per_lap_prior_litres = COALESCE(endurance_car_specs.fuel_per_lap_prior_litres,
                                         EXCLUDED.fuel_per_lap_prior_litres),
    display_name = CASE WHEN endurance_car_specs.display_name = '' OR endurance_car_specs.display_name = endurance_car_specs.car_id
                        THEN EXCLUDED.display_name
                        ELSE endurance_car_specs.display_name END,
    source = CASE WHEN endurance_car_specs.source = 'manual' THEN 'manual' ELSE 'iracing_sdk' END,
    updated_at = now()
  WHERE endurance_car_specs.tank_capacity_litres IS DISTINCT FROM EXCLUDED.tank_capacity_litres
     OR (endurance_car_specs.fuel_per_lap_prior_litres IS NULL
         AND EXCLUDED.fuel_per_lap_prior_litres IS NOT NULL)
     OR endurance_car_specs.display_name = ''
     OR endurance_car_specs.display_name = endurance_car_specs.car_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS simhub_capture_car_spec_trg ON public.simhub_telemetry_latest;
CREATE TRIGGER simhub_capture_car_spec_trg
  AFTER INSERT OR UPDATE OF v3_normalized, car_id
  ON public.simhub_telemetry_latest
  FOR EACH ROW
  EXECUTE FUNCTION public.simhub_capture_car_spec();

COMMENT ON FUNCTION public.simhub_capture_car_spec() IS
  'Vult endurance_car_specs uit fuel.fuelCapacityLitres in de telemetrie; bron iracing_sdk.';

COMMIT;
