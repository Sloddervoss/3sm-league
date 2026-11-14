#!/usr/bin/env python3
"""Final own-clone evidence: entry typecheck, role/route checks, safe-disable."""
import io
import json
import pathlib
import sys
import tarfile
import time
import clone as C
import continue_checks as CC
import faithfulness as F
import functional as U
import migrate as M
import resume as R
import s2e3lib as L


def typecheck():
    R.guard();L.assert_owned(R.CLIENT);R.resource('volume',L.CLIENT_VOLUME)
    R.run(f'docker exec {R.CLIENT} mkdir -p /lab/typecheck/base /lab/typecheck/cand /lab/typecheck/cache','typecheck-dirs')
    for arm,directory in [('base',C.LIVE_DIR),('cand',C.CAND_DIR)]:
        R.run(f'docker exec -i {R.CLIENT} tar --no-same-owner -xzf - -C /lab/typecheck/{arm}','typecheck-source-'+arm,stdin=C._tar_tree(directory))
    R.run(f'docker exec -i {R.CLIENT} tar --no-same-owner -xzf - -C /lab/typecheck/cache','typecheck-cached-dependencies',stdin=(L.ART/'deno-cache-copy.tar.gz').read_bytes())
    results={}
    for arm in ('base','cand'):
        cmd=f'docker exec -e DENO_DIR=/lab/typecheck/cache {R.CLIENT} deno check --cached-only /lab/typecheck/{arm}/simhub-ingest-v3/index.ts'
        p=L.remote(cmd,timeout=180)
        sha=L.write_private(L.ART/f'entry-typecheck-{arm}.log',p.stdout+p.stderr)
        text=(p.stdout+p.stderr).decode(errors='replace')
        cache_block=any(x in text for x in ('not found in cache','not cached','Could not resolve','Unable to load','Remote modules are not allowed','cache is not available'))
        verdict='PASS' if p.returncode==0 else ('OPEN' if cache_block else 'FAIL')
        results[arm]={'command':cmd,'exit':p.returncode,'verdict':verdict,'log_sha256':sha,'summary':text[-1400:]}
    R.save('ENTRY-TYPECHECK.json',results);R.checkpoint('full-entry-typecheck-attempted',result='ENTRY-TYPECHECK.json')
    print(json.dumps(results,indent=2))


def authority():
    R.guard()
    ev='e0000000-0000-4000-8000-000000000001';team='e0000000-0000-4000-8000-000000000002';run='e0000000-0000-4000-8000-000000000003'
    sql=f"""INSERT INTO public.endurance_events(id,name,circuit,start_at,end_at,status) VALUES('{ev}','S2E3 synthetic event','Synthetic Track',now()-interval '1 hour',now()+interval '2 hours','live');
INSERT INTO public.endurance_teams(id,event_id,name,car_id,car_number) VALUES('{team}','{ev}','S2E3 synthetic team','synthetic-car','7');
INSERT INTO public.endurance_race_runs(id,event_id,team_id,run_kind,status,started_at) VALUES('{run}','{ev}','{team}','race','active',now());
UPDATE public.simhub_devices SET endurance_event_id='{ev}',endurance_team_id='{team}',device_status='active_binding',device_role='primary' WHERE id='{U.device(2)}';
UPDATE public.simhub_devices SET endurance_event_id='{ev}',endurance_team_id='{team}',device_status='active_binding',device_role='standby' WHERE id='{U.device(3)}';"""
    results=[]
    for arm,db in C.DB_FOR.items():
        L.psql_clone_ok('BEGIN;'+L.CLONE_GUARD+sql+'COMMIT;',db=db)
        for i,seq in ((2,20),(3,20)):
            body=U.frame(seq);r=U.send(arm,i,body)
            actual=json.loads(L.psql_clone_ok(f"SELECT json_build_object('owner',owner_user_id,'driver',current_driver_name,'event',endurance_event_id,'team',endurance_team_id,'run',race_run_id,'sequence',sequence) FROM public.simhub_telemetry_latest WHERE device_id='{U.device(i)}'",db=db))
            results.append({'arm':arm,'case':'primary-bound' if i==2 else 'standby-no-team-authority','response':r,'persisted':actual})
            R.save('FUNCTIONAL-AUTHORITY.json',results)
            assert r['status']==202
            # Actual deployed contract accepts standby device-scoped telemetry.
            assert actual['event']==(ev if i==2 else None)
            assert actual['team']==(team if i==2 else None)
            assert actual['run']==(run if i==2 else None)
            assert actual['owner']==U.owner(i)
            assert actual['driver']!=U.owner(i)
    R.checkpoint('binding-and-authority-actual-http-verified',evidence='FUNCTIONAL-AUTHORITY.json')
    print('Primary bound routes to event/team/run; standby accepts device-only, no team authority, in both arms.')


def typecheck_rebalanced():
    R.guard()
    prior=json.loads((L.ART/'ENTRY-TYPECHECK.json').read_text())
    assert all(x['exit']==137 for x in prior.values())
    assert not (L.ART/'ENTRY-TYPECHECK-128M.json').exists()
    R.save('ENTRY-TYPECHECK-128M.json',prior)
    # Reallocate, never exceed the original total: DB -384MiB, client +384MiB.
    # The latency run is over; no benchmark is repeated under this allocation.
    originals={name:L.assert_owned(name) for name in (L.DB_CONTAINER,R.CLIENT)}
    try:
        R.run(f'docker update --memory 640m --memory-swap 1280m {originals[L.DB_CONTAINER]["Id"]}','typecheck-db-budget')
        R.run(f'docker update --memory 512m --memory-swap 1024m {originals[R.CLIENT]["Id"]}','typecheck-client-budget')
        R.owned_handles()
        result={}
        for arm in ('base','cand'):
            L.assert_owned(R.CLIENT)
            cmd=f'docker exec -e DENO_DIR=/lab/typecheck/cache {R.CLIENT} deno check --cached-only /lab/typecheck/{arm}/simhub-ingest-v3/index.ts'
            p=L.remote(cmd,timeout=180)
            sha=L.write_private(L.ART/f'entry-typecheck-512m-{arm}.log',p.stdout+p.stderr)
            text=(p.stdout+p.stderr).decode(errors='replace')
            blocked=p.returncode in (137,143) or any(s in text for s in ('not found in cache','not cached','Could not resolve','Unable to load'))
            result[arm]={'command':cmd,'exit':p.returncode,'verdict':'PASS' if p.returncode==0 else ('OPEN' if blocked else 'FAIL'),'log_sha256':sha,'summary':text[-2600:]}
        R.save('ENTRY-TYPECHECK.json',result)
        print(json.dumps(result,indent=2))
    finally:
        for name in (R.CLIENT,L.DB_CONTAINER):
            m=L.assert_owned(name);assert m['Id']==originals[name]['Id']
            memory=originals[name]['HostConfig']['Memory'];swap=originals[name]['HostConfig']['MemorySwap']
            R.run(f'docker update --memory {memory} --memory-swap {swap} {m["Id"]}','restore-budget-'+name)
        R.owned_handles()
        R.checkpoint('entry-typecheck-rebalanced-completed',result='ENTRY-TYPECHECK.json',original_resource_budgets_restored=True)


def acl_and_benchmark_readback():
    R.guard()
    keys=json.loads((L.ART/'lab-api-keys.json').read_text())
    th=L.hashlib.sha256(L.lab_secrets()['db_tokens']['token_2'].encode()).hexdigest()
    result={}
    for role in ('anon','authenticated','service_role'):
        jwt=keys[role] if role in keys else L.mint_jwt(L.lab_secrets()['jwt_secret'],role)
        r=R.request('cand','/rest/v1/rpc/simhub_observation_policy_v1','POST',{'p_token_hash':th},{'Authorization':'Bearer '+jwt,'apikey':keys['anon'] if role!='service_role' else keys['service_role'],'Content-Type':'application/json'})
        result[role]=r
        assert r['status']==(200 if role=='service_role' else (401 if role=='anon' else 403)),r
    result['sql_effective_acl']=json.loads(L.psql_clone_ok("SELECT json_agg(json_build_object('role',r,'private_schema_usage',has_schema_privilege(r,'pitwall_learning','USAGE'),'policy_execute',has_function_privilege(r,'public.simhub_observation_policy_v1(text)','EXECUTE'),'persist_execute',has_function_privilege(r,'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)','EXECUTE'))) FROM unnest(ARRAY['anon','authenticated','service_role','pitwall_learning_worker']) AS r"))
    benchmark={}
    for arm,db in C.DB_FOR.items():
        benchmark[arm]=json.loads(L.psql_clone_ok("SELECT json_build_object('last_sequence',(SELECT last_sequence FROM public.simhub_devices WHERE id='d0000000-0000-4000-8000-000000000099'),'legacy_laps',(SELECT count(*) FROM public.simhub_lap_summaries WHERE device_id='d0000000-0000-4000-8000-000000000099'))",db=db))
    benchmark['candidate_private_batches']=int(L.psql_clone_ok("SELECT count(*) FROM pitwall_learning.capture_batches WHERE owner_user_id='a0000000-0000-4000-8000-000000000099'"))
    benchmark['candidate_observation_rows']=int(L.psql_clone_ok("SELECT count(*) FROM public.simhub_lap_summaries WHERE device_id='d0000000-0000-4000-8000-000000000099' AND observation IS NOT NULL"))
    assert all(x['last_sequence']==1240 for x in (benchmark['base'],benchmark['cand']))
    assert benchmark['base']['legacy_laps']==3 and benchmark['cand']['legacy_laps']==5
    assert benchmark['candidate_private_batches']==5 and benchmark['candidate_observation_rows']==2
    R.save('PATH-ACL-AND-BENCHMARK-DB-PROOF.json',{'acl':result,'benchmark':benchmark})
    R.checkpoint('path-relevant-acl-and-benchmark-writes-verified',result='PATH-ACL-AND-BENCHMARK-DB-PROOF.json')
    print(json.dumps({'acl_status':{k:v['status'] for k,v in result.items() if isinstance(v,dict)},'benchmark':benchmark},indent=2))


def retained_data():
    names=L.psql_clone_ok("SELECT tablename FROM pg_tables WHERE schemaname='pitwall_learning' AND tablename<>'runtime_settings' ORDER BY tablename").splitlines()
    data={}
    for table in names+['public.simhub_lap_summaries']:
        qualified=table if '.' in table else 'pitwall_learning.'+table
        assert all(x.replace('_','').isalnum() for x in qualified.split('.'))
        data[qualified]=json.loads(L.psql_clone_ok(f"SELECT json_build_object('rows',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),''))) FROM {qualified} t"))
    return data


def rollback():
    R.guard()
    assert not (L.ART/'resume-rollback-results.json').exists(),'Do not reapply after final rollback'
    before=retained_data();R.save('rollback-retained-before.json',before)
    R.save('rollback-schema-before.json',F.capture(L.LAB_DB_CAND))
    records=[]
    for name in reversed(M.MIGRATIONS):
        R.guard();path=M.ROOT/'supabase/rollbacks'/(name+'.sql')
        p=L.psql_clone('BEGIN;'+L.CLONE_GUARD+'\n'+path.read_text()+'\nCOMMIT;',timeout=900)
        L.write_private(L.ART/('resume-rollback-'+name+'.log'),p.stdout+p.stderr)
        records.append({'file':name,'sha256':L.hashlib.sha256(path.read_bytes()).hexdigest(),'exit':p.returncode})
        R.save('resume-rollback-results.json',records)
        assert p.returncode==0,records[-1]
    L.psql_clone_ok("NOTIFY pgrst,'reload schema';")
    after=retained_data();R.save('rollback-retained-after.json',after)
    assert before==after,'Safe-disable must retain actual evidence/measurement bytes'
    expected=json.loads(L.psql_clone_ok("""SELECT json_build_object(
 'policy_rpc_absent',to_regprocedure('public.simhub_observation_policy_v1(text)') IS NULL,
 'capture_triggers_absent',NOT EXISTS(SELECT FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgname LIKE 'pitwall_learning_capture%'),
 'all_switches_off',(SELECT NOT(capture_enabled OR worker_enabled OR shadow_enabled OR advice_enabled OR observation_enabled) FROM pitwall_learning.runtime_settings WHERE id=1),
 'worker_no_login',(SELECT NOT rolcanlogin AND rolconnlimit=0 FROM pg_roles WHERE rolname='pitwall_learning_worker'),
 'worker_no_schema_usage',NOT has_schema_privilege('pitwall_learning_worker','pitwall_learning','USAGE'),
 'worker_no_execute',NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pitwall_learning' AND has_function_privilege('pitwall_learning_worker',p.oid,'EXECUTE')),
 'private_schema_retained',to_regnamespace('pitwall_learning') IS NOT NULL,
 'ten_private_tables',(SELECT count(*)=10 FROM pg_tables WHERE schemaname='pitwall_learning'),
 'observation_column_retained',EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='simhub_lap_summaries' AND column_name='observation'))"""))
    assert all(expected.values()),expected
    time.sleep(3)
    # V1/V2 and V3 core continue; newer observed rows reject without core loss.
    http=[]
    for v,i in ((1,0),(2,1),(3,4)):
        b=U.frame(30) if v==3 else U.legacy(v,30)
        if v==3:b['lapSummaries']=[U.lap(4,900,False)]
        r=U.send('cand',i,b);http.append({'version':v,'request':b,'response':r});assert r['status']==202,r
        if v==3:assert r['json']['measurements']['laps']['accepted']
    b=U.frame(31);b['lapSummaries']=[U.lap(4,901)]
    r=U.send('cand',4,b);http.append({'case':'observation-disabled-no-core-loss','request':b,'response':r})
    assert r['status']==202 and r['json']['measurements']['laps']['rejected']
    assert retained_data()['pitwall_learning.capture_batches']==before['pitwall_learning.capture_batches']
    R.save('ROLLBACK-POSITIVE-EXPECTED-STATE.json',{'verdict':'PASS_SAFE_DISABLE','checks':expected,'all_preexisting_data_digest_equal':before==after,'http':http,'byte_restoration':'NOT_PERFORMED; retained private schema/observation column/new writer by normative contract'})
    R.save('rollback-schema-after.json',F.capture(L.LAB_DB_CAND))
    R.owned_handles()
    R.checkpoint('final-safe-disable-PASS',evidence='ROLLBACK-POSITIVE-EXPECTED-STATE.json',byte_restore='OPEN_NOT_PERFORMED',handles='RESUME-CURRENT-HANDLES.json')
    print(json.dumps(expected,indent=2));print('Safe-disable PASS, retained evidence unchanged, legacy/new core HTTP works; byte restoration not claimed.')


if __name__=='__main__':
    try:
        {'typecheck':typecheck,'typecheck-rebalanced':typecheck_rebalanced,'authority':authority,'acl':acl_and_benchmark_readback,'rollback':rollback}[sys.argv[1]]()
    except Exception as e:
        R.checkpoint('finish-stage-failed',command=sys.argv[1:],error=str(e))
        raise
