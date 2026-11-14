#!/usr/bin/env python3
"""Preregister, execute once, and recompute paired real-HTTP latency evidence."""
import datetime
import io
import json
import math
import pathlib
import sys
import tarfile
import time
import clone as C
import faithfulness as F
import functional as U
import resume as R
import s2e3lib as L

HERE=pathlib.Path(__file__).resolve().parent


def tree_hashes(directory):
    return {str(p.relative_to(directory)):L.hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.rglob('*')) if p.is_file()}


def fingerprint():
    R.guard()
    result={'sources':{arm:tree_hashes(directory) for arm,directory in [('base',C.LIVE_DIR),('cand',C.CAND_DIR)]},'schema':{},'config':{},'dataset_state':{}}
    for arm,db in C.DB_FOR.items():
        snap=F.capture(db)
        # IDENTITY contains capture timestamps; hash stable schema sections only.
        result['schema'][arm]={k:L.hashlib.sha256(json.dumps(v,sort_keys=True).encode()).hexdigest() for k,v in snap.items() if k not in ('IDENTITY','MIGRATIONS')}
        for component in ('edge','rest'):
            name=L.PREFIX+component+'-'+arm
            m=L.assert_owned(name)
            cfg={k:m['Config'].get(k) for k in ('Image','Entrypoint','Cmd','Env')}
            result['config'][name]={'id':m['Id'],'image':m['Image'],'config_sha256':L.hashlib.sha256(json.dumps(cfg,sort_keys=True).encode()).hexdigest(),'memory':m['HostConfig']['Memory'],'cpus':m['HostConfig']['NanoCpus']}
        result['dataset_state'][arm]=L.psql_clone_ok("SELECT json_build_object('devices',(SELECT count(*) FROM public.simhub_devices),'sessions',(SELECT count(*) FROM public.simhub_device_sessions),'laps',(SELECT count(*) FROM public.simhub_lap_summaries),'latest',(SELECT count(*) FROM public.simhub_telemetry_latest),'policies_md5',NULL)",db=db).strip()
    return result


def register():
    R.guard()
    assert not (L.ART/'REGISTERED-BENCHMARK.json').exists(), 'Registration frozen: never overwrite'
    assert len(json.loads((L.ART/'functional-feature-on.json').read_text()))==11
    # Fresh synthetic benchmark identity, shared value but isolated per-arm state.
    sec=L.lab_secrets()
    import secrets
    token=secrets.token_urlsafe(40)
    L.write_private(L.ART/'benchmark-token.json',json.dumps({'token':token}))
    did='d0000000-0000-4000-8000-000000000099'
    oid='a0000000-0000-4000-8000-000000000099'
    th=L.hashlib.sha256(token.encode()).hexdigest()
    for db in C.DB_FOR.values():
        L.psql_clone_ok(L.CLONE_GUARD+f"INSERT INTO auth.users(id,email,aud,role,is_sso_user) VALUES('{oid}','s2e3-benchmark@example.invalid','authenticated','authenticated',false); INSERT INTO public.simhub_devices(id,owner_user_id,token_hash,device_name,connector_id,device_status) VALUES('{did}','{oid}','{th}','S2E3 synthetic benchmark','s2e3-benchmark','active_unbound');",db=db)
    L.psql_clone_ok(f"INSERT INTO pitwall_learning.account_policy(owner_user_id,capture_enabled,policy_version) VALUES('{oid}',true,1);")
    pairs=[]
    for i in range(240):
        body=U.frame(i+1);body['transportSessionId']='s2e3-benchmark-single-valid-run'
        traffic='hot-no-new-measurement'
        # 60-second synthetic laps, ~60 seconds delivery cadence at nominal 1.2 s/arm.
        # Explicit observations are absent from the deployed parser's contract;
        # their row rejection in base is an expected, preregistered feature delta.
        if i % 50 == 39:
            observation = (i//50)%2==1
            row=U.lap(2,1000+i,observation)
            start=datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=62)
            start=start.replace(microsecond=(start.microsecond//1000)*1000)
            stamp=lambda x:x.isoformat(timespec='milliseconds').replace('+00:00','Z')
            row.update(startedAt=stamp(start),endedAt=stamp(start+datetime.timedelta(seconds=60)),observedSessionId='s2e3-benchmark-measured-synthetic-session')
            if observation:
                row['observation']['capture']['deviceId']=did
                row['observation']['interval'].update(firstSampleAt=stamp(start+datetime.timedelta(milliseconds=50)),lastSampleAt=stamp(start+datetime.timedelta(milliseconds=59950)),samples=121)
            body['lapSummaries']=[row]
            traffic='fresh-observation-lap' if observation else 'fresh-legacy-lap'
        pairs.append(dict(index=i,phase='warmup' if i<40 else 'measured',order=['base','cand'] if i%2==0 else ['cand','base'],traffic=traffic,body=body))
    R.save('benchmark-dataset.json',pairs)
    fp=fingerprint();R.save('benchmark-before.json',fp)
    cfg={'version':1,'registered_at':U.now(),'frozen_application_commit':'e939c32aa5dd73d9d6ebf4a9b8e5a108e3c39277','worktree_head':'319911a7703db6d0da1a83ad245c0317ab12283f',
         'fingerprint':fp,'schema_dump_sha256':'bb1e6d1a3b09e446b4f27f2e5eeb42e9651cbf042788a70733e5260b7b0201fa',
         'dataset_sha256':L.hashlib.sha256((L.ART/'benchmark-dataset.json').read_bytes()).hexdigest(),
         'runner_sha256':L.hashlib.sha256((HERE/'http_benchmark.ts').read_bytes()).hexdigest(),
         'cached_dependency_archive_sha256':L.hashlib.sha256((L.ART/'deno-cache-copy.tar.gz').read_bytes()).hexdigest(),
         'client_image':L.assert_owned(R.CLIENT)['Image'], 'kong_image':L.assert_owned(C.KONG_CONTAINER)['Image'],
         'flags':{'base':'actual deployed source; no observation env flag','candidate':'SIMHUB_OBSERVATION_V1_ENABLED=true; private capture_enabled=true; observation_enabled=true; worker/shadow/advice false','account_policy':'synthetic benchmark owner capture=true, version=1'},
         'roles':'actual authenticator -> service_role through PostgREST, real auth.role() checks; no RPC bypass',
         'warmup_pairs':40,'measured_pairs':200,'order':'AB,BA alternating pairs (ABBA), serial concurrency 1',
         'clock':'Deno performance.now milliseconds: immediately before fetch to complete response body; internal network HTTP only',
         'cadence':{'globalSpacingMs':600,'armSpacingMs':700,'nominal_per_arm_ms':1200,'fleet':'one fresh synthetic device per arm, device+session isolated; shared cluster','rationale':'400ms DB device floor and 600/min Edge address ceiling respected; nominal 50 requests/min/arm is below normal 2Hz producer limit; actual slower service is retained, never discarded'},
         'traffic':{'hot_frames':'no new measurement on all pairs except indices 39,89,139,189,239','fresh_measurement_frames':'one fresh synthetic 60-second lap every 50 pairs (~60s); alternating legacy and observation; no replay preload; 196 hot + 2 legacy + 2 observation measured per arm','fixture':'accepted C# v3-frame-baseline.json plus accepted legacy pipeline lap serializer fixture; fresh synthetic observation interval/device; no history inferred from latest'},
         'expected_semantic_differences':['candidate adds observation enabled/mode/available/policy','base rejects observation-bearing lap row at parser; candidate accepts same fresh row and captures outbox','legacy lap ACK must match and core accepted=true/202 for every frame','receivedAt timestamp ignored only for parity; all other unexpected ACK differences invalidate'],
         'quantile':'nearest rank sorted samples[ceil(0.95*n)-1], arm-wise pooled measured frames; class results separately, tiny fresh class tails descriptive only',
         'gate':'candidate_p95 - base_p95 <= base_p95*0.10 AND <=20ms, exact unrounded values; no epsilon',
         'stop':'on transport error or non-202 stop and retain all samples; any semantic mismatch, missing sample, route/source/schema/config drift invalidates, never silently omit samples',
         'run_rule':'single fixed valid run; unfavorable valid result is FAIL, no favorable rerun; scaffold/route invalidity must retain unique failed attempt and requires explicit classification',
         'limitations':['no WAN/CDN/TLS claim','small fresh-write class does not establish standalone write p95','no ML/model/advice quality measurement']}
    sha=R.save('REGISTERED-BENCHMARK.json',cfg)
    L.write_private(L.ART/'REGISTERED-BENCHMARK.sha256',sha+'  REGISTERED-BENCHMARK.json\n')
    R.checkpoint('benchmark-preregistered-before-timing',registration_sha256=sha)
    print('Frozen registration SHA256',sha)


def execute():
    R.guard()
    assert not (L.ART/'benchmark-attempt-1.raw.jsonl').exists(),'Never repeat the fixed benchmark run'
    cfg=json.loads((L.ART/'REGISTERED-BENCHMARK.json').read_text())
    before=json.loads((L.ART/'benchmark-before.json').read_text())
    current=fingerprint()
    R.save('benchmark-prerun-readback.json',current)
    # The catalog calls its volatile identity section IDENT, not IDENTITY.
    # Pin this narrow correction before any timed request; original registration
    # and both rejected preflight attempts remain intact.
    for fp in (before,current):
        for arm in ('base','cand'):
            fp['schema'][arm].pop('IDENT',None)
            fp['schema'][arm].pop('COUNTS',None)
    addendum={'original_registration_sha256':L.hashlib.sha256((L.ART/'REGISTERED-BENCHMARK.json').read_bytes()).hexdigest(),
              'correction':'Exclude only volatile catalog IDENT section (snapshot txid and capture clock); all stable schema/config/source/dataset fields remain pinned. Two preflight stops, zero timed samples.',
              'registered_before_first_timed_request':True,'at':U.now(),'stable_fingerprint':before}
    if not (L.ART/'REGISTERED-BENCHMARK-ADDENDUM.json').exists():
        sha=R.save('REGISTERED-BENCHMARK-ADDENDUM.json',addendum)
        L.write_private(L.ART/'REGISTERED-BENCHMARK-ADDENDUM.sha256',sha+'\n')
    if not (L.ART/'REGISTERED-BENCHMARK-ADDENDUM-2.json').exists():
        sha=R.save('REGISTERED-BENCHMARK-ADDENDUM-2.json',{'at':U.now(),'before_any_timed_sample':True,
            'correction':'COUNTS also embeds snapshot_ts. Exclude redundant COUNTS summary hash, not any object inventory. All TABLES/COLUMNS/CONSTRAINTS/INDEXES/FUNCTIONS/TRIGGERS/roles/ACL/etc hashes remain compared. Three preflight stops, no timed HTTP samples.',
            'stable_fingerprint':before,'registration_sha256':addendum['original_registration_sha256']})
        L.write_private(L.ART/'REGISTERED-BENCHMARK-ADDENDUM-2.sha256',sha+'\n')
    if current!=before:
        changes={k:([sub for sub in current[k] if current[k][sub]!=before[k].get(sub)] if isinstance(current[k],dict) else True) for k in current if current[k]!=before[k]}
        sections={arm:[k for k,v in current['schema'][arm].items() if before['schema'][arm].get(k)!=v] for arm in ('base','cand')}
        raise AssertionError('Prerun fingerprint drift: '+json.dumps({'changes':changes,'schema_sections':sections}))
    runner=(HERE/'http_benchmark.ts').read_bytes()
    assert L.hashlib.sha256(runner).hexdigest()==cfg['runner_sha256']
    b=io.BytesIO()
    with tarfile.open(fileobj=b,mode='w:gz') as tf:
        info=tarfile.TarInfo('http_benchmark.ts');info.size=len(runner);tf.addfile(info,io.BytesIO(runner))
    # Client is already running; write only its verified owned named volume.
    R.resource('volume',L.CLIENT_VOLUME);L.assert_owned(R.CLIENT)
    R.run(f'docker exec -i {R.CLIENT} tar -xzf - -C /lab','seed-benchmark-client',stdin=b.getvalue())
    token=json.loads((L.ART/'benchmark-token.json').read_text())['token']
    keys=json.loads((L.ART/'lab-api-keys.json').read_text())
    payload={'pairs':json.loads((L.ART/'benchmark-dataset.json').read_text()),'token':token,'apikey':keys['service_role'],'globalSpacingMs':600,'armSpacingMs':700,'timeoutMs':20000}
    R.checkpoint('benchmark-running-single-attempt',raw='benchmark-attempt-1.raw.jsonl')
    p=L.remote(f'docker exec -i {R.CLIENT} deno run --cached-only --allow-net /lab/http_benchmark.ts',stdin=json.dumps(payload).encode(),timeout=580)
    L.write_private(L.ART/'benchmark-attempt-1.raw.jsonl',p.stdout)
    L.write_private(L.ART/'benchmark-attempt-1.stderr',p.stderr)
    R.save('benchmark-attempt-1-exit.json',{'exit':p.returncode,'raw_sha256':L.hashlib.sha256(p.stdout).hexdigest()})
    after=fingerprint();R.save('benchmark-after.json',after)
    R.checkpoint('benchmark-completed',exit=p.returncode,raw='benchmark-attempt-1.raw.jsonl')
    recompute()


def recompute(attempt=1):
    rawname=f'benchmark-attempt-{attempt}.raw.jsonl'
    regname='REGISTERED-BENCHMARK.json' if attempt==1 else 'REGISTERED-BENCHMARK-ATTEMPT-2.json'
    dataname='benchmark-dataset.json' if attempt==1 else 'benchmark-dataset-attempt-2.json'
    beforename='benchmark-before.json' if attempt==1 else 'benchmark-before-attempt-2.json'
    aftername='benchmark-after.json' if attempt==1 else 'benchmark-after-attempt-2.json'
    cfg=json.loads((L.ART/regname).read_text())
    assert L.hashlib.sha256((L.ART/regname).read_bytes()).hexdigest()==(L.ART/regname.replace('.json','.sha256')).read_text().split()[0], 'Frozen registration hash mismatch'
    rows=[json.loads(line) for line in (L.ART/rawname).read_text().splitlines()]
    errors=[]
    if len(rows)!=480:errors.append(f'expected 480 samples, actual {len(rows)}')
    indexed={(r['pair'],r['arm']):r for r in rows}
    if len(indexed)!=len(rows):errors.append('duplicate pair/arm sample')
    dataset=json.loads((L.ART/dataname).read_text())
    for pair in dataset:
        responses={}
        for arm in ('base','cand'):
            r=indexed.get((pair['index'],arm))
            if not r:continue
            if r['status']!=202 or r['error']:errors.append(f'core failure {pair["index"]}/{arm}');continue
            body=json.loads(r['response']);responses[arm]=body
            if not body.get('accepted'):errors.append('not accepted')
            if arm=='cand':
                obs=body.get('observation',{})
                if obs!={'enabled':True,'mode':'on','available':True,'policy':{'captureAllowed':True,'policyVersion':1}}:errors.append(f'feature not on {pair["index"]}')
        if len(responses)==2:
            a=responses['base'];b=responses['cand'];a.pop('receivedAt',None);b.pop('receivedAt',None);b.pop('observation',None)
            if pair['traffic']=='fresh-observation-lap':
                x=a['measurements']['laps'];y=b['measurements']['laps']
                if len(x['rejected'])!=1 or len(y['accepted'])!=1 or y['rejected'] or x['accepted']:errors.append(f'expected new feature ACK difference missing {pair["index"]}')
                # Compare all remaining ACK fields, not blanket rewrites.
                x['rejected']=[];y['accepted']=[]
            if a!=b:errors.append(f'unexpected ACK difference {pair["index"]}')
    before=json.loads((L.ART/beforename).read_text());after=json.loads((L.ART/aftername).read_text())
    for fp in (before,after):
        for arm in ('base','cand'):
            fp['schema'][arm].pop('IDENT',None)
            fp['schema'][arm].pop('COUNTS',None)
    for k in ('sources','schema','config'):
        if before[k]!=after[k]:errors.append(k+' drift')
    def stats(values):
        if not values:return None
        s=sorted(values);return {'n':len(s),'p50_ms':s[math.ceil(.5*len(s))-1],'p95_ms':s[math.ceil(.95*len(s))-1],'min_ms':s[0],'max_ms':s[-1]}
    measured=[r for r in rows if r['phase']=='measured']
    arms={arm:stats([r['elapsedMs'] for r in measured if r['arm']==arm]) for arm in ('base','cand')}
    base=arms['base'];cand=arms['cand']
    delta=cand['p95_ms']-base['p95_ms'] if base is not None and cand is not None else None
    threshold=min(base['p95_ms']*.1,20) if base is not None else None
    passes=delta is not None and threshold is not None and delta<=threshold
    result={'verdict':'INVALID' if errors else ('PASS' if passes else 'FAIL'),'errors':errors,'arms':arms,'delta_p95_ms':delta,'allowed_delta_ms':threshold,
            'classes':{kind:{arm:stats([r['elapsedMs'] for r in measured if r['arm']==arm and r['traffic']==kind]) for arm in ('base','cand')} for kind in sorted(set(r['traffic'] for r in measured))},
            'registration_sha256':L.hashlib.sha256((L.ART/regname).read_bytes()).hexdigest(),'raw_sha256':L.hashlib.sha256((L.ART/rawname).read_bytes()).hexdigest()}
    resultname='BENCHMARK-RESULT.json' if attempt==1 else 'BENCHMARK-RESULT-ATTEMPT-2.json'
    R.save(resultname,result);R.checkpoint('benchmark-recomputed',result=resultname,verdict=result['verdict'])
    print(json.dumps(result,indent=2))


def attempt2():
    R.guard()
    assert not (L.ART/'REGISTERED-BENCHMARK-ATTEMPT-2.json').exists(), 'No repeat of corrected run'
    old=json.loads((L.ART/'BENCHMARK-RESULT.json').read_text())
    assert old['verdict']=='INVALID' and old['errors']==['expected 480 samples, actual 3','core failure 1/cand']
    original=json.loads((L.ART/'REGISTERED-BENCHMARK.json').read_text())
    pairs=json.loads((L.ART/'benchmark-dataset.json').read_text())
    for pair in pairs:
        pair['body']['sequence']+=1000
    R.save('benchmark-dataset-attempt-2.json',pairs)
    runner=(HERE/'http_benchmark.ts').read_bytes()
    before=fingerprint();R.save('benchmark-before-attempt-2.json',before)
    original.update(registered_at=U.now(),attempt=2,prior_attempt='INVALID during warmup; zero measured pairs; raw retained; 429 receipt gap 103ms after 1555ms cold start; start-time spacing did not protect DB receipt-time floor',
        correction='Last same-arm response COMPLETION +700ms before next request; retain global 600ms start spacing, serial concurrency 1, original 40 warmups/200 measured, same ABBA/workload/quantile/strict gate/semantic rules; seq offset +1000 to avoid replay after aborted warmup. No further favorable retries.',
        runner_sha256=L.hashlib.sha256(runner).hexdigest(),dataset_sha256=L.hashlib.sha256((L.ART/'benchmark-dataset-attempt-2.json').read_bytes()).hexdigest(),
        prior_raw_sha256=old['raw_sha256'],fingerprint=before)
    sha=R.save('REGISTERED-BENCHMARK-ATTEMPT-2.json',original)
    L.write_private(L.ART/'REGISTERED-BENCHMARK-ATTEMPT-2.sha256',sha+'\n')
    R.checkpoint('corrected-benchmark-preregistered',sha256=sha)
    b=io.BytesIO()
    with tarfile.open(fileobj=b,mode='w:gz') as tf:
        info=tarfile.TarInfo('http_benchmark.ts');info.size=len(runner);tf.addfile(info,io.BytesIO(runner))
    L.assert_owned(R.CLIENT);R.resource('volume',L.CLIENT_VOLUME)
    R.run(f'docker exec -i {R.CLIENT} tar -xzf - -C /lab','seed-corrected-benchmark-client',stdin=b.getvalue())
    token=json.loads((L.ART/'benchmark-token.json').read_text())['token'];keys=json.loads((L.ART/'lab-api-keys.json').read_text())
    payload={'pairs':pairs,'token':token,'apikey':keys['service_role'],'globalSpacingMs':600,'armSpacingMs':700,'timeoutMs':20000,'completionGap':True}
    R.checkpoint('corrected-benchmark-running',raw='benchmark-attempt-2.raw.jsonl',registration_sha256=sha)
    p=L.remote(f'docker exec -i {R.CLIENT} deno run --cached-only --allow-net /lab/http_benchmark.ts',stdin=json.dumps(payload).encode(),timeout=580)
    L.write_private(L.ART/'benchmark-attempt-2.raw.jsonl',p.stdout);L.write_private(L.ART/'benchmark-attempt-2.stderr',p.stderr)
    R.save('benchmark-attempt-2-exit.json',{'exit':p.returncode,'raw_sha256':L.hashlib.sha256(p.stdout).hexdigest()})
    R.save('benchmark-after-attempt-2.json',fingerprint())
    recompute(2)


if __name__=='__main__':
    try:
        {'register':register,'execute':execute,'recompute':recompute,'attempt2':attempt2,'recompute2':lambda:recompute(2)}[sys.argv[1]]()
    except Exception as e:
        R.checkpoint('benchmark-stage-failed',command=sys.argv[1:],error=str(e))
        raise
