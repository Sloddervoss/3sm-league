BEGIN;
DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='3sm-tyre-race-shadow-v1';
  END IF;
END $$;
DROP TRIGGER IF EXISTS tyre_shadow_enqueue ON public.simhub_tyre_observations;
DROP FUNCTION IF EXISTS pitwall_learning.tyre_shadow_enqueue();
DROP FUNCTION IF EXISTS pitwall_learning.tyre_shadow_drain(integer);
DROP TABLE IF EXISTS pitwall_learning.tyre_shadow_exit;
COMMIT;
