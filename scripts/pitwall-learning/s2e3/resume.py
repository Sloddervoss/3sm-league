#!/usr/bin/env python3
"""Resume saved S2E3 resources only; no production access or downloads.

Usage: python3 scripts/pitwall-learning/s2e3/resume.py inspect|route
All evidence is private. Existing attempts and baseline database are preserved.
"""
from __future__ import annotations
import io
import json
import pathlib
import sys
import tarfile
import time

import clone as C
import s2e3lib as L

EXPECTED_DB = '8697ed00c78b5302ffd25476e5fd01eea8fcd2f4e094fcda4c7d4c802fa8b551'
PROD_CLUSTER = '7618318406906855462'
CLIENT = L.PREFIX + 'client'


def save(name, value):
    return L.write_private(L.ART / name, json.dumps(value, indent=2, sort_keys=True))


def checkpoint(stage, **fields):
    p = L.ART / 'CHECKPOINT.json'
    old = json.loads(p.read_text())
    old['resume'] = dict(stage=stage, at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), **fields)
    save('CHECKPOINT.json', old)


def run(args, label, stdin=None, timeout=300):
    # Never log command lines: stack command arguments contain synthetic secrets.
    p = L.remote(args, stdin=stdin, timeout=timeout)
    L.log('resume', step=label, exit=p.returncode,
          stdout_sha256=L.hashlib.sha256(p.stdout).hexdigest(), stderr_bytes=len(p.stderr))
    if p.returncode:
        L.write_private(L.ART / ('resume-' + label.replace(':', '-') + '.stderr'), p.stderr)
        raise RuntimeError(f'{label}: exit {p.returncode}; private stderr saved')
    return p.stdout.decode()


def resource(kind, name):
    assert name.startswith(L.PREFIX)
    m = json.loads(run(f'docker {kind} inspect {name}', 'inspect-' + name))[0]
    assert (m.get('Labels') or {}).get(L.LABEL_KEY) == L.LABEL_VAL
    if kind == 'network':
        assert m['Internal'] and not m.get('EnableIPv6')
    return m


def guard():
    m = L.assert_owned(L.DB_CONTAINER)
    assert m['Id'] == EXPECTED_DB and m['State']['Running']
    assert m['Image'] == L.PG_IMAGE_ID
    resource('network', L.NET)
    for mount in m['Mounts']:
        assert mount['Type'] == 'volume'
        resource('volume', mount['Name'])
    cluster = L.psql_clone_ok('SELECT system_identifier FROM pg_control_system()', db='postgres').strip()
    assert cluster != PROD_CLUSTER
    return cluster


def inspect():
    cluster = guard()
    state = {'cluster': cluster, 'db_id': EXPECTED_DB, 'databases': {}}
    for arm, db in C.DB_FOR.items():
        sql = """BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
SELECT json_build_object('database',current_database(),'private_schema',to_regnamespace('pitwall_learning'),
 'policy_rpc',to_regprocedure('public.simhub_observation_policy_v1(uuid)'),
 'observation_column',EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='simhub_lap_summaries' AND column_name='observation'),
 'capture_triggers',(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%observation%'));
ROLLBACK;"""
        state['databases'][arm] = json.loads(L.psql_clone_ok(sql, db=db).strip())
    names = run(f"docker ps -a --filter label={L.LABEL} --format '{{{{.Names}}}}'", 'list-owned').splitlines()
    state['containers'] = {}
    for name in names:
        m = L.assert_owned(name)
        state['containers'][name] = {'id': m['Id'], 'image': m['Image'], 'status': m['State']['Status'],
            'oom': m['State']['OOMKilled'], 'memory': m['HostConfig']['Memory'], 'cpus': m['HostConfig']['NanoCpus']}
    save('resume-current-state.json', state)
    checkpoint('inspected-current-resources', state_file='resume-current-state.json')
    print(json.dumps(state, indent=2))
    return state


def seed(volume, data, label):
    resource('volume', volume)
    name = L.PREFIX + 'seed'
    L.assert_absent(name)
    image = L.image_id(C.ALPINE)
    # A short-lived helper has no external route/binds and only the capabilities
    # needed to unpack source modes/ownership into the verified own volume.
    containers = owned_handles()
    assert sum(m['memory'] for m in containers.values()) + 128 * 1048576 <= 3072 * 1048576
    assert sum(m['cpus'] for m in containers.values()) + 100000000 <= 2000000000
    cid = run(f'docker create -i --pull never --name {name} --label {L.LABEL} '
        f'--network {L.NET} --memory 128m --cpus 0.1 --cap-drop ALL --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add CHOWN '
        f'-v {volume}:/dst {image} tar -xzf - -C /dst', label + '-create').strip()
    assert len(cid) == 64 and all(c in '0123456789abcdef' for c in cid)
    L.log('resume-helper-handles', id=cid, name=name, image=image, volume=volume)
    try:
        assert L.assert_owned(name)['Id'] == cid
        run(f'docker start -ai {cid}', label, stdin=data)
    finally:
        assert L.assert_owned(name)['Id'] == cid
        run(f'docker rm -f {cid}', label + '-remove')


def owned_handles():
    names = run(f"docker ps -a --filter label={L.LABEL} --format '{{{{.Names}}}}'", 'list-owned').splitlines()
    result = {}
    for name in names:
        m = L.assert_owned(name)
        result[name] = {'id': m['Id'], 'image': m['Image'], 'status': m['State']['Status'],
                        'memory': m['HostConfig']['Memory'], 'cpus': m['HostConfig']['NanoCpus']}
    save('RESUME-CURRENT-HANDLES.json', result)
    return result


def request(arm, path, method='GET', body=None, headers=None):
    guard()
    L.assert_owned(C.KONG_CONTAINER)
    L.assert_owned(CLIENT)
    keys = json.loads((L.ART / 'lab-api-keys.json').read_text())
    h = {'apikey': keys['service_role'], 'Authorization': 'Bearer ' + keys['service_role'],
         'Host': 'kong-cand' if arm == 'cand' else 'kong'}
    h.update(headers or {})
    host = 'kong-cand' if arm == 'cand' else 'kong'
    payload = {'url': f'http://{host}:8000' + path, 'method': method, 'headers': h, 'body': body}
    p = L.check(L.remote(f'docker exec -i {CLIENT} deno run --cached-only --allow-net /lab/request.ts',
                        stdin=json.dumps(payload).encode(), timeout=90), 'HTTP client')
    return json.loads(p.stdout)


def route():
    state = inspect()
    existing = state['containers']
    assert set(existing) <= {L.DB_CONTAINER}, 'Resume route stage requires DB-only starting state; inspect existing handles before retry'
    # Fresh resource availability, existing cached images only; no fresh infrastructure.
    mem = run('cat /proc/meminfo', 'memory')
    available = int(next(x.split()[1] for x in mem.splitlines() if x.startswith('MemAvailable:'))) // 1024
    additional = sum(v[0] for k, v in C.BUDGET.items() if k != L.DB_CONTAINER) + 128
    assert available >= additional + 2048, (available, additional)
    assert sum(v[0] for v in C.BUDGET.values()) + 128 <= 3072
    assert round(sum(v[1] for v in C.BUDGET.values()) + 0.1, 6) <= 2
    C._run = run
    C._seed_volume = seed
    for arm, src in [('base', C.LIVE_DIR), ('cand', C.CAND_DIR)]:
        assert src.is_dir()
        seed(L.FUNC_VOLUME + '-' + arm, C._tar_tree(src), 'seed-' + arm)
    seed(L.DENO_VOLUME, (L.ART / 'deno-cache-copy.tar.gz').read_bytes(), 'seed-cache')
    L.assert_absent(L.CLIENT_VOLUME, 'volume')
    run(f'docker volume create --label {L.LABEL} {L.CLIENT_VOLUME}', 'create-client-volume')
    script = '''const q = JSON.parse(await new Response(Deno.stdin.readable).text());
const t = performance.now();
const r = await fetch(q.url, {method:q.method,headers:q.headers,body:q.body === null ? undefined : JSON.stringify(q.body),signal:AbortSignal.timeout(20000)});
const text = await r.text();
console.log(JSON.stringify({status:r.status,body:text,ms:performance.now()-t}));
'''
    b = io.BytesIO()
    with tarfile.open(fileobj=b, mode='w:gz') as tf:
        raw = script.encode(); info = tarfile.TarInfo('request.ts'); info.size = len(raw)
        tf.addfile(info, io.BytesIO(raw))
    seed(L.CLIENT_VOLUME, b.getvalue(), 'seed-client')
    C.kong_config()
    checkpoint('volumes-seeded', current_db_state=state['databases'])
    try:
        C.stack()
    finally:
        owned_handles()
        checkpoint('stack-start-attempted', handles='RESUME-CURRENT-HANDLES.json')
    start_client()
    prove_route()


def start_client():
    guard()
    L.assert_absent(CLIENT)
    run(f'docker run -d --pull never --name {CLIENT} --label {L.LABEL} --network {L.NET} '
        f'--memory 128m --cpus 0.1 --cap-drop ALL -v {L.CLIENT_VOLUME}:/lab '
        f'--entrypoint deno {L.image_id("denoland/deno:latest")} eval "setInterval(()=>{{}},60000)"', 'run-client')
    owned_handles()


def prove_route():
    cluster = guard()
    # Marker is lab-only SQL DDL, not mutating HTTP. SQL embeds proven cluster/DB identity.
    for arm, db in C.DB_FOR.items():
        L.psql_clone_ok(L.CLONE_GUARD + f"""
CREATE OR REPLACE VIEW public.s2e3_route_marker AS
SELECT current_database()::text AS database, '{cluster}'::text AS cluster,
 '{EXPECTED_DB}'::text AS container;
GRANT SELECT ON public.s2e3_route_marker TO service_role;
NOTIFY pgrst,'reload schema';""", db=db)
    results = {}
    for arm, db in C.DB_FOR.items():
        r = {}
        for attempt in range(12):
            r = request(arm, '/rest/v1/s2e3_route_marker?select=*')
            if r['status'] == 200:
                break
            time.sleep(2)
        results[arm] = r
        assert r['status'] == 200, r
        assert json.loads(r['body']) == [{'database': db, 'cluster': cluster, 'container': EXPECTED_DB}], r
    save('HTTP-ROUTE-PROOF.json', results)
    checkpoint('read-only-http-route-PASS', proof='HTTP-ROUTE-PROOF.json', handles='RESUME-CURRENT-HANDLES.json')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    L.ensure_dirs()
    try:
        {'inspect': inspect, 'route': route, 'client': start_client, 'prove-route': prove_route}[sys.argv[1]]()
    except Exception as e:
        checkpoint('resume-failed', error=str(e), command=sys.argv[1:])
        raise
