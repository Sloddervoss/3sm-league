"""Controlled write-time permission/revocation races in the exact owned DB."""
import concurrent.futures
import json
import time
import lab
from lab import L, R, U, ART


def main():
    R.guard();R.checkpoint('write-time-race-regressions-start')
    results=json.loads((ART/'WRITE-TIME-RACES.json').read_text()) if (ART/'WRITE-TIME-RACES.json').exists() else []
    assert len(results)<=1 and all(r['mode']=='permission' and r['core_blocked_at_persist'] for r in results)
    for index,mode in enumerate(('permission','revocation')):
        if any(r['mode']==mode for r in results):continue
        L.psql_clone_ok(f"UPDATE pitwall_learning.account_policy SET capture_enabled=true WHERE owner_user_id='{U.owner(2)}'")
        body=U.frame(21000+index);body['lapSummaries']=[U.lap(2,10000+index)]
        body['ownerUserId']=U.owner(3);body['deviceId']=U.device(3)
        before=U.counts()
        change=(f"UPDATE pitwall_learning.account_policy SET capture_enabled=false,policy_version=policy_version+1 WHERE owner_user_id='{U.owner(2)}'" if mode=='permission' else f"UPDATE public.simhub_devices SET revoked_at=now(),device_status='revoked',endurance_event_id=NULL,endurance_team_id=NULL,device_role=NULL WHERE id='{U.device(2)}'")
        sql=f"BEGIN; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET application_name='s2e4-race-lock'; SELECT id FROM public.simhub_devices WHERE id='{U.device(2)}' FOR UPDATE; SELECT pg_sleep(12); {change}; COMMIT;"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            lock=pool.submit(L.psql_clone,sql)
            for _ in range(30):
                if L.psql_clone_ok("SELECT count(*) FROM pg_stat_activity WHERE application_name='s2e4-race-lock' AND wait_event='PgSleep'").strip()=='1':break
                time.sleep(.1)
            else:raise AssertionError('Failed to establish controlled device lock')
            http=pool.submit(U.send,'cand',2,body)
            blocked=False
            for _ in range(35):
                n=int(L.psql_clone_ok("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%simhub_persist_v3%'"))
                if n:blocked=True;break
                if http.done():break
                time.sleep(.1)
            p=lock.result(timeout=30)
            response=http.result(timeout=40)
            L.write_private(ART/('race-'+mode+'-sql.log'),p.stdout+p.stderr)
            R.save('race-'+mode+'-attempt.json',{'lock_exit':p.returncode,'response':response,'blocked':blocked})
            assert p.returncode==0,'race mutation failed'
        after=U.counts()
        results.append({'mode':mode,'core_blocked_at_persist':blocked,'request':body,'response':response,'before':before,'after':after})
        R.save('WRITE-TIME-RACES.json',results)
        assert blocked,'No proven overlap; cannot call this a race test'
        assert response['status']==(202 if mode=='permission' else 401),response
        assert after['batches']==before['batches'],'Captured after permission/revocation change'
        if mode=='permission':assert response['json']['observation']['policy']['captureAllowed'] is False
        else:assert 'observation' not in response['json']
    R.checkpoint('write-time-permission-and-revocation-races-PASS')
if __name__=='__main__':main()
