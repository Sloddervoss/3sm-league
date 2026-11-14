#!/usr/bin/env python3
"""Cached-dependency compiler checks for both arms, with a rebalanced budget."""
import json

import lab
from lab import ART, L, R, C, Z


def allocate(memory='640m', swap='1280m', client='512m', client_swap='1024m'):
    """Temporary, verified budget transfer; never exceeds the phase totals."""
    R.guard()
    handles = R.owned_handles()
    before = {k: (v['memory'], v['cpus']) for k, v in handles.items()}
    R.run(f'docker update --memory {memory} --memory-swap {swap} {L.DB_CONTAINER}','compiler-db-budget')
    # CPU stays untouched: the phase total (2.0) is already fully allocated, and
    # the compiler only needs headroom in memory.
    R.run(f'docker update --memory {client} --memory-swap {client_swap} {R.CLIENT}','compiler-client-budget')
    after = R.owned_handles()
    total_mem = sum(v['memory'] for v in after.values())
    total_cpu = sum(v['cpus'] for v in after.values())
    assert total_mem <= 3072*1048576, total_mem
    assert total_cpu <= 2000000000, total_cpu
    R.save('COMPILER-BUDGET.json', {'before': before,
        'after': {k: (v['memory'], v['cpus']) for k, v in after.items()},
        'total_memory_bytes': total_mem, 'total_cpu_nanos': total_cpu})
    print('allocated', total_mem//1048576, 'MiB', total_cpu/1e9, 'cpu')
    return after


def check():
    R.guard()
    originals = {name: L.assert_owned(name) for name in (L.DB_CONTAINER, R.CLIENT)}
    allocate()
    try:
        Z.typecheck()
    finally:
        for name in (R.CLIENT, L.DB_CONTAINER):
            meta = L.assert_owned(name); hc = originals[name]['HostConfig']
            assert meta['Id'] == originals[name]['Id']
            R.run(f'docker update --memory {hc["Memory"]} --memory-swap {hc["MemorySwap"]} --cpus {hc["NanoCpus"]/1e9} {meta["Id"]}','restore-budget')
        actual = R.owned_handles()
        for name in originals:
            assert actual[name]['memory'] == originals[name]['HostConfig']['Memory'], name
            assert actual[name]['cpus'] == originals[name]['HostConfig']['NanoCpus'], name
    result = json.loads((ART/'ENTRY-TYPECHECK.json').read_text())
    assert result['cand']['exit'] == 0, result['cand']
    R.save('ENTRY-TYPECHECK-VERDICT.json', {'cand': result['cand']['exit'],
                                            'base': result['base']['exit'],
                                            'qualification': 'base is the captured LIVE source; its own '
                                                             'pre-existing type errors are not part of the package'})
    R.checkpoint('s2e5-candidate-full-entry-typecheck-PASS')
