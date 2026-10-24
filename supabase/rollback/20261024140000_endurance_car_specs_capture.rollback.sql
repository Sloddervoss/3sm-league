-- ============================================================================
-- Rollback — 20261024140000_endurance_car_specs_capture
-- Datum: 2026-10-24
--
-- Haalt de trigger en de functie weg. De waarden die de trigger al in
-- endurance_car_specs heeft gezet blijven staan: dat zijn gemeten feiten, geen
-- schema. Ze handmatig wissen zou betekenen dat de pitwall vergeet wat hij al
-- wist, en dat is geen rollback maar dataverlies.
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS simhub_capture_car_spec_trg ON public.simhub_telemetry_latest;
DROP FUNCTION IF EXISTS public.simhub_capture_car_spec();

COMMIT;
