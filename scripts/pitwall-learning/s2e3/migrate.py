#!/usr/bin/env python3
"""S2E3 candidate migration apply / rollback / inventory diff (cand arm only).

Order is the real dependency order of the accepted repository set:
  P1   20261111163052_pitwall_learning_evidence          -> pitwall_learning schema
  S1   20261112134500_pitwall_learning_observation_capture -> public.* helpers + lap column
  S2E2 20261114000945_pitwall_learning_observation_policy  -> public.simhub_observation_policy_v1

Usage: python3 migrate.py <apply|rollback|snapshot|diff-base|diff-pre>
"""
from __future__ import annotations

import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import s2e3lib as L
import faithfulness as F

ROOT = pathlib.Path(__file__).resolve().parents[3]
ART = L.ART
MIGRATIONS = [
    "20261111163052_pitwall_learning_evidence",
    "20261112134500_pitwall_learning_observation_capture",
    "20261114000945_pitwall_learning_observation_policy",
]
SNAPS = ART / "snapshots"


def _psql_file(sql: str, label: str) -> dict:
    p = L.sh(
        L.SSH + [f"docker exec -i {L.DB_CONTAINER} psql -X -q -v ON_ERROR_STOP=1 "
                 f"-U supabase_admin -d {L.LAB_DB_CAND}"],
        stdin=sql.encode(), timeout=900,
    )
    rec = {"label": label, "exit": p.returncode,
           "stderr": p.stderr.decode(errors="replace")[:1500],
           "stdout_bytes": len(p.stdout)}
    L.log("migrate", **rec)
    if p.returncode != 0:
        raise RuntimeError(f"{label} failed: exit={p.returncode} {rec['stderr']}")
    return rec


def _guard() -> None:
    L.assert_owned(L.DB_CONTAINER)
    p = L.psql_clone("SELECT current_database()", db=L.LAB_DB_CAND)
    if p.stdout.decode().strip() != L.LAB_DB_CAND:
        raise L.GuardError("candidate migration target is not the lab candidate database")


def apply() -> None:
    _guard()
    results = []
    for name in MIGRATIONS:
        path = ROOT / "supabase/migrations" / f"{name}.sql"
        t0 = time.time()
        rec = _psql_file(path.read_text(), name)
        rec["file_sha256"] = L.hashlib.sha256(path.read_bytes()).hexdigest()
        rec["seconds"] = round(time.time() - t0, 3)
        results.append(rec)
        print(json.dumps(rec, sort_keys=True))
    L.write_private(ART / "candidate-apply.json", json.dumps(results, indent=2))


def rollback() -> None:
    _guard()
    results = []
    for name in reversed(MIGRATIONS):
        path = ROOT / "supabase/rollbacks" / f"{name}.sql"
        if not path.exists():
            raise RuntimeError(f"rollback file missing: {path}")
        rec = _psql_file(path.read_text(), "rollback:" + name)
        rec["file_sha256"] = L.hashlib.sha256(path.read_bytes()).hexdigest()
        results.append(rec)
        print(json.dumps(rec, sort_keys=True))
    L.write_private(ART / "candidate-rollback.json", json.dumps(results, indent=2))


def snapshot(tag: str) -> None:
    SNAPS.mkdir(parents=True, exist_ok=True)
    data = F.capture(L.LAB_DB_CAND)
    path = SNAPS / f"cand-{tag}.json"
    L.write_private(path, json.dumps(data, sort_keys=True))
    counts = {k: (len(v) if isinstance(v, list) else 1) for k, v in data.items()}
    print(tag, json.dumps({k: counts[k] for k in
                           ("TABLES", "COLUMNS", "CONSTRAINTS", "INDEXES", "POLICIES",
                            "FUNCTIONS", "TRIGGERS", "TYPES")}, sort_keys=True))


def diff_base(tag: str) -> int:
    """Compare a cand snapshot against the base (production-shaped) snapshot."""
    base_path = ART / ("clone-catalog-" + L.LAB_DB_BASE + ".raw.jsonl")
    if not base_path.exists():
        raise RuntimeError("run faithfulness.py base first")
    base = F.parse(base_path)
    cand = json.loads((SNAPS / f"cand-{tag}.json").read_text())
    report = F.compare(base, cand)
    L.write_private(ART / f"diff-base-vs-{tag}.json", json.dumps(report, indent=2, sort_keys=True))
    bad = 0
    for sec, r in report.items():
        if r["verdict"] != "MATCH":
            bad += 1
        print(f"{sec:<18} missing={len(r['missing_in_clone']):<4} extra={len(r['extra_in_clone']):<4} "
              f"diff={len(r['differing']):<4} {r['verdict']}")
        for tag2, key in (("missing", r["missing_in_clone"]), ("extra", r["extra_in_clone"]),
                          ("diff", r["differing"])):
            for k in key[:6]:
                print(f"    {tag2:<7}: {k}")
    return bad


def main() -> int:
    cmds = {"apply": apply, "rollback": rollback}
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cmd = sys.argv[1]
    if cmd == "snapshot":
        snapshot(sys.argv[2])
        return 0
    if cmd == "diff-base":
        return 0 if diff_base(sys.argv[2]) == 0 else 1
    cmds[cmd]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
