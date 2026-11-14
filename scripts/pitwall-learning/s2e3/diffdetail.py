#!/usr/bin/env python3
"""Field-level diff between production and clone catalog captures."""
from __future__ import annotations

import json
import pathlib
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import faithfulness as F  # noqa: E402

ART = F.ART
LABELS = {
    "TABLES": ["schema", "name", "kind", "owner", "rls", "force_rls", "persist", "ncols", "acl", "eff"],
    "COLUMNS": ["schema", "table", "attnum", "name", "type", "notnull", "identity", "generated",
                "default", "collation", "acl"],
    "CONSTRAINTS": ["schema", "table", "name", "type", "deferrable", "deferred", "def", "cols"],
    "INDEXES": ["schema", "table", "name", "unique", "primary", "valid", "def", "tablespace"],
    "POLICIES": ["schema", "table", "name", "permissive", "cmd", "roles", "qual", "check"],
    "FUNCTIONS": ["schema", "name", "args", "returns", "owner", "secdef", "volatility", "strict",
                  "acl", "prosrc_md5", "proconfig", "eff"],
    "TRIGGERS": ["schema", "table", "name", "enabled", "type", "constraint", "def"],
    "TYPES": ["schema", "name", "kind", "owner", "enum", "base", "acl"],
    "SEQUENCES": ["schema", "name", "owner", "acl"],
    "ROLES": ["name", "super", "inherit", "createrole", "createdb", "login", "replication",
              "bypassrls", "connlimit"],
    "DEFAULT_ACLS": ["schema", "role", "objtype", "acl"],
    "EXTENSIONS": ["name", "version", "schema", "relocatable"],
    "PUBLICATIONS": ["name", "owner", "all", "ins", "upd", "del", "trunc"],
}


def main() -> int:
    section = sys.argv[1]
    prod = F.parse(ART / "prod-catalog.raw.jsonl")
    clone = F.parse(ART / "clone-catalog.raw.jsonl")
    a = {F.key_for(section, r): r for r in prod[section]}
    b = {F.key_for(section, r): r for r in clone[section]}
    counter: Counter = Counter()
    for k in sorted(set(a) & set(b)):
        if a[k] == b[k]:
            continue
        for idx, (x, y) in enumerate(zip(a[k], b[k])):
            if x != y:
                counter[LABELS[section][idx]] += 1
                if counter[LABELS[section][idx]] <= 3:
                    print(f"{k} [{LABELS[section][idx]}]")
                    print(f"   prod ={json.dumps(x)[:300]}")
                    print(f"   clone={json.dumps(y)[:300]}")
    print("differing fields:", dict(counter))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
