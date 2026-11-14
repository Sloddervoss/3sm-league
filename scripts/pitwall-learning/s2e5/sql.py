#!/usr/bin/env python3
"""Run the S2E5 SQL contracts and prove the rollback restores the live body.

Stages:
  pre            base arm: the captured live pre-image (8-in / 3-out)
  forward        candidate arm: the S2E5 contracts, rolled back by the file
  post-rollback  candidate arm after ONLY the S2E5 rollback, plus a
                 cross-database comparison of the restored function definition
                 against the real base-arm definition
"""
import json
import pathlib
import sys

import lab
from lab import ART, L, R, C, ROOT, M

TESTS = ROOT/'supabase/tests'
SIG = ('public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,'
       'jsonb,jsonb)')

DIGEST_SQL = f"""SELECT json_build_object(
  'prosrc_md5', md5(p.prosrc),
  'prosrc_len', length(p.prosrc),
  'proargnames', p.proargnames,
  'proargmodes', p.proargmodes,
  'prorettype', p.prorettype::regtype::text,
  'prosecdef', p.prosecdef,
  'proconfig', p.proconfig,
  'acl', (SELECT array_agg(a::text ORDER BY a) FROM aclexplode(p.proacl) a),
  'owner', pg_get_userbyid(p.proowner))
  FROM pg_proc p WHERE p.oid = '{SIG}'::regprocedure"""


def run_file(path, db):
    R.guard()
    p = L.psql_clone(path.read_text(), db=db, timeout=600)
    digest = L.write_private(ART/('sql-'+path.stem+'-'+db+'.log'), p.stdout+p.stderr)
    rec = {'file': path.name, 'db': db, 'exit': p.returncode, 'sha256': digest,
           'notices': [line for line in (p.stdout+p.stderr).decode(errors='replace').splitlines()
                       if 'PASS' in line or 'ERROR' in line]}
    if p.returncode != 0:
        raise RuntimeError(f'{path.name} on {db}: exit={p.returncode}')
    assert any('PASS' in line for line in rec['notices']), 'no PASS notices: '+path.name
    return rec


def digest(db):
    return json.loads(L.psql_clone_ok(DIGEST_SQL, db=db).strip())


def main(stage):
    results = json.loads((ART/'SQL-CONTRACTS.json').read_text()) if (ART/'SQL-CONTRACTS.json').exists() else {}
    if stage == 'pre':
        results['pre'] = run_file(TESTS/'pitwall-learning-policy-in-persist-pre.sql', L.LAB_DB_BASE)
    elif stage == 'forward':
        results['forward'] = run_file(TESTS/'pitwall-learning-policy-in-persist.sql', L.LAB_DB_CAND)
    elif stage == 'post-rollback':
        results['post_rollback'] = run_file(TESTS/'pitwall-learning-policy-in-persist-post-rollback.sql', L.LAB_DB_CAND)
        base = digest(L.LAB_DB_BASE)
        rolled = digest(L.LAB_DB_CAND)
        same = {k: base[k] == rolled[k] for k in base}
        # The ACL section is compared on the effect that matters; the pre-image
        # ACL is replayed by the rollback, so it must match exactly.
        results['restored_definition'] = {'base': base, 'rolled_back': rolled, 'equal': same}
        R.save('SQL-CONTRACTS.json', results)
        L.write_private(ART/'ROLLBACK-DEFINITION-EQUALITY.json', json.dumps(results['restored_definition'], indent=2, sort_keys=True))
        if not all(same.values()):
            raise AssertionError('rollback did not restore the live definition: ' +
                                 json.dumps({k: v for k, v in same.items() if not v}))
        R.checkpoint('s2e5-sql-contracts-and-rollback-definition-equality-PASS')
        print(json.dumps(same, indent=2))
        return
    else:
        raise SystemExit('unknown sql stage: '+str(stage))
    R.save('SQL-CONTRACTS.json', results)
    R.checkpoint('s2e5-sql-contract-'+stage+'-PASS', file=results[stage]['file'])
    print(json.dumps(results[stage], indent=2))
