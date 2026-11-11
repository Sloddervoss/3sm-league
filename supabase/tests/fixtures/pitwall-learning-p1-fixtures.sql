-- ============================================================================
-- NO-PROD FIXTURE — uitsluitend voor de afgeschermde PG15.19-rehearsal
-- (database pitwall_learning_p1_rehearsal, data_directory /work/data).
--
-- Dit is synthetische testdata, geen echte race, geen productieaccount en
-- geen productie-seed. Het bestand weigert op elke andere database of
-- data_directory. Het maakt één enrolled persoonlijk account (user1) en
-- twee apparaten zonder policy (user2/device2, en een onbekend device3).
-- ============================================================================

DO $guard$
BEGIN
  IF current_database() <> 'pitwall_learning_p1_rehearsal'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'NO-PROD FIXTURE: wrong database or data_directory';
  END IF;
END
$guard$;

INSERT INTO auth.users (id, email, aud, role, is_sso_user)
VALUES
  ('a0000000-0000-4000-8000-000000000001', 'p1-rehearsal@example.invalid',
   'authenticated', 'authenticated', false),
  ('a0000000-0000-4000-8000-000000000002', 'p1-rehearsal-nopolicy@example.invalid',
   'authenticated', 'authenticated', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.simhub_devices (
  id, owner_user_id, token_hash, device_name, connector_id, device_status
)
VALUES
  ('d0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', repeat('a', 64),
   'P1-REHEARSAL', 'P1-REHEARSAL', 'active_unbound'),
  ('d0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000002', repeat('b', 64),
   'P1-REHEARSAL-NOPOLICY', 'P1-REHEARSAL-NOPOLICY', 'active_unbound')
ON CONFLICT (id) DO NOTHING;

INSERT INTO pitwall_learning.account_policy (
  owner_user_id, capture_enabled, personal_fit_enabled,
  retention_jobs_days, retention_source_days, retention_forecast_days
)
VALUES (
  'a0000000-0000-4000-8000-000000000001', true, true, 7, 180, 90
)
ON CONFLICT (owner_user_id) DO UPDATE
  SET capture_enabled = excluded.capture_enabled,
      personal_fit_enabled = excluded.personal_fit_enabled,
      retention_jobs_days = excluded.retention_jobs_days,
      retention_source_days = excluded.retention_source_days,
      retention_forecast_days = excluded.retention_forecast_days,
      updated_at = now();

UPDATE pitwall_learning.runtime_settings
   SET capture_enabled = true,
       worker_enabled = true,
       shadow_enabled = false,
       advice_enabled = false,
       updated_at = now()
 WHERE id = 1;
