-- Rollback: endurance device binding (additief -> netjes terugdraaien).
BEGIN;

DROP FUNCTION IF EXISTS public.simhub_assign_device_to_entry(UUID, UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.simhub_clear_device_entry(UUID, UUID);

ALTER TABLE public.simhub_devices
  DROP CONSTRAINT IF EXISTS simhub_devices_binding_check;

DROP INDEX IF EXISTS simhub_devices_endurance_event_idx;

ALTER TABLE public.simhub_devices
  DROP COLUMN IF EXISTS endurance_event_id,
  DROP COLUMN IF EXISTS endurance_team_id;

COMMIT;
