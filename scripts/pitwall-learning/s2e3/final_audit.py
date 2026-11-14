#!/usr/bin/env python3
"""Final mechanical audit and private evidence manifest; no application writes."""
import collections
import json
import math
import pathlib
import stat
import sys
import benchmark as B
import clone as C
import resume as R
import s2e3lib as L


def audit():
    cluster=R.guard()
    root=pathlib.Path(__file__).resolve().parents[3]
    L.write_private(L.ART/'RESULT.md',(root/'docs/operations/pitwall-learning-s2e3-clone-result.md').read_bytes())
    baseline=B.tree_hashes(C.LIVE_DIR);candidate=B.tree_hashes(C.CAND_DIR)
    classifications={'simhub-ingest-v3/index.ts':'intentional observation probe/mode/publisher and additive ACK; token hash reused, unrelated handler hotfixes preserved',
        'simhub-ingest-v3/context.ts':'intentional parser options, authenticated device UUID forced from token lookup',
        '_shared/simhub.ts':'intentional option forwarding to observation-aware lap parser',
        '_shared/simhubExtensions.ts':'intentional capture modes, optional validated raw observation, fail-closed per-row classifier'}
    changed=[p for p in baseline if p in candidate and baseline[p]!=candidate[p]]
    assert set(changed)==set(classifications)
    R.save('SOURCE-CLASSIFICATION.json',{'changed':{p:{'classification':classifications[p],'live_sha256':baseline[p],'candidate_sha256':candidate[p]} for p in changed},
        'added':[p for p in candidate if p not in baseline],'deleted':[p for p in baseline if p not in candidate],
        'review':'Actual unified diff reviewed; no unrelated lost-hotfix hunk found in the four existing-file changes. Candidate is hash-defined, not undefined.'})
    rows=[json.loads(x) for x in (L.ART/'benchmark-attempt-2.raw.jsonl').read_text().splitlines()]
    pairs=json.loads((L.ART/'benchmark-dataset-attempt-2.json').read_text())
    cfg=json.loads((L.ART/'REGISTERED-BENCHMARK-ATTEMPT-2.json').read_text())
    assert len(rows)==480 and len(pairs)==240
    expected=[(p['index'],a) for p in pairs for a in p['order']]
    assert [(r['pair'],r['arm']) for r in rows]==expected
    min_start_gap={};min_completion_gap={}
    for arm in ('base','cand'):
        a=[r for r in rows if r['arm']==arm]
        min_start_gap[arm]=min(y['startMs']-x['startMs'] for x,y in zip(a,a[1:]))
        min_completion_gap[arm]=min(y['startMs']-(x['startMs']+x['elapsedMs']) for x,y in zip(a,a[1:]))
        assert min_completion_gap[arm]>400, 'Real device receipt-time floor was not protected'
        assert len([r for r in a if r['phase']=='measured'])==200
        assert len([r for r in a if r['phase']=='warmup'])==40
    for row in rows:
        p=pairs[row['pair']]
        actual=dict(row['request']);actual.pop('capturedAt');planned=dict(p['body']);planned.pop('capturedAt')
        assert actual==planned
        assert row['status']==202 and not row['error'] and row['elapsedMs']>0
        assert row['phase']==p['phase'] and row['traffic']==p['traffic']
    assert L.hashlib.sha256((L.ART/'benchmark-dataset-attempt-2.json').read_bytes()).hexdigest()==cfg['dataset_sha256']
    assert L.hashlib.sha256((B.HERE/'http_benchmark.ts').read_bytes()).hexdigest()==cfg['runner_sha256']
    result=json.loads((L.ART/'BENCHMARK-RESULT-ATTEMPT-2.json').read_text())
    ratio=(result['arms']['cand']['p95_ms']/result['arms']['base']['p95_ms']-1)*100
    smoke=json.loads((L.ART/'functional-smoke.json').read_text())
    assert len(smoke)==6 and all(r['response']['status']==202 for r in smoke)
    assert all(all(v==0 for v in r['extra_call_delta'].values()) for r in smoke), 'Default-off must make zero extra observation HTTP calls'
    forward=json.loads((L.ART/'functional-feature-on.json').read_text())
    assert len(forward)==11
    handles=R.owned_handles()
    containers={}
    for name,handle in handles.items():
        m=L.assert_owned(name)
        assert m['Id']==handle['id']
        for mount in m.get('Mounts',[]):
            assert mount['Type']=='volume'
            R.resource('volume',mount['Name'])
        containers[name]={'id':m['Id'],'image':m['Image'],'running':m['State']['Running'],'oom_killed':m['State']['OOMKilled'],
                          'memory':m['HostConfig']['Memory'],'nano_cpus':m['HostConfig']['NanoCpus'],'user':m['Config']['User'],
                          'mounts':[{'type':x['Type'],'volume':x.get('Name'),'destination':x['Destination']} for x in m.get('Mounts',[])]}
    total_mem=sum(x['memory'] for x in containers.values());total_cpu=sum(x['nano_cpus'] for x in containers.values())
    assert total_mem<=3072*1024*1024 and total_cpu<=2000000000
    assert all(x['running'] for x in containers.values())
    route={}
    for arm,db in C.DB_FOR.items():
        route[arm]=R.request(arm,'/rest/v1/s2e3_route_marker?select=*')
        assert route[arm]['status']==200
        assert json.loads(route[arm]['body'])==[{'database':db,'cluster':cluster,'container':R.EXPECTED_DB}]
    # Read source hashes inside the actual owned Edge containers, not only local copies.
    source_readback={}
    for arm,directory in [('base',C.LIVE_DIR),('cand',C.CAND_DIR)]:
        name=C.CONTAINERS[arm][1];L.assert_owned(name)
        paths=B.tree_hashes(directory)
        actual={}
        selected=[p for p in paths if p.endswith('.ts')]
        command='docker exec '+name+' sha256sum '+' '.join('/home/deno/functions/'+p for p in selected)
        p=L.check(L.remote(command),'source readback')
        for line in p.stdout.decode().splitlines():
            digest,path=line.split(maxsplit=1);actual[path.removeprefix('/home/deno/functions/')]=digest
        assert actual=={k:paths[k] for k in selected}
        source_readback[arm]=actual
    net=R.resource('network',L.NET)
    volumes=[R.resource('volume',v) for v in (L.DB_VOLUME,L.FUNC_VOLUME+'-base',L.FUNC_VOLUME+'-cand',L.DENO_VOLUME,L.KONG_CONTAINER+'cfg',L.CLIENT_VOLUME)]
    export_modes={p:oct(stat.S_IMODE((L.ART/p).stat().st_mode)) for p in ('prod-schema-public-auth.sql','prod-catalog.json')}
    assert all(v=='0o600' for v in export_modes.values()) and stat.S_IMODE(L.ART.stat().st_mode)==0o700
    R.save('FINAL-AUDIT.json',{'samples':len(rows),'measured_per_arm':200,'warmups_per_arm':40,'all_requests_match_registered_dataset_except_fresh_capture_clock':True,
        'all_480_core_responses_202':True,'no_samples_discarded':True,'order_matches_registration':True,'min_start_gap_ms':min_start_gap,'min_completion_gap_ms':min_completion_gap,
        'p95_increase_percent':ratio,'defaultoff_zero_observation_calls':True,'resources':containers,'total_memory_bytes':total_mem,'total_nano_cpus':total_cpu,
        'network':{'id':net['Id'],'internal':net['Internal']},'volumes':[{'name':v['Name'],'labels':v['Labels']} for v in volumes],
        'final_route_readback':route,'source_volume_hash_readback':source_readback,'export_modes':export_modes})
    manifest={}
    for p in sorted(L.ART.iterdir()):
        if p.is_file() and p.name not in ('lab-secrets.json','lab-api-keys.json','benchmark-token.json','EVIDENCE-MANIFEST.json','CHECKPOINT.json'):
            manifest[p.name]={'sha256':L.hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'mode':oct(stat.S_IMODE(p.stat().st_mode))}
    R.save('EVIDENCE-MANIFEST.json',manifest)
    R.checkpoint('execution-complete-gates-failed-no-release',functional='PASS_WITH_PREREGISTERED_FEATURE_ACK_DIFFERENCES',latency='FAIL',entry_typecheck='FAIL_BASE_AND_CANDIDATE',rollback='PASS_SAFE_DISABLE_ONLY',byte_restore='OPEN_NOT_PERFORMED',audit='FINAL-AUDIT.json',manifest='EVIDENCE-MANIFEST.json',handles='RESUME-CURRENT-HANDLES.json')
    checkpoint=json.loads((L.ART/'CHECKPOINT.json').read_text())
    if not (L.ART/'CHECKPOINT-PREVIOUS-EXECUTOR.json').exists():
        R.save('CHECKPOINT-PREVIOUS-EXECUTOR.json',{k:v for k,v in checkpoint.items() if k!='resume'})
    checkpoint.update(phase='S2E3 executed: real HTTP functional path proven; latency and full entry typecheck FAIL',
        reason='Continuation completed with actual gate verdicts, not provider-credit or iteration exhaustion',
        gate_verdicts={'http_route':'PASS','functional_exercised_matrix':'PASS','path_acl':'PASS','clone_faithfulness':'QUALIFIED_NOT_IDENTICAL',
                       'feature_on_full_http_latency':'FAIL','full_entry_typecheck':'FAIL_BASE_AND_CANDIDATE','rollback':'PASS_SAFE_DISABLE_ONLY','byte_restoration':'OPEN_NOT_PERFORMED','historical_transient_helper_id_ledger':'OPEN_TRACE_GAP'},
        not_executed=['Full byte restoration (normative rollback is safe-disable)','WAN/CDN/TLS timing','Supported old-to-new automatic updater rehearsal','ML fitting/advice/quality/release'],
        next='Parent readback of RESULT.md, FINAL-AUDIT.json, raw samples and retained exact handles. No favorable benchmark retry or application edits in this scope. Latency/typecheck failures block release; fixes need separately approved scope.')
    head=L.check(L.sh(['git','rev-parse','HEAD']),'git HEAD').stdout.decode().strip()
    checkpoint['current_worktree_head']=head
    checkpoint['result_file']='RESULT.md'
    checkpoint['source_classification']='SOURCE-CLASSIFICATION.json'
    R.save('CHECKPOINT.json',checkpoint)
    print(json.dumps({'samples':len(rows),'p95_increase_percent':ratio,'min_completion_gap_ms':min_completion_gap,'total_memory_mib':total_mem//1048576,'total_cpus':total_cpu/1e9,'containers':len(containers),'source_readback':'MATCH','defaultoff_extra_calls':0,'final_route':'PASS'},indent=2))


if __name__=='__main__':
    audit()
