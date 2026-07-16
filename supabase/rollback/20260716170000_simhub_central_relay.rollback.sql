BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'simhub_telemetry_latest'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.simhub_telemetry_latest;
  END IF;
END;
$$;

DROP TABLE IF EXISTS public.simhub_telemetry_latest;

DROP FUNCTION IF EXISTS public.simhub_ingest_snapshot(TEXT, TEXT, BIGINT, TIMESTAMPTZ, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.simhub_exchange_pairing_code(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.simhub_revoke_device(UUID, UUID);
DROP FUNCTION IF EXISTS public.simhub_create_pairing_code(TEXT, UUID, UUID, UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.is_active_simhub_device(UUID);
DROP FUNCTION IF EXISTS public.can_manage_simhub();

DROP TABLE IF EXISTS public.simhub_device_sessions;
DROP TABLE IF EXISTS public.simhub_devices;
DROP TABLE IF EXISTS public.simhub_pairing_codes;

COMMIT;
