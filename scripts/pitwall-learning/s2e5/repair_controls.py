#!/usr/bin/env python3
"""ON-only contention/cancellation controls against the actual owned function.

No measurement batches; missing policy row during contention isolates the new
optional dependency. Accepted cores COMMIT and are read from another session.
Synthetic fixtures are removed afterwards; no schema/role reset or retry.
"""
import concurrent.futures
import json
import time

from lab import ART, L, R

OWNER = 'a7000000-0000-4000-8000-000000000001'
DEVICE = 'd7000000-0000-4000-8000-00000000000'
BODY = json.dumps({'observationPolicyRequested': True, 'timing': {'completedLaps': 0},
                   'raceState': {'incidents': 0}, 'track': {'onPitRoad': False},
                   'session': {'flags': []}, 'identity': {}})


def run(text, name, expected=0):
    R.guard()
    p = L.psql_clone(L.CLONE_GUARD + text)
    L.write_private(ART / (name + '.log'), p.stdout + p.stderr)
    assert p.returncode == expected, (name, p.returncode)
    return p


def accepted(i, lock_timeout='0', policy='NULL', timeout='100ms', delay=''):
    return f"""BEGIN;
SET LOCAL statement_timeout='{timeout}';
SET LOCAL lock_timeout='{lock_timeout}';
SET LOCAL request.jwt.claim.role='service_role';
DO $test$ DECLARE r record; old_lock text := current_setting('lock_timeout');
old_statement text := current_setting('statement_timeout'); BEGIN
{delay}
SELECT * INTO r FROM public.simhub_persist_v3(repeat('{i}',64),'s2e5-repair-lock-{i}',1,now(),'{BODY}'::jsonb);
{f"IF clock_timestamp()-statement_timestamp() >= interval '{timeout}' - interval '25ms' THEN RAISE EXCEPTION 'near-deadline skip would mask contention control'; END IF;" if i in (3, 4, 5) else ''}
IF r.result <> 'accepted' OR r.measurement_ack IS NOT NULL
   OR r.observation_policy IS DISTINCT FROM {policy}::jsonb THEN
  RAISE EXCEPTION 'core/ACK/policy mismatch';
END IF;
IF current_setting('lock_timeout') <> old_lock OR current_setting('statement_timeout') <> old_statement THEN
  RAISE EXCEPTION 'caller GUC changed';
END IF;
END $test$;
COMMIT;
"""


def main():
    R.guard()
    records = {}
    # These IDs are distinct from the inherited builder/reviewer fixtures.
    run(f"INSERT INTO auth.users(id,email,aud,role,is_sso_user) VALUES('{OWNER}','repair-lock@example.invalid','authenticated','authenticated',false);" +
        ''.join(f"INSERT INTO public.simhub_devices(id,owner_user_id,token_hash,device_name,connector_id,device_status) VALUES('{DEVICE}{i}','{OWNER}',repeat('{i}',64),'repair synthetic','repair','active_unbound');" for i in range(1, 7)), 'repair-control-fixtures')
    try:
        run(f"INSERT INTO pitwall_learning.account_policy(owner_user_id,capture_enabled,policy_version) VALUES('{OWNER}',true,8);", 'repair-positive-policy')
        run(accepted(1, '50ms', "'{\"captureAllowed\":true,\"policyVersion\":8}'", '2s'), 'repair-normal-on')
        run(f"DELETE FROM pitwall_learning.account_policy WHERE owner_user_id='{OWNER}';", 'repair-missing-policy')
        # Near the running global deadline: skip policy rather than change/rearm it.
        # Delay only the final core device UPDATE, after cold planning/core
        # work. A rollback-only fixture reaches ~20ms remaining on the real
        # running 1s statement timer; no SET/rearm trick inside the statement.
        trigger = f"""CREATE FUNCTION pg_temp.near_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_sleep(greatest(0, 0.98 - extract(epoch FROM (clock_timestamp()-statement_timestamp()))));
  RETURN NEW;
END $$;
CREATE TRIGGER repair_near_deadline AFTER UPDATE ON public.simhub_devices
FOR EACH ROW WHEN (NEW.id='{DEVICE}2'::uuid) EXECUTE FUNCTION pg_temp.near_deadline();
"""
        near = accepted(2, '2ms', timeout='1s').replace('DO $test$', trigger+'DO $test$', 1).replace('COMMIT;', 'ROLLBACK;')
        run(near, 'repair-near-deadline-on')
        records['normal_on'] = {'exit': 0, 'fresh_policy_version': 8, 'caller_gucs_preserved': True}
        records['near_deadline_on'] = {'exit': 0, 'policy_null': True, 'caller_gucs_preserved': True}

        def lock(table, app):
            return run(f"BEGIN; SET LOCAL statement_timeout='20s'; SET application_name='{app}'; LOCK TABLE {table} IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(12); ROLLBACK;", app)

        def wait_for_lock(app):
            for _ in range(60):
                if L.psql_clone_ok(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{app}' AND wait_event='PgSleep'").strip() == '1':
                    return
                time.sleep(.03)
            raise AssertionError('lock not acquired')

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            holder = pool.submit(lock, 'pitwall_learning.account_policy', 'repair-policy-lock')
            wait_for_lock('repair-policy-lock')
            for i, limit in [(3, '0'), (4, '2ms'), (5, '50ms')]:
                # Compile the core in this backend first, with policy OFF and
                # a separate device. The generous core budget isolates optional
                # contention from cold core CPU throttling; the elapsed check
                # above prohibits a near-deadline skip masking this control.
                warm = accepted(1, timeout='2s').replace(',1,now()', f',{i + 10},now()').replace('"observationPolicyRequested": true', '"observationPolicyRequested": false')
                run(warm + '\nSELECT pg_sleep(0.5);\n' + accepted(i, limit, timeout='1s'), 'repair-locked-on-' + str(i))
                # New backend/session, after COMMIT: not just an in-transaction result.
                actual = L.psql_clone_ok(f"SELECT last_sequence FROM public.simhub_devices WHERE id='{DEVICE}{i}'").strip()
                assert actual == '1', 'accepted core did not persist'
                wait_for_lock('repair-policy-lock')
                records['locked_on_' + limit] = {'exit': 0, 'committed_last_sequence': 1, 'policy_null': True, 'caller_gucs_preserved': True}
            holder.result()
        cancellation_before = L.psql_clone_ok(f"SELECT coalesce(last_sequence::text,'null') FROM public.simhub_devices WHERE id='{DEVICE}6'").strip()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            holder = pool.submit(lock, 'public.simhub_devices', 'repair-core-lock')
            wait_for_lock('repair-core-lock')
            p = run(accepted(6), 'repair-canceled-before-core', expected=3)
            assert b'canceling statement due to statement timeout' in p.stderr
            holder.result()
        actual = L.psql_clone_ok(f"SELECT coalesce(last_sequence::text,'null') FROM public.simhub_devices WHERE id='{DEVICE}6'").strip()
        assert actual == cancellation_before, 'canceled core changed device'
        assert L.psql_clone_ok(f"SELECT count(*) FROM public.simhub_telemetry_latest WHERE device_id='{DEVICE}6'").strip() == '0'
        records['core_cancellation'] = {'exit': 3, 'no_core_write': True, 'policy_requested': True}
    finally:
        run(f"DELETE FROM public.simhub_device_sessions WHERE device_id::text LIKE '{DEVICE}%'; DELETE FROM public.simhub_telemetry_latest WHERE device_id::text LIKE '{DEVICE}%'; DELETE FROM public.simhub_devices WHERE owner_user_id='{OWNER}'; DELETE FROM auth.users WHERE id='{OWNER}';", 'repair-control-cleanup')
    assert L.psql_clone_ok(f"SELECT count(*) FROM auth.users WHERE id='{OWNER}'").strip() == '0'
    R.save('CONTAINED-POLICY-CONTROLS.json', records)
    R.checkpoint('repair-contention-committed-core-global-cancel-and-GUC-controls-PASS')
    print(json.dumps(records, indent=2))


if __name__ == '__main__':
    main()
