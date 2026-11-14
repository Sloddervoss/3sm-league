"""S2E4 fixed-candidate registration/execution/recompute; no favorable retry."""
import datetime
import io
import json
import math
import pathlib
import tarfile
import lab
from lab import ART, OLD, ROOT, L, R, U, C
import benchmark as B

DID='d4000000-0000-4000-8000-000000000099'
OID='a4000000-0000-4000-8000-000000000099'
REG='NEWREGISTERED-BENCHMARK.json'


def sha(path):return L.hashlib.sha256(path.read_bytes()).hexdigest()

def fingerprint():
    value=B.fingerprint()
    for arm in ('base','cand'):
        value['schema'][arm].pop('IDENT',None)
        value['schema'][arm].pop('COUNTS',None)
    # Include the gateway, client, DB, network and all runtime budgets as well.
    value['handles']=R.owned_handles()
    assert sum(x['memory'] for x in value['handles'].values())<=3072*1048576
    assert sum(x['cpus'] for x in value['handles'].values())<=2000000000
    for arm in ('base','cand'):
        for component in ('edge','rest'):
            a=value['handles'][L.PREFIX+component+'-'+arm]
            b=value['handles'][L.PREFIX+component+'-'+('cand' if arm=='base' else 'base')]
            assert a['memory']==b['memory'] and a['cpus']==b['cpus']
    return value


def register():
    R.guard();R.prove_route()
    assert not (ART/REG).exists(),'Immutable registration already exists'
    assert json.loads((ART/'ENTRY-TYPECHECK.json').read_text())['cand']['exit']==0
    assert all(x['exit']==0 for x in json.loads((ART/'REGRESSIONS.json').read_text()).values())
    assert len(json.loads((ART/'functional-feature-on.json').read_text()))==11
    assert len(json.loads((ART/'WRITE-TIME-RACES.json').read_text()))==2
    head=L.check(L.sh(['git','rev-parse','HEAD']),'HEAD').stdout.decode().strip()
    assert not L.check(L.sh(['git','status','--porcelain']),'clean source freeze').stdout
    import secrets
    token=secrets.token_urlsafe(40)
    L.write_private(ART/'benchmark-token.json',json.dumps({'token':token}))
    th=L.hashlib.sha256(token.encode()).hexdigest()
    for db in C.DB_FOR.values():
        L.psql_clone_ok(L.CLONE_GUARD+f"INSERT INTO auth.users(id,email,aud,role,is_sso_user) VALUES('{OID}','s2e4-benchmark@example.invalid','authenticated','authenticated',false); INSERT INTO public.simhub_devices(id,owner_user_id,token_hash,device_name,connector_id,device_status) VALUES('{DID}','{OID}','{th}','S2E4 synthetic benchmark','s2e4-benchmark','active_unbound');",db=db)
    L.psql_clone_ok(f"INSERT INTO pitwall_learning.account_policy(owner_user_id,capture_enabled,policy_version) VALUES('{OID}',true,1)")
    pairs=[]
    for i in range(240):
        body=U.frame(i+1001);body['transportSessionId']='s2e4-benchmark-single-valid-run'
        traffic='hot-no-new-measurement'
        if i%50==39:
            observation=(i//50)%2==1
            row=U.lap(2,30000+i,observation)
            start=datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=62)
            start=start.replace(microsecond=(start.microsecond//1000)*1000)
            stamp=lambda x:x.isoformat(timespec='milliseconds').replace('+00:00','Z')
            row.update(startedAt=stamp(start),endedAt=stamp(start+datetime.timedelta(seconds=60)),observedSessionId='s2e4-benchmark-measured-synthetic-session')
            if observation:
                row['observation']['capture']['deviceId']=DID
                row['observation']['interval'].update(firstSampleAt=stamp(start+datetime.timedelta(milliseconds=50)),lastSampleAt=stamp(start+datetime.timedelta(milliseconds=59950)),samples=121)
            body['lapSummaries']=[row]
            traffic='fresh-observation-lap' if observation else 'fresh-legacy-lap'
        pairs.append({'index':i,'phase':'warmup' if i<40 else 'measured','order':['base','cand'] if i%2==0 else ['cand','base'],'traffic':traffic,'body':body})
    R.save('benchmark-dataset.json',pairs)
    before=fingerprint();R.save('benchmark-before.json',before)
    cfg=json.loads((OLD/'REGISTERED-BENCHMARK-ATTEMPT-2.json').read_text())
    for key in ('prior_attempt','prior_raw_sha256','correction','attempt'):cfg.pop(key,None)
    cfg.update(version=2,registered_at=U.now(),frozen_application_commit=head,worktree_head=head,
        fingerprint=before,dataset_sha256=sha(ART/'benchmark-dataset.json'),
        runner_sha256=sha(ROOT/'scripts/pitwall-learning/s2e3/http_benchmark.ts'),
        control_hashes={str(p.relative_to(ROOT)):sha(p) for p in sorted((ROOT/'scripts/pitwall-learning/s2e4').glob('*.py'))},
        baseline='OLD actual captured LIVE source; not prior failed candidate',
        endpoints={'base':'http://kong:8000/functions/v1/simhub-ingest-v3','cand':'http://kong-cand:8000/candidate-functions/v1/simhub-ingest-v3'},
        cadence={**cfg['cadence'],'spacing':'last same-arm response completion +700ms; global start spacing 600ms; concurrency 1'},
        source_qualification='Captured TS baseline unchanged; .env intentionally not copied. Earlier component/role/publication clone residuals remain; not whole-DB identical.',
        new_namespace=L.PREFIX,new_benchmark_device=DID,
        client_image=L.assert_owned(R.CLIENT)['Image'],kong_image=L.assert_owned(C.KONG_CONTAINER)['Image'])
    # Existing recompute consumes this same registration, never an alternative.
    R.save('REGISTERED-BENCHMARK.json',cfg)
    digest=R.save(REG,cfg)
    L.write_private(ART/'NEWREGISTERED-BENCHMARK.sha256',digest+'  '+REG+'\n')
    L.write_private(ART/'REGISTERED-BENCHMARK.sha256',digest+'\n')
    R.checkpoint('new-fixed-candidate-preregistered-before-timing',sha256=digest,source=head)
    print('REGISTERED',head,digest)


def execute():
    R.guard()
    assert not (ART/'benchmark-attempt-1.raw.jsonl').exists(),'One fixed valid run only'
    cfg=json.loads((ART/REG).read_text())
    assert sha(ART/REG)==(ART/'NEWREGISTERED-BENCHMARK.sha256').read_text().split()[0]
    assert sha(ART/'benchmark-dataset.json')==cfg['dataset_sha256']
    assert fingerprint()==cfg['fingerprint'],'Pre-run source/schema/config/dataset/resource drift'
    runner=(ROOT/'scripts/pitwall-learning/s2e3/http_benchmark.ts').read_bytes()
    assert L.hashlib.sha256(runner).hexdigest()==cfg['runner_sha256']
    for rel,digest in cfg['control_hashes'].items():assert sha(ROOT/rel)==digest
    b=io.BytesIO()
    with tarfile.open(fileobj=b,mode='w:gz') as tf:
        info=tarfile.TarInfo('http_benchmark.ts');info.size=len(runner);tf.addfile(info,io.BytesIO(runner))
    R.run(f'docker exec -i {R.CLIENT} tar -xzf - -C /lab','frozen-runner',stdin=b.getvalue())
    payload={'pairs':json.loads((ART/'benchmark-dataset.json').read_text()),'token':json.loads((ART/'benchmark-token.json').read_text())['token'],'apikey':json.loads((ART/'lab-api-keys.json').read_text())['service_role'],'globalSpacingMs':600,'armSpacingMs':700,'timeoutMs':20000,'completionGap':True}
    R.checkpoint('single-fixed-candidate-benchmark-running',registration_sha256=sha(ART/REG))
    p=L.remote(f'docker exec -i {R.CLIENT} deno run --cached-only --allow-net /lab/http_benchmark.ts',stdin=json.dumps(payload).encode(),timeout=580)
    L.write_private(ART/'benchmark-attempt-1.raw.jsonl',p.stdout)
    L.write_private(ART/'benchmark-attempt-1.stderr',p.stderr)
    R.save('benchmark-attempt-1-exit.json',{'exit':p.returncode,'raw_sha256':L.hashlib.sha256(p.stdout).hexdigest()})
    R.save('benchmark-after.json',fingerprint())
    B.recompute()
    validate()


def validate():
    B.recompute()
    rows=[json.loads(line) for line in (ART/'benchmark-attempt-1.raw.jsonl').read_text().splitlines()]
    pairs=json.loads((ART/'benchmark-dataset.json').read_text())
    assert len(rows)==480
    assert [(r['pair'],r['arm']) for r in rows]==[(p['index'],a) for p in pairs for a in p['order']]
    counts={arm:{phase:sum(r['arm']==arm and r['phase']==phase for r in rows) for phase in ('warmup','measured')} for arm in ('base','cand')}
    assert all(v=={'warmup':40,'measured':200} for v in counts.values())
    before=json.loads((ART/'benchmark-before.json').read_text());after=json.loads((ART/'benchmark-after.json').read_text())
    assert before['handles']==after['handles'],'Resource drift'
    last={};gaps=[]
    for row in rows:
        if row['arm'] in last:gaps.append(row['startMs']-last[row['arm']])
        last[row['arm']]=row['startMs']+row['elapsedMs']
    assert min(gaps)>=400,'Device floor violated'
    writes={}
    for arm,db in C.DB_FOR.items():
        writes[arm]=json.loads(L.psql_clone_ok(f"SELECT json_build_object('last_sequence',(SELECT last_sequence FROM public.simhub_devices WHERE id='{DID}'),'laps',(SELECT count(*) FROM public.simhub_lap_summaries WHERE device_id='{DID}'))",db=db))
    writes['capture_batches']=int(L.psql_clone_ok(f"SELECT count(*) FROM pitwall_learning.capture_batches WHERE owner_user_id='{OID}'"))
    writes['observations']=int(L.psql_clone_ok(f"SELECT count(*) FROM public.simhub_lap_summaries WHERE device_id='{DID}' AND observation IS NOT NULL"))
    assert writes=={'base':{'last_sequence':1240,'laps':3},'cand':{'last_sequence':1240,'laps':5},'capture_batches':5,'observations':2},writes
    R.save('BENCHMARK-VALIDATION.json',{'counts':counts,'min_same_arm_completion_gap_ms':min(gaps),'writes':writes,'registration_sha256':sha(ART/REG),'raw_sha256':sha(ART/'benchmark-attempt-1.raw.jsonl')})
    R.checkpoint('fixed-run-mechanically-validated',verdict=json.loads((ART/'BENCHMARK-RESULT.json').read_text())['verdict'])

if __name__=='__main__':
    import sys
    {'register':register,'execute':execute,'validate':validate}[sys.argv[1]]()
