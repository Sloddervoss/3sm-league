#!/usr/bin/env python3
"""S2E3 clone faithfulness.

Installs the production extension/publication/role set into BOTH lab databases,
captures the clone catalog with the exact SQL used on production, and compares
object-by-object against the production capture (identity, signature, owner,
ACL, RLS flags, constraint/index definitions, function body md5).

Usage: python3 faithfulness.py [base|cand]   (default: base)
"""
from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import s2e3lib as L

ART = L.ART
SRC_SQL = pathlib.Path(__file__).resolve().parent / "catalog.sql"
RAW_PROD = ART / "prod-catalog.raw.jsonl"

EXTENSIONS = [
    ("pgcrypto", "extensions"),
    ("uuid-ossp", "extensions"),
    ("pg_stat_statements", "extensions"),
    ("pg_net", "extensions"),
    ("pgjwt", "extensions"),
    ("supabase_vault", "vault"),
    ("pg_graphql", "graphql"),
    ("pg_cron", "pg_catalog"),
]


def install_roles() -> dict[str, str]:
    """Replicate production role attributes that the local image does not ship.

    Lab normalisation: attributes (including LOGIN) match production, but no
    password is ever set, so these roles cannot authenticate over TCP here.
    """
    out = {}
    for name, attrs in {
        "supabase_functions_admin": "NOINHERIT CREATEROLE LOGIN",
        "supabase_realtime_admin": "NOINHERIT NOLOGIN",
    }.items():
        p = L.psql_clone(f'CREATE ROLE "{name}" {attrs}', db="postgres", guard=L.CLONE_GUARD)
        out[name] = "ok" if p.returncode == 0 else "exists"
    p = L.psql_clone('GRANT "supabase_functions_admin" TO postgres', db="postgres",
                     guard=L.CLONE_GUARD)
    out["grant:supabase_functions_admin"] = "ok" if p.returncode == 0 else "exists"
    return out


def install_extensions(db: str) -> dict[str, str]:
    for schema in ("extensions", "vault", "graphql"):
        L.psql_clone(f"CREATE SCHEMA IF NOT EXISTS {schema}", db=db, guard=L.CLONE_GUARD)
    out: dict[str, str] = {}
    for name, schema in EXTENSIONS:
        p = L.psql_clone(f'CREATE EXTENSION IF NOT EXISTS "{name}" WITH SCHEMA "{schema}"',
                         db=db, guard=L.CLONE_GUARD)
        if p.returncode != 0 and b"already exists" not in p.stderr:
            p = L.psql_clone(f'CREATE EXTENSION IF NOT EXISTS "{name}"', db=db, guard=L.CLONE_GUARD)
        out[name] = "ok" if p.returncode == 0 else p.stderr.decode(errors="replace")[:160]
    return out


def replicate_publications(prod: dict, db: str) -> dict[str, str]:
    out = {}
    for row in prod.get("PUBLICATIONS", []):
        name, owner, all_tables, ins, upd, dele, trun, tables = row
        tables = (tables or "").split(",") if tables else []
        cloned = [t for t in tables if t.split(".")[0] in ("public", "auth")]
        if not tables or len(cloned) != len(tables):
            out[name] = "skipped (touches non-cloned schema)"
            continue
        p = L.psql_clone(f'CREATE PUBLICATION "{name}" FOR TABLE {", ".join(cloned)}',
                         db=db, guard=L.CLONE_GUARD)
        out[name] = "ok" if p.returncode == 0 else "exists"
    return out


def clone_catalog_sql(db: str) -> pathlib.Path:
    text = SRC_SQL.read_text()
    # candidate snapshots must also inventory the new pitwall_learning schema
    text = text.replace("('public','auth')", "('public','auth','pitwall_learning')")
    text = text.replace(
        "  IF current_database() <> 'postgres' THEN\n"
        "    RAISE EXCEPTION 's2e3 identity guard: database=% (expected postgres)', current_database();\n"
        "  END IF;\n"
        "  IF current_setting('transaction_read_only') <> 'on' THEN\n"
        "    RAISE EXCEPTION 's2e3 identity guard: transaction is not READ ONLY';\n"
        "  END IF;",
        "  IF current_database() <> '" + db + "' THEN\n"
        "    RAISE EXCEPTION 's2e3 clone guard: database=%', current_database();\n"
        "  END IF;",
    )
    text = text.replace(
        "'pitwall_learning_schema', (SELECT count(*) FROM pg_namespace WHERE nspname='pitwall_learning'),",
        "'pitwall_learning_schema', (SELECT count(*) FROM pg_namespace WHERE nspname='pitwall_learning'),")
    if "IF current_database() <> '" not in text:
        raise RuntimeError("clone guard substitution failed")
    path = L.WORK / f"catalog-{db}.sql"
    path.write_text(text)
    return path


def capture(db: str) -> dict:
    sql = clone_catalog_sql(db)
    p = L.sh(
        L.SSH + [f"docker exec -i {L.DB_CONTAINER} psql -X -q -At -v ON_ERROR_STOP=1 "
                 f"-U supabase_admin -d {db}"],
        stdin=sql.read_bytes(), timeout=300,
    )
    raw = ART / f"clone-catalog-{db}.raw.jsonl"
    L.write_private(raw, p.stdout)
    if p.returncode != 0:
        raise RuntimeError("clone catalog capture failed: " + p.stderr.decode(errors="replace")[:1000])
    return parse(raw)


def parse(path: pathlib.Path) -> dict:
    out: dict[str, object] = {}
    cur = None
    buf: list[str] = []

    def flush() -> None:
        nonlocal buf
        if cur and "".join(buf).strip():
            out[cur] = json.loads("".join(buf))
        buf = []

    for line in path.read_text().splitlines(keepends=True):
        if line.startswith("=== "):
            flush()
            cur = line[4:].strip()
        else:
            buf.append(line)
    flush()
    return out


SCOPE_SECTIONS = ["TABLES", "COLUMNS", "CONSTRAINTS", "INDEXES", "POLICIES", "FUNCTIONS",
                  "TRIGGERS", "TYPES", "SEQUENCES", "ROLES", "ROLE_MEMBERSHIPS",
                  "DEFAULT_ACLS", "EXTENSIONS", "PUBLICATIONS"]


def key_for(section: str, row: list) -> str:
    if section == "COLUMNS":
        return f"{row[0]}.{row[1]}.{row[3]}"
    if section in ("TABLES",):
        return f"{row[0]}.{row[1]}"
    if section == "TRIGGERS":
        return f"{row[0]}.{row[1]}.{row[2]}"
    if section == "INDEXES":
        return f"{row[0]}.{row[2]}"
    if section == "POLICIES":
        return f"{row[0]}.{row[1]}.{row[2]}"
    if section == "FUNCTIONS":
        return f"{row[0]}.{row[1]}({row[2]})"
    if section == "CONSTRAINTS":
        return f"{row[0]}.{row[1]}.{row[2]}"
    if section in ("TYPES", "SEQUENCES"):
        return f"{row[0]}.{row[1]}"
    if section == "ROLES":
        return row[0]
    if section == "ROLE_MEMBERSHIPS":
        return f"{row[0]}<-{row[1]}"
    if section == "DEFAULT_ACLS":
        return f"{row[0]}|{row[1]}|{row[2]}"
    if section in ("EXTENSIONS", "PUBLICATIONS"):
        return row[0]
    return json.dumps(row, sort_keys=True)


def normalize(section: str, rows: list) -> list:
    """Normalise only representation artefacts, never semantics.

    - ACL arrays are compared as SETS: PostgreSQL stores aclitem[] in grant
      order, and a dump/restore can reorder the same grants.
    - COLUMNS attnum is replaced by the in-table ordinal position, so a table
      whose production history contains dropped columns (attnum gaps) compares
      equal to the dump/restore copy that has no gaps.
    """
    out = []
    if section == "COLUMNS":
        per_table: dict[str, int] = {}
        for r in sorted(rows, key=lambda r: (r[0], r[1], r[2])):
            key = f"{r[0]}.{r[1]}"
            per_table[key] = per_table.get(key, 0) + 1
            out.append([r[0], r[1], per_table[key], *r[3:]])
        return out
    for r in rows:
        row = list(r)
        for idx, val in enumerate(row):
            if isinstance(val, list) and val and all(isinstance(x, str) and "=" in x for x in val):
                row[idx] = sorted(val)
        out.append(row)
    return out


def compare(prod: dict, clone: dict) -> dict:
    report: dict[str, object] = {}
    for sec in SCOPE_SECTIONS:
        a = {key_for(sec, r): r for r in normalize(sec, prod.get(sec, []))}
        b = {key_for(sec, r): r for r in normalize(sec, clone.get(sec, []))}
        missing = sorted(set(a) - set(b))
        extra = sorted(set(b) - set(a))
        differing = sorted(k for k in set(a) & set(b) if a[k] != b[k])
        report[sec] = {
            "prod": len(a), "clone": len(b),
            "missing_in_clone": missing, "extra_in_clone": extra,
            "differing": differing,
            "verdict": "MATCH" if not (missing or extra or differing) else "DIFF",
        }
    return report


def main() -> int:
    arm = sys.argv[1] if len(sys.argv) > 1 else "base"
    db = L.LAB_DB_BASE if arm == "base" else L.LAB_DB_CAND
    prod = parse(RAW_PROD)
    print("roles:", json.dumps(install_roles(), sort_keys=True))
    print("publications:", json.dumps(replicate_publications(prod, db), sort_keys=True))
    print("extensions:", json.dumps(install_extensions(db), sort_keys=True))
    clone = capture(db)
    report = compare(prod, clone)
    out = ART / f"clone-faithfulness-{arm}.json"
    L.write_private(out, json.dumps(report, indent=2, sort_keys=True))
    for sec, r in report.items():
        print(f"{sec:<18} prod={r['prod']:<5} clone={r['clone']:<5} "
              f"missing={len(r['missing_in_clone']):<4} extra={len(r['extra_in_clone']):<4} "
              f"diff={len(r['differing']):<4} {r['verdict']}")
        for tag, key in (("missing", r["missing_in_clone"]), ("extra", r["extra_in_clone"]),
                         ("diff", r["differing"])):
            for k in key[:4]:
                print(f"    {tag:<7}: {k}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
