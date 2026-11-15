#!/usr/bin/env python3
"""S2E4 adapter for the approved guarded S2E3 harness; no production routes.

Only captured inputs are read from OLD. All writes and handles belong to ART.
"""
import hashlib
import json
import pathlib
import shlex
import shutil
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[3]
OLD = pathlib.Path('/home/hermes/artifacts/3sm/pitwall-learning-p2-readonly-clone-20261114')
ART = pathlib.Path('/home/hermes/artifacts/3sm/pitwall-learning-p2-latency-repair-20261114')
sys.path.insert(0, str(ROOT / 'scripts/pitwall-learning/s2e3'))
import s2e3lib as L

L.ART = ART
L.LOGS, L.WORK, L.SECRETS_FILE = ART/'logs', ART/'work', ART/'lab-secrets.json'
L.PREFIX = 'pitwall-learning-s2e4-'
L.LABEL_VAL = 'pitwall-learning-s2e4'
L.LABEL = L.LABEL_KEY + '=' + L.LABEL_VAL
for key, suffix in [('NET','net'),('DB_CONTAINER','db'),('REST_CONTAINER','rest'),
                    ('EDGE_CONTAINER','edge'),('KONG_CONTAINER','kong'),('DB_VOLUME','dbdata'),
                    ('FUNC_VOLUME','functions'),('DENO_VOLUME','denocache'),('CLIENT_VOLUME','client')]:
    setattr(L, key, L.PREFIX+suffix)
L.LAB_DB_BASE, L.LAB_DB_CAND = 'pitwall_learning_s2e4_base', 'pitwall_learning_s2e4_cand'
L.LAB_DB = L.LAB_DB_CAND
L.SSH = ['ssh','-o','BatchMode=yes','-o','ControlMaster=auto',
         '-o','ControlPersist=60','-o','ControlPath='+str(ART/'ssh-control'),L.HOST]
L.CLONE_GUARD = L.CLONE_GUARD.replace('pitwall_learning_s2e3_', 'pitwall_learning_s2e4_')

def forbidden(*args, **kwargs):
    raise L.GuardError('Production access is disabled in S2E4')
L.psql_prod_file = forbidden
# Function default arguments are bound at definition, not at invocation.
original_psql = L.psql_clone
L.psql_clone = lambda sql, db=L.LAB_DB_CAND, **kw: original_psql(sql, db=db, **kw)
original_ok = L.psql_clone_ok
L.psql_clone_ok = lambda sql, db=L.LAB_DB_CAND, **kw: original_ok(sql, db=db, **kw)
import clone as C
import resume as R
import functional as U
import migrate as M
import finish as Z

C.fetch_live_edge = forbidden
C.functions = forbidden
C.reset_lab = forbidden
C.down_owned = forbidden
L.ensure_dirs()
LEDGER = ART/'resource-ledger.json'

def ledger():
    return json.loads(LEDGER.read_text()) if LEDGER.exists() else {}

def remember(name, meta):
    records = ledger()
    records[name] = {'id':meta['Id'],'image':meta['Image'],
        'mounts':meta['Mounts'],'network':meta['HostConfig']['NetworkMode'],
        'labels':meta['Config'].get('Labels'), 'memory':meta['HostConfig']['Memory'],
        'cpus':meta['HostConfig']['NanoCpus']}
    R.save('resource-ledger.json', records)
    L.log('created-handles', name=name, **records[name])

original_owned = L.assert_owned

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

raw_run = R.run

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
# seed already records IDs, but register them before its assert_owned call.
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

# New namespace and synthetic account identities, never reuse prior fixture accounts.
U.SESSION='s2e4-functional-fixed-session'
U.device=lambda i:f'd4000000-0000-4000-8000-{i+1:012d}'
U.owner=lambda i:f'a4000000-0000-4000-8000-{i+1:012d}'

def setup():
    assert not LEDGER.exists(), 'No adoption or automatic reset'
    C.preflight()
    dump=(OLD/'prod-schema-public-auth.sql').read_bytes()
    assert hashlib.sha256(dump).hexdigest()=='bb1e6d1a3b09e446b4f27f2e5eeb42e9651cbf042788a70733e5260b7b0201fa'
    for file in ('prod-schema-public-auth.sql','deno-cache-copy.tar.gz'):
        shutil.copyfile(OLD/file,ART/file)
        (ART/file).chmod(0o600)
    for tree in ('live-edge-baseline','candidate-edge'):
        shutil.copytree(OLD/tree,ART/tree,ignore=shutil.ignore_patterns('.env'))
    R.save('input-provenance.json', {file:hashlib.sha256((ART/file).read_bytes()).hexdigest() for file in ('prod-schema-public-auth.sql','deno-cache-copy.tar.gz')})
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
        p=L.psql_clone('BEGIN;'+L.CLONE_GUARD+'\n'+path.read_text()+'\nCOMMIT;')
        L.write_private(ART/('apply-'+name+'.log'),p.stdout+p.stderr)
        assert p.returncode==0, 'Migration failed; private log: '+name
    for vol in (L.FUNC_VOLUME+'-base',L.FUNC_VOLUME+'-cand',L.DENO_VOLUME,L.KONG_CONTAINER+'cfg'):
        L.assert_absent(vol,'volume')
        run(f'docker volume create --label {L.LABEL} {vol}','create-'+vol)
    R.route()
    U.seed();U.smoke();U.flag_on();U.matrix()
    R.owned_handles()
    R.checkpoint('equivalent-lab-functional-ready-for-diagnostic')

def fixtures():
    # The foreground setup deadline interrupted smoke after its first accepted
    # request. Preserve that partial evidence; use fresh sequences, not DB reset.
    if (ART/'functional-smoke.json').exists():
        shutil.copyfile(ART/'functional-smoke.json',ART/'functional-smoke-interrupted.json')
    frame, legacy = U.frame, U.legacy
    U.frame = lambda seq=1: frame(seq+100)
    U.legacy = lambda version, seq=1: legacy(version,seq+100)
    U.seed(); U.smoke(); U.flag_on(); U.matrix()
    R.checkpoint('equivalent-lab-functional-ready-for-diagnostic')

if __name__=='__main__':
    commands={'setup':setup,'inspect':R.inspect,'route':R.prove_route,'matrix':U.matrix,
              'authority':Z.authority,'rollback':Z.rollback,'fixtures':fixtures}
    stage=sys.argv[1]
    R.checkpoint('starting-'+stage)
    try: commands[stage]()
    except Exception as error:
        R.checkpoint('blocked-'+stage,error=str(error))
        raise
