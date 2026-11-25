-- Operator-only; execute after approved migration and same-frame Edge provenance.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('pitwall_learning.tyre_shadow_drain(integer)') IS NULL THEN
    RAISE EXCEPTION 'Apply the tyre shadow migration first';
  END IF;
END $$;
SELECT cron.schedule('3sm-tyre-race-shadow-v1', '*/2 * * * *',
  $job$ SET statement_timeout='15s'; SET lock_timeout='2s'; SELECT pitwall_learning.tyre_shadow_drain(20); $job$);
COMMIT;
