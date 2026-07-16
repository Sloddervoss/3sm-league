BEGIN;

-- Applicatierollback voor de device-only canary.
-- De nullable kolommen en dual-mode functies blijven bewust additief aanwezig,
-- zodat de oude race/team-Edge-flow zonder schema-lock of functie-onderbreking werkt.
-- Alleen data die uitsluitend door de nieuwe ongebonden koppelflow kan zijn gemaakt
-- wordt verwijderd voordat de nieuwe create-RPC verdwijnt.
DELETE FROM public.simhub_telemetry_latest
WHERE race_id IS NULL OR team_id IS NULL;

DELETE FROM public.simhub_device_sessions
WHERE device_id IN (
  SELECT id
  FROM public.simhub_devices
  WHERE race_id IS NULL OR team_id IS NULL OR expires_at IS NULL
);

DELETE FROM public.simhub_devices
WHERE race_id IS NULL OR team_id IS NULL OR expires_at IS NULL;

DELETE FROM public.simhub_pairing_codes
WHERE race_id IS NULL OR team_id IS NULL;

DROP FUNCTION IF EXISTS public.simhub_create_device_pairing_code(TEXT, UUID, TIMESTAMPTZ);

COMMIT;
