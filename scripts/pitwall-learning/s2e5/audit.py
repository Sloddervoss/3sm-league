#!/usr/bin/env python3
"""Readback, real-HTTP fallback proof and the normative safe-disable."""
import json
import time

import http_matrix as H
import lab
import sql as S
from lab import ART, L, R, U, C, Z, M, ROOT


def source_proof():
    R.guard()
    results = {}
    for arm, tree in [('base', C.LIVE_DIR), ('cand', C.CAND_DIR)]:
        name = C.CONTAINERS[arm][1]
        meta = L.assert_owned(name)
        paths = sorted(str(p.relative_to(tree)) for p in tree.rglob('*.ts'))
        output = R.run('docker exec ' + meta['Id'] + ' sha256sum ' +
                       ' '.join('/home/deno/functions/'+p for p in paths), 'runtime-byte-proof-'+arm)
        actual = {line.split()[1].removeprefix('/home/deno/functions/'): line.split()[0]
                  for line in output.splitlines()}
        expected = {rel: L.hashlib.sha256((tree/rel).read_bytes()).hexdigest() for rel in paths}
        assert actual == expected, 'Runtime source does not match registered source'
        assert all(b'S2E5_' not in (tree/rel).read_bytes() for rel in paths), 'diagnostic code must not ship'
        results[arm] = {'container': meta['Id'], 'files': actual}
    R.save('RUNTIME-BYTE-PROOF.json', results)


def acl():
    R.guard()
    keys = json.loads((ART/'lab-api-keys.json').read_text())
    th = L.hashlib.sha256(L.lab_secrets()['db_tokens']['token_2'].encode()).hexdigest()
    results = {}
    for role in ('anon', 'authenticated', 'service_role'):
        jwt = keys[role] if role in keys else L.mint_jwt(L.lab_secrets()['jwt_secret'], role)
        r = R.request('cand', '/rest/v1/rpc/simhub_observation_policy_v1', 'POST',
                      {'p_token_hash': th},
                      {'Authorization': 'Bearer '+jwt,
                       'apikey': keys['service_role'] if role == 'service_role' else keys['anon'],
                       'Content-Type': 'application/json'})
        assert r['status'] == {'anon': 401, 'authenticated': 403, 'service_role': 200}[role], (role, r)
        results[role] = r
    results['effective_acl'] = json.loads(L.psql_clone_ok(
        "SELECT json_agg(json_build_object('role',r,"
        "'private_schema_usage',has_schema_privilege(r,'pitwall_learning','USAGE'),"
        "'policy_execute',has_function_privilege(r,'public.simhub_observation_policy_v1(text)','EXECUTE'),"
        "'persist_execute',has_function_privilege(r,'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)','EXECUTE')))"
        " FROM unnest(ARRAY['anon','authenticated','service_role','pitwall_learning_worker']) AS r"))
    R.save('PATH-ACL.json', results)
    source_proof()
    R.checkpoint('s2e5-actual-role-acl-and-runtime-bytes-verified')


def rollback_file(name):
    R.guard()
    path = ROOT/'supabase/rollbacks'/(name+'.sql')
    p = L.psql_clone(path.read_text(), timeout=900)
    L.write_private(ART/('rollback-'+name+'.log'), p.stdout+p.stderr)
    assert p.returncode == 0, 'rollback failed: '+name
    L.psql_clone_ok("NOTIFY pgrst,'reload schema';")
    return {'file': name, 'sha256': L.hashlib.sha256(path.read_bytes()).hexdigest(), 'exit': p.returncode}


def disable():
    R.guard(); R.checkpoint('s2e5-final-safe-disable-start')
    assert not (ART/'SAFE-DISABLE.json').exists(), 'do not reapply the safe-disable'
    before = Z.retained_data()
    R.save('rollback-retained-before.json', before)
    records = []
    # 1. Roll back ONLY the S2E5 migration, keep the flag on, and prove real HTTP
    #    that an old database without the column still publishes via the bounded
    #    fallback. This is the rollout-order evidence.
    records.append(rollback_file(lab.NEW_MIGRATION))
    R.save('ROLLBACK-ORDER.json', records)
    after_s2e5 = Z.retained_data()
    R.save('rollback-retained-after-s2e5-rollback.json', after_s2e5)
    assert after_s2e5 == before, 'the S2E5 rollback alone must not touch retained rows'
    time.sleep(5)
    R.prove_route()
    fallback = H.fallback_http()
    S.main('post-rollback')
    # The intentional HTTP fallback probe is a real accepted write. Snapshot
    # immediately after it, before any further rollback, so its three inserted
    # rows cannot be confused with a rollback mutation.
    after_probe = Z.retained_data()
    R.save('rollback-retained-after-fallback-proof.json', after_probe)
    expected_probe_tables = {
        'public.simhub_lap_summaries',
        'pitwall_learning.capture_batches',
        'pitwall_learning.jobs',
    }
    assert set(before) == set(after_probe)
    changed_by_probe = {k for k in before if before[k] != after_probe[k]}
    assert changed_by_probe == expected_probe_tables, changed_by_probe
    for table in expected_probe_tables:
        assert after_probe[table]['rows'] == before[table]['rows'] + 1, table
    # 2. Now the rest of the package, in reverse dependency order.
    for name in reversed([m for m in M.MIGRATIONS if m != lab.NEW_MIGRATION]):
        records.append(rollback_file(name))
        R.save('ROLLBACK-ORDER.json', records)
    time.sleep(3)
    after = Z.retained_data()
    R.save('rollback-retained-after.json', after)
    # Every remaining rollback must preserve the exact post-probe data digest;
    # no permission to alter an existing row or add any further rows is waived.
    assert after == after_probe, 'remaining rollbacks changed retained data'
    retained_equal = True
    finish_disable(before, after_s2e5, after_probe, after, records, fallback)


def finish_disable(before, after_s2e5, after_probe, after, records, fallback):
    """Validate the already-rolled-back lab and finish the OFF/HTTP proof."""
    R.guard()
    expected_probe_tables = {'public.simhub_lap_summaries',
                             'pitwall_learning.capture_batches', 'pitwall_learning.jobs'}
    assert after_s2e5 == before
    assert {k for k in before if before[k] != after_probe[k]} == expected_probe_tables
    assert all(after_probe[k]['rows'] == before[k]['rows'] + 1 for k in expected_probe_tables)
    retained_equal = after == after_probe
    assert retained_equal
    assert Z.retained_data() == after, 'lab data changed since the saved rollback state'
    expected = json.loads(L.psql_clone_ok("""SELECT json_build_object(
 'policy_rpc_absent',to_regprocedure('public.simhub_observation_policy_v1(text)') IS NULL,
 'persist_back_to_three_columns',(SELECT cardinality(proallargtypes)-pronargs=3 FROM pg_proc WHERE oid='public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)'::regprocedure),
 'capture_triggers_absent',NOT EXISTS(SELECT FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgname LIKE 'pitwall_learning_capture%'),
 'all_switches_off',(SELECT NOT(capture_enabled OR worker_enabled OR shadow_enabled OR advice_enabled OR observation_enabled) FROM pitwall_learning.runtime_settings WHERE id=1),
 'worker_no_login',(SELECT NOT rolcanlogin AND rolconnlimit=0 FROM pg_roles WHERE rolname='pitwall_learning_worker'),
 'worker_no_schema_usage',NOT has_schema_privilege('pitwall_learning_worker','pitwall_learning','USAGE'),
 'worker_no_execute',NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pitwall_learning' AND has_function_privilege('pitwall_learning_worker',p.oid,'EXECUTE')),
 'private_schema_retained',to_regnamespace('pitwall_learning') IS NOT NULL,
 'ten_private_tables',(SELECT count(*)=10 FROM pg_tables WHERE schemaname='pitwall_learning'),
 'observation_column_retained',EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='simhub_lap_summaries' AND column_name='observation'))"""))
    assert all(expected.values()), expected
    # 3. Switches off, then legacy V1/V2/V3 plus an observation row that must be
    #    rejected without losing the core frame.
    H.flag(False)
    env = L.assert_owned(C.CONTAINERS['cand'][1])['Config']['Env']
    assert 'SIMHUB_OBSERVATION_V1_ENABLED=false' in env
    R.prove_route(); source_proof()
    # These devices already carry committed frames from the earlier stages; a
    # low sequence number would be rejected as a replay instead of proving the
    # path under test.
    high = int(L.psql_clone_ok("SELECT coalesce(max(last_sequence),0) FROM public.simhub_devices "
                               "WHERE id::text LIKE 'd5000000-%'").strip())
    seq = high + 10
    http = []
    for v, i in ((1, 0), (2, 1), (3, 4)):
        b = U.frame(seq) if v == 3 else U.legacy(v, seq)
        if v == 3:
            b['lapSummaries'] = [U.lap(4, 900, False)]
        r = U.send('cand', i, b)
        http.append({'version': v, 'request': b, 'response': r})
        assert r['status'] == 202, r
        if v == 3:
            assert r['json']['measurements']['laps']['accepted']
    b = U.frame(seq + 1); b['lapSummaries'] = [U.lap(4, 901)]
    r = U.send('cand', 4, b)
    http.append({'case': 'observation-disabled-no-core-loss', 'request': b, 'response': r})
    assert r['status'] == 202 and r['json']['measurements']['laps']['rejected']
    assert Z.retained_data()['pitwall_learning.capture_batches'] == after_probe['pitwall_learning.capture_batches']
    R.save('ROLLBACK-POSITIVE-EXPECTED-STATE.json', {'verdict': 'PASS_SAFE_DISABLE',
        'checks': expected, 'rollback_only_digest_equal': after_s2e5 == before,
        'retained_equal_except_proof_rows': retained_equal,
        'proof_rows_added': {k: after_probe[k]['rows'] - before[k]['rows'] for k in sorted(expected_probe_tables)},
        'http': http, 'fallback': fallback,
        'byte_restoration': 'NOT_PERFORMED; retained private schema/observation column/new writer by normative contract'})
    handles = R.owned_handles()
    assert len(handles) == 7, handles
    assert sum(x['memory'] for x in handles.values()) <= 3072*1048576
    assert sum(x['cpus'] for x in handles.values()) <= 2000000000
    R.save('FINAL-HANDLES.json', {'containers': handles,
        'network': R.resource('network', L.NET),
        'volumes': {v: R.resource('volume', v) for v in (L.DB_VOLUME, L.FUNC_VOLUME+'-base',
                    L.FUNC_VOLUME+'-cand', L.DENO_VOLUME, L.KONG_CONTAINER+'cfg', L.CLIENT_VOLUME)},
        'cluster': R.guard(), 'edge_flag': False, 'db_all_switches_off': True,
        'retained_for_reviewer': True, 'all_nonroot_claim': False})
    R.save('SAFE-DISABLE.json', {'records': records, 'retained_equal': retained_equal,
                                 'rollback_only_digest_equal': after_s2e5 == before,
                                 'proof_rows_added': {k: after_probe[k]['rows'] - before[k]['rows'] for k in sorted(expected_probe_tables)},
                                 'fallback_real_http': fallback['extra_call_delta'],
                                 'verdict': 'PASS'})
    R.checkpoint('s2e5-finished-safe-disabled-retained-owned-lab', handles='FINAL-HANDLES.json')


def resume_finish():
    """Resume after a metadata assertion without replaying completed rollbacks."""
    R.guard()
    assert not (ART/'SAFE-DISABLE.json').exists()
    read = lambda name: json.loads((ART/name).read_text())
    before = read('rollback-retained-before.json')
    after_s2e5 = read('rollback-retained-after-s2e5-rollback.json')
    after_probe = read('rollback-retained-after-fallback-proof.json')
    after = read('rollback-retained-after.json')
    records = read('ROLLBACK-ORDER.json')
    assert [r['file'] for r in records] == [lab.NEW_MIGRATION] + list(reversed([m for m in M.MIGRATIONS if m != lab.NEW_MIGRATION]))
    assert all(r['exit'] == 0 for r in records)
    finish_disable(before, after_s2e5, after_probe, after, records,
                   read('FUNCTIONAL-FALLBACK.json')[0])


if __name__ == '__main__':
    import sys
    {'acl': acl, 'source': source_proof, 'disable': disable, 'finish-saved': resume_finish,
     'rollback-one': lambda: rollback_file(lab.NEW_MIGRATION)}[sys.argv[1]]()
