-- ============================================================================
-- S2E2 — pre-forward bewijs (disposable DB)
--
-- Alleen assertions: de fixture is al gecommitteerd. Bewijst dat de nieuwe
-- functie nog niet bestaat en dat de bestaande autoriteit (devicebinding,
-- account_policy, P1-captureguard) wel aanwezig is.
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p2_readiness_policy_s2e2'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'S2E2 PRE: wrong database or data_directory';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'S2E2 PRE: TCP connection is not allowed';
  END IF;
END
$guard$;

DO $pre$
BEGIN
  IF to_regprocedure('public.simhub_observation_policy_v1(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'PRE-1: publisher already exists before forward';
  END IF;
  IF to_regclass('public.simhub_devices') IS NULL
     OR to_regclass('pitwall_learning.account_policy') IS NULL
     OR to_regprocedure('pitwall_learning.capture_source_batch(text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRE-2: existing authority objects are missing';
  END IF;
  IF (SELECT count(*) FROM public.simhub_devices) <> 5 THEN
    RAISE EXCEPTION 'PRE-3: expected 5 synthetic devices, got %',
      (SELECT count(*) FROM public.simhub_devices);
  END IF;
  IF (SELECT count(*) FROM pitwall_learning.account_policy) <> 3 THEN
    RAISE EXCEPTION 'PRE-4: expected 3 synthetic policy rows, got %',
      (SELECT count(*) FROM pitwall_learning.account_policy);
  END IF;
  IF (SELECT policy_version FROM pitwall_learning.account_policy
       WHERE owner_user_id = 'a0000000-0000-4000-8000-0000000000d4') <> 2 THEN
    RAISE EXCEPTION 'PRE-5: future version fixture is not 2';
  END IF;
  RAISE NOTICE 'PASS PRE-1 publisher absent before forward';
  RAISE NOTICE 'PASS PRE-2 device binding, account_policy and P1 guard present';
  RAISE NOTICE 'PASS PRE-3 synthetic identities and future version 2 present';
END
$pre$;
