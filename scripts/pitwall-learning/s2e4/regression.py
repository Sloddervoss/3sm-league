import io
import json
import tarfile
import lab
from lab import ART, ROOT, L, R

def tests():
    R.guard(); R.checkpoint('focused-runtime-regressions-start')
    b=io.BytesIO()
    with tarfile.open(fileobj=b,mode='w:gz') as tf:
        paths=list((ROOT/'supabase/functions/_shared').glob('*.ts'))+list((ROOT/'supabase/functions/simhub-ingest-v3').glob('*.ts'))
        paths+=[ROOT/'tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures/v3-frame-baseline.json']
        for p in paths:
            tf.add(p,arcname=str(p.relative_to(ROOT)))
    R.run(f'docker exec {R.CLIENT} mkdir -p /lab/regression','regression-dir')
    R.run(f'docker exec -i {R.CLIENT} tar --no-same-owner -xzf - -C /lab/regression','regression-source',stdin=b.getvalue())
    originals={name:L.assert_owned(name)['HostConfig'] for name in (L.DB_CONTAINER,R.CLIENT)}
    results={}
    try:
        R.run(f'docker update --memory 640m --memory-swap 1280m --cpus 0.3 {L.DB_CONTAINER}','test-db-budget')
        R.run(f'docker update --memory 512m --memory-swap 1024m --cpus 0.4 {R.CLIENT}','test-client-budget')
        cmd=f'docker exec -w /lab/regression -e DENO_DIR=/lab/typecheck/cache {R.CLIENT} deno test --cached-only --allow-read --allow-env '
        for name,files in [('entry','supabase/functions/simhub-ingest-v3/latencyRepair_test.ts'),('policy','supabase/functions/_shared/observationPolicyV1.test.ts'),('observation','supabase/functions/_shared/observationWiring.test.ts supabase/functions/_shared/observationV1.test.ts supabase/functions/_shared/observationContext.test.ts supabase/functions/_shared/observationWindow.test.ts')]:
            p=L.remote(cmd+files,timeout=240)
            sha=L.write_private(ART/('regression-'+name+'.log'),p.stdout+p.stderr)
            results[name]={'command':cmd+files,'exit':p.returncode,'sha256':sha}
            print(name,p.returncode,(p.stdout+p.stderr).decode()[-1300:])
        R.save('REGRESSIONS.json',results)
        # Type-fixed serial control: retain every runtime byte except the one
        # scheduling change. The actual-entry test must reject this old order.
        path=ROOT/'supabase/functions/simhub-ingest-v3/index.ts'
        repaired=path.read_text()
        block=repaired[repaired.index('      const pendingPolicy ='):repaired.index('\n\n      // 0.7.4.0')]
        serial=repaired.replace(block,'').replace('const policy = await pendingPolicy;',block.strip().replace('const pendingPolicy =','const policy = await'))
        def entry(text):
            buf=io.BytesIO();raw=text.encode()
            with tarfile.open(fileobj=buf,mode='w:gz') as tf:
                info=tarfile.TarInfo('supabase/functions/simhub-ingest-v3/index.ts');info.size=len(raw);tf.addfile(info,io.BytesIO(raw))
            R.run(f'docker exec -i {R.CLIENT} tar -xzf - -C /lab/regression','discriminating-entry',stdin=buf.getvalue())
        try:
            entry(serial)
            p=L.remote(cmd+'supabase/functions/simhub-ingest-v3/latencyRepair_test.ts',timeout=240)
            digest=L.write_private(ART/'regression-serial-control.log',p.stdout+p.stderr)
            assert p.returncode==1 and b'policy remains serialized behind tyre write' in p.stdout+p.stderr
            R.save('SERIAL-CONTROL.json',{'exit':p.returncode,'expected_exit':1,'sha256':digest,'verdict':'EXPECTED_FAIL_OLD_ORDER'})
        finally:entry(repaired)
    finally:
        for name in (R.CLIENT,L.DB_CONTAINER):
            hc=originals[name]
            R.run(f'docker update --memory {hc["Memory"]} --memory-swap {hc["MemorySwap"]} --cpus {hc["NanoCpus"]/1e9} {name}','restore-test-budget')
        R.owned_handles()
    assert all(x['exit']==0 for x in results.values())
    R.checkpoint('focused-runtime-regressions-PASS')
if __name__=='__main__':tests()
