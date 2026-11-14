"""One-hypothesis serial/overlap diagnostic, not an acceptance benchmark."""
import io
import json
import statistics
import tarfile
import time
import lab
import diagnostic as D
from lab import L, R, C, U, ART, ROOT


def main():
    R.guard();R.checkpoint('ordering-diagnostic-start-non-acceptance')
    assert not (ART/'ORDERING-DIAGNOSTIC.json').exists()
    repaired=(C.CAND_DIR/'simhub-ingest-v3/index.ts').read_text()
    block=repaired[repaired.index('      const pendingPolicy ='):repaired.index('\n\n      // 0.7.4.0')]
    serial=repaired.replace(block,'').replace('const policy = await pendingPolicy;',block.strip().replace('const pendingPolicy =','const policy = await'))
    runner=(ROOT/'scripts/pitwall-learning/s2e3/http_benchmark.ts').read_bytes()
    b=io.BytesIO()
    with tarfile.open(fileobj=b,mode='w:gz') as tf:
        info=tarfile.TarInfo('http_benchmark.ts');info.size=len(runner);tf.addfile(info,io.BytesIO(runner))
    R.run(f'docker exec -i {R.CLIENT} tar -xzf - -C /lab','diagnostic-runner',stdin=b.getvalue())
    results={}
    try:
        for index,(mode,text) in enumerate([('serial',serial),('overlap',repaired)]):
            (C.CAND_DIR/'simhub-ingest-v3/index.ts').write_text(text)
            D.overlay(True)
            start=U.now()
            sql="SELECT coalesce(json_agg(json_build_object('queryid',queryid,'calls',calls,'total_exec_ms',total_exec_time,'rows',rows)),'[]'::json) FROM extensions.pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND query ILIKE '%simhub_%'"
            before=L.psql_clone_ok(sql)
            pairs=[{'index':i,'phase':'diagnostic-warmup' if i<4 else 'diagnostic-measured','order':['cand'],'traffic':'hot-no-new-measurement','body':U.frame(10000+index*100+i)} for i in range(24)]
            keys=json.loads((ART/'lab-api-keys.json').read_text())
            payload={'pairs':pairs,'token':L.lab_secrets()['db_tokens']['token_2'],'apikey':keys['service_role'],'globalSpacingMs':600,'armSpacingMs':700,'timeoutMs':20000,'completionGap':True}
            p=L.remote(f'docker exec -i {R.CLIENT} deno run --cached-only --allow-net /lab/http_benchmark.ts',stdin=json.dumps(payload).encode(),timeout=120)
            sha=L.write_private(ART/('ORDERING-'+mode+'.raw.jsonl'),p.stdout)
            L.write_private(ART/('ORDERING-'+mode+'.stderr'),p.stderr)
            rows=[json.loads(line) for line in p.stdout.splitlines()]
            assert p.returncode==0 and len(rows)==24 and all(x['status']==202 for x in rows)
            hops=L.check(L.remote(f'docker logs --since {start} {C.CONTAINERS["cand"][1]}'),'ordering logs')
            L.write_private(ART/('ORDERING-'+mode+'-hops.log'),hops.stdout+hops.stderr)
            values=[x['elapsedMs'] for x in rows[4:]]
            results[mode]={'n':len(values),'median_ms':statistics.median(values),'p95_ms':sorted(values)[18],'raw_sha256':sha,'sql_before':json.loads(before),'sql_after':json.loads(L.psql_clone_ok(sql)),'cpu_stat':R.run(f'docker exec {C.CONTAINERS["cand"][1]} cat /sys/fs/cgroup/cpu.stat','diagnostic-cpu')}
            R.save('ORDERING-DIAGNOSTIC.json',{'non_acceptance':True,'only_hypothesis':'policy read after accepted core overlaps independent best-effort writes; same budgets and hot frame','results':results})
            print(mode,results[mode]['median_ms'],results[mode]['p95_ms'])
    finally:
        (C.CAND_DIR/'simhub-ingest-v3/index.ts').write_text(repaired)
        D.overlay(False)
    R.checkpoint('ordering-diagnostic-complete-non-acceptance')
if __name__=='__main__':main()
