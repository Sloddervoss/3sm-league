-- Phase E rollback. It removes only Phase-E-owned objects.
-- It deliberately fails if real incident_count_changed rows remain: no history is deleted.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.endurance_telemetry_events WHERE event_type='incident_count_changed') THEN
  RAISE EXCEPTION 'Phase E rollback blocked: incident_count_changed rows must be retained or explicitly handled by an approved operational migration';
 END IF;
END $$;
DROP FUNCTION IF EXISTS public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb);
DROP TABLE IF EXISTS public.endurance_source_segments;
DROP INDEX IF EXISTS public.endurance_telemetry_events_v3_lap_dedupe_idx;
DROP INDEX IF EXISTS public.endurance_telemetry_events_v3_incident_dedupe_idx;
DROP INDEX IF EXISTS public.endurance_telemetry_events_race_run_idx;
DROP INDEX IF EXISTS public.simhub_telemetry_latest_race_run_idx;
ALTER TABLE public.simhub_telemetry_latest DROP CONSTRAINT IF EXISTS simhub_telemetry_latest_v3_normalized_object_check;
ALTER TABLE public.endurance_telemetry_events DROP CONSTRAINT IF EXISTS endurance_telemetry_events_event_type_check;
ALTER TABLE public.endurance_telemetry_events ADD CONSTRAINT endurance_telemetry_events_event_type_check CHECK
(event_type = ANY (ARRAY['sample'::text,'lap_completed'::text,'pit_entry'::text,'pit_exit'::text,
'fuel_added'::text,'driver_change'::text,'stint_start'::text,'stint_end'::text,'flag_change'::text,'car_state_change'::text]));
ALTER TABLE public.endurance_telemetry_events DROP COLUMN IF EXISTS race_run_id;
ALTER TABLE public.simhub_telemetry_latest DROP COLUMN IF EXISTS race_run_id, DROP COLUMN IF EXISTS v3_normalized;
COMMIT;
