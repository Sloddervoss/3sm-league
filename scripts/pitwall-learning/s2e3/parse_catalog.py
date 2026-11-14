#!/usr/bin/env python3
"""S2E3 catalog parser: split marker-based psql output into sections + hashes.

Reads the raw capture, validates every section parses as JSON, writes
prod-catalog.json (normalized) and prints ONLY counts/hashes to stdout.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import sys

ART = pathlib.Path("/home/hermes/artifacts/3sm/pitwall-learning-p2-readonly-clone-20261114")
RAW = ART / "prod-catalog.raw.jsonl"
OUT = ART / "prod-catalog.json"

SECTIONS = [
    "IDENT", "SECRET_PRESENCE", "SCHEMAS", "ROLES", "ROLE_MEMBERSHIPS", "TABLES",
    "COLUMNS", "CONSTRAINTS", "INDEXES", "POLICIES", "FUNCTIONS", "TRIGGERS",
    "TYPES", "SEQUENCES", "EXTENSIONS", "PUBLICATIONS", "DEFAULT_ACLS", "COUNTS",
]


def parse() -> dict[str, object]:
    out: dict[str, object] = {}
    current = None
    buf: list[str] = []

    def flush() -> None:
        nonlocal buf
        if current is None:
            buf = []
            return
        text = "".join(buf).strip()
        if text:
            out[current] = json.loads(text)
        buf = []

    for line in RAW.read_text().splitlines(keepends=True):
        if line.startswith("=== "):
            flush()
            current = line[4:].strip()
        else:
            buf.append(line)
    flush()
    return out


def main() -> int:
    data = parse()
    missing = [s for s in SECTIONS if s not in data]
    if missing:
        print(f"FAIL missing sections: {missing}", file=sys.stderr)
        return 1
    if "END" in data:
        print("FAIL unexpected END payload", file=sys.stderr)
        return 1

    normalized = {k: data[k] for k in SECTIONS}
    text = json.dumps(normalized, sort_keys=True, separators=(",", ":"))
    OUT.write_text(text)
    OUT.chmod(0o600)

    print(f"prod-catalog.json bytes={len(text)} sha256={hashlib.sha256(text.encode()).hexdigest()}")
    for k in SECTIONS:
        v = normalized[k]
        n = len(v) if isinstance(v, list) else 1
        sec = hashlib.sha256(
            json.dumps(v, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()[:16]
        print(f"  {k:<18} items={n:<5} sha={sec}")
    print("IDENT:", json.dumps(normalized["IDENT"]))
    print("SECRET_PRESENCE:", json.dumps(normalized["SECRET_PRESENCE"]))
    print("COUNTS:", json.dumps(normalized["COUNTS"]))
    print("EXTENSIONS:", json.dumps(normalized["EXTENSIONS"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
