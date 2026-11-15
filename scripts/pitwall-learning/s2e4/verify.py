"""Overlay only verified repairs; cached fixed-SDK compiler and runtime checks."""
import json
import shutil
import lab
from lab import L, R, C, Z, ART, OLD, ROOT
import diagnostic

CHANGED=('simhub-ingest-v3/index.ts','simhub-ingest-v3/context.ts','_shared/paceCapture.ts')

def candidate():
    # The inherited live PACE helper is byte-identical to the clean repository
    # base; no stale helper or unrelated live fixes are overlaid.
    for rel in CHANGED:
        original= L.check(L.sh(['git','show','85c73b3e8dd3e023e7dda789b82999402c8026c9:supabase/functions/'+rel]),'base source').stdout
        assert original==(OLD/'candidate-edge'/rel).read_bytes(),rel
        shutil.copyfile(ROOT/'supabase/functions'/rel,C.CAND_DIR/rel)
    R.save('repair-overlay-provenance.json',{rel:{'before':L.hashlib.sha256((OLD/'candidate-edge'/rel).read_bytes()).hexdigest(),'after':L.hashlib.sha256((C.CAND_DIR/rel).read_bytes()).hexdigest()} for rel in CHANGED})
    diagnostic.overlay(False)

def check():
    R.guard()
    R.checkpoint('candidate-cached-typecheck-start')
    originals={name:L.assert_owned(name) for name in (L.DB_CONTAINER,R.CLIENT)}
    try:
        R.run(f'docker update --memory 640m --memory-swap 1280m {originals[L.DB_CONTAINER]["Id"]}','compiler-db-budget')
        R.run(f'docker update --memory 512m --memory-swap 1024m {originals[R.CLIENT]["Id"]}','compiler-client-budget')
        Z.typecheck()
    finally:
        for name in (R.CLIENT,L.DB_CONTAINER):
            meta=L.assert_owned(name); hc=originals[name]['HostConfig']
            assert meta['Id']==originals[name]['Id']
            R.run(f'docker update --memory {hc["Memory"]} --memory-swap {hc["MemorySwap"]} {meta["Id"]}','restore-budget')
        actual=R.owned_handles()
        assert all(actual[name]['memory']==originals[name]['HostConfig']['Memory'] for name in originals)
    result=json.loads((ART/'ENTRY-TYPECHECK.json').read_text())
    assert result['cand']['exit']==0,result['cand']
    R.checkpoint('candidate-full-entry-typecheck-PASS')

if __name__=='__main__':
    import sys
    {'candidate':candidate,'check':check}[sys.argv[1]]()
