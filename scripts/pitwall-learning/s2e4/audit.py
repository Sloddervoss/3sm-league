"""Readback and normative safe-disable of the S2E4-owned lab only."""
import json
import lab
from lab import ART, ROOT, L, R, U, C, Z
import http_checks


def source_proof():
    R.guard()
    results={}
    for arm,tree in [('base',C.LIVE_DIR),('cand',C.CAND_DIR)]:
        name=C.CONTAINERS[arm][1];meta=L.assert_owned(name)
        paths=sorted(str(p.relative_to(tree)) for p in tree.rglob('*.ts'))
        output=R.run('docker exec '+meta['Id']+' sha256sum '+' '.join('/home/deno/functions/'+p for p in paths),'runtime-byte-proof-'+arm)
        actual={line.split()[1].removeprefix('/home/deno/functions/'):line.split()[0] for line in output.splitlines()}
        expected={rel:L.hashlib.sha256((tree/rel).read_bytes()).hexdigest() for rel in paths}
        assert actual==expected,'Runtime source does not match registered source'
        assert all(b'S2E4_HOP' not in (tree/rel).read_bytes() for rel in paths),'Diagnostic code must not ship'
        results[arm]={'container':meta['Id'],'files':actual}
    R.save('RUNTIME-BYTE-PROOF.json',results)


def acl():
    R.guard();keys=json.loads((ART/'lab-api-keys.json').read_text())
    th=L.hashlib.sha256(L.lab_secrets()['db_tokens']['token_2'].encode()).hexdigest()
    results={}
    for role in ('anon','authenticated','service_role'):
        jwt=keys[role] if role in keys else L.mint_jwt(L.lab_secrets()['jwt_secret'],role)
        r=R.request('cand','/rest/v1/rpc/simhub_observation_policy_v1','POST',{'p_token_hash':th},{'Authorization':'Bearer '+jwt,'apikey':keys['service_role'] if role=='service_role' else keys['anon'],'Content-Type':'application/json'})
        assert r['status']=={'anon':401,'authenticated':403,'service_role':200}[role]
        results[role]=r
    results['effective_acl']=json.loads(L.psql_clone_ok("SELECT json_agg(json_build_object('role',r,'private_schema_usage',has_schema_privilege(r,'pitwall_learning','USAGE'),'policy_execute',has_function_privilege(r,'public.simhub_observation_policy_v1(text)','EXECUTE'),'persist_execute',has_function_privilege(r,'public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)','EXECUTE'))) FROM unnest(ARRAY['anon','authenticated','service_role','pitwall_learning_worker']) AS r"))
    R.save('PATH-ACL.json',results)
    source_proof()
    R.checkpoint('actual-role-acl-and-runtime-bytes-verified')


def disable():
    R.guard();R.checkpoint('final-safe-disable-start')
    frame,legacy,lap=U.frame,U.legacy,U.lap
    U.frame=lambda seq=1:frame(seq+40000)
    U.legacy=lambda v,seq=1:legacy(v,seq+40000)
    U.lap=lambda i=2,serial=1,observation=True:lap(i,serial+40000,observation)
    Z.rollback()
    http_checks.flag(False)
    env=L.assert_owned(C.CONTAINERS['cand'][1])['Config']['Env']
    assert 'SIMHUB_OBSERVATION_V1_ENABLED=false' in env
    R.prove_route();source_proof()
    handles=R.owned_handles()
    assert len(handles)==7
    assert sum(x['memory'] for x in handles.values())<=3072*1048576
    assert sum(x['cpus'] for x in handles.values())<=2000000000
    R.save('FINAL-HANDLES.json',{'containers':handles,'network':R.resource('network',L.NET),'volumes':{v:R.resource('volume',v) for v in (L.DB_VOLUME,L.FUNC_VOLUME+'-base',L.FUNC_VOLUME+'-cand',L.DENO_VOLUME,L.KONG_CONTAINER+'cfg',L.CLIENT_VOLUME)},'cluster':R.guard(),'edge_flag':False,'db_all_switches_off':True,'retained_for_reviewer':True,'all_nonroot_claim':False})
    R.checkpoint('finished-safe-disabled-retained-owned-lab',handles='FINAL-HANDLES.json')

if __name__=='__main__':
    import sys
    {'acl':acl,'source':source_proof,'disable':disable}[sys.argv[1]]()
