-- Run inside a transaction, then ROLLBACK. No fixture data is retained.
-- Verifies the compact overlay snapshot, its binding gate, pace aggregation and size.
BEGIN;
DO $$
DECLARE
  owner uuid;
  iracing text := 'overlay-test-iracing';
  eid uuid := '77777777-7777-4777-8777-777777777777';
  tid uuid := '88888888-8888-4888-8888-888888888888';
  did uuid := '66666666-6666-4666-8666-666666666666';
  unbound_did uuid := '66666666-6666-4666-8666-666666666667';
  snapshot jsonb;
  first_revision text;
  bytes integer;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  SELECT p.user_id INTO owner FROM public.profiles p WHERE p.user_id IS NOT NULL LIMIT 1;
  IF owner IS NULL THEN RAISE EXCEPTION 'Test needs an existing profile'; END IF;
  UPDATE public.profiles SET iracing_id = iracing WHERE user_id = owner;

  INSERT INTO public.endurance_events (id, name, circuit, configuration, start_at, end_at, visibility, status)
  VALUES (eid, 'Overlay snapshot test', 'Test', '', now() - interval '4 hours', now() + interval '4 hours', 'hidden', 'draft');

  INSERT INTO public.endurance_registrations (event_id, user_id, status)
  VALUES (eid, owner, 'confirmed');

  INSERT INTO public.endurance_teams (id, event_id, name, car_number)
  VALUES (tid, eid, 'Overlay test team', '999');

  INSERT INTO public.endurance_team_members (team_id, user_id, role)
  VALUES (tid, owner, 'driver');

  INSERT INTO public.endurance_stints
    (id, event_id, team_id, driver_id, original_start_at, original_end_at, actual_start_at, expected_laps, status)
  VALUES
    (gen_random_uuid(), eid, tid, owner, now() - interval '4 hours', now() - interval '3 hours 30 minutes', now() - interval '4 hours', 20, 'completed'),
    (gen_random_uuid(), eid, tid, owner, now() - interval '3 hours 30 minutes', now() - interval '3 hours', now() - interval '3 hours 30 minutes', 20, 'completed'),
    (gen_random_uuid(), eid, tid, owner, now() - interval '3 hours', now() - interval '2 hours 30 minutes', now() - interval '3 hours', 20, 'completed'),
    ('99999999-9999-4999-8999-999999999994', eid, tid, owner, now() - interval '30 minutes', now() + interval '30 minutes', now() - interval '30 minutes', 20, 'in_car'),
    (gen_random_uuid(), eid, tid, owner, now() + interval '30 minutes', now() + interval '1 hour', NULL, 20, 'confirmed'),
    (gen_random_uuid(), eid, tid, owner, now() + interval '1 hour', now() + interval '1 hour 30 minutes', NULL, 20, 'confirmed'),
    (gen_random_uuid(), eid, tid, owner, now() + interval '1 hour 30 minutes', now() + interval '2 hours', NULL, 20, 'confirmed'),
    (gen_random_uuid(), eid, tid, owner, now() + interval '2 hours', now() + interval '2 hours 30 minutes', NULL, 20, 'confirmed');

  INSERT INTO public.simhub_devices
    (id, owner_user_id, token_hash, connector_id, device_name, endurance_event_id, endurance_team_id, endurance_binding_source, device_status, device_role)
  VALUES
    (did, owner, repeat('b', 64), 'overlay-test', 'overlay-test', eid, tid, 'manual', 'active_binding', 'primary'),
    (unbound_did, owner, repeat('c', 64), 'overlay-test-unbound', 'overlay-test-unbound', NULL, NULL, NULL, 'inactive', NULL);

  INSERT INTO public.endurance_telemetry_events
    (device_id, event_id, team_id, session_id, event_type, event_key, sequence, captured_at, event_detection_source, driver_id, lap_time_from_deltas_s, session_time_s)
  VALUES
    (did, eid, tid, 's', 'lap_completed', 'lap:1', 1, now() - interval '20 minutes', 'v3_transition', iracing, 102.450, 3000),
    (did, eid, tid, 's', 'lap_completed', 'lap:2', 2, now() - interval '19 minutes', 'v3_transition', iracing, 101.900, 3060);

  snapshot := public.simhub_overlay_snapshot(repeat('b', 64));
  IF snapshot->>'contract' <> '3sm-overlay.v1' THEN RAISE EXCEPTION 'Wrong contract: %', snapshot; END IF;
  IF snapshot->'current' IS NULL OR snapshot->'current'->>'stintIndex' <> '4' THEN RAISE EXCEPTION 'Wrong current stint: %', snapshot->'current'; END IF;
  IF snapshot->'next' IS NULL OR snapshot->'next'->>'stintIndex' <> '5' THEN RAISE EXCEPTION 'Wrong next stint: %', snapshot->'next'; END IF;
  IF jsonb_array_length(snapshot->'order') <> 8 THEN RAISE EXCEPTION 'Order must contain all 8 stints'; END IF;
  IF jsonb_array_length(snapshot->'warnings') <> 0 THEN RAISE EXCEPTION 'Unexpected warnings: %', snapshot->'warnings'; END IF;
  IF jsonb_array_length(snapshot->'pace') <> 1 THEN RAISE EXCEPTION 'Pace must contain one driver'; END IF;
  IF (snapshot->'pace'->0->>'laps')::int <> 2 OR (snapshot->'pace'->0->>'averageSeconds')::numeric <> 102.175 THEN
    RAISE EXCEPTION 'Wrong pace aggregation: %', snapshot->'pace';
  END IF;
  IF snapshot->'current'->>'averageSeconds' IS NULL THEN RAISE EXCEPTION 'Current driver pace missing'; END IF;

  first_revision := snapshot->>'revision';
  IF public.simhub_overlay_snapshot(repeat('b', 64))->>'revision' <> first_revision THEN
    RAISE EXCEPTION 'Revision is not stable';
  END IF;

  bytes := pg_column_size(snapshot);
  IF bytes >= 8192 THEN RAISE EXCEPTION 'Snapshot too large: % bytes', bytes; END IF;

  IF public.simhub_overlay_snapshot('nope')->>'error' <> 'invalid_device' THEN
    RAISE EXCEPTION 'Invalid hash was not rejected';
  END IF;
  IF public.simhub_overlay_snapshot(repeat('c', 64))->>'error' <> 'not_bound' THEN
    RAISE EXCEPTION 'Unbound device was not reported';
  END IF;

  RAISE NOTICE 'PASS: contract, current/next/order, pace, no warnings, stable revision, % bytes, invalid/unbound gate', bytes;
END;
$$;

ROLLBACK;
