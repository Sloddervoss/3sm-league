-- Aggregate diagnostic only. No identifiers or telemetry payloads.
BEGIN READ ONLY;
SELECT coalesce(outcome,'queued') AS outcome, count(*) AS stops
FROM pitwall_learning.tyre_shadow_exit GROUP BY 1 ORDER BY 1;
SELECT count(*) FILTER (WHERE forecast_rate IS NOT NULL) AS issued,
  count(*) FILTER (WHERE absolute_error IS NOT NULL) AS scored,
  round(avg(absolute_error[1]),3) AS mae_fl, round(avg(absolute_error[2]),3) AS mae_fr,
  round(avg(absolute_error[3]),3) AS mae_rl, round(avg(absolute_error[4]),3) AS mae_rr
FROM pitwall_learning.tyre_shadow_exit;
SELECT d.status,d.start_time,d.end_time FROM cron.job_run_details d JOIN cron.job j USING(jobid)
 WHERE j.jobname='3sm-tyre-race-shadow-v1' ORDER BY d.start_time DESC LIMIT 5;
ROLLBACK;
