-- Safe-disable: retain all personal models/evaluations and deployment provenance.
BEGIN;
UPDATE pitwall_learning.runtime_settings SET worker_enabled=false,shadow_enabled=false,advice_enabled=false,
 automatic_personal_enrollment=false,updated_at=clock_timestamp() WHERE id=1;
DROP FUNCTION IF EXISTS pitwall_learning.fuel_worker_save_model(uuid,text,jsonb);
DROP FUNCTION IF EXISTS pitwall_learning.fuel_worker_provision(integer);
COMMIT;
