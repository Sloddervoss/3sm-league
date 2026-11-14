#!/usr/bin/env python3
"""S2E5 runtime regressions and the discriminating old-path control.

Runs the real-entry regression (actual `simhub-ingest-v3` entry, fixed cached
SDK, fetch replaced) plus the policy and observation suites inside the owned lab
client container. Then it reverts ONLY the scheduling/wiring change in
`index.ts` back to the old separate-call path and proves the same entry test
fails. No instrumentation is added to shipped source.
"""
import io
import json
import tarfile

import lab
from lab import ART, ROOT, L, R

NEW_IMPORT = 'import { resolveObservationPolicy } from "../_shared/observationPolicyV1.ts";'
OLD_IMPORT = 'import { maybeComposeObservationPolicy } from "../_shared/observationPolicyV1.ts";'
NEW_BLOCK_START = '      const pendingPolicy = resolveObservationPolicy('
NEW_BLOCK_END = '\n\n      // 0.7.4.0'
OLD_BLOCK = '''      const pendingPolicy = maybeComposeObservationPolicy(
        observationMode,
        tokenHash,
        (fn, args) => service.rpc(fn, args),
      );'''


def source_archive():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as tf:
        paths = list((ROOT/'supabase/functions/_shared').glob('*.ts'))
        paths += list((ROOT/'supabase/functions/simhub-ingest-v3').glob('*.ts'))
        paths += [ROOT/'tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures/v3-frame-baseline.json']
        for path in paths:
            tf.add(path, arcname=str(path.relative_to(ROOT)))
    return buf.getvalue()


def put_entry(text):
    buf = io.BytesIO()
    raw = text.encode()
    with tarfile.open(fileobj=buf, mode='w:gz') as tf:
        info = tarfile.TarInfo('supabase/functions/simhub-ingest-v3/index.ts')
        info.size = len(raw)
        tf.addfile(info, io.BytesIO(raw))
    R.run(f'docker exec -i {R.CLIENT} tar -xzf - -C /lab/regression', 'regression-entry-overlay', stdin=buf.getvalue())


def legacy_source(source):
    """The exact S2E4 wiring: always a separate, joined policy call."""
    start = source.index(NEW_BLOCK_START)
    end = source.index(NEW_BLOCK_END)
    reverted = source[:start] + OLD_BLOCK + source[end:]
    reverted = reverted.replace(NEW_IMPORT, OLD_IMPORT)
    assert 'resolveObservationPolicy(' not in reverted
    assert reverted.count('maybeComposeObservationPolicy(') == 1
    return reverted


def tests():
    R.guard(); R.checkpoint('s2e5-runtime-regressions-start')
    R.run(f'docker exec {R.CLIENT} mkdir -p /lab/regression','regression-dir')
    R.run(f'docker exec -i {R.CLIENT} tar --no-same-owner -xzf - -C /lab/regression','regression-source',
          stdin=source_archive())
    originals = {name: L.assert_owned(name)['HostConfig'] for name in (L.DB_CONTAINER, R.CLIENT)}
    results = {}
    try:
        R.run(f'docker update --memory 640m --memory-swap 1280m --cpus 0.3 {L.DB_CONTAINER}','test-db-budget')
        R.run(f'docker update --memory 512m --memory-swap 1024m --cpus 0.4 {R.CLIENT}','test-client-budget')
        R.owned_handles()
        base = f'docker exec -w /lab/regression -e DENO_DIR=/lab/typecheck/cache {R.CLIENT} deno test --cached-only --allow-read --allow-env '
        suites = [
            ('entry', 'supabase/functions/simhub-ingest-v3/policyInPersist_test.ts'),
            ('policy', 'supabase/functions/_shared/observationPolicyV1.test.ts'),
            ('observation', 'supabase/functions/_shared/observationWiring.test.ts '
                            'supabase/functions/_shared/observationV1.test.ts '
                            'supabase/functions/_shared/observationContext.test.ts '
                            'supabase/functions/_shared/observationWindow.test.ts'),
        ]
        for name, files in suites:
            cmd = base + files
            p = L.remote(cmd, timeout=300)
            sha = L.write_private(ART/('regression-'+name+'.log'), p.stdout+p.stderr)
            results[name] = {'command': cmd, 'exit': p.returncode, 'sha256': sha}
            print(name, p.returncode, (p.stdout+p.stderr).decode(errors='replace')[-1500:])
        R.save('REGRESSIONS.json', results)
        assert all(x['exit'] == 0 for x in results.values()), results

        # Discriminating control: only the wiring reverts to the old separate
        # call; every runtime byte is otherwise identical.
        entry_path = ROOT/'supabase/functions/simhub-ingest-v3/index.ts'
        current = entry_path.read_text()
        try:
            put_entry(legacy_source(current))
            p = L.remote(base + 'supabase/functions/simhub-ingest-v3/policyInPersist_test.ts', timeout=300)
            text = (p.stdout+p.stderr).decode(errors='replace')
            digest = L.write_private(ART/'regression-legacy-control.log', p.stdout+p.stderr)
            assert p.returncode != 0, 'the old separate-call path still passes the new test'
            assert 'policy hop still used' in text, 'control failed for an unexpected reason: '+text[-1200:]
            R.save('LEGACY-CONTROL.json', {'exit': p.returncode, 'expected': 'non-zero',
                                           'reason': 'policy hop still used',
                                           'sha256': digest, 'verdict': 'EXPECTED_FAIL_OLD_SEPARATE_CALL'})
        finally:
            put_entry(current)
        p = L.remote(base + 'supabase/functions/simhub-ingest-v3/policyInPersist_test.ts', timeout=300)
        assert p.returncode == 0, 'restored entry no longer passes'
        R.save('LEGACY-CONTROL-RESTORED.json', {'exit': p.returncode,
                                                'source_sha256': L.hashlib.sha256(current.encode()).hexdigest()})
    finally:
        for name in (R.CLIENT, L.DB_CONTAINER):
            hc = originals[name]
            R.run(f'docker update --memory {hc["Memory"]} --memory-swap {hc["MemorySwap"]} --cpus {hc["NanoCpus"]/1e9} {name}','restore-test-budget')
        R.owned_handles()
    R.checkpoint('s2e5-runtime-regressions-and-legacy-control-PASS')
