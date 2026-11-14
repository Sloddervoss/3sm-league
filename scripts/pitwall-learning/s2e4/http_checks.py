"""Fresh-sequence functional verification of repaired real HTTP caller."""
import json
import lab
from lab import ART, L, R, U, Z


def flag(enabled):
    original=R.run
    def run(command,*args,**kwargs):
        if not enabled:command=command.replace('SIMHUB_OBSERVATION_V1_ENABLED=true','SIMHUB_OBSERVATION_V1_ENABLED=false')
        return original(command,*args,**kwargs)
    R.run=run
    try:
        try:U.flag_on()
        except AssertionError:
            # The reused helper positively asserts 'true'. For this explicit
            # off transition, verify the replacement's exact recorded ID and
            # false env below instead; never ignore an on-transition failure.
            if enabled:raise
    finally:R.run=original
    env=L.assert_owned(lab.C.CONTAINERS['cand'][1])['Config']['Env']
    assert f'SIMHUB_OBSERVATION_V1_ENABLED={str(enabled).lower()}' in env
    R.owned_handles()


def functional():
    R.guard();R.checkpoint('repaired-real-http-functional-start')
    # Return to the original matched budgets after the interrupted compiler's
    # temporary transfer; read back exact configured limits before any timing.
    R.run(f'docker update --memory 1024m --memory-swap 2147483648 --cpus 0.6 {L.DB_CONTAINER}','matched-db-budget')
    R.run(f'docker update --memory 128m --memory-swap 268435456 --cpus 0.1 {R.CLIENT}','matched-client-budget')
    R.owned_handles()
    for file in ('functional-feature-on.json','functional-smoke.json'):
        if (ART/file).exists(): (ART/('pre-repair-'+file)).write_bytes((ART/file).read_bytes())
    frame,legacy,lap=U.frame,U.legacy,U.lap
    U.frame=lambda seq=1:frame(seq+2000)
    U.legacy=lambda v,seq=1:legacy(v,seq+2000)
    U.lap=lambda i=2,serial=1,observation=True:lap(i,serial+2000,observation)
    flag(False)
    U.smoke()
    smoke=json.loads((ART/'functional-smoke.json').read_text())
    assert all(not any(x['extra_call_delta'].values()) for x in smoke)
    flag(True)
    U.matrix()
    # Preserve actual fixtures and extend with permission changes between requests.
    results=[]
    for enabled,seq in [(False,50),(True,51)]:
        L.psql_clone_ok(f"UPDATE pitwall_learning.account_policy SET capture_enabled={str(enabled).lower()},policy_version=policy_version+1 WHERE owner_user_id='{U.owner(2)}'")
        body=U.frame(seq);body['lapSummaries']=[U.lap(2,seq)]
        before=U.counts();r=U.send('cand',2,body);after=U.counts()
        results.append({'enabled':enabled,'request':body,'response':r,'before':before,'after':after})
        R.save('FUNCTIONAL-CHANGED-PERMISSIONS.json',results)
        assert r['status']==202 and r['json']['observation']['policy']['captureAllowed']==enabled
        assert (after['batches']>before['batches'])==enabled
    U.frame=lambda seq=1:frame(seq+4000)
    Z.authority()
    R.checkpoint('repaired-real-http-functional-PASS')

if __name__=='__main__':functional()
