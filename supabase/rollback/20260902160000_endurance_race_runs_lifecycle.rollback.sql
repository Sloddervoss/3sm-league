-- Rollback for 20260902160000_endurance_race_runs_lifecycle.sql.
-- Removes only Phase B lifecycle objects. Existing endurance events, teams,
-- registrations, devices, authority helpers, and telemetry data are untouched.
-- ============================================================================

DROP FUNCTION IF EXISTS public.simhub_get_active_race_run(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.simhub_close_race_run(UUID, TEXT);
DROP FUNCTION IF EXISTS public.simhub_start_race_run(UUID, UUID, TEXT);

DROP TABLE IF EXISTS public.endurance_race_runs;

DROP TYPE IF EXISTS public.endurance_race_run_status;
DROP TYPE IF EXISTS public.endurance_run_kind;