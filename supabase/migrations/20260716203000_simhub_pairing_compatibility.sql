BEGIN;

ALTER TABLE public.simhub_pairing_codes
  ADD CONSTRAINT simhub_pairing_codes_context_shape
  CHECK ((race_id IS NULL AND team_id IS NULL) OR (race_id IS NOT NULL AND team_id IS NOT NULL))
  NOT VALID;

ALTER TABLE public.simhub_devices
  ADD CONSTRAINT simhub_devices_context_shape
  CHECK (
    (race_id IS NULL AND team_id IS NULL AND expires_at IS NULL)
    OR (race_id IS NOT NULL AND team_id IS NOT NULL AND expires_at IS NOT NULL)
  )
  NOT VALID;

ALTER TABLE public.simhub_telemetry_latest
  ADD CONSTRAINT simhub_telemetry_latest_context_shape
  CHECK ((race_id IS NULL AND team_id IS NULL) OR (race_id IS NOT NULL AND team_id IS NOT NULL))
  NOT VALID;

ALTER TABLE public.simhub_pairing_codes VALIDATE CONSTRAINT simhub_pairing_codes_context_shape;
ALTER TABLE public.simhub_devices VALIDATE CONSTRAINT simhub_devices_context_shape;
ALTER TABLE public.simhub_telemetry_latest VALIDATE CONSTRAINT simhub_telemetry_latest_context_shape;

COMMIT;