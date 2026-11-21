-- Rollback for 20261121121000_personal_pit_visits.sql
BEGIN;

DROP TRIGGER IF EXISTS simhub_tyre_observations_pit_visit ON public.simhub_tyre_observations;
DROP FUNCTION IF EXISTS public.simhub_capture_personal_pit_visit_v1();
DROP FUNCTION IF EXISTS public.pitwall_personal_pit_visits_v1(uuid, integer);
DROP TABLE IF EXISTS public.pitwall_personal_pit_visits;

COMMIT;
