#!/usr/bin/env python3
"""S2E5 fixed-candidate registration, one execution, mechanical recomputation.

One single fixed run. Unfavorable valid results are FAIL and are never retried.
"""
import datetime
import io
import json
import math
import tarfile

import benchmark as B
import lab
from lab import ART, OLD, ROOT, L, R, U, C

DID = 'd5000000-0000-4000-8000-000000000099'
OID = 'a5000000-0000-4000-8000-000000000099'
REG = 'REGISTERED-BENCHMARK.json'
SESSION = 's2e5-benchmark-single-valid-run'
TRAFFIC_SESSION = 's2e5-benchmark-measured-synthetic-session'
# Exact, name-based: a matrix that silently lost, renamed or duplicated a case
# must block registration instead of passing a count check. Recorded in
# REPORT.md alongside the run.
MATRIX_CASES = (
    'eligible-fresh-observation-write',
    'ordinary-hot-no-new-measurement',
    'policy-denied-fresh-row',
    'policy-row-missing-fresh-row',
    'revoked-device',
    'replay',
    'observation-device-binding-mismatch',
    'invalid-batch-valid-core',
    'valid-legacy-measurement-batch',
    'global-capture-closed-no-batch',
    'policy-rpc-absent-embedded-still-published',
)


def sha(path):
    return L.hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint():
    value = B.fingerprint()
    for arm in ('base', 'cand'):
        value['schema'][arm].pop('IDENT', None)
        value['schema'][arm].pop('COUNTS', None)
    value['handles'] = R.owned_handles()
    assert sum(x['memory'] for x in value['handles'].values()) <= 3072*1048576
    assert sum(x['cpus'] for x in value['handles'].values()) <= 2000000000
    for arm in ('base', 'cand'):
        for component in ('edge', 'rest'):
            a = value['handles'][L.PREFIX+component+'-'+arm]
            b = value['handles'][L.PREFIX+component+'-'+('cand' if arm == 'base' else 'base')]
            assert a['memory'] == b['memory'] and a['cpus'] == b['cpus']
    return value


def register():
    R.guard(); R.prove_route()
    assert not (ART/REG).exists(), 'Immutable registration already exists'
    assert json.loads((ART/'ENTRY-TYPECHECK.json').read_text())['cand']['exit'] == 0
    assert all(x['exit'] == 0 for x in json.loads((ART/'REGRESSIONS.json').read_text()).values())
    assert len(json.loads((ART/'functional-feature-on.json').read_text())) == 12
    assert len(json.loads((ART/'WRITE-TIME-RACES.json').read_text())) == 2
    assert json.loads((ART/'LEGACY-CONTROL.json').read_text())['verdict'] == 'EXPECTED_FAIL_OLD_SEPARATE_CALL'
    head = L.check(L.sh(['git', 'rev-parse', 'HEAD']), 'HEAD').stdout.decode().strip()
    assert not L.check(L.sh(['git', 'status', '--porcelain']), 'clean source freeze').stdout
    import secrets
    token = secrets.token_urlsafe(40)
    L.write_private(ART/'benchmark-token.json', json.dumps({'token': token}))
    th = L.hashlib.sha256(token.encode()).hexdigest()
    for db in C.DB_FOR.values():
        L.psql_clone_ok(L.CLONE_GUARD+f"INSERT INTO auth.users(id,email,aud,role,is_sso_user) VALUES('{OID}','s2e5-benchmark@example.invalid','authenticated','authenticated',false); INSERT INTO public.simhub_devices(id,owner_user_id,token_hash,device_name,connector_id,device_status) VALUES('{DID}','{OID}','{th}','S2E5 synthetic benchmark','s2e5-benchmark','active_unbound');", db=db)
    L.psql_clone_ok(f"INSERT INTO pitwall_learning.account_policy(owner_user_id,capture_enabled,policy_version) VALUES('{OID}',true,1)")
    pairs = []
    for i in range(240):
        body = U.frame(i+3001); body['transportSessionId'] = SESSION
        traffic = 'hot-no-new-measurement'
        if i % 50 == 39:
            observation = (i//50) % 2 == 1
            row = U.lap(2, 30000+i, observation)
            start = datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=62)
            start = start.replace(microsecond=(start.microsecond//1000)*1000)
            stamp = lambda x: x.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            row.update(startedAt=stamp(start), endedAt=stamp(start+datetime.timedelta(seconds=60)),
                       observedSessionId=TRAFFIC_SESSION)
            if observation:
                row['observation']['capture']['deviceId'] = DID
                row['observation']['interval'].update(firstSampleAt=stamp(start+datetime.timedelta(milliseconds=50)),
                                                      lastSampleAt=stamp(start+datetime.timedelta(milliseconds=59950)),
                                                      samples=121)
            body['lapSummaries'] = [row]
            traffic = 'fresh-observation-lap' if observation else 'fresh-legacy-lap'
        pairs.append({'index': i, 'phase': 'warmup' if i < 40 else 'measured',
                      'order': ['base', 'cand'] if i % 2 == 0 else ['cand', 'base'],
                      'traffic': traffic, 'body': body})
    R.save('benchmark-dataset.json', pairs)
    before = fingerprint(); R.save('benchmark-before.json', before)
    cfg = {
        'version': 1,
        'registered_at': U.now(),
        'frozen_application_commit': head,
        'worktree_head': head,
        'fingerprint': before,
        'schema_dump_sha256': sha(ART/'prod-schema-public-auth.sql'),
        'dataset_sha256': sha(ART/'benchmark-dataset.json'),
        'runner_sha256': sha(ROOT/'scripts/pitwall-learning/s2e3/http_benchmark.ts'),
        'control_hashes': {str(p.relative_to(ROOT)): sha(p) for p in sorted((ROOT/'scripts/pitwall-learning/s2e5').glob('*.py'))},
        'handoff_hashes': {str(p.relative_to(ROOT)): sha(p) for p in sorted((ROOT/'scripts/pitwall-learning/s2e3').glob('*.py'))
                           + sorted((ROOT/'scripts/pitwall-learning/s2e3').glob('*.ts'))},
        'baseline': 'OLD actual captured LIVE source and live-shaped schema; not the S2E4 candidate',
        'endpoints': {'base': 'http://kong:8000/functions/v1/simhub-ingest-v3',
                      'cand': 'http://kong-cand:8000/candidate-functions/v1/simhub-ingest-v3'},
        'warmup_pairs': 40,
        'measured_pairs': 200,
        'order': 'AB,BA alternating pairs (ABBA), serial concurrency 1',
        'clock': 'Deno performance.now milliseconds: immediately before fetch to complete response body; internal network HTTP only',
        'cadence': {'globalSpacingMs': 600, 'armSpacingMs': 700, 'completionGap': True,
                    'spacing': 'last same-arm response completion +700ms; global start spacing 600ms; concurrency 1'},
        'traffic': {'hot_frames': 'no new measurement on all pairs except indices 39,89,139,189,239',
                    'fresh_measurement_frames': 'one fresh synthetic 60-second lap every 50 pairs; alternating legacy and observation',
                    'measured_mix': '196 hot + 2 fresh legacy + 2 fresh observation per arm'},
        'quantile': 'nearest rank sorted samples[ceil(0.95*n)-1], arm-wise pooled measured frames',
        'gate': 'candidate_p95 - base_p95 <= base_p95*0.10 AND <=20ms, exact unrounded values; no epsilon',
        'flags': {'base': 'actual deployed source; no observation env flag',
                  'candidate': 'SIMHUB_OBSERVATION_V1_ENABLED=true; private capture_enabled=true; observation_enabled=true; worker/shadow/advice false',
                  'account_policy': 'synthetic benchmark owner capture=true, version=1'},
        'roles': 'actual authenticator -> service_role through PostgREST, real auth.role() checks; no RPC bypass',
        'expected_semantic_differences': [
            'candidate adds observation enabled/mode/available/policy and reads the policy from the persist result',
            'base rejects the observation-bearing lap row at the parser; candidate accepts the same fresh row and captures',
            'legacy lap ACK must match and core accepted=true/202 for every frame',
            'receivedAt ignored only for parity; any other unexpected ACK difference invalidates'],
        'expected_writes': {'base_legacy_laps': 3, 'cand_legacy_laps': 5, 'cand_observation_rows': 2,
                            'cand_private_capture_batches_min': 1, 'last_sequence': 3240,
                            'separate_policy_rpc_calls_during_run': 0},
        'stop': 'on transport error or non-202 stop and retain all samples; any semantic mismatch, missing sample, route/source/schema/config drift invalidates',
        'run_rule': 'single fixed valid run; unfavorable valid result is FAIL, no favorable rerun',
        'new_namespace': L.PREFIX,
        'new_benchmark_device': DID,
        'client_image': L.assert_owned(R.CLIENT)['Image'],
        'kong_image': L.assert_owned(C.KONG_CONTAINER)['Image'],
        'source_qualification': 'Captured LIVE baseline unchanged; .env intentionally not copied. Earlier clone component/role/publication residuals remain; not whole-DB identical.',
        'limitations': ['no WAN/CDN/TLS claim', 'small fresh-write class does not establish standalone write p95',
                        'no ML/model/advice quality measurement'],
    }
    R.save(REG, cfg)
    digest = sha(ART/REG)
    L.write_private(ART/'REGISTERED-BENCHMARK.sha256', digest+'  '+REG+'\n')
    R.checkpoint('s2e5-fixed-candidate-preregistered-before-timing', sha256=digest, source=head)
    print('REGISTERED', head, digest)


def execute():
    R.guard()
    assert not (ART/'benchmark-attempt-1.raw.jsonl').exists(), 'One fixed valid run only'
    cfg = json.loads((ART/REG).read_text())
    assert sha(ART/REG) == (ART/'REGISTERED-BENCHMARK.sha256').read_text().split()[0]
    assert sha(ART/'benchmark-dataset.json') == cfg['dataset_sha256']
    assert fingerprint() == cfg['fingerprint'], 'Pre-run source/schema/config/dataset/resource drift'
    runner = (ROOT/'scripts/pitwall-learning/s2e3/http_benchmark.ts').read_bytes()
    assert L.hashlib.sha256(runner).hexdigest() == cfg['runner_sha256']
    for rel, digest in cfg['control_hashes'].items():
        assert sha(ROOT/rel) == digest, rel
    b = io.BytesIO()
    with tarfile.open(fileobj=b, mode='w:gz') as tf:
        info = tarfile.TarInfo('http_benchmark.ts'); info.size = len(runner)
        tf.addfile(info, io.BytesIO(runner))
    R.run(f'docker exec -i {R.CLIENT} tar -xzf - -C /lab', 'frozen-runner', stdin=b.getvalue())
    payload = {'pairs': json.loads((ART/'benchmark-dataset.json').read_text()),
               'token': json.loads((ART/'benchmark-token.json').read_text())['token'],
               'apikey': json.loads((ART/'lab-api-keys.json').read_text())['service_role'],
               'globalSpacingMs': 600, 'armSpacingMs': 700, 'timeoutMs': 20000, 'completionGap': True}
    before_calls = U.kong_counts()
    R.checkpoint('s2e5-single-fixed-candidate-benchmark-running', registration_sha256=sha(ART/REG))
    p = L.remote(f'docker exec -i {R.CLIENT} deno run --cached-only --allow-net /lab/http_benchmark.ts',
                 stdin=json.dumps(payload).encode(), timeout=580)
    after_calls = U.kong_counts()
    L.write_private(ART/'benchmark-attempt-1.raw.jsonl', p.stdout)
    L.write_private(ART/'benchmark-attempt-1.stderr', p.stderr)
    R.save('benchmark-attempt-1-exit.json', {'exit': p.returncode,
                                             'raw_sha256': L.hashlib.sha256(p.stdout).hexdigest()})
    R.save('benchmark-kong-deltas.json', {k: after_calls[k]-before_calls[k] for k in before_calls})
    R.save('benchmark-after.json', fingerprint())
    recompute()
    validate()


def recompute():
    cfg = json.loads((ART/REG).read_text())
    assert sha(ART/REG) == (ART/'REGISTERED-BENCHMARK.sha256').read_text().split()[0]
    rows = [json.loads(line) for line in (ART/'benchmark-attempt-1.raw.jsonl').read_text().splitlines()]
    errors = []
    if len(rows) != 480:
        errors.append(f'expected 480 samples, actual {len(rows)}')
    indexed = {(r['pair'], r['arm']): r for r in rows}
    if len(indexed) != len(rows):
        errors.append('duplicate pair/arm sample')
    dataset = json.loads((ART/'benchmark-dataset.json').read_text())
    for pair in dataset:
        responses = {}
        for arm in ('base', 'cand'):
            r = indexed.get((pair['index'], arm))
            if not r:
                continue
            if r['status'] != 202 or r['error']:
                errors.append(f'core failure {pair["index"]}/{arm}'); continue
            body = json.loads(r['response']); responses[arm] = body
            if not body.get('accepted'):
                errors.append('not accepted')
            if arm == 'cand':
                obs = body.get('observation', {})
                if obs != {'enabled': True, 'mode': 'on', 'available': True,
                           'policy': {'captureAllowed': True, 'policyVersion': 1}}:
                    errors.append(f'feature not on {pair["index"]}')
        if len(responses) == 2:
            a = responses['base']; b = responses['cand']
            a.pop('receivedAt', None); b.pop('receivedAt', None); b.pop('observation', None)
            if pair['traffic'] == 'fresh-observation-lap':
                x = a['measurements']['laps']; y = b['measurements']['laps']
                if len(x['rejected']) != 1 or len(y['accepted']) != 1 or y['rejected'] or x['accepted']:
                    errors.append(f'expected new feature ACK difference missing {pair["index"]}')
                x['rejected'] = []; y['accepted'] = []
            if a != b:
                errors.append(f'unexpected ACK difference {pair["index"]}')
    before = json.loads((ART/'benchmark-before.json').read_text())
    after = json.loads((ART/'benchmark-after.json').read_text())
    for fp in (before, after):
        for arm in ('base', 'cand'):
            fp['schema'][arm].pop('IDENT', None)
            fp['schema'][arm].pop('COUNTS', None)
    for k in ('sources', 'schema', 'config'):
        if before[k] != after[k]:
            errors.append(k+' drift')
    if before['handles'] != after['handles']:
        errors.append('resource drift')

    def stats(values):
        if not values:
            return None
        s = sorted(values)
        return {'n': len(s), 'p50_ms': s[math.ceil(.5*len(s))-1], 'p95_ms': s[math.ceil(.95*len(s))-1],
                'min_ms': s[0], 'max_ms': s[-1]}
    measured = [r for r in rows if r['phase'] == 'measured']
    arms = {arm: stats([r['elapsedMs'] for r in measured if r['arm'] == arm]) for arm in ('base', 'cand')}
    base = arms['base']; cand = arms['cand']
    delta = cand['p95_ms']-base['p95_ms'] if base and cand else None
    threshold = min(base['p95_ms']*.1, 20) if base else None
    passes = delta is not None and threshold is not None and delta <= threshold
    result = {'verdict': 'INVALID' if errors else ('PASS' if passes else 'FAIL'),
              'errors': errors, 'arms': arms, 'delta_p95_ms': delta, 'allowed_delta_ms': threshold,
              'classes': {kind: {arm: stats([r['elapsedMs'] for r in measured
                                             if r['arm'] == arm and r['traffic'] == kind])
                                 for arm in ('base', 'cand')}
                          for kind in sorted(set(r['traffic'] for r in measured))},
              'registration_sha256': sha(ART/REG),
              'raw_sha256': sha(ART/'benchmark-attempt-1.raw.jsonl'),
              'kong_deltas': json.loads((ART/'benchmark-kong-deltas.json').read_text())}
    R.save('BENCHMARK-RESULT.json', result)
    R.checkpoint('s2e5-benchmark-recomputed', verdict=result['verdict'])
    print(json.dumps({k: result[k] for k in ('verdict', 'arms', 'delta_p95_ms',
                                             'allowed_delta_ms', 'errors')}, indent=2))
    return result


def validate():
    result = recompute()
    rows = [json.loads(line) for line in (ART/'benchmark-attempt-1.raw.jsonl').read_text().splitlines()]
    dataset = json.loads((ART/'benchmark-dataset.json').read_text())
    assert [(r['pair'], r['arm']) for r in rows] == [(p['index'], a) for p in dataset for a in p['order']]
    counts = {arm: {phase: sum(r['arm'] == arm and r['phase'] == phase for r in rows)
                    for phase in ('warmup', 'measured')} for arm in ('base', 'cand')}
    assert all(v == {'warmup': 40, 'measured': 200} for v in counts.values()), counts
    last = {}; gaps = []
    for row in rows:
        if row['arm'] in last:
            gaps.append(row['startMs']-last[row['arm']])
        last[row['arm']] = row['startMs']+row['elapsedMs']
    assert min(gaps) >= 400, 'Device floor violated'
    writes = {}
    for arm, db in C.DB_FOR.items():
        writes[arm] = json.loads(L.psql_clone_ok(
            f"SELECT json_build_object('last_sequence',(SELECT last_sequence FROM public.simhub_devices WHERE id='{DID}'),"
            f"'laps',(SELECT count(*) FROM public.simhub_lap_summaries WHERE device_id='{DID}'))", db=db))
    writes['capture_batches'] = int(L.psql_clone_ok(
        f"SELECT count(*) FROM pitwall_learning.capture_batches WHERE owner_user_id='{OID}'"))
    writes['observations'] = int(L.psql_clone_ok(
        f"SELECT count(*) FROM public.simhub_lap_summaries WHERE device_id='{DID}' AND observation IS NOT NULL"))
    kong = json.loads((ART/'benchmark-kong-deltas.json').read_text())
    assert writes['base'] == {'last_sequence': 3240, 'laps': 3}, writes['base']
    assert writes['cand'] == {'last_sequence': 3240, 'laps': 5}, writes['cand']
    assert writes['capture_batches'] > 0, 'candidate did not capture'
    assert writes['observations'] == 2, writes
    assert kong.get('simhub_observation_policy_v1', 0) == 0, 'the separate policy hop was still used'
    R.save('BENCHMARK-VALIDATION.json', {'counts': counts, 'min_same_arm_completion_gap_ms': min(gaps),
        'writes': writes, 'kong_deltas': kong,
        'registration_sha256': sha(ART/REG),
        'raw_sha256': sha(ART/'benchmark-attempt-1.raw.jsonl'),
        'zero_extra_policy_hop': kong.get('simhub_observation_policy_v1', 0) == 0})
    R.checkpoint('s2e5-fixed-run-mechanically-validated', verdict=result['verdict'])


if __name__ == '__main__':
    import sys
    {'register': register, 'execute': execute, 'validate': validate,
     'recompute': recompute}[sys.argv[1]]()
