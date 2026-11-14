-- Safe-disable read contribution; existing pitwall/telemetry remains on its baseline.
BEGIN;
UPDATE pitwall_learning.runtime_settings SET advice_enabled=false,updated_at=clock_timestamp() WHERE id=1;
DROP FUNCTION IF EXISTS public.pitwall_fuel_learning_v1(uuid);
NOTIFY pgrst,'reload schema';
COMMIT;
