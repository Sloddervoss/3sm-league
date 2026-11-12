#!/usr/bin/env python3
"""T13-S1 — geïsoleerde PostgreSQL-rehearsal voor observation capture.

Harde, niet overrideerbare route:
  ssh -o BatchMode=yes 3sm-docker
    docker exec -i pitwall-learning-p2-observation-s1
      psql -X -q -v ON_ERROR_STOP=1 -h /work/socket -U postgres
           -d pitwall_learning_p2_observation_s1

Container: één disposable container, exacte naam, --network none, geen poorten,
geen hostmounts, 768 MiB / 1 CPU, tmpfs /work <= 512 MiB, cached image
supabase/postgres:15.19.0.004 by id, entrypoint override naar bare initdb +
postgres (niet de Supabase-entrypoint), user postgres, trust alleen op de
Unix-socket, listen_addresses = ''.

Elke muterende stream start met een identiteitsguard:
current_database exact, data_directory = /work/data, inet_server_addr() IS NULL.
Er is geen env- of CLI-override: het script doet altijd dezelfde route.

Exit 0 betekent: alle stages geslaagd. De container blijft draaien zodat de
ouder het handle kan verifiëren; bij een fout wordt alleen DEZE container
opgeruimd.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
# De oude reviewer-root blijft bevroren. Deze reparatieronde schrijft alleen
# naar de nieuwe bewijsroot; een expliciete env-override blijft mogelijk.
ART = pathlib.Path(os.environ.get(
    "PITWALL_T13_ART",
    "/home/hermes/artifacts/3sm/pitwall-learning-p2-observation-server-evidence",
))
LOGS = ART / "logs"

CONTAINER = "pitwall-learning-p2-observation-s1"
DB = "pitwall_learning_p2_observation_s1"
IMAGE_ID = "1aabcd9cfb8a"
SSH = ["ssh", "-o", "BatchMode=yes", "3sm-docker"]
PSQL_BASE = [
    "docker", "exec", "-i", CONTAINER, "psql",
    "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-h", "/work/socket", "-U", "postgres",
]

MIGRATION = ROOT / "supabase/migrations/20261112134500_pitwall_learning_observation_capture.sql"
ROLLBACK = ROOT / "supabase/rollbacks/20261112134500_pitwall_learning_observation_capture.sql"
BASELINE_FIXTURE = ROOT / "supabase/tests/fixtures/pitwall-learning-p2-observation-baseline.sql"
STUB = ROOT / "supabase/tests/fixtures/plugin08_stub_schema.sql"
PRE_TEST = ROOT / "supabase/tests/pitwall-learning-observation-pre.sql"
CAPTURE_TEST = ROOT / "supabase/tests/pitwall-learning-observation-capture.sql"
ROLE_TEST = ROOT / "supabase/tests/pitwall-learning-observation-role-null.sql"
POST_TEST = ROOT / "supabase/tests/pitwall-learning-observation-post-rollback.sql"
LATEST_OUTER_WRAPPER = ROOT / "supabase/migrations/20261110231000_pitwall_pace_storage.sql"

CHAIN = sorted((ROOT / "supabase/migrations").glob("2026103118*.sql"))
CHAIN += sorted((ROOT / "supabase/migrations").glob("2026103119*.sql"))
CHAIN += sorted((ROOT / "supabase/migrations").glob("2026103120*.sql"))
CHAIN.append(ROOT / "supabase/migrations/20261111163052_pitwall_learning_evidence.sql")

# Eerlijke scope-label voor de harness: de T13-writer/hash-bodies zijn de
# actuele 20261031200500-versies, maar de buitenste persist_v3-wrapper uit
# 20261110231000 vereist het volledige PACE-schema en past niet op deze
# T13-fixture. We claimen daarom NIET dat de oude wrapper de nieuwste is.
CHAIN_SCOPE = {
    "label": "older_wrapper_fixture",
    "batch_writer_under_test": "public.simhub_persist_measurement_batch from 20261031200500",
    "outer_wrapper_in_db": "simhub_persist_v3 fixture from an older migration",
    "omitted": [
        "20261101113047_pace_capture.sql",
        "20261110231000_pitwall_pace_storage.sql",
    ],
    "reason": "full PACE schema prerequisites are outside the T13-S1 fixture",
    "current_rpc_case": "role/null test calls the actual simhub_persist_measurement_batch RPC as service_role",
}

CURRENT_BATCH_DISPATCH = (
    "v_agg_ack := public.simhub_persist_measurement_batch"
    "(d.id, p_session_id, p_events, p_laps);"
)

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


def _ssh_capture(args: list[str], stdin: bytes | None = None, timeout: int = 300):
    return subprocess.run(SSH + args, input=stdin, capture_output=True, timeout=timeout)


def psql(db: str, sql: str, label: str, *, guard: str | None = None,
         single_transaction: bool = True) -> subprocess.CompletedProcess:
    """One psql stream with the identity guard first. Never TCP."""
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
        "stderr_tail": proc.stderr.decode(errors="replace").strip().splitlines()[-3:],
    })
    if proc.returncode != 0:
        raise SystemExit(
            f"stage {label} failed (exit {proc.returncode})\n"
            f"STDOUT:\n{proc.stdout.decode(errors='replace')[-4000:]}\n"
            f"STDERR:\n{proc.stderr.decode(errors='replace')[-6000:]}"
        )
    return proc


def psql_expect_failure(sql: str, label: str, needle: str) -> None:
    """A stream that MUST fail, with a fixed diagnostic (guards/refusals)."""
    payload = (GUARD_TEST + sql).encode()
    proc = _ssh_capture(PSQL_BASE + ["-1", "-d", DB], payload)
    LOGS.mkdir(parents=True, exist_ok=True)
    (LOGS / f"{label}.out.log").write_bytes(proc.stdout)
    (LOGS / f"{label}.err.log").write_bytes(proc.stderr)
    text = proc.stderr.decode(errors="replace")
    if proc.returncode == 0 or needle not in text:
        raise SystemExit(
            f"stage {label}: expected failure containing {needle!r}, "
            f"exit={proc.returncode}\n{text[-3000:]}")
    executed.append({"label": label, "exit": proc.returncode, "pass_lines": 0,
                     "expected_failure": True, "stdout_bytes": len(proc.stdout),
                     "stderr_tail": text.strip().splitlines()[-2:]})


def concurrent(sql_a: str, sql_b: str, label: str) -> tuple[str, str]:
    """Two independent psql sessions, both starting with the identity guard."""
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
        raise SystemExit(f"stage {label} failed: {[p.returncode for p in procs]}\n"
                         f"{[e[-1500:] for _, e in outs]}")
    executed.append({"label": label, "exit": 0, "pass_lines": 0,
                     "concurrent_sessions": 2})
    return outs[0][0], outs[1][0]


def docker(*args: str) -> subprocess.CompletedProcess:
    return _ssh_capture(["docker", *args])


def ensure_container() -> str:
    names = docker("ps", "-a", "--format", "{{.Names}}").stdout.decode().split()
    if CONTAINER in names:
        # Losse formats: ssh voegt argumenten samen, dus geen pipes/spaties in
        # één template.
        running = docker("inspect", CONTAINER, "--format", "{{.State.Running}}").stdout.decode().strip()
        image = docker("inspect", CONTAINER, "--format", "{{.Config.Image}}").stdout.decode().strip()
        net = docker("inspect", CONTAINER, "--format", "{{.HostConfig.NetworkMode}}").stdout.decode().strip()
        user = docker("inspect", CONTAINER, "--format", "{{.Config.User}}").stdout.decode().strip()
        if running != "true" or net != "none" or user != "postgres" or IMAGE_ID not in image:
            # Rest van een mislukte start: exact deze testcontainer opruimen en
            # opnieuw opbouwen. Nooit een andere container aanraken.
            docker("rm", "-f", CONTAINER)
        else:
            return docker("inspect", CONTAINER, "--format", "{{.Id}}").stdout.decode().strip()
    image = docker("image", "inspect", IMAGE_ID, "--format", "{{.Id}}").stdout.decode().strip()
    if not image:
        raise SystemExit("cached image is missing; refusing to pull")

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
        "--network", "none",
        "--memory", "768m", "--memory-swap", "768m", "--cpus", "1",
        "--tmpfs", "/work:rw,size=512m,mode=0777",
        "--no-healthcheck",
        "--user", "postgres",
        "--entrypoint", "/bin/bash",
        # ssh voegt argumenten samen zonder te quoten; de remote shell moet de
        # scripttekst als één argument aan `bash -c` geven.
        IMAGE_ID, "-c", "'" + inner + "'",
    )
    if proc.returncode != 0:
        docker("rm", "-f", CONTAINER)
        raise SystemExit(f"docker run failed: {proc.stderr.decode()}")
    container_id = proc.stdout.decode().strip()

    for _ in range(60):
        ready = docker("exec", CONTAINER, "pg_isready", "-h", "/work/socket", "-U", "postgres")
        if ready.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise SystemExit("postgres did not become ready")
    return container_id


def container_limits() -> dict[str, object]:
    """Read-only bewijs van de opgelegde grenzen (geen aanname)."""
    def one(template: str) -> str:
        return docker("inspect", CONTAINER, "--format", template).stdout.decode().strip()

    return {
        "id": one("{{.Id}}"),
        "image": one("{{.Config.Image}}"),
        "user": one("{{.Config.User}}"),
        "network_mode": one("{{.HostConfig.NetworkMode}}"),
        "memory_bytes": one("{{.HostConfig.Memory}}"),
        "memory_swap_bytes": one("{{.HostConfig.MemorySwap}}"),
        "nano_cpus": one("{{.HostConfig.NanoCpus}}"),
        "tmpfs": one("{{.HostConfig.Tmpfs}}"),
        "port_bindings": one("{{.HostConfig.PortBindings}}"),
        "binds": one("{{.HostConfig.Binds}}"),
        "readonly_rootfs": one("{{.HostConfig.ReadonlyRootfs}}"),
        "healthcheck": one("{{.Config.Healthcheck}}"),
        "running": one("{{.State.Running}}"),
    }


def rebuild_database() -> None:
    psql("postgres", f"""
DO $drop$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = '{DB}') THEN
    PERFORM pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{DB}';
  END IF;
END $drop$;
DROP DATABASE IF EXISTS {DB};
-- De P1-workerrol is cluster-globaal, niet per database. Deze container is
-- uitsluitend van deze rehearsal, dus de rol wordt mee opgeruimd.
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


def object_inventory(label: str) -> dict[str, object]:
    sql = """
SELECT jsonb_build_object(
  'column', (SELECT jsonb_build_object(
      'type', data_type, 'nullable', is_nullable, 'storage', (
        SELECT attstorage::text FROM pg_attribute
         WHERE attrelid = 'public.simhub_lap_summaries'::regclass
           AND attname = 'observation'))
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='simhub_lap_summaries'
     AND column_name='observation'),
  'constraints', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', conname, 'def', pg_get_constraintdef(oid)) ORDER BY conname), '[]'::jsonb)
    FROM pg_constraint WHERE conrelid='public.simhub_lap_summaries'::regclass
      AND conname LIKE '%observation%'),
  'flag', (SELECT observation_enabled FROM pitwall_learning.runtime_settings WHERE id=1),
  'flags', (SELECT jsonb_build_object(
      'observation_enabled', observation_enabled,
      'capture_enabled', capture_enabled)
    FROM pitwall_learning.runtime_settings WHERE id=1),
  'functions', (SELECT coalesce(jsonb_agg(p.proname || '(' ||
        pg_get_function_identity_arguments(p.oid) || ')' ORDER BY p.proname), '[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname IN (
     'simhub_observation_v1_valid','simhub_observation_text_valid',
     'simhub_observation_ts_valid','simhub_observation_ts_le',
     'simhub_observation_row_disposition','simhub_lap_row_hash_v2',
     'simhub_observation_capture_enabled','simhub_observation_v1_available')),
  'row_counts', jsonb_build_object(
     'lap_summaries', (SELECT count(*) FROM public.simhub_lap_summaries),
     'observation_rows', (SELECT count(*) FROM public.simhub_lap_summaries WHERE observation IS NOT NULL),
     'capture_batches', (SELECT count(*) FROM pitwall_learning.capture_batches),
     'source_revisions', (SELECT count(*) FROM pitwall_learning.source_revisions)),
  'grants', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'role', grantee, 'privilege', privilege_type)), '[]'::jsonb)
    FROM information_schema.role_routine_grants
   WHERE routine_schema='public'
     AND routine_name IN ('simhub_observation_v1_available',
                          'simhub_observation_capture_enabled',
                          'simhub_persist_measurement_batch'))
);
"""
    proc = psql(DB, sql, label, single_transaction=False)
    return json.loads(proc.stdout.decode().strip().splitlines()[-1])


def _obs_json(refuel: float) -> dict:
    return {
        "version": 1,
        "capture": {"deviceId": "d0000000-0000-4000-8000-0000000000a1"},
        "interval": {
            "firstSampleAt": "2026-11-12T10:00:00.050Z",
            "lastSampleAt": "2026-11-12T10:01:39.950Z",
            "samples": 41, "maxGapSeconds": 0.5, "unknownSeconds": 0.1,
            "edgeBeforeSeconds": 0.05, "edgeAfterSeconds": 0.05,
        },
        "refuel": {
            "observedAddedLitres": refuel,
            "firstAt": "2026-11-12T10:00:10.000Z",
            "positiveSteps": 2, "resolutionLitres": 0.01,
        },
        "context": {"carId": "1321", "trackId": 42,
                    "trackName": "Spa", "trackConfig": "Endurance"},
    }


def _race_row(uid: str, lap: int, rev: int, observation: dict | None) -> dict:
    row = {
        "summaryUid": uid, "summaryId": f"T13-RACE-{lap}", "segmentId": "segment-1",
        "observedSessionId": "session-1", "lapNumber": lap,
        "startedAt": "2026-11-12T10:00:00.000Z",
        "endedAt": "2026-11-12T10:01:40.000Z",
        "currentDriverName": "Test Driver", "aggregationVersion": 1,
        "recordRevision": rev, "complete": False, "pitLap": False,
        "driverChanged": False,
    }
    if observation is not None:
        row["observation"] = observation
    return row


def _race_sql(row: dict) -> str:
    payload = json.dumps([row], separators=(",", ":"))
    return (
        "SET request.jwt.claim.role = 'service_role';\n"
        "SELECT pg_sleep(0.25);\n"
        "SELECT public.simhub_persist_measurement_batch("
        "'d0000000-0000-4000-8000-0000000000a1', 'session-1', NULL, "
        f"$race${payload}$race$::jsonb)::text;\n"
    )


def run_concurrency_stage() -> None:
    """Twee echte sessies: gelijktijdige retry en gelijktijdige revisies.

    De bestaande schrijver lost dit op met het set-based snelpad plus de
    rij-voor-rij terugval; deze test bewijst dat de observation-kolom en hash
    dat pad niet breken.
    """
    psql(DB, "SET request.jwt.claim.role = 'service_role';"
             "UPDATE pitwall_learning.runtime_settings SET observation_enabled = true WHERE id = 1;"
             "UPDATE pitwall_learning.runtime_settings SET capture_enabled = false WHERE id = 1;",
         "06b-concurrency-arm")

    retry_uid = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee"
    obs = _obs_json(2.4)
    a, b = concurrent(_race_sql(_race_row(retry_uid, 40, 1, obs)),
                      _race_sql(_race_row(retry_uid, 40, 1, obs)),
                      "06c-concurrent-retry")
    def ack_kind(text: str) -> str:
        data = json.loads(text.strip().splitlines()[-1])
        if data["laps"]["accepted"]:
            return "accepted"
        if data["laps"]["duplicates"]:
            return "duplicate"
        if data["laps"]["rejected"]:
            return "rejected:" + str(data["laps"]["rejected"][0].get("reason"))
        return "other"

    kinds = sorted((ack_kind(a), ack_kind(b)))
    if kinds != ["accepted", "duplicate"]:
        raise SystemExit(f"concurrent retry resolved to {kinds}:\n{a}\n{b}")

    rev_uid = "eeeeeeee-2222-4222-8222-eeeeeeeeeeee"
    a, b = concurrent(_race_sql(_race_row(rev_uid, 41, 1, _obs_json(2.4))),
                      _race_sql(_race_row(rev_uid, 41, 2, _obs_json(3.7))),
                      "06d-concurrent-revision")

    check = f"""
SELECT jsonb_build_object(
  'retry_rows', (SELECT count(*) FROM public.simhub_lap_summaries WHERE summary_uid = '{retry_uid}'),
  'retry_obs', (SELECT observation->'refuel'->>'observedAddedLitres' FROM public.simhub_lap_summaries WHERE summary_uid = '{retry_uid}'),
  'retry_hash_ok', (SELECT content_hash = public.simhub_lap_row_hash_v2(l) FROM public.simhub_lap_summaries l WHERE summary_uid = '{retry_uid}'),
  'rev_rows', (SELECT count(*) FROM public.simhub_lap_summaries WHERE summary_uid = '{rev_uid}'),
  'rev_rev', (SELECT record_revision FROM public.simhub_lap_summaries WHERE summary_uid = '{rev_uid}'),
  'rev_obs', (SELECT observation->'refuel'->>'observedAddedLitres' FROM public.simhub_lap_summaries WHERE summary_uid = '{rev_uid}'),
  'rev_hash_ok', (SELECT content_hash = public.simhub_lap_row_hash_v2(l) FROM public.simhub_lap_summaries l WHERE summary_uid = '{rev_uid}')
);
"""
    proc = psql(DB, check, "06e-concurrent-verify", single_transaction=False)
    result = json.loads(proc.stdout.decode().strip().splitlines()[-1])
    expected = {
        "retry_rows": 1, "retry_obs": "2.4", "retry_hash_ok": True,
        "rev_rows": 1, "rev_rev": 2, "rev_obs": "3.7", "rev_hash_ok": True,
    }
    if result != expected:
        raise SystemExit(f"concurrent verification mismatch: {result} != {expected}")
    executed[-1]["pass_lines"] = 7
    executed[-1]["detail"] = result


def current_wrapper_dispatch_check() -> dict[str, object]:
    """Bewijs dat de nieuwste wrapper nog steeds dezelfde batchdispatch heeft.

    De wrapper wordt niet toegepast (PACE-schema buiten scope), maar de
    aanroepregel in de canonieke migratie moet onveranderd zijn. Anders zou de
    functionele batchtest hieronder niet op de actuele dispatch lijken.
    """
    text = LATEST_OUTER_WRAPPER.read_text()
    present = CURRENT_BATCH_DISPATCH in text
    if not present:
        raise SystemExit(
            "current persist_v3 wrapper no longer dispatches the expected batch call")
    return {
        "file": str(LATEST_OUTER_WRAPPER.relative_to(ROOT)),
        "dispatch_present": present,
        "dispatch": CURRENT_BATCH_DISPATCH,
    }


def forward_state() -> dict[str, object]:
    """Readback van de werkelijke objecten, niet alleen aantallen."""
    sql = """
SELECT jsonb_build_object(
  'flag', (SELECT observation_enabled FROM pitwall_learning.runtime_settings WHERE id=1),
  'flags', (SELECT jsonb_build_object(
      'observation_enabled', observation_enabled,
      'capture_enabled', capture_enabled)
    FROM pitwall_learning.runtime_settings WHERE id=1),
  'column', (SELECT jsonb_build_object('type', atttypid::regtype::text,
                                       'nullable', NOT attnotnull,
                                       'storage', attstorage::text)
               FROM pg_attribute
              WHERE attrelid='public.simhub_lap_summaries'::regclass
                AND attname='observation'),
  'writer_gates', (SELECT jsonb_object_agg(p.proname, jsonb_build_object(
      'row_gate', position('simhub_observation_row_disposition' in pg_get_functiondef(p.oid)) > 0,
      'v2_hash', position('simhub_lap_row_hash_v2' in pg_get_functiondef(p.oid)) > 0,
      'off_gate', position('observation_unavailable' in pg_get_functiondef(p.oid)) > 0))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN
     ('simhub_persist_measurement_batch','simhub_apply_lap_row')),
  'p1_projection', (SELECT jsonb_object_agg(p.proname,
      pg_get_functiondef(p.oid) LIKE '%''observation'', n.observation%')
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='pitwall_learning' AND p.proname LIKE 'capture_lap_summaries_%'),
  'function_md5', (SELECT jsonb_object_agg(p.proname || '(' ||
      pg_get_function_identity_arguments(p.oid) || ')',
      md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN (
     'simhub_observation_v1_valid','simhub_observation_text_valid',
     'simhub_observation_ts_valid','simhub_observation_ts_le',
     'simhub_observation_row_disposition','simhub_lap_row_hash_v2',
     'simhub_observation_capture_enabled','simhub_observation_v1_available'))
);
"""
    proc = psql(DB, sql, "05b-forward-object-readback", single_transaction=False)
    return json.loads(proc.stdout.decode().strip().splitlines()[-1])


def main() -> int:
    ART.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    os.chmod(ART, 0o700)
    os.chmod(LOGS, 0o700)

    container_id = ensure_container()
    rebuild_database()
    identity = identity_readback()

    # Baseline: fixture + stub + de bevroren migratieketen, atomair.
    parts = []
    for path in [BASELINE_FIXTURE, STUB, *CHAIN]:
        parts.append(f"-- ===== {path.name} =====\n{path.read_text()}")
    psql(DB, "\n\n".join(parts), "02-baseline")

    psql(DB, PRE_TEST.read_text(), "03-pre")
    psql(DB, MIGRATION.read_text(), "04-forward")
    # De forward-guard moet een tweede toepassing weigeren: nooit stil adopteren.
    psql_expect_failure(
        MIGRATION.read_text(), "04b-forward-reapply-refused",
        "already exists; refusing to adopt it")
    before = object_inventory("05-inventory-after-forward")
    state = forward_state()
    psql(DB, CAPTURE_TEST.read_text(), "06-capture-tests")
    run_concurrency_stage()
    psql(DB, ROLE_TEST.read_text(), "06f-role-null-matrix")
    psql(DB, ROLLBACK.read_text(), "07-rollback")
    # De rollback is idempotent: een tweede keer mag niets kapotmaken.
    psql(DB, ROLLBACK.read_text(), "07b-rollback-reapply")
    psql(DB, POST_TEST.read_text(), "08-post-rollback")
    after = object_inventory("09-inventory-after-rollback")

    total_passes = sum(int(str(e["pass_lines"])) for e in executed)
    report = {
        "container": CONTAINER,
        "container_id": container_id,
        "limits": container_limits(),
        "image": IMAGE_ID,
        "identity": identity,
        "chain_scope": CHAIN_SCOPE,
        "current_wrapper_dispatch": current_wrapper_dispatch_check(),
        "stages": executed,
        "pass_lines_total": total_passes,
        "inventory_after_forward": before,
        "forward_state": state,
        "inventory_after_rollback": after,
    }
    (ART / "run.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
