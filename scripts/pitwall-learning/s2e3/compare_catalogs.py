#!/usr/bin/env python3
"""Compare two catalog raw captures (drift check around the schema export)."""
from __future__ import annotations

import json
import pathlib
import sys

ART = pathlib.Path("/home/hermes/artifacts/3sm/pitwall-learning-p2-readonly-clone-20261114")


def parse(p: pathlib.Path) -> dict[str, object]:
    out: dict[str, object] = {}
    cur = None
    buf: list[str] = []

    def flush() -> None:
        nonlocal buf
        if cur and "".join(buf).strip():
            out[cur] = json.loads("".join(buf))
        buf = []

    for line in p.read_text().splitlines(keepends=True):
        if line.startswith("=== "):
            flush()
            cur = line[4:].strip()
        else:
            buf.append(line)
    flush()
    return out


def main() -> int:
    a = parse(ART / "prod-catalog.raw.jsonl")
    b = parse(ART / sys.argv[1])
    diffs = [
        k for k in a
        if k not in ("IDENT", "COUNTS")
        and json.dumps(a[k], sort_keys=True) != json.dumps(b.get(k), sort_keys=True)
    ]
    print("changed sections (excl IDENT/COUNTS):", diffs or "NONE")
    print("ident before:", a["IDENT"])
    print("ident after :", b["IDENT"])
    for k in diffs:
        av, bv = a[k], b.get(k)
        if isinstance(av, list) and isinstance(bv, list):
            sa = {json.dumps(x, sort_keys=True) for x in av}
            sb = {json.dumps(x, sort_keys=True) for x in bv}
            print(f"  {k}: -{len(sa - sb)} +{len(sb - sa)}")
            for x in list(sa - sb)[:5]:
                print("    removed:", x[:200])
            for x in list(sb - sa)[:5]:
                print("    added  :", x[:200])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
