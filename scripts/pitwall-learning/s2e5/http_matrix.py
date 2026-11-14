"""S2E5 real-HTTP functional matrix: policy comes from the persist response.

Every case runs through Kong -> PostgREST -> PostgreSQL in the isolated lab.
The Kong access log is the independent, non-invasive witness for how many
policy RPCs a frame actually caused; no instrumentation is added to shipped
source.
"""
import json
import time

import lab
from lab import ART, L, R, U, C

POLICY = 'simhub_observation_policy_v1'
PERSIST = 'simhub_persist_v3'
PROBE = 'simhub_observation_v1_available'
NAMES = (POLICY, PERSIST, PROBE)


def kong_counts():
    """Count every RPC this package can cause, from the Kong access log.

    The shared helper only counts the two observation RPCs; the persist call is
    the one that must stay at exactly one per accepted frame, so it is counted
    here too rather than inferred.
    """
    L.assert_owned(C.KONG_CONTAINER)
    p = L.check(L.remote(f'docker logs {C.KONG_CONTAINER}'), 'kong logs')
    data = p.stdout + p.stderr
    return {name: data.count(('/rest/v1/rpc/' + name + ' ').encode()) for name in NAMES}


def flag(enabled):
    """Restart only the candidate Edge with an explicit observation flag.

    Reuses the accepted helper, but tolerates its positive on-assertion when the
    explicit transition is to `false`; the exact recorded ID and env are checked
    here instead.
    """
    original = R.run
    def run(command, *args, **kwargs):
        if not enabled:
            command = command.replace('SIMHUB_OBSERVATION_V1_ENABLED=true',
                                      'SIMHUB_OBSERVATION_V1_ENABLED=false')
        return original(command, *args, **kwargs)
    R.run = run
    try:
        try:
            U.flag_on()
        except AssertionError:
            if enabled:
                raise
    finally:
        R.run = original
    env = L.assert_owned(C.CONTAINERS['cand'][1])['Config']['Env']
    assert f'SIMHUB_OBSERVATION_V1_ENABLED={str(enabled).lower()}' in env
    R.owned_handles()


def functional():
    R.guard(); R.checkpoint('s2e5-real-http-functional-start')
    R.run(f'docker update --memory 1024m --memory-swap 2147483648 --cpus 0.6 {L.DB_CONTAINER}','matched-db-budget')
    R.run(f'docker update --memory 128m --memory-swap 268435456 --cpus 0.1 {R.CLIENT}','matched-client-budget')
    R.owned_handles()
    # Default off first: no probe, no policy, no capture. Fresh sequences.
    flag(False)
    frame, legacy = U.frame, U.legacy
    U.frame = lambda seq=1: frame(seq+2000)
    U.legacy = lambda v, seq=1: legacy(v, seq+2000)
    try:
        U.smoke()
    finally:
        U.frame, U.legacy = frame, legacy
    smoke = json.loads((ART/'functional-smoke.json').read_text())
    assert all(not any(x['extra_call_delta'].values()) for x in smoke), 'default off did work'
    flag(True)
    R.checkpoint('s2e5-default-off-zero-policy-work-PASS')


def matrix():
    R.prove_route()
    assert 'SIMHUB_OBSERVATION_V1_ENABLED=true' in L.assert_owned(C.CONTAINERS['cand'][1])['Config']['Env']
    # Sequence numbers must be above whatever the earlier default-off smoke
    # already committed for these devices: a lower number is a replay (409) and
    # would test the replay guard instead of the case at hand.
    high = int(L.psql_clone_ok("SELECT coalesce(max(last_sequence),0) FROM public.simhub_devices "
                               "WHERE id::text LIKE 'd5000000-%'").strip())
    base = high + 10
    results = []

    def lap(i, serial, observation=True):
        # The shared fixture derives the summary UID from the serial; folding in
        # the run's sequence base keeps re-runs from colliding with a row an
        # earlier attempt already wrote (revision_conflict instead of a capture).
        return U.lap(i, base + serial, observation)

    def probes():
        return kong_counts()

    def case(name, i, seq, rows=None, expected=202, expect_capture=None, expect_persist=True):
        body = U.frame(base + seq)
        if rows is not None:
            body['lapSummaries'] = rows
        before = U.counts(); calls = probes()
        r = U.send('cand', i, body)
        after = U.counts(); calls_after = probes()
        delta = {k: calls_after[k]-calls[k] for k in calls}
        rec = dict(case=name, device_index=i, request=body, response=r, before=before,
                   after=after, extra_call_delta=delta)
        results.append(rec); R.save('functional-feature-on.json', results)
        print(name, r['status'], r['body'], 'capture_delta', after['batches']-before['batches'], 'delta', delta)
        assert r['status'] == expected, name
        assert delta.get(POLICY, 0) == 0, f'{name}: the separate policy hop was still used'
        assert delta.get(PERSIST, 0) == (1 if expect_persist else 0), f'{name}: unexpected persist count'
        if expect_capture is not None:
            assert (after['batches'] > before['batches']) == expect_capture, name
        return rec

    a = case('eligible-fresh-observation-write', 2, 2, [lap(2, 1)], expect_capture=True)
    assert a['response']['json']['observation']['mode'] == 'on'
    assert a['response']['json']['observation']['policy']['captureAllowed'] is True
    assert a['response']['json']['observation']['policy']['policyVersion'] == 1
    assert a['after']['observations'] == a['before']['observations'] + 1
    R.save('ZERO-HOP.json', {'case': a['case'], 'persist_delta': a['extra_call_delta'][PERSIST],
                             'policy_delta': a['extra_call_delta'][POLICY],
                             'witness': 'kong access log', 'verdict': 'ZERO_EXTRA_POLICY_HOP'})

    a = case('ordinary-hot-no-new-measurement', 2, 3, expect_capture=False)
    a = case('policy-denied-fresh-row', 3, 1, [lap(3, 1)], expect_capture=False)
    assert a['response']['json']['observation']['policy']['captureAllowed'] is False
    a = case('policy-row-missing-fresh-row', 4, 1, [lap(4, 1)], expect_capture=False)
    assert a['response']['json']['observation']['policy']['captureAllowed'] is False
    a = case('revoked-device', 5, 1, expected=401, expect_persist=False)
    assert a['after'] == a['before']
    a = case('replay', 2, 3, expected=409)
    assert a['after'] == a['before']
    invalid = lap(2, 2); invalid['observation']['capture']['deviceId'] = U.device(3)
    a = case('observation-device-binding-mismatch', 2, 4, [invalid], expect_capture=False)
    assert a['response']['json']['measurements']['laps']['rejected']
    a = case('invalid-batch-valid-core', 2, 5, {'not': 'array'}, expect_capture=False)
    assert a['response']['json']['measurements']['laps']['block_error']
    # A legacy lap row (no observation block) is still a new measurement: the
    # pre-existing statement trigger captures every accepted lap summary that
    # passes the owner policy, independent of the observation payload. What must
    # NOT happen is an observation value appearing on the row.
    a = case('valid-legacy-measurement-batch', 2, 6, [lap(2, 3, False)], expect_capture=True)
    assert a['response']['json']['measurements']['laps']['accepted']
    assert a['after']['observations'] == a['before']['observations']

    # Discriminating real-HTTP control: remove the separate policy RPC entirely.
    # The old code lost the policy here; the embedded fact must survive it.
    R.guard()
    L.psql_clone_ok(f"ALTER FUNCTION public.{POLICY}(text) RENAME TO s2e5_saved_policy_v1; NOTIFY pgrst,'reload schema';")
    time.sleep(3)
    try:
        a = case('policy-rpc-absent-embedded-still-published', 2, 7, [lap(2, 4)], expect_capture=True)
        assert a['response']['json']['observation']['policy']['captureAllowed'] is True
        assert a['response']['json']['observation']['policy']['policyVersion'] == 1
    finally:
        R.guard()
        L.psql_clone_ok(f"ALTER FUNCTION public.s2e5_saved_policy_v1(text) RENAME TO {POLICY}; NOTIFY pgrst,'reload schema';")
        time.sleep(3)
    R.save('functional-feature-on.json', results)
    R.checkpoint('s2e5-feature-on-functional-matrix-executed', evidence='functional-feature-on.json')
    return results


def changed_permissions():
    """Permission change between two accepted frames is read in the same transaction."""
    R.guard()
    results = []
    frame = U.frame
    for enabled, seq in [(False, 50), (True, 51)]:
        L.psql_clone_ok(f"UPDATE pitwall_learning.account_policy SET capture_enabled={str(enabled).lower()},policy_version=policy_version+1 WHERE owner_user_id='{U.owner(2)}'")
        body = frame(seq); body['lapSummaries'] = [U.lap(2, seq)]
        before = U.counts(); r = U.send('cand', 2, body); after = U.counts()
        results.append({'enabled': enabled, 'request': body, 'response': r, 'before': before, 'after': after})
        R.save('FUNCTIONAL-CHANGED-PERMISSIONS.json', results)
        assert r['status'] == 202 and r['json']['observation']['policy']['captureAllowed'] == enabled
        assert (after['batches'] > before['batches']) == enabled
    R.checkpoint('s2e5-changed-permissions-read-fresh-in-transaction')
    return results


def fallback_http(seq=900001):
    """Real HTTP proof that an old database without the column still publishes.

    Runs while the flag is still on, after ONLY the S2E5 migration was rolled
    back: the persist result has three columns again, so the Edge must fall back
    to the bounded separate lookup. This is the rollout-order proof.
    """
    R.guard()
    before_calls = kong_counts()
    before = U.counts()
    body = U.frame(seq)
    body['lapSummaries'] = [U.lap(2, 900, False)]
    r = U.send('cand', 2, body)
    after_calls = kong_counts()
    after = U.counts()
    delta = {k: after_calls[k]-before_calls[k] for k in before_calls}
    rec = {'case': 'old-database-without-column-uses-bounded-fallback', 'request': body,
           'response': r, 'before': before, 'after': after, 'extra_call_delta': delta}
    R.save('FUNCTIONAL-FALLBACK.json', [rec])
    print(json.dumps({'status': r['status'], 'delta': delta}, sort_keys=True))
    assert r['status'] == 202, r
    assert delta[POLICY] == 1, 'the fallback lookup was not used exactly once: %s' % delta
    assert r['json']['observation']['policy']['captureAllowed'] is True
    R.checkpoint('s2e5-old-database-fallback-real-http-PASS')
    return rec
