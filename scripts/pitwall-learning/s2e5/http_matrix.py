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


def policy_version(owner):
    """The published version must equal the single live row; never hard-coded."""
    value = L.psql_clone_ok(
        f"SELECT policy_version FROM pitwall_learning.account_policy WHERE owner_user_id='{owner}'").strip()
    assert value, 'no policy row for ' + owner
    return int(value)


def prepare_preconditions():
    """Rebuild the exact state every case below asserts, then prove it.

    The write-time race stages deliberately leave owner 2 denied and device 2
    revoked, and the "missing row" case needs an owner without any row, so the
    matrix must own its preconditions instead of inheriting whatever the
    previous stage left behind. Everything here is synthetic lab state inside
    the owned candidate database; the resulting rows are recorded.
    """
    R.guard()
    owners = f"'{U.owner(2)}','{U.owner(3)}','{U.owner(4)}'"
    # Delete first: an inherited row for owner 4 would silently turn the
    # "missing row" case into a second "denied" case.
    L.psql_clone_ok(f"DELETE FROM pitwall_learning.account_policy WHERE owner_user_id IN ({owners})")
    L.psql_clone_ok(
        "INSERT INTO pitwall_learning.account_policy(owner_user_id,capture_enabled,policy_version) "
        f"VALUES('{U.owner(2)}',true,1),('{U.owner(3)}',false,3)")
    L.psql_clone_ok(
        "UPDATE pitwall_learning.runtime_settings SET capture_enabled=true, observation_enabled=true, "
        "worker_enabled=false, shadow_enabled=false, advice_enabled=false WHERE id=1")
    for index in (2, 3, 4):
        L.psql_clone_ok(
            "UPDATE public.simhub_devices SET revoked_at=NULL, device_status='active_unbound', "
            "endurance_event_id=NULL, endurance_team_id=NULL, device_role=NULL "
            f"WHERE id='{U.device(index)}'")
    state = json.loads(L.psql_clone_ok(
        "SELECT coalesce(json_agg(json_build_object('owner',owner_user_id,'capture',capture_enabled,"
        "'version',policy_version) ORDER BY owner_user_id),'[]'::json) "
        f"FROM pitwall_learning.account_policy WHERE owner_user_id IN ({owners})"))
    devices = json.loads(L.psql_clone_ok(
        "SELECT coalesce(json_agg(json_build_object('device',id,'owner',owner_user_id,"
        "'status',device_status,'revoked',revoked_at IS NOT NULL) ORDER BY id),'[]'::json) "
        "FROM public.simhub_devices WHERE id::text LIKE 'd5000000-%'"))
    settings = json.loads(L.psql_clone_ok(
        "SELECT row_to_json(t) FROM pitwall_learning.runtime_settings t"))
    R.save('matrix-preconditions.json', {'policies': state, 'devices': devices, 'settings': settings})
    assert [(x['owner'], x['capture']) for x in state] == [
        (U.owner(2), True), (U.owner(3), False)], state
    assert devices[2]['device'] == U.device(2) and not devices[2]['revoked'], devices
    assert settings['capture_enabled'] and settings['observation_enabled'], settings
    assert not any(settings[k] for k in ('worker_enabled', 'shadow_enabled', 'advice_enabled')), settings
    return state


def matrix():
    R.prove_route()
    assert 'SIMHUB_OBSERVATION_V1_ENABLED=true' in L.assert_owned(C.CONTAINERS['cand'][1])['Config']['Env']
    prepare_preconditions()
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

    def run_case(name, i, seq, rows=None, expected=202, expect_capture=None, expect_persist=True):
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

    a = run_case('eligible-fresh-observation-write', 2, 2, [lap(2, 1)], expect_capture=True)
    assert a['response']['json']['observation']['mode'] == 'on'
    assert a['response']['json']['observation']['policy']['captureAllowed'] is True
    # The published version is whatever the single policy row says right now;
    # earlier stages bump it, so it must never be hard-coded.
    current_version = policy_version(U.owner(2))
    assert a['response']['json']['observation']['policy']['policyVersion'] == current_version
    assert a['after']['observations'] == a['before']['observations'] + 1
    R.save('ZERO-HOP.json', {'case': a['case'], 'persist_delta': a['extra_call_delta'][PERSIST],
                             'policy_delta': a['extra_call_delta'][POLICY],
                             'witness': 'kong access log', 'verdict': 'ZERO_EXTRA_POLICY_HOP'})

    a = run_case('ordinary-hot-no-new-measurement', 2, 3, expect_capture=False)
    a = run_case('policy-denied-fresh-row', 3, 1, [lap(3, 1)], expect_capture=False)
    assert a['response']['json']['observation']['policy']['captureAllowed'] is False
    a = run_case('policy-row-missing-fresh-row', 4, 1, [lap(4, 1)], expect_capture=False)
    assert a['response']['json']['observation']['policy']['captureAllowed'] is False
    a = run_case('revoked-device', 5, 1, expected=401, expect_persist=False)
    assert a['after'] == a['before']
    a = run_case('replay', 2, 3, expected=409)
    assert a['after'] == a['before']
    invalid = lap(2, 2); invalid['observation']['capture']['deviceId'] = U.device(3)
    a = run_case('observation-device-binding-mismatch', 2, 4, [invalid], expect_capture=False)
    assert a['response']['json']['measurements']['laps']['rejected']
    a = run_case('invalid-batch-valid-core', 2, 5, {'not': 'array'}, expect_capture=False)
    assert a['response']['json']['measurements']['laps']['block_error']
    # A legacy lap row (no observation block) is still a new measurement: the
    # pre-existing statement trigger captures every accepted lap summary that
    # passes the owner policy, independent of the observation payload. What must
    # NOT happen is an observation value appearing on the row.
    a = run_case('valid-legacy-measurement-batch', 2, 6, [lap(2, 3, False)], expect_capture=True)
    assert a['response']['json']['measurements']['laps']['accepted']
    assert a['after']['observations'] == a['before']['observations']

    # Closed capture core: the global switch is off while the account policy is
    # still positive. The frame is accepted, the policy fact is published, and
    # the pre-existing trigger captures nothing — without any extra hop.
    R.guard()
    L.psql_clone_ok("UPDATE pitwall_learning.runtime_settings SET capture_enabled=false WHERE id=1")
    try:
        closed = run_case('global-capture-closed-no-batch', 2, 8, [lap(2, 5)], expect_capture=False)
        assert closed['response']['json']['observation']['policy']['captureAllowed'] is True
        # `capture_batches` is the private capture artifact and must not move.
        # The lap row still stores the observation payload it carried: that
        # row-level column is written by the accepted persist path itself and is
        # gated by its own parser/trigger rules, not by the capture switch — the
        # same row it wrote in the eligible case above. Only the capture is
        # closed, so the observation count grows by exactly this one row.
        assert closed['after']['batches'] == closed['before']['batches'], closed
        assert closed['after']['observations'] == closed['before']['observations'] + 1, closed
    finally:
        R.guard()
        L.psql_clone_ok("UPDATE pitwall_learning.runtime_settings SET capture_enabled=true WHERE id=1")

    # Discriminating real-HTTP control: remove the separate policy RPC entirely.
    # The old code lost the policy here; the embedded fact must survive it.
    R.guard()
    L.psql_clone_ok(f"ALTER FUNCTION public.{POLICY}(text) RENAME TO s2e5_saved_policy_v1; NOTIFY pgrst,'reload schema';")
    time.sleep(3)
    try:
        a = run_case('policy-rpc-absent-embedded-still-published', 2, 9, [lap(2, 4)], expect_capture=True)
        assert a['response']['json']['observation']['policy']['captureAllowed'] is True
        assert a['response']['json']['observation']['policy']['policyVersion'] == current_version
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
