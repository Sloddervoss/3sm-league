#!/usr/bin/env python3
"""S2E5 adapter: isolated lab for the policy-in-persist package.

Nothing here touches production. The captured inputs from the read-only clone
(S2E3 artifact root) are read once and copied here; every write, container,
volume, network and database name belongs to this phase's own prefix
`pitwall-learning-s2e5-` / `3sm.test=pitwall-learning-s2e5`.

Stages: setup | candidate | sql | typecheck | functional | matrix | regression
        | races | authority | allocate
"""
import hashlib
import json
import os
import pathlib
import shlex
import shutil
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[3]
OLD = pathlib.Path('/home/hermes/artifacts/3sm/pitwall-learning-p2-readonly-clone-20261114')
ART = pathlib.Path(os.environ.get('S2E5_ARTIFACT_ROOT', '/home/hermes/artifacts/3sm/pitwall-learning-p2-policy-hop-20261114'))
sys.path.insert(0, str(ROOT / 'scripts/pitwall-learning/s2e3'))
import s2e3lib as L  # noqa: E402

L.ART = ART
L.LOGS, L.WORK, L.SECRETS_FILE = ART/'logs', ART/'work', ART/'lab-secrets.json'
L.PREFIX = 'pitwall-learning-s2e5-'
L.LABEL_VAL = 'pitwall-learning-s2e5'
L.LABEL = L.LABEL_KEY + '=' + L.LABEL_VAL
for key, suffix in [('NET','net'),('DB_CONTAINER','db'),('REST_CONTAINER','rest'),
                    ('EDGE_CONTAINER','edge'),('KONG_CONTAINER','kong'),('DB_VOLUME','dbdata'),
                    ('FUNC_VOLUME','functions'),('DENO_VOLUME','denocache'),('CLIENT_VOLUME','client')]:
    setattr(L, key, L.PREFIX+suffix)
L.LAB_DB_BASE, L.LAB_DB_CAND = 'pitwall_learning_s2e5_base', 'pitwall_learning_s2e5_cand'
L.LAB_DB = L.LAB_DB_CAND
L.SSH = ['ssh','-o','BatchMode=yes','-o','ControlMaster=auto',
         '-o','ControlPersist=60','-o','ControlPath='+str(ART/'ssh-control'),L.HOST]
L.CLONE_GUARD = L.CLONE_GUARD.replace('pitwall_learning_s2e3_', 'pitwall_learning_s2e5_')

def forbidden(*args, **kwargs):
    raise L.GuardError('Production access is disabled in S2E5')
L.psql_prod_file = forbidden
# Function default arguments are bound at definition, not at invocation.
# Originals live on the shared s2e3lib module object: this file also runs as
# `__main__` while the stage modules import it as `lab`, so every patch must be
# applied on top of the genuine upstream function exactly once.
if not hasattr(L, '_s2e5_originals'):
    L._s2e5_originals = {}
_ORIG = L._s2e5_originals
_ORIG.setdefault('psql_clone', L.psql_clone)
_ORIG.setdefault('psql_clone_ok', L.psql_clone_ok)
original_psql, original_ok = _ORIG['psql_clone'], _ORIG['psql_clone_ok']
L.psql_clone = lambda sql, db=L.LAB_DB_CAND, **kw: original_psql(sql, db=db, **kw)
L.psql_clone_ok = lambda sql, db=L.LAB_DB_CAND, **kw: original_ok(sql, db=db, **kw)

import clone as C  # noqa: E402
import resume as R  # noqa: E402
import functional as U  # noqa: E402
import migrate as M  # noqa: E402
import finish as Z  # noqa: E402

C.fetch_live_edge = forbidden
C.functions = forbidden
C.reset_lab = forbidden
C.down_owned = forbidden
L.ensure_dirs()

# The S2E5 migration joins the same dependency-ordered candidate set.
NEW_MIGRATION = '20261114101500_pitwall_learning_policy_in_persist'
if NEW_MIGRATION not in M.MIGRATIONS:
    M.MIGRATIONS.append(NEW_MIGRATION)

LEDGER = ART/'resource-ledger.json'

# ------------------------------------------------------------------ ledger ---
def ledger():
    return json.loads(LEDGER.read_text()) if LEDGER.exists() else {}

def remember(name, meta):
    records = ledger()
    records[name] = {'id':meta['Id'],'image':meta['Image'],
        'mounts':meta['Mounts'],'network':meta['HostConfig']['NetworkMode'],
        'labels':meta['Config'].get('Labels'), 'memory':meta['HostConfig']['Memory'],
        'cpus':meta['HostConfig']['NanoCpus']}
    R.save('resource-ledger.json', records)
    with (ART/'resource-ledger-history.jsonl').open('a') as history:
        history.write(json.dumps({'name': name, **records[name]}, sort_keys=True)+'\n')
    L.log('created-handles', name=name, **records[name])

_ORIG.setdefault('assert_owned', L.assert_owned)
original_owned = _ORIG['assert_owned']

def owned(name):
    meta = original_owned(name)
    recorded = ledger().get(name)
    assert recorded and recorded['id'] == meta['Id'], 'Refuse unrecorded/replaced container: '+name
    assert recorded['image'] == meta['Image'] and recorded['mounts'] == meta['Mounts']
    R.resource('network', L.NET)
    for mount in meta['Mounts']:
        assert mount['Type']=='volume' and mount['Name'].startswith(L.PREFIX)
        R.resource('volume', mount['Name'])
    return meta
L.assert_owned = owned

_ORIG.setdefault('run', R.run)
raw_run = _ORIG['run']

def run(command, label, stdin=None, timeout=300):
    """Record exact IDs before start, including non-auto-removed helpers."""
    words = shlex.split(command)
    if words[:2] == ['docker','run']:
        name = words[words.index('--name')+1]
        assert name.startswith(L.PREFIX)
        L.assert_absent(name)
        detached = '-d' in words
        words[1] = 'create'
        if '-d' in words: words.remove('-d')
        if '--rm' in words: words.remove('--rm')
        if '--pull' not in words: words[2:2] = ['--pull','never']
        cid = raw_run(shlex.join(words), label+'-create', timeout=timeout).strip()
        meta = original_owned(name)
        assert meta['Id']==cid and meta['State']['Status']=='created'
        remember(name, meta)
        R.checkpoint('container-created-before-start', name=name, id=cid, ledger='resource-ledger.json')
        raw_run('docker start '+('-ai ' if not detached else '')+cid, label+'-start', stdin=stdin, timeout=timeout)
        owned(name)
        return cid+'\n'
    return raw_run(command, label, stdin=stdin, timeout=timeout)
R.run = run
C._run = run

def seed(volume, data, label):
    R.resource('volume',volume)
    name=L.PREFIX+'seed'
    L.assert_absent(name)
    handles=R.owned_handles()
    assert sum(x['memory'] for x in handles.values())+128*1048576<=3072*1048576
    assert sum(x['cpus'] for x in handles.values())+100000000<=2000000000
    cid=run(f'docker run -i --name {name} --label {L.LABEL} --network {L.NET} '
        f'--memory 128m --cpus 0.1 --cap-drop ALL --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add CHOWN '
        f'-v {volume}:/dst {L.image_id(C.ALPINE)} tar -xzf - -C /dst',label,stdin=data).strip()
    owned(name)
    raw_run('docker rm -f '+cid,label+'-remove')
R.seed=C._seed_volume=seed

def guard():
    meta=owned(L.DB_CONTAINER)
    assert meta['State']['Running'] and meta['Image']==L.PG_IMAGE_ID
    assert meta['Mounts']==ledger()[L.DB_CONTAINER]['mounts']
    cluster=L.psql_clone_ok("SELECT system_identifier FROM pg_control_system()",db='postgres').strip()
    state=json.loads((ART/'cluster-identity.json').read_text())
    assert state['id']==meta['Id'] and state['cluster']==cluster and cluster!=R.PROD_CLUSTER
    assert L.psql_clone_ok('SHOW data_directory',db='postgres').strip()=='/var/lib/postgresql/data'
    R.EXPECTED_DB=meta['Id']
    return cluster
R.guard=guard
if LEDGER.exists() and L.DB_CONTAINER in ledger():
    R.EXPECTED_DB=ledger()[L.DB_CONTAINER]['id']

def wait_db(timeout=360):
    """Wait for the FINAL server, not the image's temporary init instance.

    The supabase/postgres entrypoint initializes a fresh data directory with a
    throwaway server, stops it and only then starts the real one on the same
    PGDATA; `pg_isready` is already true during that init window. The postgres
    command line sets `log_min_messages=fatal`, so the final server never logs
    its own "ready to accept connections" line: the init-complete marker *after*
    the shutdown is the real signal, and a working query afterwards proves the
    final instance is serving.
    """
    deadline=time.time()+timeout
    started=time.time()
    last=''
    while time.time()<deadline:
        p=L.remote(f'docker logs {L.DB_CONTAINER}')
        text=(p.stdout+p.stderr).decode(errors='replace')
        init_complete='PostgreSQL init process complete' in text
        init_pending='running /docker-entrypoint-initdb.d' in text and not init_complete
        if init_complete or (not init_pending and time.time()-started>90):
            q=L.remote(f'docker exec {L.DB_CONTAINER} psql -X -q -At -U supabase_admin -d postgres -c "SELECT 1"')
            if q.returncode==0 and q.stdout.strip()==b'1':
                print('db ready: final server, init_complete=%s' % init_complete)
                R.checkpoint('db-final-server-ready', init_complete=init_complete)
                return
            last=(q.stdout+q.stderr).decode(errors='replace')
        time.sleep(3)
    raise RuntimeError('db not ready: '+last)
C.wait_db=wait_db

# Kong boots slower than the container's "running" state; the shared prove_route
# helper raises on a transport error instead of retrying it, so retry the whole
# read-only proof (it is idempotent) until the proxy actually answers.
_ORIG.setdefault('prove_route', R.prove_route)
original_prove_route=_ORIG['prove_route']

def prove_route():
    last=None
    for attempt in range(20):
        try:
            return original_prove_route()
        except RuntimeError as error:
            if 'HTTP client' not in str(error):
                raise
            last=error
            L.log('prove-route-retry', attempt=attempt, error=str(error)[:200])
            time.sleep(3)
    raise last if last else RuntimeError('route proof failed')
R.prove_route=prove_route

# New namespace and synthetic account identities, never reuse prior fixtures.
U.SESSION='s2e5-functional-fixed-session'
U.device=lambda i:f'd5000000-0000-4000-8000-{i+1:012d}'
U.owner=lambda i:f'a5000000-0000-4000-8000-{i+1:012d}'

# --------------------------------------------------------------- candidate ---
# Exactly the package files that differ from the captured live source, plus the
# runtime files the package owns. Resolved from the worktree, proven against the
# captured live tree, and recorded per file.
OVERLAY = [
    'supabase/functions/simhub-ingest-v3/index.ts',
    'supabase/functions/simhub-ingest-v3/context.ts',
    'supabase/functions/simhub-ingest-v3/persist.ts',
    'supabase/functions/simhub-ingest-v3/observationCapability.ts',
    'supabase/functions/_shared/simhub.ts',
    'supabase/functions/_shared/observationPolicyV1.ts',
    'supabase/functions/_shared/observationV1.ts',
    # observationContext/observationWindow are test-only in this repository
    # (only *.test.ts exist); they are not part of the runtime overlay.
    'supabase/functions/_shared/simhubExtensions.ts',
    'supabase/functions/_shared/simhubAggregates.ts',
    'supabase/functions/_shared/tyreObservation.ts',
    'supabase/functions/_shared/tyreTelemetry.ts',
    'supabase/functions/_shared/lapTimes.ts',
    'supabase/functions/_shared/vehicleTelemetry.ts',
    'supabase/functions/_shared/paceCapture.ts',
]

def build_candidate():
    if C.CAND_DIR.exists():
        shutil.rmtree(C.CAND_DIR)
    shutil.copytree(C.LIVE_DIR, C.CAND_DIR)
    applied = {}
    for rel in OVERLAY:
        src = ROOT / rel
        assert src.exists(), 'missing package file: '+rel
        dst = C.CAND_DIR / rel.split('functions/', 1)[1]
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())
        applied[rel] = L.hashlib.sha256(src.read_bytes()).hexdigest()
    L.write_private(ART/'candidate-overlay.json', json.dumps(applied, indent=2, sort_keys=True))
    # Continuity: the only intended difference against the captured S2E4
    # candidate tree is the S2E5 change; everything else must be untouched.
    prior = OLD.parent/'pitwall-learning-p2-latency-repair-20261114'/'candidate-edge'
    delta = {}
    if prior.is_dir():
        for path in sorted(C.CAND_DIR.rglob('*.ts')):
            rel = str(path.relative_to(C.CAND_DIR))
            other = prior/rel
            if not other.exists():
                delta[rel] = 'only_in_s2e5'
            elif other.read_bytes() != path.read_bytes():
                delta[rel] = {'s2e4': L.hashlib.sha256(other.read_bytes()).hexdigest(),
                              's2e5': L.hashlib.sha256(path.read_bytes()).hexdigest()}
        for path in sorted(prior.rglob('*.ts')):
            rel = str(path.relative_to(prior))
            if not (C.CAND_DIR/rel).exists():
                delta[rel] = 'only_in_s2e4'
    L.write_private(ART/'candidate-delta-vs-s2e4.json', json.dumps(delta, indent=2, sort_keys=True))
    print('candidate overlay files=%d, delta vs S2E4=%s' % (len(applied), sorted(delta)))
    return delta

def tree_hashes(base):
    return {str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(base.rglob('*')) if p.is_file() and p.name != '.env'}

def mirror_tree(src, dst):
    """Idempotent copy of a captured input tree inside our own artifact root.

    The captured source is authoritative (its dump hash is asserted separately).
    A pre-existing destination is reused only when it is byte-identical;
    otherwise it is a stale derived copy in this private root and is replaced,
    with the differing files recorded.
    """
    assert src.is_dir(), 'missing captured input tree: '+str(src)
    expected = tree_hashes(src)
    if dst.is_dir():
        actual = tree_hashes(dst)
        if actual == expected:
            L.log('setup-input-tree', tree=dst.name, action='reused-identical', files=len(expected))
            return 'reused'
        L.log('setup-input-tree', tree=dst.name, action='replaced-stale-copy',
              stale=sorted(set(actual.items()) ^ set(expected.items()))[:12])
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns('.env'))
    assert tree_hashes(dst) == expected, 'copy is not byte-identical: '+str(dst)
    L.log('setup-input-tree', tree=dst.name, action='copied', files=len(expected))
    return 'copied'

# ---------------------------------------------------------------- teardown ---
def teardown_partial():
    """Remove ONLY a partially built own lab after a setup failure.

    Every resource must carry the S2E5 label and prefix; containers must also
    match the exact ID recorded in the ledger before the ledger is archived and
    dropped, so a following `setup` starts from a proven-empty host. This is a
    recovery helper for our own half-built lab, never an adoption path.
    """
    assert LEDGER.exists(), 'no partial lab to remove'
    recorded=ledger()
    R.checkpoint('partial-teardown-start', ledger=list(recorded))
    containers=L.check(L.remote(f"docker ps -a --filter label={L.LABEL} --format '{{{{.Names}}}}'"),
                       'list-partial-containers').stdout.decode().split()
    for name in containers:
        assert name.startswith(L.PREFIX), name
        meta=original_owned(name)
        assert name in recorded and recorded[name]['id']==meta['Id'], 'unrecorded container: '+name
        L.log('teardown-partial', container=name, id=meta['Id'])
        raw_run('docker rm -f '+meta['Id'], 'rm-'+name)
    volumes=L.check(L.remote(f"docker volume ls --filter label={L.LABEL} --format '{{{{.Name}}}}'"),
                    'list-partial-volumes').stdout.decode().split()
    for volume in volumes:
        assert volume.startswith(L.PREFIX), volume
        L.log('teardown-partial', volume=volume)
        raw_run('docker volume rm '+volume, 'rmv-'+volume)
    networks=L.check(L.remote(f"docker network ls --filter label={L.LABEL} --format '{{{{.Name}}}}'"),
                     'list-partial-networks').stdout.decode().split()
    for network in networks:
        assert network==L.NET, network
        L.log('teardown-partial', network=network)
        raw_run('docker network rm '+network, 'rmnet')
    for kind, remaining in (('containers', containers), ('volumes', volumes), ('networks', networks)):
        for name in remaining:
            p=L.remote(f'docker {kind[:-1]} inspect {name}')
            assert p.returncode!=0, 'still present: '+name
    L.write_private(ART/'teardown-partial-ledger.json', json.dumps(recorded, indent=2, sort_keys=True))
    digest=hashlib.sha256(LEDGER.read_bytes()).hexdigest()
    LEDGER.unlink()
    L.log('teardown-partial', ledger_sha256=digest, removed=sorted(recorded))
    R.checkpoint('partial-teardown-complete', ledger_sha256=digest, archived='teardown-partial-ledger.json')
    print('partial lab removed:', {'containers':containers,'volumes':volumes,'networks':networks})

# ------------------------------------------------------------------ setup ---
def setup():
    assert not LEDGER.exists(), 'No adoption or automatic reset'
    C.preflight()
    dump=(OLD/'prod-schema-public-auth.sql').read_bytes()
    assert hashlib.sha256(dump).hexdigest()=='bb1e6d1a3b09e446b4f27f2e5eeb42e9651cbf042788a70733e5260b7b0201fa'
    for file in ('prod-schema-public-auth.sql','deno-cache-copy.tar.gz'):
        shutil.copyfile(OLD/file,ART/file)
        (ART/file).chmod(0o600)
    for tree in ('live-edge-baseline','candidate-edge'):
        mirror_tree(OLD/tree, ART/tree)
    R.save('input-provenance.json', {file:hashlib.sha256((ART/file).read_bytes()).hexdigest() for file in ('prod-schema-public-auth.sql','deno-cache-copy.tar.gz')})
    build_candidate()
    C.up()
    meta=owned(L.DB_CONTAINER)
    cluster=L.psql_clone_ok('SELECT system_identifier FROM pg_control_system()',db='postgres').strip()
    assert cluster!=R.PROD_CLUSTER
    R.save('cluster-identity.json',{'id':meta['Id'],'cluster':cluster})
    R.guard()
    for db in C.DB_FOR.values():
        L.psql_clone_ok(f"CREATE DATABASE {db} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8'",db='postgres')
        for ext in json.loads((OLD/'resume-base-extensions.json').read_text()):
            if ext['name']=='plpgsql':continue
            L.psql_clone_ok(f'CREATE SCHEMA IF NOT EXISTS "{ext["schema"]}"; CREATE EXTENSION "{ext["name"]}" WITH SCHEMA "{ext["schema"]}" VERSION \'{ext["version"]}\'',db=db)
        L.psql_clone_ok('DROP SCHEMA public CASCADE',db=db)
        R.guard()
        run(f'docker exec -i {L.DB_CONTAINER} psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d {db}', 'restore-'+db,stdin=dump,timeout=900)
    R.checkpoint('captured-schema-restored-both-arms')
    for name in M.MIGRATIONS:
        R.guard()
        path=ROOT/'supabase/migrations'/(name+'.sql')
        text=path.read_text()
        if '\nBEGIN;\n' in text:
            body=text.replace('\nBEGIN;\n', '\nBEGIN;\n'+L.CLONE_GUARD+'\n', 1)
            p=L.psql_clone(body)
        else:
            p=L.psql_clone('BEGIN;'+L.CLONE_GUARD+'\n'+text+'\nCOMMIT;')
        L.write_private(ART/('apply-'+name+'.log'),p.stdout+p.stderr)
        assert p.returncode==0, 'Migration failed; private log: '+name
    for vol in (L.FUNC_VOLUME+'-base',L.FUNC_VOLUME+'-cand',L.DENO_VOLUME,L.KONG_CONTAINER+'cfg'):
        L.assert_absent(vol,'volume')
        run(f'docker volume create --label {L.LABEL} {vol}','create-'+vol)
    R.route()
    U.seed();U.smoke();U.flag_on()
    R.owned_handles()
    R.checkpoint('equivalent-lab-functional-ready-for-regression')

if __name__=='__main__':
    import http_matrix as H
    import sql as S
    import verify as V
    import regression as G
    import races as RA
    commands={'setup':setup,'candidate':build_candidate,'sql':lambda:S.main(sys.argv[2]),
              'teardown-partial':teardown_partial,
              'typecheck':V.check,'functional':H.functional,'matrix':H.matrix,
              'regression':G.tests,'races':RA.main,'authority':Z.authority,
              'allocate':V.allocate}
    stage=sys.argv[1]
    R.checkpoint('starting-'+stage)
    try: commands[stage]()
    except Exception as error:
        R.checkpoint('blocked-'+stage,error=str(error))
        raise
