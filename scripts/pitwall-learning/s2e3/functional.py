#!/usr/bin/env python3
"""Real HTTP functional checks. Only synthetic identities in verified own DBs."""
import copy
import datetime
import json
import pathlib
import sys
import time
import uuid
import clone as C
import resume as R
import s2e3lib as L

ROOT = pathlib.Path(__file__).resolve().parents[3]
FIX = ROOT / 'tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures'
SESSION = 's2e3-functional-fixed-session'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')


def device(i):
    return f'd0000000-0000-4000-8000-{i+1:012d}'


def owner(i):
    return f'a0000000-0000-4000-8000-{i+1:012d}'


def seed():
    R.guard()
    assert (L.ART / 'HTTP-ROUTE-PROOF.json').exists()
    sec = L.lab_secrets()
    sql = "INSERT INTO public.endurance_runtime_settings(singleton,member_access_enabled,member_pairing_enabled,member_ingest_enabled,simhub_ingest_enabled) VALUES(true,true,true,true,true) ON CONFLICT(singleton) DO UPDATE SET member_access_enabled=true,member_pairing_enabled=true,member_ingest_enabled=true,simhub_ingest_enabled=true;\n"
    for i in range(6):
        th = L.hashlib.sha256(sec['db_tokens'][f'token_{i}'].encode()).hexdigest()
        sql += f"INSERT INTO auth.users(id,email,aud,role,is_sso_user) VALUES('{owner(i)}','s2e3-{i}@example.invalid','authenticated','authenticated',false) ON CONFLICT(id) DO NOTHING;\n"
        sql += f"INSERT INTO public.simhub_devices(id,owner_user_id,token_hash,device_name,connector_id,device_status,revoked_at) VALUES('{device(i)}','{owner(i)}','{th}','S2E3 synthetic {i}','s2e3-{i}',{'\'revoked\',now()' if i==5 else '\'active_unbound\',NULL'}) ON CONFLICT(id) DO NOTHING;\n"
    for db in C.DB_FOR.values():
        R.guard()
        L.psql_clone_ok('BEGIN;'+L.CLONE_GUARD+sql+'COMMIT;', db=db)
    L.psql_clone_ok("UPDATE pitwall_learning.runtime_settings SET capture_enabled=true,observation_enabled=true WHERE id=1;" +
        f"INSERT INTO pitwall_learning.account_policy(owner_user_id,capture_enabled,policy_version) VALUES('{owner(2)}',true,1),('{owner(3)}',false,3) ON CONFLICT(owner_user_id) DO NOTHING;", db=L.LAB_DB_CAND)
    R.checkpoint('synthetic-seed-complete', real_accounts=False)
    print('Synthetic users/devices + explicit lab runtime/policy settings seeded.')


def frame(seq=1):
    body = json.loads((FIX / 'v3-frame-baseline.json').read_text())
    body['capturedAt'] = now(); body['sequence'] = seq; body['transportSessionId'] = SESSION
    # Wire fixture is synthetic; owner remains separate from the driver identity.
    return body


def legacy(v, seq=1):
    race = dict(eventId='s2e3-unbound-event',teamId='s2e3-unbound-team',sessionId=SESSION,driverId='s2e3-driver-not-owner')
    if v == 2:
        race.update(currentDriverId='s2e3-driver-not-owner',currentDriverName='Synthetic Driver',carId='synthetic-car',carName='Synthetic Car',trackName='Synthetic Track',trackConfig='Full')
    telemetry = dict(connected=True,sessionTimeSeconds=120,lap=2,completedLaps=1,lapTimeSeconds=90,position=1,classPosition=1,speedKph=100,fuelLitres=40,fuelPerLapLitres=3,estimatedLapsRemaining=12,inPitLane=False,pitLimiter=False,stintElapsedSeconds=120,incidents=0,flag='green')
    if v == 2:
        telemetry['isInCar'] = True
    return dict(protocolVersion=v,sequence=seq,capturedAt=now(),source=dict(connectorId='s2e3-legacy',simHubVersion='lab',game='IRacing'),race=race,telemetry=telemetry)


def send(arm, i, body):
    token = L.lab_secrets()['db_tokens'][f'token_{i}']
    path = '/candidate-functions/v1/simhub-ingest-v3' if arm == 'cand' else '/functions/v1/simhub-ingest-v3'
    r = R.request(arm,path,'POST',body,{'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    r['json'] = json.loads(r['body'])
    return r


def counts():
    return json.loads(L.psql_clone_ok("SELECT json_build_object('latest',(SELECT count(*) FROM public.simhub_telemetry_latest),'laps',(SELECT count(*) FROM public.simhub_lap_summaries),'batches',(SELECT count(*) FROM pitwall_learning.capture_batches),'observations',(SELECT count(*) FROM public.simhub_lap_summaries WHERE observation IS NOT NULL))"))


def kong_counts():
    L.assert_owned(C.KONG_CONTAINER)
    p=L.check(L.remote(f'docker logs {C.KONG_CONTAINER}'),'kong logs')
    data=p.stdout+p.stderr
    return {name: data.count(('/rest/v1/rpc/'+name+' ').encode()) for name in ('simhub_observation_policy_v1','simhub_observation_v1_available')}


def smoke():
    R.prove_route()
    out=[]
    for arm in ('base','cand'):
        for v,i in ((1,0),(2,1),(3,2)):
            before = kong_counts()
            b = frame() if v==3 else legacy(v)
            r=send(arm,i,b)
            after = kong_counts()
            out.append(dict(arm=arm,version=v,request=b,response=r,extra_call_delta={k:after[k]-before[k] for k in before}))
            R.save('functional-smoke.json',out)
            print(arm,v,r['status'],r['body'])
            assert r['status']==202, 'Real accepted core path failed; do not patch application to pass'
    R.save('functional-defaultoff-db-counts.json',counts())
    R.checkpoint('legacy-V1-V2-and-new-V3-accepted-defaultoff', evidence='functional-smoke.json')


def flag_on():
    R.guard()
    name=C.CONTAINERS['cand'][1]
    m=L.assert_owned(name)
    handles=json.loads((L.ART/'RESUME-CURRENT-HANDLES.json').read_text())
    assert m['Id']==handles[name]['id']
    R.save('edge-cand-before-flag-on.json', {'id':m['Id'],'image':m['Image'],'flag':next((x for x in m['Config']['Env'] if x.startswith('SIMHUB_OBSERVATION_V1_ENABLED=')), 'absent')})
    R.run(f"docker rm -f {m['Id']}", 'remove-own-candidate-edge')
    sec=L.lab_secrets(); keys=json.loads((L.ART/'lab-api-keys.json').read_text()); mem,cpu=C.BUDGET[name]
    R.run(f'docker run -d --pull never --name {name} --label {L.LABEL} --network {L.NET} --network-alias edge-cand --memory {mem}m --cpus {cpu} '
        '-e SUPABASE_URL=http://kong-cand:8000 -e SUPABASE_PUBLIC_URL=http://kong-cand:8000 '
        f'-e SUPABASE_SERVICE_ROLE_KEY={keys["service_role"]} -e SUPABASE_ANON_KEY={keys["anon"]} -e JWT_SECRET={sec["jwt_secret"]} '
        '-e VERIFY_JWT=false -e SIMHUB_ALLOWED_ORIGINS=https://lab.s2e3.invalid -e SIMHUB_OBSERVATION_V1_ENABLED=true '
        f'-v {L.FUNC_VOLUME}-cand:/home/deno/functions -v {L.DENO_VOLUME}:/root/.cache/deno '
        f'--entrypoint edge-runtime {L.image_id(L.EDGE_IMAGE)} start --main-service /home/deno/functions/main','run-candidate-feature-on')
    handles=R.owned_handles()
    m=L.assert_owned(name)
    assert 'SIMHUB_OBSERVATION_V1_ENABLED=true' in m['Config']['Env']
    R.checkpoint('candidate-lab-feature-on',handles='RESUME-CURRENT-HANDLES.json')
    time.sleep(5)
    print('Candidate Edge replaced with explicit lab feature-on; baseline untouched.')


def lap(i=2, serial=1, observation=True):
    row=json.loads((FIX/'measurement-legacy-pipeline-before-observation.json').read_text())
    start=datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=22)
    stamp=lambda d:d.isoformat(timespec='milliseconds').replace('+00:00','Z')
    # Keep the interval arithmetic on the same millisecond lattice as the wire.
    start=datetime.datetime.fromisoformat(stamp(start).replace('Z','+00:00'))
    row.update(summaryUid=str(uuid.uuid5(uuid.NAMESPACE_URL,f's2e3/{i}/{serial}')),summaryId=f's2e3-{serial}',observedSessionId=SESSION,
               lapNumber=serial,startedAt=stamp(start),endedAt=stamp(start+datetime.timedelta(seconds=20)))
    if observation:
        row['observation']=dict(version=1,capture=dict(deviceId=device(i)),interval=dict(
            firstSampleAt=stamp(start+datetime.timedelta(milliseconds=50)),lastSampleAt=stamp(start+datetime.timedelta(milliseconds=19950)),
            samples=41,maxGapSeconds=0.5,unknownSeconds=0.1,edgeBeforeSeconds=0.05,edgeAfterSeconds=0.05),
            context=dict(carId='1321',trackId=42,trackName='Synthetic Track',trackConfig='Full'))
    return row


def matrix():
    R.prove_route()
    assert 'SIMHUB_OBSERVATION_V1_ENABLED=true' in L.assert_owned(C.CONTAINERS['cand'][1])['Config']['Env']
    results=[]
    def case(name,i,seq,rows=None,expected=202):
        body=frame(seq)
        if rows is not None: body['lapSummaries']=rows
        before=counts(); calls=kong_counts(); r=send('cand',i,body); after=counts(); calls_after=kong_counts()
        rec=dict(case=name,device_index=i,request=body,response=r,before=before,after=after,extra_call_delta={k:calls_after[k]-calls[k] for k in calls})
        results.append(rec); R.save('functional-feature-on.json',results)
        print(name,r['status'],r['body'],'capture_delta',after['batches']-before['batches'])
        assert r['status']==expected, name
        return rec
    a=case('eligible-fresh-observation-write',2,2,[lap(2,1)])
    assert a['response']['json']['observation']['mode']=='on'
    assert a['response']['json']['observation']['policy']['captureAllowed'] is True
    assert a['after']['batches']>a['before']['batches'] and a['after']['observations']==a['before']['observations']+1
    a=case('ordinary-hot-no-new-measurement',2,3)
    assert a['after']['batches']==a['before']['batches']
    a=case('policy-denied-fresh-row',3,1,[lap(3,1)])
    assert a['response']['json']['observation']['policy']['captureAllowed'] is False
    assert a['after']['batches']==a['before']['batches']
    a=case('policy-row-missing-fresh-row',4,1,[lap(4,1)])
    assert a['response']['json']['observation']['policy']['captureAllowed'] is False
    assert a['after']['batches']==a['before']['batches']
    a=case('revoked-device',5,1,expected=401)
    assert a['after']==a['before']
    a=case('replay',2,3,expected=409)
    assert a['after']==a['before']
    invalid=lap(2,2); invalid['observation']['capture']['deviceId']=device(3)
    a=case('observation-device-binding-mismatch',2,4,[invalid])
    assert a['after']['batches']==a['before']['batches']
    assert a['response']['json']['measurements']['laps']['rejected']
    a=case('invalid-batch-valid-core',2,5,{'not':'array'})
    assert a['after']['batches']==a['before']['batches']
    assert a['response']['json']['measurements']['laps']['block_error']
    a=case('valid-legacy-measurement-batch',2,6,[lap(2,3,False)])
    assert a['response']['json']['measurements']['laps']['accepted']
    # Missing and permission-error RPC faults preserve the exact candidate body.
    for mode in ('missing','permission-error'):
        R.guard()
        sql = 'ALTER FUNCTION public.simhub_observation_policy_v1(text) RENAME TO s2e3_saved_policy_v1' if mode=='missing' else 'REVOKE EXECUTE ON FUNCTION public.simhub_observation_policy_v1(text) FROM service_role'
        L.psql_clone_ok(sql+"; NOTIFY pgrst,'reload schema';")
        time.sleep(3)
        try:
            a=case('policy-rpc-'+mode,2,7 if mode=='missing' else 8)
            assert 'policy' not in a['response']['json']['observation']
            assert a['after']['batches']==a['before']['batches']
        finally:
            R.guard()
            sql='ALTER FUNCTION public.s2e3_saved_policy_v1(text) RENAME TO simhub_observation_policy_v1' if mode=='missing' else 'GRANT EXECUTE ON FUNCTION public.simhub_observation_policy_v1(text) TO service_role'
            L.psql_clone_ok(sql+"; NOTIFY pgrst,'reload schema';")
            time.sleep(3)
    R.checkpoint('feature-on-functional-matrix-executed',evidence='functional-feature-on.json')


if __name__=='__main__':
    try:
        {'seed':seed,'smoke':smoke,'flag-on':flag_on,'matrix':matrix}[sys.argv[1]]()
    except Exception as e:
        R.checkpoint('functional-stage-failed',command=sys.argv[1:],error=str(e))
        raise
