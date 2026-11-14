"""Sandbox-only fetch profiling; never overlay instrumentation into repository."""
import io
import json
import statistics
import tarfile
import time
import lab
from lab import L, R, C, U, ART


def overlay(profile=False):
    R.guard()
    for arm, source in [('base',C.LIVE_DIR),('cand',C.CAND_DIR)]:
        data={str(p.relative_to(source)):p.read_bytes() for p in source.rglob('*') if p.is_file()}
        if profile:
            key='simhub-ingest-v3/index.ts'
            text=data[key].decode()
            anchor='const service = createClient('
            assert anchor in text
            pos=text.index(anchor)
            text=text[:pos]+'''const diagnosticFetch: typeof fetch = async (input, init) => {
  const start = performance.now();
  const response = await fetch(input, init);
  await response.clone().arrayBuffer();
  console.log("S2E4_HOP " + JSON.stringify({path: new URL(String(input)).pathname, startMs:start, ms: performance.now()-start, status:response.status}));
  return response;
};
'''+text[pos:]
            text=text.replace('{ auth: { persistSession: false } }','{ auth: { persistSession: false }, global: { fetch: diagnosticFetch } }')
            data[key]=text.encode()
        b=io.BytesIO()
        with tarfile.open(fileobj=b,mode='w:gz') as tf:
            for key,raw in data.items():
                info=tarfile.TarInfo(key);info.size=len(raw);tf.addfile(info,io.BytesIO(raw))
        name=C.CONTAINERS[arm][1];m=L.assert_owned(name)
        R.run(f'docker exec -i {name} tar -xzf - -C /home/deno/functions','overlay-'+arm,stdin=b.getvalue())
        R.run('docker restart '+m['Id'],'restart-owned-'+arm)
    time.sleep(4)


def diagnose():
    assert not (ART/'DIAGNOSTIC-before.json').exists()
    R.checkpoint('diagnostic-before-start-non-acceptance')
    overlay(True)
    start=U.now()
    rows=[]
    # Identical hot frame, authenticated eligible account, no measurement replay.
    for pair in range(16):
        for arm in (('base','cand') if pair%2==0 else ('cand','base')):
            body=U.frame(1000+pair)
            r=U.send(arm,2,body)
            rows.append({'pair':pair,'arm':arm,'response':r})
            R.save('DIAGNOSTIC-before.json',rows)
            assert r['status']==202,r
    hops={}
    resources={}
    for arm in ('base','cand'):
        name=C.CONTAINERS[arm][1]
        m=L.assert_owned(name)
        p=L.check(L.remote(f'docker logs --since {start} {m["Id"]}'),'diagnostic logs')
        L.write_private(ART/('DIAGNOSTIC-before-'+arm+'.log'),p.stdout+p.stderr)
        hops[arm]=[]
        for line in (p.stdout+p.stderr).decode().splitlines():
            if 'S2E4_HOP ' in line:
                tail=line.split('S2E4_HOP ',1)[1]
                try:hops[arm].append(json.JSONDecoder().raw_decode(tail)[0])
                except ValueError:pass
        resources[arm]=R.run(f'docker exec {m["Id"]} cat /sys/fs/cgroup/cpu.stat','cpu-stat-'+arm)
    R.save('DIAGNOSTIC-before-hops.json',{'hops':hops,'cpu':resources,'non_acceptance':True})
    for arm in ('base','cand'):
        groups={path:[x['ms'] for x in hops[arm] if x['path']==path] for path in set(x['path'] for x in hops[arm])}
        print(arm,{path:{'n':len(v),'median_ms':statistics.median(v),'sum_ms':sum(v)} for path,v in groups.items()})
    overlay(False)
    R.checkpoint('diagnostic-before-complete-non-acceptance')

if __name__=='__main__':diagnose()
