BEGIN;

ALTER TABLE public.simhub_telemetry_latest DROP CONSTRAINT IF EXISTS simhub_telemetry_latest_context_shape;
ALTER TABLE public.simhub_devices DROP CONSTRAINT IF EXISTS simhub_devices_context_shape;
ALTER TABLE public.simhub_pairing_codes DROP CONSTRAINT IF EXISTS simhub_pairing_codes_context_shape;

COMMIT;