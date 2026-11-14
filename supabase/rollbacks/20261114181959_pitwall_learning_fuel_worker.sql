-- Safe-disable paired rollback: retain source/model/forecast/visibility rows and additive columns.
-- This is NOT a full schema restoration. Historical evidence is never destroyed by rollback.
BEGIN;
UPDATE pitwall_learning.runtime_settings SET worker_enabled=false,shadow_enabled=false,advice_enabled=false,
 automatic_personal_enrollment=false,updated_at=clock_timestamp() WHERE id=1;
DROP FUNCTION IF EXISTS pitwall_learning.fuel_worker_example(uuid,uuid);
DROP FUNCTION IF EXISTS pitwall_learning.fuel_worker_forecast(uuid,jsonb);
DROP FUNCTION IF EXISTS pitwall_learning.fuel_worker_window(uuid,text);
DROP FUNCTION IF EXISTS pitwall_learning.fuel_worker_record(uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS pitwall_learning.fuel_worker_source(uuid,uuid);
DROP FUNCTION IF EXISTS pitwall_learning.fuel_worker_allowed();
COMMIT;
