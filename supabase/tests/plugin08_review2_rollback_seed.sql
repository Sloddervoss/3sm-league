-- ============================================================================
-- Echte meetrijen vóór de rollback (review 2, punt 3)
-- Datum: 2026-10-31
--
-- Deze rijen staan er met opzet al als de rollbackketen begint:
--   * twee gebeurtenissen met hetzelfde tekstlabel en verschillende UUID's,
--   * één gebeurtenis zonder tekstlabel (null),
--   * een hogere revisie met een correctieverwijzing,
--   * twee rondeaggregaten met hetzelfde summary_id en een derde met een
--     hogere revisie en een correctieverwijzing.
--
-- De oude rollback probeerde uniciteit op (device_id, event_id) en
-- (device_id, summary_id) opnieuw af te dwingen; deze rijen maken dat
-- onmogelijk zonder gegevensverlies. Ze worden hier direct ingevoegd, zoals een
-- echte schrijver dat eerder deed.
-- ============================================================================

insert into public.simhub_devices (
  id, token_hash, device_name, connector_id, endurance_event_id, endurance_team_id,
  device_status, device_role)
values ('11111111-1111-4111-8111-111111111111', repeat('a', 64), 'PC-TEST', 'SIM-TEST',
        '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
        'active_binding', 'primary')
on conflict (id) do nothing;

insert into public.simhub_measurement_events (
  device_id, event_uid, event_id, kind, observed_session_id, delivered_session_id,
  record_revision, content_hash, supersedes_event_uid)
values
  ('11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000001', 'evt-1', 'wear_refresh_confirmed',
   'sess-1', 'sess-1', 1, md5('review2-a'), null),
  ('11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000002', 'evt-1', 'wear_refresh_confirmed',
   'sess-1', 'sess-1', 1, md5('review2-b'), null),
  ('11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-0000-4000-8000-000000000003', null, 'wear_refresh_confirmed',
   'sess-1', 'sess-1', 2, md5('review2-c'),
   'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.simhub_lap_summaries (
  device_id, summary_uid, summary_id, lap_number, record_revision, content_hash,
  supersedes_summary_uid, current_driver_name, coverage)
values
  ('11111111-1111-4111-8111-111111111111',
   'bbbbbbbb-0000-4000-8000-000000000001', 'lap-1', 1, 1, md5('review2-l1'),
   null, 'Vincent de Vos',
   jsonb_build_object('temperature', jsonb_build_object('validDurationSeconds', 120,
                                                        'sampleCount', 2400, 'maxGapSeconds', 0.1))),
  ('11111111-1111-4111-8111-111111111111',
   'bbbbbbbb-0000-4000-8000-000000000002', 'lap-1', 2, 1, md5('review2-l2'),
   null, null, null),
  ('11111111-1111-4111-8111-111111111111',
   'bbbbbbbb-0000-4000-8000-000000000003', 'lap-3', 3, 3, md5('review2-l3'),
   'bbbbbbbb-0000-4000-8000-000000000001', 'Vincent de Vos',
   jsonb_build_object('temperature', jsonb_build_object('validDurationSeconds', 120,
                                                        'sampleCount', 2400, 'maxGapSeconds', 0.1)));
