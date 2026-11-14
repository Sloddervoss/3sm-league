#!/usr/bin/env python3
"""Exact whole-file rollback controls. DDL and fixtures always ROLLBACK."""
import json

import lab
import sql as S
from lab import ART, ROOT, L, R


def main():
    R.guard()
    path = ROOT/'supabase/rollbacks'/(lab.NEW_MIGRATION+'.sql')
    text = path.read_text().replace('BEGIN;', '', 1).replace('COMMIT;', '', 1)
    before = S.digest(L.LAB_DB_CAND)
    inventory = "SELECT md5(coalesce(json_agg(t ORDER BY t.oid)::text,'')) FROM (SELECT oid,proowner,proacl,prosrc,proconfig,proargnames,proargmodes,proallargtypes FROM pg_proc) t"
    check = "DO $$ BEGIN IF ("+inventory+") IS DISTINCT FROM (SELECT digest FROM rb_inventory) THEN RAISE EXCEPTION 'rollback no-op changed function inventory/ACL'; END IF; END $$;"
    script = 'BEGIN;'+L.CLONE_GUARD+'\n'+text+'\n'+S.DIGEST_SQL+';\n'
    script += 'CREATE TEMP TABLE rb_inventory AS '+inventory.replace('SELECT md5(', 'SELECT md5(', 1)+';\n'
    # Give the single column a stable name without changing its contents.
    script += 'ALTER TABLE rb_inventory RENAME COLUMN md5 TO digest;\n'+text+'\n'+check+'\n'
    script += 'DROP FUNCTION '+S.SIG+';\nTRUNCATE rb_inventory; INSERT INTO rb_inventory '+inventory+';\n'+text+'\n'+check+'\nROLLBACK;'
    p = L.psql_clone(script)
    L.write_private(ART/'rollback-controls.log',p.stdout+p.stderr)
    assert p.returncode == 0
    rows = [json.loads(line) for line in p.stdout.decode().splitlines() if line.startswith('{')]
    assert len(rows) == 1
    base = S.digest(L.LAB_DB_BASE)
    assert rows[0] == base, 'first 4->3 application differs from actual prior base definition/ACL'
    assert S.digest(L.LAB_DB_CAND) == before, 'rollback-only fixture leaked'
    R.save('ROLLBACK-CONTROLS.json',{'exit':0,'first_application_exact_prior_definition_owner_acl_search_path':True,
        'repeat_three_output_exact_inventory_acl_noop':True,'absent_exact_inventory_acl_noop':True,
        'outer_transaction_restored':True,'rollback_sha256':L.hashlib.sha256(path.read_bytes()).hexdigest()})
    R.checkpoint('repair-whole-rollback-first-repeat-absent-controls-PASS')


if __name__ == '__main__':
    main()
