-- ============================================================================
-- S2E2 — synthetische identiteiten voor de wegwerp-rehearsal
--
-- Alleen voor database pitwall_learning_p2_readiness_policy_s2e2, na de
-- migratieketen (account_policy moet bestaan).
--   A = capture toegestaan, policy_version 1
--   B = capture expliciet uit, policy_version 3
--   C = geen policyrij (niet ingeschreven)
--   D = capture toegestaan, toekomstige policy_version 2
--   R = apparaat van A maar ingetrokken
-- Geen echte gebruikers, e-mails of tokens.
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p2_readiness_policy_s2e2'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'S2E2 SEED: wrong database or data_directory';
  END IF;
  IF inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'S2E2 SEED: TCP connection is not allowed';
  END IF;
  IF to_regclass('pitwall_learning.account_policy') IS NULL THEN
    RAISE EXCEPTION 'S2E2 SEED: account_policy missing; run after the P1 chain';
  END IF;
END
$guard$;

INSERT INTO auth.users (id, email, aud, role, is_sso_user) VALUES
  ('a0000000-0000-4000-8000-0000000000a1', 's2e2-a@example.invalid', 'authenticated', 'authenticated', false),
  ('a0000000-0000-4000-8000-0000000000b2', 's2e2-b@example.invalid', 'authenticated', 'authenticated', false),
  ('a0000000-0000-4000-8000-0000000000c3', 's2e2-c@example.invalid', 'authenticated', 'authenticated', false),
  ('a0000000-0000-4000-8000-0000000000d4', 's2e2-d@example.invalid', 'authenticated', 'authenticated', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.simhub_devices (
  id, owner_user_id, token_hash, device_name, connector_id, device_status, revoked_at
) VALUES
  ('d0000000-0000-4000-8000-0000000000a1',
   'a0000000-0000-4000-8000-0000000000a1', repeat('a', 64),
   'S2E2-A', 'S2E2-A', 'active_unbound', NULL),
  ('d0000000-0000-4000-8000-0000000000b2',
   'a0000000-0000-4000-8000-0000000000b2', repeat('b', 64),
   'S2E2-B', 'S2E2-B', 'active_unbound', NULL),
  ('d0000000-0000-4000-8000-0000000000c3',
   'a0000000-0000-4000-8000-0000000000c3', repeat('c', 64),
   'S2E2-C', 'S2E2-C', 'active_unbound', NULL),
  ('d0000000-0000-4000-8000-0000000000d4',
   'a0000000-0000-4000-8000-0000000000d4', repeat('d', 64),
   'S2E2-D', 'S2E2-D', 'active_unbound', NULL),
  ('d0000000-0000-4000-8000-0000000000e5',
   'a0000000-0000-4000-8000-0000000000a1', repeat('e', 64),
   'S2E2-R', 'S2E2-R', 'active_unbound', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO pitwall_learning.account_policy (
  owner_user_id, capture_enabled, policy_version
) VALUES
  ('a0000000-0000-4000-8000-0000000000a1', true,  1),
  ('a0000000-0000-4000-8000-0000000000b2', false, 3),
  ('a0000000-0000-4000-8000-0000000000d4', true,  2)
ON CONFLICT (owner_user_id) DO NOTHING;
