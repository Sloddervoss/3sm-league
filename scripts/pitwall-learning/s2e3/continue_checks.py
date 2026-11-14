#!/usr/bin/env python3
"""Private evidence collection for the existing isolated S2E3 continuation."""
import difflib
import json
import sys
import pathlib
import resume as R
import s2e3lib as L
import clone as C
import faithfulness as F
import migrate as M


def prepare():
    R.guard()
    assert (L.ART / 'HTTP-ROUTE-PROOF.json').exists()
    assert not (L.ART / 'resume-candidate-apply.json').exists(), 'Never silently repeat candidate preparation'
    before_base = F.capture(L.LAB_DB_BASE)
    R.save('resume-base-before.json', before_base)
    R.save('resume-cand-before-reset.json', F.capture(L.LAB_DB_CAND))
    ext = json.loads(L.psql_clone_ok("SELECT json_agg(json_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion)) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace", db=L.LAB_DB_BASE))
    R.save('resume-base-extensions.json', ext)
    R.guard()
    L.psql_clone_ok(f'DROP DATABASE {L.LAB_DB_CAND} WITH (FORCE)', db='postgres')
    L.psql_clone_ok(f"CREATE DATABASE {L.LAB_DB_CAND} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8'", db='postgres')
    for e in ext:
        if e['name'] == 'plpgsql':
            continue
        assert e['name'] != 'pg_cron'
        L.psql_clone_ok(f'CREATE SCHEMA IF NOT EXISTS "{e["schema"]}"; CREATE EXTENSION "{e["name"]}" WITH SCHEMA "{e["schema"]}" VERSION \'{e["version"]}\'', db=L.LAB_DB_CAND)
    dump = (L.ART / 'prod-schema-public-auth.sql').read_bytes()
    assert L.hashlib.sha256(dump).hexdigest() == 'bb1e6d1a3b09e446b4f27f2e5eeb42e9651cbf042788a70733e5260b7b0201fa'
    L.psql_clone_ok('DROP SCHEMA public CASCADE', db=L.LAB_DB_CAND)
    R.guard()
    R.run(f'docker exec -i {L.DB_CONTAINER} psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d {L.LAB_DB_CAND}', 'restore-cand-only', stdin=dump, timeout=900)
    R.checkpoint('candidate-only-restored', before='resume-cand-before-reset.json')
    apply_restored()


def apply_restored():
    R.guard()
    previous = json.loads((L.ART / 'resume-candidate-apply.json').read_text()) if (L.ART / 'resume-candidate-apply.json').exists() else []
    if previous:
        assert len(previous) == 1 and previous[0]['exit'] == 3
        assert 'role pitwall_learning_worker already exists' in (L.ART / ('resume-apply-' + M.MIGRATIONS[0] + '.log')).read_text()
        R.save('resume-candidate-apply-failed-role-conflict.json', previous)
    assert L.psql_clone_ok("SELECT to_regnamespace('pitwall_learning') IS NULL", db=L.LAB_DB_CAND).strip() == 't'
    deps = L.psql_clone_ok("SELECT count(*) FROM pg_shdepend WHERE refobjid=(SELECT oid FROM pg_roles WHERE rolname='pitwall_learning_worker') AND dbid<>0", db='postgres').strip()
    assert deps == '0', 'Retained lab worker role still has dependencies; do not cascade'
    # Proven isolated cluster role retained by the prior rollback; no base dependencies.
    L.psql_clone_ok('DROP ROLE IF EXISTS pitwall_learning_worker', db='postgres')
    records = []
    for name in M.MIGRATIONS:
        path = M.ROOT / 'supabase/migrations' / (name + '.sql')
        R.guard()
        # Transactional failure never leaves a partially applied file.
        p = L.psql_clone('BEGIN;\n' + L.CLONE_GUARD + '\n' + path.read_text() + '\nCOMMIT;', db=L.LAB_DB_CAND, timeout=900)
        L.write_private(L.ART / ('resume-apply-' + name + '.log'), p.stdout + p.stderr)
        records.append({'file':name,'sha256':L.hashlib.sha256(path.read_bytes()).hexdigest(),'exit':p.returncode})
        R.save('resume-candidate-apply.json', records)
        assert p.returncode == 0, records[-1]
    after = F.capture(L.LAB_DB_CAND)
    R.save('resume-cand-applied.json', after)
    prior = json.loads((L.ART / 'snapshots/cand-post2.json').read_text())
    comparison = F.compare(prior, after)
    R.save('resume-candidate-vs-saved-post2.json', comparison)
    before_base = json.loads((L.ART / 'resume-base-before.json').read_text())
    base_after = F.capture(L.LAB_DB_BASE)
    base_diff = F.compare(before_base, base_after)
    R.save('resume-base-preservation.json', base_diff)
    assert all(x['verdict'] == 'MATCH' for k,x in base_diff.items() if k not in ('ROLES','MEMBERSHIPS','IDENTITY')), base_diff
    R.checkpoint('candidate-reapplied-once', apply='resume-candidate-apply.json', comparison='resume-candidate-vs-saved-post2.json', baseline='preserved')
    R.prove_route()
    print('Candidate-only restore/apply complete; baseline preserved.')


def source_diff():
    root = L.ART
    out = []
    hashes = {}
    for rel in ('simhub-ingest-v3/index.ts', 'simhub-ingest-v3/context.ts', '_shared/simhub.ts', '_shared/simhubExtensions.ts'):
        a = (root / 'live-edge-baseline' / rel).read_text()
        b = (root / 'candidate-edge' / rel).read_text()
        d = ''.join(difflib.unified_diff(a.splitlines(True), b.splitlines(True), fromfile='live/'+rel, tofile='candidate/'+rel))
        out.append(d)
        hashes[rel] = {'live': L.hashlib.sha256(a.encode()).hexdigest(), 'candidate': L.hashlib.sha256(b.encode()).hexdigest()}
    L.write_private(root / 'resume-source-diff.patch', '\n'.join(out))
    R.save('resume-source-hashes.json', hashes)
    print('\n'.join(out))


def runtime_probe():
    R.guard()
    assert (L.ART / 'HTTP-ROUTE-PROOF.json').exists()
    out = {}
    for arm in ('base', 'cand'):
        path = '/candidate-functions/v1/simhub-ingest-v3' if arm == 'cand' else '/functions/v1/simhub-ingest-v3'
        out[arm] = R.request(arm, path, 'POST', {'protocolVersion': 3},
            {'Authorization': 'Bearer ' + 's2e3-unknown-device-token-0000000000000000', 'Content-Type': 'application/json'})
    R.save('runtime-probe.json', out)
    print(json.dumps(out, indent=2))
    for arm in ('base','cand'):
        name = L.PREFIX + 'edge-' + arm
        L.assert_owned(name)
        p = L.remote(f'docker logs --tail 70 {name}')
        L.write_private(L.ART / ('resume-edge-' + arm + '.log'), p.stdout + p.stderr)
    R.checkpoint('runtime-probe-recorded', result='runtime-probe.json')


if __name__ == '__main__':
    try:
        {'source-diff': source_diff, 'runtime-probe': runtime_probe, 'prepare': prepare, 'apply-restored': apply_restored}[sys.argv[1]]()
    except Exception as e:
        R.checkpoint('continuation-stage-failed', command=sys.argv[1:], error=str(e))
        raise
