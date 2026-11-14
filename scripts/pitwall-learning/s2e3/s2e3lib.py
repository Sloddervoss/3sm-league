#!/usr/bin/env python3
"""S2E3 shared library: guarded ssh/docker helpers, artifacts, lab credentials.

Nothing here mutates production. Every mutating docker call must first pass
`assert_owned()` for the exact S2E3 name/label set.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import pathlib
import secrets
import subprocess
import time

ART = pathlib.Path("/home/hermes/artifacts/3sm/pitwall-learning-p2-readonly-clone-20261114")
LOGS = ART / "logs"
WORK = ART / "work"
SECRETS_FILE = ART / "lab-secrets.json"

HOST = "3sm-docker"
SSH = ["ssh", "-o", "BatchMode=yes", HOST]
PREFIX = "pitwall-learning-s2e3-"
LABEL_KEY = "3sm.test"
LABEL_VAL = "pitwall-learning-s2e3"
LABEL = f"{LABEL_KEY}={LABEL_VAL}"

NET = PREFIX + "net"
DB_CONTAINER = PREFIX + "db"
REST_CONTAINER = PREFIX + "rest"
EDGE_CONTAINER = PREFIX + "edge"
KONG_CONTAINER = PREFIX + "kong"
DB_VOLUME = PREFIX + "dbdata"
FUNC_VOLUME = PREFIX + "functions"
DENO_VOLUME = PREFIX + "denocache"

LAB_DB_BASE = "pitwall_learning_s2e3_base"
LAB_DB_CAND = "pitwall_learning_s2e3_cand"
LAB_DB = LAB_DB_CAND  # default for ad-hoc psql_clone calls
CLIENT_VOLUME = PREFIX + "client"
PG_IMAGE_ID = "sha256:1aabcd9cfb8a58ecde50a6092b207bcbb5f6bdc45546fde35cfda5d3ab39c065"
REST_IMAGE_ID = "sha256:c9dc201e555f"  # resolved at runtime to full id
EDGE_IMAGE = "supabase/edge-runtime:v1.76.2"
KONG_IMAGE = "kong/kong:3.9.1"

PROD_DB_CONTAINER = "supabase-db"
PROD_PG_USER = "supabase_admin"
PROD_DB = "postgres"


# ---------------------------------------------------------------- process ---
def sh(args: list[str], stdin: bytes | None = None, timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(args, input=stdin, capture_output=True, timeout=timeout)


def remote(cmd: str, stdin: bytes | None = None, timeout: int = 300) -> subprocess.CompletedProcess:
    return sh(SSH + [cmd], stdin=stdin, timeout=timeout)


def docker(*args: str, stdin: bytes | None = None, timeout: int = 300) -> subprocess.CompletedProcess:
    return sh(SSH + ["docker " + " ".join(_q(a) for a in args)], stdin=stdin, timeout=timeout)


def _q(s: str) -> str:
    if s and all(c.isalnum() or c in "_-./=:@,+[]{}*" for c in s):
        return s
    return "'" + s.replace("'", "'\\''") + "'"


def check(p: subprocess.CompletedProcess, label: str) -> subprocess.CompletedProcess:
    if p.returncode != 0:
        raise RuntimeError(
            f"{label}: exit={p.returncode} stderr={p.stderr.decode(errors='replace')[:800]}"
        )
    return p


# ------------------------------------------------------------- artifacts ---
def ensure_dirs() -> None:
    ART.mkdir(parents=True, exist_ok=True)
    os.chmod(ART, 0o700)
    for d in (LOGS, WORK):
        d.mkdir(parents=True, exist_ok=True)
        os.chmod(d, 0o700)


def write_private(path: pathlib.Path, data: str | bytes, mode: int = 0o600) -> str:
    raw = data.encode() if isinstance(data, str) else data
    path.write_bytes(raw)
    os.chmod(path, mode)
    return hashlib.sha256(raw).hexdigest()


def log(stage: str, **fields) -> None:
    ensure_dirs()
    rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "stage": stage, **fields}
    with open(LOGS / f"{stage}.jsonl", "a") as fh:
        fh.write(json.dumps(rec, sort_keys=True) + "\n")


def record_cmd(stage: str, argv: list[str], p: subprocess.CompletedProcess) -> None:
    log(stage, kind="cmd", argv=argv, exit=p.returncode,
        stdout_sha=hashlib.sha256(p.stdout).hexdigest(),
        stdout_bytes=len(p.stdout),
        stderr=p.stderr.decode(errors="replace")[:400])


# -------------------------------------------------------------- lab auth ---
def lab_secrets() -> dict[str, str]:
    """Synthetic lab-only credentials; generated once, never printed, 0600."""
    ensure_dirs()
    if SECRETS_FILE.exists():
        return json.loads(SECRETS_FILE.read_text())
    cfg = {
        "jwt_secret": secrets.token_hex(32),
        "postgres_password": secrets.token_urlsafe(24),
        "authenticator_password": secrets.token_urlsafe(24),
        "db_tokens": {f"token_{i}": secrets.token_urlsafe(32) for i in range(6)},
    }
    write_private(SECRETS_FILE, json.dumps(cfg, sort_keys=True), 0o600)
    return cfg


def b64url(raw: bytes) -> bytes:
    return base64.urlsafe_b64encode(raw).rstrip(b"=")


def mint_jwt(secret: str, role: str, ttl: int = 3600 * 8) -> str:
    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64url(json.dumps(
        {"iss": "supabase-lab", "role": role, "iat": now, "exp": now + ttl},
        separators=(",", ":"),
    ).encode())
    signing = header + b"." + payload
    sig = b64url(hmac.new(secret.encode(), signing, hashlib.sha256).digest())
    return (signing + b"." + sig).decode()


# ---------------------------------------------------------------- guards ---
class GuardError(RuntimeError):
    pass


def container_meta(name: str) -> dict | None:
    p = remote(
        "docker inspect " + _q(name) + ' --format "{{json .}}"'
    )
    if p.returncode != 0:
        return None
    return json.loads(p.stdout)


def assert_owned(name: str) -> dict:
    """Refuse to touch anything that is not provably our own S2E3 resource."""
    if not name.startswith(PREFIX):
        raise GuardError(f"{name}: not an S2E3 name")
    meta = container_meta(name)
    if meta is None:
        raise GuardError(f"{name}: container does not exist")
    labels = (meta.get("Config") or {}).get("Labels") or {}
    if labels.get(LABEL_KEY) != LABEL_VAL:
        raise GuardError(f"{name}: missing/incorrect label {LABEL}")
    netmode = (meta.get("HostConfig") or {}).get("NetworkMode")
    if netmode != NET:
        raise GuardError(f"{name}: network mode {netmode} != {NET}")
    ports = (meta.get("HostConfig") or {}).get("PortBindings") or {}
    if ports:
        raise GuardError(f"{name}: host port bindings are forbidden: {ports}")
    hc = meta.get("HostConfig") or {}
    if hc.get("Privileged"):
        raise GuardError(f"{name}: privileged container is forbidden")
    if hc.get("PidMode") not in ("", None):
        raise GuardError(f"{name}: forbidden PidMode={hc.get('PidMode')}")
    if str(hc.get("IpcMode") or "").startswith(("host", "container:")):
        raise GuardError(f"{name}: forbidden IpcMode={hc.get('IpcMode')}")
    if hc.get("UsernsMode") not in ("", None):
        raise GuardError(f"{name}: forbidden UsernsMode={hc.get('UsernsMode')}")
    if (hc.get("Devices") or []):
        raise GuardError(f"{name}: device passthrough is forbidden")
    for mount in (meta.get("Mounts") or []):
        if mount["Type"] == "bind":
            raise GuardError(f"{name}: bind mount is forbidden: {mount.get('Source')}")
        if "/var/run/docker.sock" in (mount.get("Source") or ""):
            raise GuardError(f"{name}: docker socket mount is forbidden")
    return meta


def assert_absent(name: str, kind: str = "container") -> None:
    if kind == "container":
        p = remote("docker inspect " + _q(name))
        if p.returncode == 0:
            raise GuardError(f"{name}: container already exists; refusing adoption")
    elif kind == "volume":
        p = remote("docker volume inspect " + _q(name))
        if p.returncode == 0:
            raise GuardError(f"{name}: volume already exists; refusing adoption")
    elif kind == "network":
        p = remote("docker network inspect " + _q(name))
        if p.returncode == 0:
            raise GuardError(f"{name}: network already exists; refusing adoption")


def image_id(ref: str) -> str:
    p = check(remote('docker image inspect ' + _q(ref) + ' --format "{{.Id}}"'),
              f"image inspect {ref}")
    return p.stdout.decode().strip()


# ------------------------------------------------------------------ psql ---
def psql_prod_file(sql_path: pathlib.Path, timeout: int = 180) -> subprocess.CompletedProcess:
    """Read-only metadata SQL on production, executed over the fixed route."""
    return sh(
        SSH + [
            f"docker exec -i {PROD_DB_CONTAINER} psql -X -q -At "
            f"-v ON_ERROR_STOP=1 -U {PROD_PG_USER} -d {PROD_DB}"
        ],
        stdin=sql_path.read_bytes(),
        timeout=timeout,
    )


def psql_clone(sql: str, db: str = LAB_DB, *, timeout: int = 300,
               guard: str | None = None) -> subprocess.CompletedProcess:
    """Run SQL inside the verified clone DB container (mutations allowed here)."""
    assert_owned(DB_CONTAINER)
    body = sql
    if guard:
        body = guard + "\n" + sql
    argv = SSH + [
        f"docker exec -i {DB_CONTAINER} psql -X -q -At -v ON_ERROR_STOP=1 "
        f'-U supabase_admin -d {db}'
    ]
    return sh(argv, stdin=body.encode(), timeout=timeout)


def psql_clone_ok(sql: str, db: str = LAB_DB, *, timeout: int = 300,
                  guard: str | None = None, label: str = "psql_clone") -> str:
    p = psql_clone(sql, db, timeout=timeout, guard=guard)
    if p.returncode != 0:
        raise RuntimeError(f"{label}: exit={p.returncode} {p.stderr.decode(errors='replace')[:1200]}")
    return p.stdout.decode()


CLONE_GUARD = """DO $guard$ BEGIN
  IF to_regclass('pg_catalog.pg_class') IS NULL THEN RAISE EXCEPTION 'clone guard: not postgres'; END IF;
  IF current_setting('server_version_num')::int <> 150019 THEN
    RAISE EXCEPTION 'clone guard: server_version_num=% (expected 150019)', current_setting('server_version_num');
  END IF;
  IF current_database() NOT LIKE 'pitwall_learning_s2e3_%' THEN
    RAISE EXCEPTION 'clone guard: database=% is not a lab database', current_database();
  END IF;
  IF current_setting('data_directory') <> '/var/lib/postgresql/data' THEN
    RAISE EXCEPTION 'clone guard: data_directory=%', current_setting('data_directory');
  END IF;
END $guard$;"""
