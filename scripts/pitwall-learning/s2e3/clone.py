#!/usr/bin/env python3
"""S2E3 clone stage: preflight, resources, production-shaped restore, 2-arm stack.

Two isolated arms share one PostgreSQL cluster (same server version, config,
extensions, roles) but never share a database:

  arm "base"  pitwall_learning_s2e3_base  = restored production schema, no candidate DDL
  arm "cand"  pitwall_learning_s2e3_cand  = same restore + approved candidate DDL

Each arm has its own PostgREST and its own Edge isolate. A single Kong proxy
serves both internal hops (host-based routing) and both HTTP ingress routes, so
the measured hop chain stays edge -> kong -> postgrest -> postgres -> response.

Usage: python3 clone.py <preflight|up|restore|functions|kong|stack|status|
                         wait-db|rm-stack|reset-lab|down-owned>
"""
from __future__ import annotations

import io
import json
import pathlib
import shutil
import sys
import tarfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import s2e3lib as L

ART = L.ART
PREFLIGHT = ART / "clone-preflight.json"
LIVE_TAR = ART / "live-edge-baseline.tar.gz"
LIVE_DIR = ART / "live-edge-baseline"
CAND_DIR = ART / "candidate-edge"

ALPINE = "alpine:latest"
ARMS = ("base", "cand")
DB_FOR = {"base": L.LAB_DB_BASE, "cand": L.LAB_DB_CAND}
CONTAINERS = {arm: (f"{L.PREFIX}rest-{arm}", f"{L.PREFIX}edge-{arm}") for arm in ARMS}
KONG_CONTAINER = L.KONG_CONTAINER

# container budget (MiB / cpus); total must stay <= 3072 MiB and 2.0 cpus
BUDGET = {
    L.DB_CONTAINER: (1024, 0.60),
    CONTAINERS["base"][0]: (256, 0.20),
    CONTAINERS["cand"][0]: (256, 0.20),
    CONTAINERS["base"][1]: (448, 0.30),
    CONTAINERS["cand"][1]: (448, 0.30),
    KONG_CONTAINER: (384, 0.30),
}
RESERVE_MIB = 2048


def _run(args: str, label: str, stdin: bytes | None = None, timeout: int = 300) -> str:
    p = L.remote(args, stdin=stdin, timeout=timeout)
    L.log("clone", step=label, argv=args, exit=p.returncode,
          stderr=p.stderr.decode(errors="replace")[:400])
    if p.returncode != 0:
        raise RuntimeError(f"{label}: exit={p.returncode} {p.stderr.decode(errors='replace')[:800]}")
    return p.stdout.decode()


def preflight() -> dict:
    meminfo = L.check(L.remote("cat /proc/meminfo"), "meminfo").stdout.decode()
    avail_mib = None
    for line in meminfo.splitlines():
        if line.startswith("MemAvailable:"):
            avail_mib = int(line.split()[1]) // 1024
    total_mib = sum(v[0] for v in BUDGET.values())
    total_cpu = round(sum(v[1] for v in BUDGET.values()), 2)
    disk = L.check(L.remote("df -Pk /var/lib/docker | tail -1"), "df").stdout.decode().split()
    disk_avail_kib = int(disk[3])
    nproc = int(L.check(L.remote("nproc"), "nproc").stdout.decode().strip())
    images = {}
    for ref in (L.PG_IMAGE_ID, "postgrest/postgrest:v14.17", L.EDGE_IMAGE, L.KONG_IMAGE,
                ALPINE, "denoland/deno:latest"):
        images[ref] = L.image_id(ref)
    absent = {}
    for kind, name in (
        ("container", L.DB_CONTAINER),
        *[("container", c) for pair in CONTAINERS.values() for c in pair],
        ("container", KONG_CONTAINER),
        ("volume", L.DB_VOLUME), ("volume", L.FUNC_VOLUME + "-base"),
        ("volume", L.FUNC_VOLUME + "-cand"), ("volume", L.DENO_VOLUME),
        ("volume", L.KONG_CONTAINER + "cfg"), ("volume", L.CLIENT_VOLUME),
        ("network", L.NET),
    ):
        try:
            L.assert_absent(name, kind)
            absent[f"{kind}:{name}"] = "absent"
        except L.GuardError as exc:
            absent[f"{kind}:{name}"] = f"PRESENT:{exc}"
    res = {
        "host": L.HOST,
        "avail_mib": avail_mib,
        "budget_total_mib": total_mib,
        "budget_total_cpu": total_cpu,
        "required_mib": total_mib + RESERVE_MIB,
        "ram_check": "PASS" if avail_mib is not None and avail_mib >= total_mib + RESERVE_MIB else "FAIL",
        "cpu_check": "PASS" if total_cpu <= 2.0 else "FAIL",
        "disk_avail_kib": disk_avail_kib,
        "disk_check": "PASS" if disk_avail_kib >= 5 * 1024 * 1024 else "FAIL",
        "host_nproc": nproc,
        "images": images,
        "name_checks": absent,
        "image_check": "PASS" if all(len(v) == 71 for v in images.values()) else "FAIL",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    L.write_private(PREFLIGHT, json.dumps(res, indent=2, sort_keys=True))
    print(json.dumps({k: res[k] for k in (
        "avail_mib", "budget_total_mib", "required_mib", "ram_check", "cpu_check",
        "disk_avail_kib", "disk_check", "image_check")}, indent=2))
    for k, v in res["name_checks"].items():
        print(f"  {k}: {v}")
    ok = all(res[k] == "PASS" for k in ("ram_check", "cpu_check", "disk_check", "image_check")) \
        and all(v == "absent" for v in res["name_checks"].values())
    if not ok:
        raise L.GuardError("preflight failed; refusing to create resources")
    return res


# ------------------------------------------------------------------ create ---
def up() -> None:
    preflight()
    sec = L.lab_secrets()
    _run(f"docker network create --internal --label {L.LABEL} {L.NET}", "create-network")
    _run(f"docker volume create --label {L.LABEL} {L.DB_VOLUME}", f"create-volume:{L.DB_VOLUME}")
    L.assert_absent(L.DB_CONTAINER)
    mem, cpu = BUDGET[L.DB_CONTAINER]
    _run(
        "docker run -d "
        f"--name {L.DB_CONTAINER} --label {L.LABEL} "
        f"--network {L.NET} --network-alias db "
        f"--memory {mem}m --cpus {cpu} --restart no "
        f"-e POSTGRES_PASSWORD={sec['postgres_password']} "
        f"-e POSTGRES_DB=postgres -e POSTGRES_USER=supabase_admin "
        f"-e POSTGRES_HOST=/var/run/postgresql -e POSTGRES_PORT=5432 "
        f"-e PGDATABASE=postgres -e PGPORT=5432 -e PGDATA=/var/lib/postgresql/data "
        f"-e JWT_SECRET={sec['jwt_secret']} -e JWT_EXP=3600 "
        f"-v {L.DB_VOLUME}:/var/lib/postgresql/data "
        f"{L.PG_IMAGE_ID} "
        "postgres -c config_file=/etc/postgresql/postgresql.conf "
        "-c log_min_messages=fatal -c jit=off -c wal_compression=on "
        "-c track_io_timing=on -c max_slot_wal_keep_size=2GB",
        "run-db",
    )
    wait_db()


def wait_db(timeout: int = 240) -> None:
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        p = L.remote(f"docker exec {L.DB_CONTAINER} pg_isready -U supabase_admin -d postgres")
        last = p.stdout.decode() + p.stderr.decode()
        if p.returncode == 0:
            print("db ready:", last.strip())
            return
        time.sleep(3)
    raise RuntimeError(f"db not ready: {last}")


def restore() -> None:
    meta = L.assert_owned(L.DB_CONTAINER)
    print("db container id:", meta["Id"][:12])
    dump = (ART / "prod-schema-public-auth.sql").read_bytes()
    for arm in ARMS:
        db = DB_FOR[arm]
        exists = L.psql_clone(f"SELECT 1 FROM pg_database WHERE datname='{db}'", db="postgres")
        if b"1" not in exists.stdout:
            L.psql_clone_ok(
                f'CREATE DATABASE "{db}" TEMPLATE template0 ENCODING \'UTF8\' '
                "LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8'",
                db="postgres", guard=None, label=f"create-{arm}-db")
            print("created", db)
        L.psql_clone_ok('DROP SCHEMA IF EXISTS "public" CASCADE', db=db, label="drop-public-stub")
        p = L.sh(
            L.SSH + [f"docker exec -i {L.DB_CONTAINER} psql -X -q -v ON_ERROR_STOP=1 "
                     f"-U supabase_admin -d {db}"],
            stdin=dump, timeout=900,
        )
        L.log("clone", step=f"restore-{arm}", exit=p.returncode,
              stdout=len(p.stdout), stderr=p.stderr.decode()[:2000])
        if p.returncode != 0:
            (ART / f"restore-{arm}.log").write_bytes(p.stderr)
            raise RuntimeError(f"restore {arm} failed: " + p.stderr.decode(errors="replace")[:1500])
        print(f"restore {arm}: exit 0, stderr bytes {len(p.stderr)}")


# --------------------------------------------------------------- functions ---
def fetch_live_edge() -> None:
    cmd = (
        "cd /opt/supabase/docker/volumes/functions && "
        "tar czf - --exclude='*.bak-*' --exclude='*.pre-*' "
        "_shared simhub-ingest-v3 simhub-version main"
    )
    p = L.check(L.remote(cmd), "fetch live edge")
    L.write_private(LIVE_TAR, p.stdout)
    if LIVE_DIR.exists():
        shutil.rmtree(LIVE_DIR)
    LIVE_DIR.mkdir(parents=True)
    with tarfile.open(LIVE_TAR) as tf:
        tf.extractall(LIVE_DIR, filter="data")
    files = sorted(x for x in LIVE_DIR.rglob("*.ts"))
    hashes = {str(f.relative_to(LIVE_DIR)): L.hashlib.sha256(f.read_bytes()).hexdigest() for f in files}
    L.write_private(ART / "live-edge-baseline-hashes.json",
                    json.dumps(hashes, indent=2, sort_keys=True))
    print(f"live edge files={len(files)} tar_sha={L.hashlib.sha256(LIVE_TAR.read_bytes()).hexdigest()}")


def build_candidate() -> None:
    root = pathlib.Path(__file__).resolve().parents[3]
    if CAND_DIR.exists():
        shutil.rmtree(CAND_DIR)
    shutil.copytree(LIVE_DIR, CAND_DIR)
    overlay = [
        "supabase/functions/simhub-ingest-v3/index.ts",
        "supabase/functions/simhub-ingest-v3/context.ts",
        "supabase/functions/simhub-ingest-v3/persist.ts",
        "supabase/functions/simhub-ingest-v3/observationCapability.ts",
        "supabase/functions/_shared/simhub.ts",
        "supabase/functions/_shared/observationPolicyV1.ts",
        "supabase/functions/_shared/observationV1.ts",
        "supabase/functions/_shared/observationContext.ts",
        "supabase/functions/_shared/observationWindow.ts",
        "supabase/functions/_shared/simhubExtensions.ts",
        "supabase/functions/_shared/simhubAggregates.ts",
        "supabase/functions/_shared/tyreObservation.ts",
        "supabase/functions/_shared/tyreTelemetry.ts",
        "supabase/functions/_shared/lapTimes.ts",
        "supabase/functions/_shared/vehicleTelemetry.ts",
    ]
    applied = {}
    for rel in overlay:
        src = root / rel
        if not src.exists():
            continue
        dst = CAND_DIR / rel.split("functions/", 1)[1]
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())
        applied[rel] = L.hashlib.sha256(src.read_bytes()).hexdigest()
    L.write_private(ART / "candidate-overlay.json", json.dumps(applied, indent=2, sort_keys=True))
    print(f"candidate overlay files={len(applied)}")


def _tar_tree(base: pathlib.Path) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for path in sorted(base.rglob("*")):
            tf.add(path, arcname=str(path.relative_to(base)))
    return buf.getvalue()


def _seed_volume(volume: str, tar_bytes: bytes, label: str) -> None:
    _run(f"docker run --rm -i -v {volume}:/dst {ALPINE} tar -xzf - -C /dst",
         label, stdin=tar_bytes, timeout=300)


def functions() -> None:
    fetch_live_edge()
    build_candidate()
    for vol in (L.FUNC_VOLUME + "-base", L.FUNC_VOLUME + "-cand", L.DENO_VOLUME,
                L.KONG_CONTAINER + "cfg", L.CLIENT_VOLUME):
        L.assert_absent(vol, "volume")
        _run(f"docker volume create --label {L.LABEL} {vol}", f"create-volume:{vol}")
    _seed_volume(L.FUNC_VOLUME + "-base", _tar_tree(LIVE_DIR), "seed-functions-base")
    _seed_volume(L.FUNC_VOLUME + "-cand", _tar_tree(CAND_DIR), "seed-functions-cand")
    src = "/var/lib/docker/volumes/supabase_deno-cache/_data"
    out = b""
    for attempt in range(3):
        p = L.remote(f"tar czf - --warning=no-file-changed -C {src} .", timeout=300)
        L.log("clone", step="tar-deno-cache", attempt=attempt, exit=p.returncode,
              stderr=p.stderr.decode(errors="replace")[:200], bytes=len(p.stdout))
        if p.returncode in (0, 1) and len(p.stdout) > 0:
            out = p.stdout
            break
        time.sleep(2)
    if not out:
        raise RuntimeError("could not copy the cached deno dependency tree")
    L.write_private(ART / "deno-cache-copy.tar.gz", out)
    _seed_volume(L.DENO_VOLUME, out, "seed-deno-cache")
    print("deno cache bytes:", len(out))


def kong_config() -> None:
    sec = L.lab_secrets()
    anon = L.mint_jwt(sec["jwt_secret"], "anon")
    svc = L.mint_jwt(sec["jwt_secret"], "service_role")
    cfg = f"""_format_version: "3.0"
_transform: true
services:
  - name: rest-base
    url: http://rest-base:3000
    routes:
      - name: rest-base
        hosts: ["kong"]
        paths: ["/rest/v1"]
        strip_path: true
  - name: rest-cand
    url: http://rest-cand:3000
    routes:
      - name: rest-cand
        hosts: ["kong-cand"]
        paths: ["/rest/v1"]
        strip_path: true
  - name: functions-base
    url: http://edge-base:9000
    routes:
      - name: functions-base
        paths: ["/functions/v1"]
        strip_path: true
  - name: functions-cand
    url: http://edge-cand:9000
    routes:
      - name: functions-cand
        paths: ["/candidate-functions/v1"]
        strip_path: true
consumers:
  - username: anon
    keyauth_credentials:
      - key: "{anon}"
  - username: service_role
    keyauth_credentials:
      - key: "{svc}"
plugins:
  - name: key-auth
    config:
      key_names: ["apikey"]
      hide_credentials: false
"""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        data = cfg.encode()
        info = tarfile.TarInfo("kong.yml")
        info.size = len(data)
        info.mode = 0o644
        tf.addfile(info, io.BytesIO(data))
    _seed_volume(L.KONG_CONTAINER + "cfg", buf.getvalue(), "seed-kong-cfg")
    L.write_private(ART / "lab-kong.yml", cfg, 0o600)
    L.write_private(ART / "lab-api-keys.json",
                    json.dumps({"anon": anon, "service_role": svc}, indent=2), 0o600)


# ------------------------------------------------------------------- stack ---
def stack() -> None:
    sec = L.lab_secrets()
    for arm in ARMS:
        rest, edge = CONTAINERS[arm]
        L.assert_absent(rest)
        L.assert_absent(edge)
    L.assert_absent(KONG_CONTAINER)
    L.psql_clone_ok(
        f"ALTER ROLE authenticator WITH PASSWORD '{sec['authenticator_password']}'",
        db="postgres", guard=None, label="lab-authenticator-password")
    rest_image = L.image_id("postgrest/postgrest:v14.17")
    for arm in ARMS:
        rest, _ = CONTAINERS[arm]
        mem, cpu = BUDGET[rest]
        _run(
            "docker run -d "
            f"--name {rest} --label {L.LABEL} "
            f"--network {L.NET} --network-alias rest-{arm} --memory {mem}m --cpus {cpu} "
            f"-e PGRST_DB_URI=postgres://authenticator:{sec['authenticator_password']}"
            f"@db:5432/{DB_FOR[arm]} "
            "-e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon "
            f"-e PGRST_JWT_SECRET={sec['jwt_secret']} "
            "-e PGRST_DB_MAX_ROWS=1000 -e PGRST_DB_USE_LEGACY_GUCS=false "
            "-e PGRST_DB_EXTRA_SEARCH_PATH=public -e PGRST_APP_SETTINGS_JWT_EXP=3600 "
            f"-e PGRST_APP_SETTINGS_JWT_SECRET={sec['jwt_secret']} "
            f"{rest_image}",
            f"run-rest-{arm}",
        )
    keys = json.loads((ART / "lab-api-keys.json").read_text())
    edge_image = L.image_id(L.EDGE_IMAGE)
    for arm in ARMS:
        _, edge = CONTAINERS[arm]
        mem, cpu = BUDGET[edge]
        supabase_url = "http://kong-cand:8000" if arm == "cand" else "http://kong:8000"
        _run(
            "docker run -d "
            f"--name {edge} --label {L.LABEL} "
            f"--network {L.NET} --network-alias edge-{arm} --memory {mem}m --cpus {cpu} "
            f"-e SUPABASE_URL={supabase_url} "
            f"-e SUPABASE_SERVICE_ROLE_KEY={keys['service_role']} "
            f"-e SUPABASE_ANON_KEY={keys['anon']} "
            f"-e JWT_SECRET={sec['jwt_secret']} -e VERIFY_JWT=false "
            f"-e SUPABASE_PUBLIC_URL={supabase_url} "
            "-e SIMHUB_ALLOWED_ORIGINS=https://lab.s2e3.invalid "
            f"-v {L.FUNC_VOLUME}-{arm}:/home/deno/functions "
            f"-v {L.DENO_VOLUME}:/root/.cache/deno "
            f"--entrypoint edge-runtime {edge_image} "
            "start --main-service /home/deno/functions/main",
            f"run-edge-{arm}",
        )
    mem, cpu = BUDGET[KONG_CONTAINER]
    _run(
        "docker run -d "
        f"--name {KONG_CONTAINER} --label {L.LABEL} "
        f"--network {L.NET} --network-alias kong --network-alias kong-cand "
        f"--memory {mem}m --cpus {cpu} --user kong "
        "-e KONG_DATABASE=off "
        "-e KONG_DECLARATIVE_CONFIG=/home/kong/cfg/kong.yml "
        "-e KONG_PROXY_LISTEN=0.0.0.0:8000 -e KONG_ADMIN_LISTEN=off "
        "-e KONG_LOG_LEVEL=notice -e KONG_NGINX_WORKER_PROCESSES=2 "
        "-e KONG_PROXY_ACCESS_LOG=/dev/stdout -e KONG_DNS_NOT_FOUND_TTL=30 "
        f"-v {L.KONG_CONTAINER}cfg:/home/kong/cfg "
        f"{L.image_id(L.KONG_IMAGE)}",
        "run-kong",
    )
    wait_stack()


def wait_stack(timeout: int = 240) -> None:
    deadline = time.time() + timeout
    report: dict[str, str] = {}
    while time.time() < deadline:
        report = {}
        for name in [c for pair in CONTAINERS.values() for c in pair] + [KONG_CONTAINER]:
            p = L.remote(f"docker inspect {name} --format '{{{{.State.Status}}}}'")
            report[name] = p.stdout.decode().strip()
        print(json.dumps(report))
        if all(v == "running" for v in report.values()) and len(report) == 5:
            return
        time.sleep(5)
    raise RuntimeError("stack not healthy: " + json.dumps(report))


def status() -> None:
    handles = {}
    for name in (L.DB_CONTAINER, KONG_CONTAINER,
                 *[c for pair in CONTAINERS.values() for c in pair]):
        meta = L.assert_owned(name)
        handles[name] = {
            "id": meta["Id"],
            "image": (meta["Config"] or {}).get("Image"),
            "status": (meta["State"] or {}).get("Status"),
            "memory": (meta["HostConfig"] or {}).get("Memory"),
            "nano_cpus": (meta["HostConfig"] or {}).get("NanoCpus"),
            "networks": list(((meta["NetworkSettings"] or {}).get("Networks") or {}).keys()),
            "mounts": [{"type": m["Type"], "name": m.get("Name"), "dst": m["Destination"]}
                       for m in (meta.get("Mounts") or [])],
        }
    net = json.loads(L.check(L.remote(f"docker network inspect {L.NET}"), "net").stdout)[0]
    vols = {}
    for vol in (L.DB_VOLUME, L.FUNC_VOLUME + "-base", L.FUNC_VOLUME + "-cand",
                L.DENO_VOLUME, L.KONG_CONTAINER + "cfg", L.CLIENT_VOLUME):
        vols[vol] = json.loads(L.check(L.remote(f"docker volume inspect {vol}"), "vol").stdout)[0]["Mountpoint"]
    handles["network"] = {"name": net["Name"], "id": net["Id"], "internal": net["Internal"],
                          "labels": net.get("Labels")}
    handles["volumes"] = vols
    L.write_private(ART / "clone-handles.json", json.dumps(handles, indent=2, sort_keys=True))
    print(json.dumps({k: (v if k in ("network", "volumes") else {
        "id": v["id"][:12], "status": v["status"], "memory_mib": v["memory"] // 1048576})
        for k, v in handles.items()}, indent=2))


def rm_stack() -> None:
    for name in (KONG_CONTAINER, *[c for pair in CONTAINERS.values() for c in pair]):
        try:
            L.assert_owned(name)
        except L.GuardError:
            continue
        _run(f"docker rm -f {name}", f"rm:{name}")
        print("removed", name)


def reset_lab() -> None:
    L.assert_owned(L.DB_CONTAINER)
    for arm in ARMS:
        db = DB_FOR[arm]
        if not db.startswith("pitwall_learning_s2e3_"):
            raise L.GuardError(f"refusing to drop {db}")
        L.psql_clone_ok(
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{db}'",
            db="postgres", guard=None, label="terminate-lab-conns")
        L.psql_clone_ok(f'DROP DATABASE IF EXISTS "{db}"', db="postgres", guard=None,
                        label="drop-lab-db")
        print("dropped", db)


def down_owned() -> None:
    removed = []
    for name in (KONG_CONTAINER, *[c for pair in CONTAINERS.values() for c in pair],
                 L.DB_CONTAINER):
        try:
            L.assert_owned(name)
        except L.GuardError:
            continue
        _run(f"docker rm -f {name}", f"rm:{name}")
        removed.append(name)
    for vol in (L.KONG_CONTAINER + "cfg", L.CLIENT_VOLUME, L.DENO_VOLUME,
                L.FUNC_VOLUME + "-cand", L.FUNC_VOLUME + "-base", L.DB_VOLUME):
        p = L.remote(f"docker volume inspect {vol} --format '{{{{json .Labels}}}}'")
        if p.returncode != 0:
            continue
        if (json.loads(p.stdout or b"{}") or {}).get(L.LABEL_KEY) != L.LABEL_VAL:
            continue
        _run(f"docker volume rm {vol}", f"rmv:{vol}")
        removed.append(vol)
    p = L.remote(f"docker network inspect {L.NET} --format '{{{{json .Labels}}}}'")
    if p.returncode == 0 and (json.loads(p.stdout or b"{}") or {}).get(L.LABEL_KEY) == L.LABEL_VAL:
        _run(f"docker network rm {L.NET}", "rmnet")
        removed.append(L.NET)
    print("removed:", removed)


def main() -> int:
    L.ensure_dirs()
    cmds = {
        "preflight": preflight, "up": up, "restore": restore, "functions": functions,
        "kong": kong_config, "stack": stack, "status": status, "wait-db": wait_db,
        "rm-stack": rm_stack, "reset-lab": reset_lab, "down-owned": down_owned,
    }
    if len(sys.argv) != 2 or sys.argv[1] not in cmds:
        print(__doc__)
        return 2
    cmds[sys.argv[1]]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
