#!/usr/bin/env python3
"""S2E2 — geïsoleerde PostgreSQL-rehearsal voor de observation-policy-publisher.

Harde, niet overrideerbare route:
  ssh -o BatchMode=yes 3sm-docker
    docker exec -i pitwall-learning-p2-readiness-policy-s2e2
      psql -X -q -A -t -v ON_ERROR_STOP=1 -h /work/socket -U postgres
           -d pitwall_learning_p2_readiness_policy_s2e2

Dit is een NIEUWE, wegwerp-instance. Het oude S1-script en de oude
S1-container/proof worden nooit gebruikt of hergebruikt. De bestaande
productiecontainer `supabase-db` wordt niet aangeraakt.

Container: exacte naam, --network none, geen poorten/binds/named volumes/
socketmount, 768 MiB / 1 CPU, tmpfs /work <= 512 MiB, bare postgres UID 100:101,
entrypoint bash (niet de Supabase-stack), Unix-socket /work/socket,
data_directory /work/data, listen_addresses = ''.

Elke muterende stream start met een SQL-identiteitsguard (exacte database,
data_directory, inet_server_addr IS NULL); vóór elke stream wordt de container
opnieuw geïnspecteerd (id/label/image/network/mounts/user).

Exit 0 betekent: alle stages geslaagd. De container blijft draaien zodat de
ouder het handle kan verifiëren; bij een fout wordt alleen DEZE container
opgeruimd.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tarfile
import time
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[2]
ART = pathlib.Path(
    "/home/hermes/artifacts/3sm/pitwall-learning-p2-observation-policy-publisher"
)
LOGS = ART / "logs"
WORK = ART / "work"

CONTAINER = "pitwall-learning-p2-readiness-policy-s2e2"
DB = "pitwall_learning_p2_readiness_policy_s2e2"
LABEL = "3sm.test=pitwall-learning-p2-readiness-policy-s2e2"
IMAGE_ID = "sha256:1aabcd9cfb8a58ecde50a6092b207bcbb5f6bdc45546fde35cfda5d3ab39c065"
SSH = ["ssh", "-o", "BatchMode=yes", "3sm-docker"]
PSQL_BASE = [
    "docker", "exec", "-i", CONTAINER, "psql",
    "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-h", "/work/socket", "-U", "postgres",
]

MIGRATION = ROOT / "supabase/migrations/20261114000945_pitwall_learning_observation_policy.sql"
ROLLBACK = ROOT / "supabase/rollbacks/20261114000945_pitwall_learning_observation_policy.sql"
BASELINE_FIXTURE = ROOT / "supabase/tests/fixtures/pitwall-learning-p2-readiness-policy-baseline.sql"
SEED_FIXTURE = ROOT / "supabase/tests/fixtures/pitwall-learning-p2-readiness-policy-seed.sql"
STUB = ROOT / "supabase/tests/fixtures/plugin08_stub_schema.sql"
PRE_TEST = ROOT / "supabase/tests/pitwall-learning-observation-policy-pre.sql"
FORWARD_TEST = ROOT / "supabase/tests/pitwall-learning-observation-policy.sql"
POST_TEST = ROOT / "supabase/tests/pitwall-learning-observation-policy-post-rollback.sql"
COMPOSER = ROOT / "supabase/functions/_shared/observationPolicyV1.ts"

CHAIN = sorted((ROOT / "supabase/migrations").glob("2026103118*.sql"))
CHAIN += sorted((ROOT / "supabase/migrations").glob("2026103119*.sql"))
CHAIN += sorted((ROOT / "supabase/migrations").glob("2026103120*.sql"))
CHAIN.append(ROOT / "supabase/migrations/20261111163052_pitwall_learning_evidence.sql")

CHAIN_SCOPE = {
    "label": "minimal_fixture_older_wrapper",
    "new_function_dependencies": [
        "public.simhub_devices (plugin08 stub schema in this disposable DB)",
        "pitwall_learning.account_policy (20261111163052)",
        "pitwall_learning.capture_source_batch (actual P1 guard, 20261111163052)",
    ],
    "omitted": [
        "20261101113047_pace_capture.sql (full PACE schema outside this fixture)",
        "20261110231000_pitwall_pace_storage.sql (full PACE schema outside this fixture)",
        "20261112134500_pitwall_learning_observation_capture.sql (not a dependency of the publisher)",
    ],
    "not_claimed": "not a production-schema or full-ingest rehearsal; simhub_devices comes from the repo stub fixture, matching the accepted S1 rehearsal pattern",
}

GUARD_TEST = """DO $harness_guard$ BEGIN
  IF current_database() <> '%s'
     OR current_setting('data_directory') <> '/work/data'
     OR inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'HARNESS GUARD: wrong database, data_directory or TCP route';
  END IF;
END $harness_guard$;
""" % DB

GUARD_LIFECYCLE = """DO $harness_guard$ BEGIN
  IF current_database() <> 'postgres'
     OR current_setting('data_directory') <> '/work/data'
     OR inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'HARNESS GUARD: wrong lifecycle database or route';
  END IF;
END $harness_guard$;
"""

executed: list[dict[str, object]] = []
identity_verified: dict[str, object] = {}


class StageError(RuntimeError):
    pass


def _ssh_capture(args: list[str], stdin: bytes | None = None, timeout: int = 300):
    return subprocess.run(SSH + args, input=stdin, capture_output=True, timeout=timeout)


def remote(*args: str) -> subprocess.CompletedProcess:
    return _ssh_capture(list(args))


def docker(*args: str) -> subprocess.CompletedProcess:
    return remote("docker", *args)


def docker_out(*args: str, check: bool = True) -> str:
    proc = docker(*args)
    if check and proc.returncode != 0:
        raise StageError(f"docker {' '.join(args)} failed: {proc.stderr.decode(errors='replace')}")
    return proc.stdout.decode().strip()


def file_sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def preflight() -> dict[str, object]:
    """Read-only: host, daemon, image, resources and reserved test name only."""
    hostname = remote("hostname")
    if hostname.returncode != 0 or not hostname.stdout.strip():
        raise StageError("3sm-docker hostname check failed")
    daemon = docker("info", "--format", "{{.Name}}")
    if daemon.returncode != 0:
        raise StageError("docker daemon not reachable via 3sm-docker")

    image = docker_out("image", "inspect", IMAGE_ID, "--format", "{{.Id}}")
    if image != IMAGE_ID:
        raise StageError(f"cached image id mismatch: {image!r} != {IMAGE_ID!r}")

    names = set(docker_out("ps", "-a", "--format", "{{.Names}}").split())
    if CONTAINER in names:
        # Nooit een bestaand instance adopteren, ook niet als het 'onze' naam is.
        raise StageError(
            f"reserved container name {CONTAINER!r} already exists; refusing to adopt it"
        )

    # /proc/meminfo reports KiB; compare and report MiB, just like df -Pm.
    mem_avail = int(remote(
        "awk", "'/MemAvailable/{print $2}'", "/proc/meminfo").stdout.decode().strip()) // 1024
    disk_probe = remote("df", "-Pm", "/var/lib/docker")
    if disk_probe.returncode != 0:
        disk_probe = remote("df", "-Pm", "/")
    disk_avail = int(disk_probe.stdout.decode().splitlines()[-1].split()[3])
    if mem_avail < 1536:
        raise StageError(f"not enough available memory: {mem_avail} MiB")
    if disk_avail < 4096:
        raise StageError(f"not enough free disk: {disk_avail} MiB")

    return {
        "hostname": hostname.stdout.decode().strip(),
        "docker_daemon": daemon.stdout.decode().strip(),
        "image_id": image,
        "mem_available_mib": mem_avail,
        "disk_available_mib": disk_avail,
        "reserved_name_free": True,
        "production_container_inspected": False,
        "production_container_untouched": True,
    }


def ensure_container() -> str:
    inner = (
        "set -e; export PATH=/usr/lib/postgresql/15/bin:$PATH; "
        "initdb -D /work/data -U postgres --auth-local=trust --auth-host=reject "
        "--encoding=UTF8 --locale=C >/work/initdb.log 2>&1; "
        "mkdir -p /work/socket; "
        'exec postgres -D /work/data -c listen_addresses="" '
        "-c unix_socket_directories=/work/socket -c fsync=off "
        "-c synchronous_commit=off"
    )
    proc = docker(
        "run", "-d",
        "--name", CONTAINER,
        "--label", LABEL,
        "--network", "none",
        "--memory", "768m", "--memory-swap", "768m", "--cpus", "1",
        "--tmpfs", "/work:rw,size=512m,mode=0777",
        "--no-healthcheck",
        "--user", "100:101",
        "--entrypoint", "/bin/bash",
        IMAGE_ID, "-c", "'" + inner + "'",
    )
    if proc.returncode != 0:
        raise StageError(f"docker run failed: {proc.stderr.decode(errors='replace')}")
    container_id = proc.stdout.decode().strip()

    for _ in range(60):
        ready = docker("exec", CONTAINER, "pg_isready", "-h", "/work/socket", "-U", "postgres")
        if ready.returncode == 0:
            break
        time.sleep(0.5)
    else:
        docker("rm", "-f", container_id)
        raise StageError("postgres did not become ready")

    try:
        identity_verified.update(verify_container(container_id))
    except Exception:
        docker("rm", "-f", container_id)
        raise
    return container_id


def verify_container(expected_id: str | None = None) -> dict[str, object]:
    def one(template: str) -> str:
        return docker_out("inspect", CONTAINER, "--format", "'" + template + "'")

    ident = {
        "id": one("{{.Id}}"),
        "label": one("{{index .Config.Labels \"3sm.test\"}}"),
        "image": one("{{.Image}}"),
        "user": one("{{.Config.User}}"),
        "entrypoint": one("{{json .Config.Entrypoint}}"),
        "network_mode": one("{{.HostConfig.NetworkMode}}"),
        "mounts": one("{{json .Mounts}}"),
        "binds": one("{{json .HostConfig.Binds}}"),
        "port_bindings": one("{{json .HostConfig.PortBindings}}"),
        "memory_bytes": one("{{.HostConfig.Memory}}"),
        "memory_swap_bytes": one("{{.HostConfig.MemorySwap}}"),
        "nano_cpus": one("{{.HostConfig.NanoCpus}}"),
        "tmpfs": one("{{json .HostConfig.Tmpfs}}"),
        "running": one("{{.State.Running}}"),
        "uid": docker_out("exec", CONTAINER, "id", "-u"),
        "gid": docker_out("exec", CONTAINER, "id", "-g"),
    }
    problems = []
    if expected_id and ident["id"] != expected_id:
        problems.append(f"container id {ident['id']} != {expected_id}")
    if ident["label"] != LABEL.split("=", 1)[1]:
        problems.append(f"label mismatch: {ident['label']!r}")
    if ident["image"] != IMAGE_ID:
        problems.append(f"image mismatch: {ident['image']!r}")
    if ident["network_mode"] != "none":
        problems.append(f"network mode {ident['network_mode']!r}")
    if ident["mounts"] != "[]" or ident["binds"] not in ("null", "[]"):
        problems.append(f"mounts/binds not empty: {ident['mounts']} / {ident['binds']}")
    if ident["port_bindings"] not in ("null", "{}", "map[]"):
        problems.append(f"port bindings present: {ident['port_bindings']}")
    if ident["user"] != "100:101" or ident["uid"] != "100" or ident["gid"] != "101":
        problems.append(f"unexpected user: {ident['user']} ({ident['uid']}:{ident['gid']})")
    if ident["memory_bytes"] != "805306368" or ident["memory_swap_bytes"] != "805306368":
        problems.append(f"memory limits wrong: {ident['memory_bytes']}/{ident['memory_swap_bytes']}")
    if ident["nano_cpus"] != "1000000000":
        problems.append(f"cpu limit wrong: {ident['nano_cpus']}")
    if ident["running"] != "true":
        problems.append("container is not running")
    if problems:
        raise StageError("container identity check failed: " + "; ".join(problems))
    return ident


def psql(db: str, sql: str, label: str, *, guard: str | None = None,
         single_transaction: bool = True, verify: bool = True) -> subprocess.CompletedProcess:
    if verify:
        verify_container(str(identity_verified.get("id", "")))
    payload = (guard or GUARD_TEST) + sql
    args = PSQL_BASE + (["-1"] if single_transaction else []) + ["-d", db]
    proc = _ssh_capture(args, payload.encode())
    LOGS.mkdir(parents=True, exist_ok=True)
    (LOGS / f"{label}.out.log").write_bytes(proc.stdout)
    (LOGS / f"{label}.err.log").write_bytes(proc.stderr)
    passes = len(re.findall(rb"PASS ", proc.stderr))
    executed.append({
        "label": label,
        "exit": proc.returncode,
        "pass_lines": passes,
        "stdout_bytes": len(proc.stdout),
        "stderr_tail": proc.stderr.decode(errors="replace").strip().splitlines()[-4:],
    })
    if proc.returncode != 0:
        raise StageError(
            f"stage {label} failed (exit {proc.returncode})\n"
            f"STDOUT:\n{proc.stdout.decode(errors='replace')[-4000:]}\n"
            f"STDERR:\n{proc.stderr.decode(errors='replace')[-6000:]}"
        )
    return proc


def psql_expect_failure(sql: str, label: str, needle: str) -> None:
    verify_container(str(identity_verified.get("id", "")))
    proc = _ssh_capture(PSQL_BASE + ["-1", "-d", DB], (GUARD_TEST + sql).encode())
    LOGS.mkdir(parents=True, exist_ok=True)
    (LOGS / f"{label}.out.log").write_bytes(proc.stdout)
    (LOGS / f"{label}.err.log").write_bytes(proc.stderr)
    text = proc.stderr.decode(errors="replace")
    if proc.returncode == 0 or needle not in text:
        raise StageError(
            f"stage {label}: expected failure containing {needle!r}, "
            f"exit={proc.returncode}\n{text[-3000:]}")
    executed.append({"label": label, "exit": proc.returncode, "pass_lines": 0,
                     "expected_failure": True, "stdout_bytes": len(proc.stdout),
                     "stderr_tail": text.strip().splitlines()[-2:]})


def concurrent(sql_a: str, sql_b: str, label: str) -> tuple[str, str]:
    verify_container(str(identity_verified.get("id", "")))
    args = SSH + PSQL_BASE + ["-d", DB]
    procs = [
        subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE)
        for _ in range(2)
    ]
    outs = []
    for proc, sql in zip(procs, (sql_a, sql_b)):
        out, err = proc.communicate((GUARD_TEST + sql).encode(), timeout=60)
        outs.append((out.decode(), err.decode()))
    LOGS.mkdir(parents=True, exist_ok=True)
    for i, (out, err) in enumerate(outs):
        (LOGS / f"{label}-{i}.out.log").write_text(out)
        (LOGS / f"{label}-{i}.err.log").write_text(err)
    if any(p.returncode != 0 for p in procs):
        raise StageError(f"stage {label} failed: {[p.returncode for p in procs]}\n"
                         f"{[e[-1500:] for _, e in outs]}")
    executed.append({"label": label, "exit": 0, "pass_lines": 0,
                     "concurrent_sessions": 2})
    return outs[0], outs[1]


def rebuild_database() -> None:
    psql("postgres", f"""
DO $drop$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = '{DB}') THEN
    PERFORM pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{DB}';
  END IF;
END $drop$;
DROP DATABASE IF EXISTS {DB};
DROP ROLE IF EXISTS pitwall_learning_worker;
CREATE DATABASE {DB};
""", "00-lifecycle", guard=GUARD_LIFECYCLE, single_transaction=False)


def identity_readback() -> dict[str, object]:
    proc = psql(DB, """
SELECT jsonb_build_object(
  'database', current_database(),
  'data_directory', current_setting('data_directory'),
  'inet_server_addr', inet_server_addr(),
  'server_version', current_setting('server_version'),
  'user', current_user,
  'session_user', session_user
);
""", "01-identity", single_transaction=False)
    return json.loads(proc.stdout.decode().strip().splitlines()[-1])


INVENTORY_SQL = """
SELECT jsonb_build_object(
  'functions', (SELECT coalesce(jsonb_object_agg(
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       md5(pg_get_functiondef(p.oid)) ORDER BY 1), '{}'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public','pitwall_learning')),
  'table_columns', (SELECT coalesce(jsonb_object_agg(t, c ORDER BY t), '{}'::jsonb)
    FROM (SELECT table_schema || '.' || table_name AS t, count(*) AS c
            FROM information_schema.columns
           WHERE table_schema IN ('public','pitwall_learning')
           GROUP BY 1) s),
  'row_counts', jsonb_build_object(
     'simhub_devices', (SELECT count(*) FROM public.simhub_devices),
     'account_policy', (SELECT count(*) FROM pitwall_learning.account_policy),
     'capture_batches', (SELECT count(*) FROM pitwall_learning.capture_batches),
     'jobs', (SELECT count(*) FROM pitwall_learning.jobs),
     'runtime_settings', (SELECT count(*) FROM pitwall_learning.runtime_settings)),
  'data_md5', jsonb_build_object(
     'devices', (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.simhub_devices t),
     'policies', (SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.owner_user_id), '')) FROM pitwall_learning.account_policy t)),
  'publisher_acl', (SELECT coalesce(jsonb_agg(jsonb_build_object(
       'grantee', a.grantee, 'privilege', a.privilege_type) ORDER BY a.grantee), '[]'::jsonb)
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = to_regprocedure('public.simhub_observation_policy_v1(text)'))
);
"""


def inventory(label: str) -> dict[str, Any]:
    proc = psql(DB, INVENTORY_SQL, label, single_transaction=False)
    return json.loads(proc.stdout.decode().strip().splitlines()[-1])


def publish_sha(paths: list[pathlib.Path]) -> dict[str, str]:
    return {str(p.relative_to(ROOT)): file_sha256(p) for p in paths}


def _wire_body(token: str, *, mode: str = "on", enabled: bool = True,
               available: bool = True, with_policy: bool = True) -> str:
    policy = (
        f"public.simhub_observation_policy_v1(repeat('{token}', 64))"
        if with_policy else "NULL::jsonb"
    )
    return (
        "jsonb_build_object("
        "'accepted', true,"
        "'receivedAt', '2026-11-14T00:00:00.000Z',"
        "'measurements', jsonb_build_object(),"
        "'aggregates', jsonb_build_object(),"
        "'observation', jsonb_build_object("
        f"'enabled', {'true' if enabled else 'false'},"
        f"'mode', '{mode}',"
        f"'available', {'true' if available else 'false'},"
        f"'policy', {policy}))"
    )


WIRE_CASES_SQL = """
SET request.jwt.claim.role = 'service_role';
SELECT jsonb_build_object('cases', jsonb_build_array(
  jsonb_build_object('label','A-allowed','mode','on','rpc','live','token_hash',repeat('a',64),
                     'response', %(a)s),
  jsonb_build_object('label','B-denied','mode','on','rpc','live','token_hash',repeat('b',64),
                     'response', %(b)s),
  jsonb_build_object('label','D-future-version','mode','on','rpc','live','token_hash',repeat('d',64),
                     'response', %(d)s),
  jsonb_build_object('label','revoked','mode','on','rpc','live','token_hash',repeat('e',64),
                     'response', %(e)s),
  jsonb_build_object('label','unknown','mode','on','rpc','live','token_hash',repeat('f',64),
                     'response', %(f)s),
  jsonb_build_object('label','missing-rpc','mode','on','rpc','missing','token_hash',repeat('a',64),
                     'response', %(a)s),
  jsonb_build_object('label','core-off','mode','off','rpc','live','token_hash',repeat('a',64),
                     'response', %(off)s)
));
""" % {
    "a": _wire_body("a"),
    "b": _wire_body("b"),
    "d": _wire_body("d"),
    "e": _wire_body("e"),
    "f": _wire_body("f"),
    "off": _wire_body("a", mode="off", enabled=False, available=False, with_policy=False),
}


DENO_BRIDGE = r"""
// S2E2 wire bridge: echte PG-policy-json -> echte Edge-composer.
// Geen netwerk, geen database, geen verzonnen rechten: de RPC-antwoorden komen
// uit het geëxporteerde PostgreSQL-resultaat.
import { maybeComposeObservationPolicy } from "file:///home/hermes/wt/pitwall-learning-p2-observation-policy-publisher/supabase/functions/_shared/observationPolicyV1.ts";

type WireCase = {
  label: string;
  mode: string;
  token_hash: string;
  rpc: "live" | "missing";
  response: Record<string, unknown> & { observation: Record<string, unknown> };
};

const inputPath = Deno.args[0];
const outputPath = Deno.args[1];
const parsed = JSON.parse(await Deno.readTextFile(inputPath)) as { cases: WireCase[] };
const out: Record<string, unknown>[] = [];

for (const item of parsed.cases) {
  let calls = 0;
  const raw = item.response.observation?.policy;
  const rpc = () => {
    calls += 1;
    if (item.rpc === "missing") {
      return { data: null, error: { code: "PGRST202", message: "missing function" } };
    }
    return { data: raw, error: null };
  };
  const policy = await maybeComposeObservationPolicy(item.mode, item.token_hash, rpc);
  const observation: Record<string, unknown> = {
    enabled: item.response.observation.enabled,
    mode: item.response.observation.mode,
    available: item.response.observation.available,
  };
  if (policy) observation.policy = policy;
  const response = {
    accepted: item.response.accepted,
    receivedAt: item.response.receivedAt,
    measurements: item.response.measurements,
    aggregates: item.response.aggregates,
    observation,
  };
  out.push({ label: item.label, mode: item.mode, calls, policy: policy ?? null, response });
}

await Deno.writeTextFile(outputPath, JSON.stringify({ cases: out }, null, 2) + "\n");
console.log(JSON.stringify(out.map((c) => ({ label: c.label, calls: c.calls, policy: c.policy }))));
"""


CSHARP_PROBE = r"""
using System;
using System.IO;
using ThreeSM.EnduranceConnector;

public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("usage: probe <response-json-file>");
            return 2;
        }
        string json = File.ReadAllText(args[0]);
        long version;
        string reason;
        bool ready = ObservationReadinessReader.TryRead(json, out version, out reason);
        Console.WriteLine("{\"ready\":" + (ready ? "true" : "false")
            + ",\"version\":" + version
            + ",\"reason\":\"" + reason + "\"}");
        return 0;
    }
}
"""


def run_wire_proof(pg_cases_path: pathlib.Path) -> dict[str, object]:
    work = WORK / "wire"
    work.mkdir(parents=True, exist_ok=True)
    cs_source_archive = pathlib.Path(
        "/home/hermes/artifacts/3sm/pitwall-learning-p2-observation-readiness-client-windows/"
        "pitwall-readiness-431d6c99.tar.gz"
    )
    if not cs_source_archive.exists():
        raise StageError(f"accepted C# source archive missing: {cs_source_archive}")

    source_dir = work / "cs-source"
    source_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(cs_source_archive, "r:gz") as archive:
        archive.extractall(source_dir, filter="data")

    tests_dir = source_dir / "tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests"
    build = subprocess.run(
        ["/home/hermes/.dotnet/dotnet", "build", "-c", "Release", "--nologo"],
        cwd=tests_dir, capture_output=True, timeout=300,
    )
    (work / "cs-build.log").write_bytes(build.stdout + build.stderr)
    if build.returncode != 0:
        raise StageError("accepted net8 assembly did not build: see work/wire/cs-build.log")
    assembly = tests_dir / "bin/Release/net8.0/3SM.EnduranceConnector.DiagnosticsTests.dll"

    probe_dir = work / "probe"
    probe_dir.mkdir(parents=True, exist_ok=True)
    (probe_dir / "probe.csproj").write_text(f"""<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>disable</ImplicitUsings>
    <Nullable>disable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <AssemblyName>ObservationReadinessWireProbe</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <Reference Include="3SM.EnduranceConnector.DiagnosticsTests">
      <HintPath>{assembly}</HintPath>
      <Private>true</Private>
    </Reference>
  </ItemGroup>
</Project>
""")
    (probe_dir / "Program.cs").write_text(CSHARP_PROBE)
    probe_build = subprocess.run(
        ["/home/hermes/.dotnet/dotnet", "build", "-c", "Release", "--nologo"],
        cwd=probe_dir, capture_output=True, timeout=300,
    )
    (work / "probe-build.log").write_bytes(probe_build.stdout + probe_build.stderr)
    if probe_build.returncode != 0:
        raise StageError("wire probe did not build: see work/wire/probe-build.log")

    # 1. Het exportbestand is al vóór de rollback uit de echte functie gemaakt.
    pg_cases = json.loads(pg_cases_path.read_text())
    if not pg_cases.get("cases"):
        raise StageError("PG wire export is empty")

    # 2. Echte Edge-composer met de PG-antwoorden als geïnjecteerde RPC.
    (work / "bridge.ts").write_text(DENO_BRIDGE)
    bridge = subprocess.run(
        ["/home/hermes/.deno/bin/deno", "run", "--no-remote", "--deny-net",
         "--allow-read", "--allow-write", str(work / "bridge.ts"),
         str(work / "pg-cases.json"), str(work / "composed.json")],
        capture_output=True, timeout=120,
    )
    (work / "bridge.log").write_bytes(bridge.stdout + bridge.stderr)
    if bridge.returncode != 0:
        raise StageError("Deno bridge failed: see work/wire/bridge.log")
    composed = json.loads((work / "composed.json").read_text())

    # 3. Echte C#-lezer (net8 assembly uit de geaccepteerde 431d-bron).
    results = []
    probe = probe_dir / "bin/Release/net8.0/ObservationReadinessWireProbe.dll"
    for case in composed["cases"]:
        response_file = work / f"response-{case['label']}.json"
        response_file.write_text(json.dumps(case["response"]))
        proc = subprocess.run(
            ["/home/hermes/.dotnet/dotnet", str(probe), str(response_file)],
            capture_output=True, timeout=60,
        )
        if proc.returncode != 0:
            raise StageError(f"C# probe failed for {case['label']}: {proc.stderr.decode()}")
        verdict = json.loads(proc.stdout.decode().strip())
        results.append({
            "label": case["label"],
            "composer_calls": case["calls"],
            "composer_policy": case["policy"],
            "csharp": verdict,
        })
    (work / "csharp-results.json").write_text(json.dumps(results, indent=2) + "\n")

    expected = {
        "A-allowed": {"ready": True, "version": 1, "reason": "ready", "calls": 1},
        "B-denied": {"ready": False, "version": 0, "reason": "policy_denied", "calls": 1},
        "D-future-version": {"ready": False, "version": 0,
                             "reason": "policy_version_unsupported", "calls": 1},
        "revoked": {"ready": False, "version": 0, "reason": "policy_denied", "calls": 1},
        "unknown": {"ready": False, "version": 0, "reason": "policy_denied", "calls": 1},
        "missing-rpc": {"ready": False, "version": 0, "reason": "policy_absent", "calls": 1},
        "core-off": {"ready": False, "version": 0, "reason": "receiver_disabled", "calls": 0},
    }
    for row in results:
        exp = expected[row["label"]]
        got = row["csharp"]
        if (got["ready"] != exp["ready"] or got["reason"] != exp["reason"]
                or got["version"] != exp["version"] or row["composer_calls"] != exp["calls"]):
            raise StageError(f"wire mismatch for {row['label']}: {row} != {exp}")
    executed.append({"label": "09b-wire-cross-language", "exit": 0,
                     "cases": len(results), "pass_lines": len(results)})
    return {
        "source_archive": str(cs_source_archive),
        "source_archive_sha256": file_sha256(cs_source_archive),
        "net8_assembly": str(assembly),
        "net8_assembly_sha256": file_sha256(assembly),
        "probe_assembly_sha256": file_sha256(probe) if probe.exists() else None,
        "cases": results,
        "deno_bridge_log": str(work / "bridge.log"),
    }


def main() -> int:
    ART.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    os.chmod(ART, 0o700)
    os.chmod(LOGS, 0o700)

    container_id = None
    try:
        pre = preflight()
        (ART / "preflight.json").write_text(json.dumps(pre, indent=2) + "\n")

        container_id = ensure_container()
        rebuild_database()
        identity = identity_readback()

        parts = []
        for path in [BASELINE_FIXTURE, STUB, *CHAIN]:
            parts.append(f"-- ===== {path.name} =====\n{path.read_text()}")
        psql(DB, "\n\n".join(parts), "02-baseline")
        psql(DB, SEED_FIXTURE.read_text(), "02b-seed")
        psql(DB, PRE_TEST.read_text(), "03-pre")

        before = inventory("04a-inventory-before-forward")
        psql(DB, MIGRATION.read_text(), "05-forward")
        psql_expect_failure(
            MIGRATION.read_text(), "05b-forward-reapply-refused",
            "already exists; refusing to adopt it")
        after_forward = inventory("06a-inventory-after-forward")

        forward_diff = {
            "added": sorted(set(after_forward["functions"]) - set(before["functions"])),
            "removed": sorted(set(before["functions"]) - set(after_forward["functions"])),
            "changed": sorted(
                key for key in set(before["functions"]) & set(after_forward["functions"])
                if before["functions"][key] != after_forward["functions"][key]
            ),
            "columns_changed": before["table_columns"] != after_forward["table_columns"],
            "row_counts_equal": before["row_counts"] == after_forward["row_counts"],
            "data_md5_equal": before["data_md5"] == after_forward["data_md5"],
        }
        added = forward_diff["added"]
        if len(added) != 1 or not added[0].startswith(
                "public.simhub_observation_policy_v1("):
            raise StageError(f"forward added unexpected objects: {forward_diff}")
        if forward_diff["removed"] or forward_diff["changed"]:
            raise StageError(f"forward changed/removed objects: {forward_diff}")
        if forward_diff["columns_changed"] or not forward_diff["row_counts_equal"] \
                or not forward_diff["data_md5_equal"]:
            raise StageError(f"forward changed data/schema: {forward_diff}")

        psql(DB, FORWARD_TEST.read_text(), "06b-forward-tests", single_transaction=False)

        # Claim is transaction-local: na COMMIT lekt hij niet door.
        claim = psql(DB, """BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';
SELECT public.simhub_observation_policy_v1(repeat('a',64))::text;
COMMIT;
SELECT jsonb_build_object(
  'claim', coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '<null>'),
  'auth_role', auth.role())::text;
""", "06c-claim-transaction-local", single_transaction=False)
        lines = [line for line in claim.stdout.decode().strip().splitlines() if line]
        if not lines or '"captureAllowed": true' not in lines[0]:
            raise StageError(f"unexpected claim-stage result: {lines}")
        after = json.loads(lines[-1])
        if after.get("claim") != "<null>" or after.get("auth_role") != "anon":
            raise StageError(f"SET LOCAL claim leaked after commit: {after}")

        # Echte gelijktijdige sessies: service_role allowed, anon denied.
        a, b = concurrent(
            """SET request.jwt.claim.role = 'service_role';
DO $x$ BEGIN
  IF public.simhub_observation_policy_v1(repeat('a',64))->>'captureAllowed' <> 'true' THEN
    RAISE EXCEPTION 'service session not allowed';
  END IF;
  RAISE NOTICE 'PASS concurrent service_role allowed';
END $x$;
""",
            """SET ROLE anon;
DO $x$ BEGIN
  BEGIN
    PERFORM public.simhub_observation_policy_v1(repeat('a',64));
    RAISE EXCEPTION 'anon session unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS concurrent anon denied';
  END;
END $x$;
""",
            "06d-concurrent-roles",
        )
        if "PASS concurrent service_role allowed" not in a[1] \
                or "PASS concurrent anon denied" not in b[1]:
            raise StageError(f"concurrent role matrix did not both pass: {a[1][-500:]} | {b[1][-500:]}")

        # Echte PG-policy-json vastleggen zolang de functie nog bestaat.
        (WORK / "wire").mkdir(parents=True, exist_ok=True)
        raw = psql(DB, WIRE_CASES_SQL, "06e-wire-pg-export", single_transaction=False)
        pg_cases_path = WORK / "wire/pg-cases.json"
        pg_cases_path.write_text(
            json.dumps(json.loads(raw.stdout.decode().strip().splitlines()[-1]), indent=2) + "\n"
        )

        rolled = psql(DB, ROLLBACK.read_text(), "07-rollback", single_transaction=True)
        psql(DB, ROLLBACK.read_text(), "07b-rollback-reapply", single_transaction=True)
        psql(DB, POST_TEST.read_text(), "08-post-rollback", single_transaction=False)
        after_rollback = inventory("08b-inventory-after-rollback")

        if after_rollback["functions"] != before["functions"]:
            raise StageError("rollback did not restore the pre-forward function set")
        if after_rollback["table_columns"] != before["table_columns"]:
            raise StageError("rollback changed columns")
        if after_rollback["row_counts"] != before["row_counts"]:
            raise StageError("rollback changed row counts")
        if after_rollback["data_md5"] != before["data_md5"]:
            raise StageError("rollback changed data")
        if after_rollback["publisher_acl"]:
            raise StageError("publisher ACL rows survived the rollback")

        wire = run_wire_proof(pg_cases_path)

        report = {
            "task": "S2E2 observation policy publisher",
            "base": "648996af2f617ee465e02983acca770706f82767",
            "container": CONTAINER,
            "container_id": container_id,
            "database": DB,
            "identity": identity,
            "limits": verify_container(container_id),
            "preflight": pre,
            "chain_scope": CHAIN_SCOPE,
            "chain_files": [str(p.relative_to(ROOT)) for p in CHAIN],
            "stages": executed,
            "pass_lines_total": sum(int(str(e.get("pass_lines", 0))) for e in executed),
            "hashes": publish_sha([
                MIGRATION, ROLLBACK, BASELINE_FIXTURE, SEED_FIXTURE, STUB, PRE_TEST,
                FORWARD_TEST, POST_TEST, COMPOSER,
            ]),
            "inventory_before_forward": before,
            "inventory_after_forward": after_forward,
            "inventory_after_rollback": after_rollback,
            "forward_diff": forward_diff,
            "wire_proof": wire,
            "container_left_running_for_parent_readback": True,
        }
        (ART / "run.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({
            "container_id": container_id,
            "database": DB,
            "pass_lines_total": report["pass_lines_total"],
            "wire_cases": len(wire["cases"]),
            "stages": [e["label"] for e in executed],
        }, indent=2))
        return 0
    except Exception as exc:  # noqa: BLE001 - honest bounded failure
        import traceback
        error = {"error": str(exc), "container_id": container_id,
                 "traceback": traceback.format_exc()}
        (ART / "run-error.json").write_text(json.dumps(error, indent=2) + "\n")
        print(json.dumps(error, indent=2), file=sys.stderr)
        # Ruim alleen DEZE, geverifieerde container op.
        if container_id:
            probe = docker("inspect", CONTAINER, "--format", "{{.Id}}")
            if probe.returncode == 0 and probe.stdout.decode().strip() == container_id:
                docker("rm", "-f", CONTAINER)
        return 1


if __name__ == "__main__":
    sys.exit(main())
