-- P0 only: bounded, aggregate-only inventory, no training and no historical seed.
-- Run with psql -X -qAt -v ON_ERROR_STOP=1; save output outside Git with mode 0600.
-- Cells are NOT anonymisation. Do not publish output or attach raw account data.
-- NULL means unverified/not computed, NEVER zero qualified physical sets.
-- Current device ownership is explicitly not ownership at observation time.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '8s';
SET LOCAL lock_timeout = '500ms';
SET LOCAL idle_in_transaction_session_timeout = '12s';

SELECT jsonb_build_object('kind', 'identity', 'data', jsonb_build_object(
  'database', current_database(), 'read_only', current_setting('transaction_read_only'),
  'snapshot_at', CURRENT_TIMESTAMP, 'server_version', current_setting('server_version'),
  'audit_version', 'p0-v1', 'as_of_reconstructable', false,
  'warning', 'Raw counts and structural candidates are not qualified training examples.'
));

WITH summaries AS (
  SELECT s.*,
    EXTRACT(EPOCH FROM ended_at - started_at) AS window_seconds,
    NOT EXISTS (
      SELECT 1 FROM (VALUES ('temperature'), ('fuel'), ('load')) AS g(metric)
      WHERE NOT COALESCE(
        (CASE WHEN jsonb_typeof(s.coverage #> ARRAY[g.metric, 'sampleCount']) = 'number'
          THEN (s.coverage #>> ARRAY[g.metric, 'sampleCount'])::numeric END) >= 10
        AND (CASE WHEN jsonb_typeof(s.coverage #> ARRAY[g.metric, 'maxGapSeconds']) = 'number'
          THEN (s.coverage #>> ARRAY[g.metric, 'maxGapSeconds'])::numeric END) BETWEEN 0 AND 2
        AND (CASE WHEN jsonb_typeof(s.coverage #> ARRAY[g.metric, 'validDurationSeconds']) = 'number'
          THEN (s.coverage #>> ARRAY[g.metric, 'validDurationSeconds'])::numeric END) > 0
        AND (CASE WHEN jsonb_typeof(s.coverage #> ARRAY[g.metric, 'validDurationSeconds']) = 'number'
          THEN (s.coverage #>> ARRAY[g.metric, 'validDurationSeconds'])::numeric END)
            >= 0.8 * EXTRACT(EPOCH FROM s.ended_at - s.started_at) - 0.000001,
        false
      )
    ) AS coverage_pass
  FROM public.simhub_lap_summaries s
), structural AS (
  SELECT *, COALESCE(
    complete AND pit_lap IS FALSE AND driver_changed IS FALSE
    AND COALESCE(array_length(invalid_reasons, 1), 0) = 0
    AND window_seconds > 0 AND coverage_pass
    AND observed_session_id IS NOT NULL AND segment_id IS NOT NULL
    AND fuel_start_litres IS NOT NULL AND fuel_end_litres IS NOT NULL
    AND fuel_start_litres::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND fuel_end_litres::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND fuel_start_litres >= fuel_end_litres AND fuel_end_litres >= 0
    AND fuel_added_litres_observed = 0, false
  ) AS structural_fuel_candidate
  FROM summaries
)
SELECT jsonb_build_object('kind', 'lap_summaries', 'data', jsonb_build_object(
  'records', count(*), 'devices', count(DISTINCT device_id),
  'observed_device_sessions', count(DISTINCT (device_id, observed_session_id)) FILTER (WHERE observed_session_id IS NOT NULL),
  'distinct_reported_observed_session_ids', count(DISTINCT observed_session_id),
  'observed_segments', count(DISTINCT (device_id, observed_session_id, segment_id)) FILTER (WHERE observed_session_id IS NOT NULL AND segment_id IS NOT NULL),
  'complete_flag', count(*) FILTER (WHERE complete),
  'structural_fuel_candidates', count(*) FILTER (WHERE structural_fuel_candidate),
  'structural_candidate_sessions', count(DISTINCT (device_id, observed_session_id)) FILTER (WHERE structural_fuel_candidate),
  'missing_driver', count(*) FILTER (WHERE current_driver_id IS NULL),
  'missing_window', count(*) FILTER (WHERE window_seconds IS NULL OR window_seconds <= 0),
  'coverage_rejected', count(*) FILTER (WHERE NOT coverage_pass),
  'pit_laps', count(*) FILTER (WHERE pit_lap),
  'driver_changed', count(*) FILTER (WHERE driver_changed),
  'pit_lap_unknown', count(*) FILTER (WHERE pit_lap IS NULL),
  'driver_changed_unknown', count(*) FILTER (WHERE driver_changed IS NULL),
  'invalid_reason_counts', (SELECT jsonb_agg(jsonb_build_object('reason', r.reason, 'records', r.records))
    FROM (SELECT CASE WHEN reason IN ('coverage_window_missing', 'coverage_missing:temperature', 'coverage_missing:fuel', 'coverage_missing:load', 'coverage_samples:temperature', 'coverage_samples:fuel', 'coverage_samples:load', 'coverage_gap:temperature', 'coverage_gap:fuel', 'coverage_gap:load', 'coverage_duration:temperature', 'coverage_duration:fuel', 'coverage_duration:load')
      THEN reason ELSE 'other_or_unmapped' END AS reason, count(*) AS records
      FROM public.simhub_lap_summaries CROSS JOIN LATERAL unnest(invalid_reasons) AS reason
      GROUP BY 1 ORDER BY 1) r),
  'invalid_reason_present', count(*) FILTER (WHERE COALESCE(array_length(invalid_reasons, 1), 0) > 0),
  'fuel_end_zero', count(*) FILTER (WHERE fuel_end_litres = 0),
  'fuel_increased', count(*) FILTER (WHERE fuel_end_litres > fuel_start_litres),
  'known_refuel', count(*) FILTER (WHERE fuel_added_litres_observed > 0),
  'refuel_unknown', count(*) FILTER (WHERE fuel_added_litres_observed IS NULL),
  'revision_gt_one', count(*) FILTER (WHERE record_revision > 1),
  'missing_uid_or_hash', count(*) FILTER (WHERE summary_uid IS NULL OR content_hash IS NULL),
  'observed_transport_ids_differ', count(*) FILTER (WHERE observed_session_id IS DISTINCT FROM delivered_session_id),
  'received_before_end', count(*) FILTER (WHERE received_at < ended_at),
  'received_over_day_late', count(*) FILTER (WHERE received_at > ended_at + INTERVAL '1 day'),
  'historical_owner_accounts', NULL,
  'training_eligible', NULL,
  'qualification_block', 'NULL pit/driver/refuel flags are not false; no immutable owner/car/layout/regime context or reconstructable prior revisions on these rows.',
  'session_domain_warning', 'Observed SDK session and delivered transport session have different identifier domains; inequality is not delayed-delivery evidence.'
)) FROM structural;

SELECT jsonb_build_object('kind', 'measurement_events', 'data', jsonb_build_object(
  'records', count(*), 'devices', count(DISTINCT device_id),
  'observed_device_sessions', count(DISTINCT (device_id, observed_session_id)) FILTER (WHERE observed_session_id IS NOT NULL),
  'distinct_reported_observed_session_ids', count(DISTINCT observed_session_id),
  'refresh_confirmed', count(*) FILTER (WHERE kind = 'wear_refresh_confirmed'),
  'service_completed', count(*) FILTER (WHERE kind = 'pit_service_completed'),
  'value_changed', count(*) FILTER (WHERE kind = 'wear_value_changed'),
  'session_start', count(*) FILTER (WHERE kind = 'session_start'),
  'other_kind', count(*) FILTER (WHERE kind NOT IN ('wear_refresh_confirmed', 'pit_service_completed', 'wear_value_changed', 'session_start')),
  'revision_gt_one', count(*) FILTER (WHERE record_revision > 1),
  'missing_uid_or_hash', count(*) FILTER (WHERE event_uid IS NULL OR content_hash IS NULL),
  'missing_observed_session', count(*) FILTER (WHERE observed_session_id IS NULL),
  'missing_observed_time', count(*) FILTER (WHERE observed_at IS NULL),
  'observed_transport_ids_differ', count(*) FILTER (WHERE observed_session_id IS DISTINCT FROM delivered_session_id),
  'received_before_observed', count(*) FILTER (WHERE received_at < observed_at),
  'received_over_day_late', count(*) FILTER (WHERE received_at > observed_at + INTERVAL '1 day'),
  'qualified_physical_sets', NULL,
  'qualification_block', 'A generation counter or value change does not prove a physical replacement or full interval.'
)) FROM public.simhub_measurement_events;

WITH corners AS (
  SELECT device_id, observed_session_id, segment_id, kind, observed_at, event_uid,
    c.corner, set_generation ->> c.corner AS generation,
    CASE WHEN jsonb_typeof(wear_after -> c.corner) = 'number'
      THEN (wear_after ->> c.corner)::numeric END AS wear
  FROM public.simhub_measurement_events
  CROSS JOIN (VALUES ('fl'), ('fr'), ('rl'), ('rr')) AS c(corner)
), transitions AS (
  SELECT *, lag(wear) OVER (PARTITION BY device_id, observed_session_id, segment_id, corner ORDER BY observed_at, event_uid) AS previous_wear,
    lag(generation) OVER (PARTITION BY device_id, observed_session_id, segment_id, corner ORDER BY observed_at, event_uid) AS previous_generation
  FROM corners
)
SELECT jsonb_build_object('kind', 'wheel_counter_diagnostics', 'data', jsonb_build_object(
  'corner_records', count(*),
  'reported_corner_generations', count(DISTINCT (device_id, observed_session_id, segment_id, corner, generation)) FILTER (WHERE generation IS NOT NULL),
  'generation_changes', count(*) FILTER (WHERE generation <> previous_generation),
  'wear_increases_same_reported_generation', count(*) FILTER (WHERE wear > previous_wear AND generation = previous_generation),
  'equal_values', count(*) FILTER (WHERE wear = previous_wear),
  'equal_value_confirmed_refreshes', count(*) FILTER (WHERE wear = previous_wear AND kind = 'wear_refresh_confirmed'),
  'qualified_physical_sets', NULL,
  'warning', 'Diagnostic corner counters are not independent sets; ties/late revisions are not qualified intervals.'
)) FROM transitions;

SELECT jsonb_build_object('kind', 'fuel_samples', 'data', jsonb_build_object(
  'records', count(*), 'valid_flag', count(*) FILTER (WHERE valid_fuel_sample),
  'race_runs', count(DISTINCT race_run_id),
  'distinct_reported_transport_session_ids', count(DISTINCT source_session_id),
  'device_sessions', count(DISTINCT (source_device_id, source_session_id)) FILTER (WHERE source_device_id IS NOT NULL AND source_session_id IS NOT NULL),
  'valid_device_sessions', count(DISTINCT (source_device_id, source_session_id)) FILTER (WHERE valid_fuel_sample AND source_device_id IS NOT NULL AND source_session_id IS NOT NULL),
  'invalid_flag', count(*) FILTER (WHERE valid_fuel_sample IS FALSE),
  'exclusion_counts', (SELECT jsonb_agg(jsonb_build_object('reason', r.reason, 'records', r.records))
    FROM (SELECT CASE WHEN exclusion_reason IN ('source_baseline', 'no_prior_lap', 'lap_jump_or_regression', 'pit_lane_during_lap', 'fuel_null', 'no_prior_boundary_fuel', 'prior_lap_no_fuel', 'fuel_increase_or_no_change', 'implausible_lap_time', 'implausible_fuel_used')
      THEN exclusion_reason ELSE 'other_or_unmapped' END AS reason, count(*) AS records
      FROM public.endurance_strategy_lap_samples WHERE exclusion_reason IS NOT NULL GROUP BY 1 ORDER BY 1) r),
  'invalid_without_reason', count(*) FILTER (WHERE valid_fuel_sample IS FALSE AND exclusion_reason IS NULL),
  'zero_end_fuel', count(*) FILTER (WHERE fuel_end_litres = 0),
  'missing_session', count(*) FILTER (WHERE source_session_id IS NULL),
  'historical_owner_accounts', NULL,
  'training_eligible', NULL,
  'warning', 'Existing baseline validity is not new out-of-sample model validation.'
)) FROM public.endurance_strategy_lap_samples;

SELECT jsonb_build_object('kind', 'tyre_laps', 'data', jsonb_build_object(
  'records', count(*), 'devices', count(DISTINCT device_id),
  'device_sessions', count(DISTINCT (device_id, session_key)) FILTER (WHERE session_key IS NOT NULL),
  'car_track_present', count(*) FILTER (WHERE car_key IS NOT NULL AND track_key IS NOT NULL),
  'distinct_reported_transport_session_ids', count(DISTINCT session_key),
  'car_track_combinations', count(DISTINCT (car_key, track_key)) FILTER (WHERE car_key IS NOT NULL AND track_key IS NOT NULL),
  'compound_present', count(*) FILTER (WHERE compound_id IS NOT NULL),
  'compound_temp_present', count(*) FILTER (WHERE compound_id IS NOT NULL AND track_temp_c IS NOT NULL),
  'all_corners_present', count(*) FILTER (WHERE wear_fl IS NOT NULL AND wear_fr IS NOT NULL AND wear_rl IS NOT NULL AND wear_rr IS NOT NULL),
  'qualified_physical_sets', NULL,
  'warning', 'Repeated last_available wear is not an independent measurement.'
)) FROM public.simhub_tyre_lap_samples;

SELECT jsonb_build_object('kind', 'prior_contributions', 'data', jsonb_build_object(
  'records', count(*), 'devices', count(DISTINCT device_id),
  'device_sessions', count(DISTINCT (device_id, session_key)) FILTER (WHERE session_key IS NOT NULL),
  'distinct_reported_transport_session_ids', count(DISTINCT session_key),
  'legacy_reported_set_groups', count(DISTINCT (device_id, session_key, set_number)),
  'car_track_present', count(*) FILTER (WHERE car_key IS NOT NULL AND track_key IS NOT NULL),
  'qualified_physical_sets', NULL,
  'warning', 'Legacy set_number groups are not automatically confirmed physical sets.'
)) FROM public.tyre_prior_contrib;

SELECT jsonb_build_object('kind', 'pit_stops', 'data', jsonb_build_object(
  'records', count(*),
  'closed_entry_exit', count(*) FILTER (WHERE pit_entry_at IS NOT NULL AND pit_exit_at > pit_entry_at),
  'duration_present', count(*) FILTER (WHERE pit_lane_seconds IS NOT NULL),
  'device_sessions', count(DISTINCT (device_id, session_id)) FILTER (WHERE device_id IS NOT NULL AND session_id IS NOT NULL),
  'distinct_reported_transport_session_ids', count(DISTINCT session_id),
  'comparable_net_loss_examples', NULL,
  'warning', 'Entry-to-exit occupancy is not measured net loss against the same on-track segment or marginal tyre service cost.'
)) FROM public.endurance_pit_stops;

SELECT jsonb_build_object('kind', 'prior_queue', 'data', jsonb_build_object(
  'records', count(*), 'completed', count(*) FILTER (WHERE afgerond_op IS NOT NULL),
  'not_completed', count(*) FILTER (WHERE afgerond_op IS NULL),
  'with_error', count(*) FILTER (WHERE laatste_fout IS NOT NULL),
  'max_attempts', max(pogingen),
  'oldest_unfinished_age_seconds', max(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - gevraagd_op)) FILTER (WHERE afgerond_op IS NULL)
)) FROM public.tyre_prior_queue;

WITH sources AS (
  SELECT device_id::text AS device_id FROM public.simhub_lap_summaries
  UNION SELECT device_id::text FROM public.simhub_measurement_events
  UNION SELECT device_id::text FROM public.simhub_tyre_lap_samples
  UNION SELECT source_device_id::text AS device_id FROM public.endurance_strategy_lap_samples
  UNION SELECT device_id::text FROM public.endurance_pit_stops
  UNION SELECT device_id::text FROM public.tyre_prior_contrib
  UNION SELECT device_id::text FROM public.tyre_prior_queue
)
SELECT jsonb_build_object('kind', 'account_coverage', 'data', jsonb_build_object(
  'source_devices', count(*) FILTER (WHERE s.device_id IS NOT NULL),
  'current_owner_accounts_only', count(DISTINCT d.owner_user_id),
  'devices_without_current_owner', count(*) FILTER (WHERE s.device_id IS NOT NULL AND d.owner_user_id IS NULL),
  'historical_owner_accounts', NULL,
  'warning', 'This current ownership join is a coverage diagnostic, not historical attribution or permission to pool.'
)) FROM sources s LEFT JOIN public.simhub_devices d ON d.id::text = s.device_id;

ROLLBACK;
