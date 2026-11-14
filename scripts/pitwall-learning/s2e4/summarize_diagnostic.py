import json
import statistics
from lab import ART, R


def main():
    summary={}
    for mode in ('serial','overlap'):
        hops=[]
        for line in (ART/('ORDERING-'+mode+'-hops.log')).read_text().splitlines():
            if 'S2E4_HOP ' in line:hops.append(json.JSONDecoder().raw_decode(line.split('S2E4_HOP ',1)[1])[0])
        policies=[x for x in hops if x['path'].endswith('/simhub_observation_policy_v1')]
        tyres=[x for x in hops if x['path'].endswith('/simhub_record_tyre_observations')]
        assert len(policies)==len(tyres)==24
        overlapped=sum(p['startMs']<t['startMs']+t['ms'] and t['startMs']<p['startMs']+p['ms'] for p,t in zip(policies,tyres))
        groups={path:[x['ms'] for x in hops if x['path']==path] for path in sorted({x['path'] for x in hops})}
        source=json.loads((ART/'ORDERING-DIAGNOSTIC.json').read_text())['results'][mode]
        before={str(x['queryid']):x for x in source['sql_before']}
        delta=[]
        for row in source['sql_after']:
            previous=before.get(str(row['queryid']),{'calls':0,'total_exec_ms':0})
            count=row['calls']-previous['calls']
            if count:delta.append({'queryid':row['queryid'],'calls':count,'total_exec_ms':row['total_exec_ms']-previous['total_exec_ms']})
        summary[mode]={'overlapped_policy_tyre_pairs':overlapped,'total_pairs':24,'full_http_median_ms':source['median_ms'],'descriptive_p95_20_samples_ms':source['p95_ms'],'hops':{path:{'calls':len(v),'median_ms':statistics.median(v),'sum_ms':sum(v)} for path,v in groups.items()},'sql_statement_deltas':delta,'cpu_stat':source['cpu_stat']}
    assert summary['serial']['overlapped_policy_tyre_pairs']==0
    assert summary['overlap']['overlapped_policy_tyre_pairs']>0
    R.save('DIAGNOSIS.json',{'non_acceptance':True,'results':summary,'conclusion':'A serial read-only policy lookup is an avoidable response-path dependency. Real trace proves overlap after core acceptance. SQL root cause of historical 50.47ms tail NOT established; CPU throttling and sequential stage noise remain confounds. No SQL amendment justified. The small diagnostic tail is descriptive, not acceptance evidence.'})
    print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
