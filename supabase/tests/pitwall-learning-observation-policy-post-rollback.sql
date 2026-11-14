-- ============================================================================
-- S2E2 — post-rollback bewijs (disposable DB)
--
-- Na de paired rollback: alleen de nieuwe functie is weg. De bestaande
-- devicebinding, het accountbeleid, de P1-guard en alle data zijn ongewijzigd.
-- De testmutaties hieronder worden expliciet teruggedraaid.
-- ============================================================================

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p2_readiness_policy_s2e2'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'S2E2 POST: wrong database or data_directory';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'S2E2 POST: TCP connection is not allowed';
  END IF;
END
$guard$;

DO $post$
DECLARE
  v_result jsonb;
BEGIN
  IF to_regprocedure('public.simhub_observation_policy_v1(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'POST-1: publisher still exists after rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.proname = 'simhub_observation_policy_v1'
  ) THEN
    RAISE EXCEPTION 'POST-1b: any overload of the publisher still exists';
  END IF;
  RAISE NOTICE 'PASS POST-1 publisher and all its overloads are absent';

  IF (SELECT count(*) FROM public.simhub_devices) <> 5 THEN
    RAISE EXCEPTION 'POST-2: device rows changed by rollback';
  END IF;
  IF (SELECT count(*) FROM pitwall_learning.account_policy) <> 3
     OR (SELECT policy_version FROM pitwall_learning.account_policy
          WHERE owner_user_id = 'a0000000-0000-4000-8000-0000000000d4') <> 2 THEN
    RAISE EXCEPTION 'POST-3: account policy data changed by rollback';
  END IF;
  IF (SELECT count(*) FROM pitwall_learning.capture_batches) <> 0 THEN
    RAISE EXCEPTION 'POST-4: capture batches unexpectedly present';
  END IF;
  IF to_regprocedure('pitwall_learning.capture_source_batch(text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'POST-5: P1 capture guard disappeared';
  END IF;
  RAISE NOTICE 'PASS POST-2 device rows, policy data and P1 guard survive rollback';

  -- De bestaande handhaving werkt nog steeds: A wel, B niet.
  UPDATE pitwall_learning.runtime_settings SET capture_enabled = true WHERE id = 1;
  v_result := pitwall_learning.capture_source_batch('lap_summary', jsonb_build_array(
    jsonb_build_object('device_id', 'd0000000-0000-4000-8000-0000000000a1',
      'source_uid', '88888888-8888-4888-8888-888888888888',
      'record_revision', 1, 'content_hash', repeat('8', 32),
      'observed_at', '2026-11-14T00:03:00Z', 'payload', '{"lap":8}'::jsonb),
    jsonb_build_object('device_id', 'd0000000-0000-4000-8000-0000000000b2',
      'source_uid', '99999999-9999-4999-8999-999999999999',
      'record_revision', 1, 'content_hash', repeat('9', 32),
      'observed_at', '2026-11-14T00:03:01Z', 'payload', '{"lap":9}'::jsonb)
  ));
  IF (v_result->>'items')::int <> 1 THEN
    RAISE EXCEPTION 'POST-6: P1 guard no longer captures A only: %', v_result;
  END IF;
  RAISE NOTICE 'PASS POST-3 existing P1 guard still captures A and denies B';
END
$post$;

ROLLBACK;
