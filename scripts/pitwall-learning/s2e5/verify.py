#!/usr/bin/env python3
"""Cached-dependency compiler checks for both arms, with a rebalanced budget."""
import json

import lab
from lab import ART, L, R, C, Z

# Creation-time allocation recorded when each container was made (lab ledger).
# The compiler borrows memory only; CPU is never moved, so the phase total
# stays at exactly 2.0 and a stale bump from an interrupted run is repaired
# back to the documented budget instead of being carried forward.
TEMP = {L.DB_CONTAINER: ('640m', '1280m'), R.CLIENT: ('512m', '1024m')}


def baseline():
    recorded = json.loads((ART / 'resource-ledger.json').read_text())
    return {name: (recorded[name]['memory'], recorded[name]['cpus'],
                   recorded[name]['memory'] * 2)
            for name in (L.DB_CONTAINER, R.CLIENT)}


def apply(name, memory, memory_swap, cpus, label):
    meta = L.assert_owned(name)
    R.run(f'docker update --memory {memory} --memory-swap {memory_swap} '
          f'--cpus {cpus / 1e9} {meta["Id"]}', label)


def allocate(memory='640m', swap='1280m', client='512m', client_swap='1024m'):
    """Temporary, verified budget transfer; never exceeds the phase totals."""
    R.guard()
    handles = R.owned_handles()
    before = {k: (v['memory'], v['cpus']) for k, v in handles.items()}
    base = baseline()
    # Repair any drift first so the totals below describe the real allocation.
    for name, (mem, cpus, swap_value) in base.items():
        if (before[name][0], before[name][1]) != (mem, cpus):
            apply(name, mem, swap_value, cpus, 'reset-budget-' + name)
    R.run(f'docker update --memory {memory} --memory-swap {swap} {L.DB_CONTAINER}',
          'compiler-db-budget')
    R.run(f'docker update --memory {client} --memory-swap {client_swap} {R.CLIENT}',
          'compiler-client-budget')
    after = R.owned_handles()
    total_mem = sum(v['memory'] for v in after.values())
    total_cpu = sum(v['cpus'] for v in after.values())
    assert total_mem <= 3072 * 1048576, total_mem
    assert total_cpu <= 2000000000, total_cpu
    R.save('COMPILER-BUDGET.json', {'before': before,
        'after': {k: (v['memory'], v['cpus']) for k, v in after.items()},
        'total_memory_bytes': total_mem, 'total_cpu_nanos': total_cpu})
    print('allocated', total_mem // 1048576, 'MiB', total_cpu / 1e9, 'cpu')
    return after


def restore():
    for name, (memory, cpus, swap) in baseline().items():
        meta = L.assert_owned(name)
        R.run(f'docker update --memory {memory} --memory-swap {swap} '
              f'--cpus {cpus / 1e9} {meta["Id"]}', 'restore-budget-' + name)
    actual = R.owned_handles()
    total_mem = sum(v['memory'] for v in actual.values())
    total_cpu = sum(v['cpus'] for v in actual.values())
    assert total_mem <= 3072 * 1048576, total_mem
    assert total_cpu <= 2000000000, total_cpu
    for name, (memory, cpus, _swap) in baseline().items():
        assert actual[name]['memory'] == memory, name
        assert actual[name]['cpus'] == cpus, name
    return actual


def check():
    R.guard()
    for name in (L.DB_CONTAINER, R.CLIENT):
        L.assert_owned(name)
    try:
        allocate()
        Z.typecheck()
    finally:
        restore()
    result = json.loads((ART / 'ENTRY-TYPECHECK.json').read_text())
    assert result['cand']['exit'] == 0, result['cand']
    R.save('ENTRY-TYPECHECK-VERDICT.json', {'cand': result['cand']['exit'],
                                            'base': result['base']['exit'],
                                            'base_verdict': result['base']['verdict'],
                                            'qualification': 'base is the captured LIVE source; its own '
                                                             'pre-existing type errors are not part of the package'})
    R.checkpoint('s2e5-candidate-full-entry-typecheck-PASS')
