#!/usr/bin/env python3
"""One-shot, pre-registered 200-round controlled P1 performance measurement.

This driver is deliberately separate from ``rehearse-p1.py``. It imports the
already-reviewed helpers (``_measure_block``, ``_parse_perf``,
``measurement_contract_errors``, ``classify_gate`` and
``calibrated_phase_orders``) without changing them, and only adds:

  * a committed protocol/hash that must exist before any database call;
  * exact container identity, label, network and resource guards;
  * 200 rounds / 20 ten-order cycles / 1000 measured samples;
  * a rotating per-cycle order start so the ten-round maintenance boundary is
    not always followed by the same phase position;
  * full raw sample fields, per-round cgroup/Postgres resource snapshots and
    guarded maintenance outside every clocked RPC window;
  * a diagnostic bootstrap interval that never replaces the p95 gate.

No production container, database or network route is reachable from the
hard-coded command. The only database is the explicitly named private clone.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import platform
import random
import re
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Unchanged reviewed helpers
# ---------------------------------------------------------------------------
REHEARSE_PATH = Path(__file__).resolve().with_name("rehearse-p1.py")
_spec = importlib.util.spec_from_file_location("pitwall_rehearse_p1", REHEARSE_PATH)
if _spec is None or _spec.loader is None:  # pragma: no cover - import guard
    raise RuntimeError(f"cannot load {REHEARSE_PATH}")
rehearse = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rehearse)

REPO = Path(__file__).resolve().parents[2]
DEFAULT_PROTOCOL = (REPO / "docs/operations"
                    / "pitwall-learning-p1-controlled-perf-protocol.json")

PHASES = ["absent", "absent_aa", "off", "off_aa", "on"]
ROUNDS = 200
CYCLES = 20
ORDERS_PER_CYCLE = 10
WARMUPS_PER_PHASE = 3
MEASURED_SAMPLES = ROUNDS * len(PHASES)
TOTAL_RPCS = MEASURED_SAMPLES + WARMUPS_PER_PHASE * ROUNDS * len(PHASES)
MAINTENANCE_INTERVAL = 10

DB = "pitwall_learning_p1_rehearsal"
DATA_DIRECTORY = "/work/data"
SOCKET_DIRECTORY = "/work"
CONTAINER_NAME = "pitwall-learning-p1-controlled-20261111"
CONTAINER_LABEL_KEY = "3sm.test"
CONTAINER_LABEL_VALUE = "pitwall-learning-p1-controlled"
IMAGE = "supabase/postgres:15.19.0.004"
IMAGE_ID = ("sha256:1aabcd9cfb8a58ecde50a6092b207bcbb5f6bdc45546fde35cfda5d3ab39c065")
MEMORY_BYTES = 512 * 1024 * 1024
NANO_CPUS = 1_000_000_000
PIDS_LIMIT = 64
TMPFS_BYTES = 384 * 1024 * 1024

SSH = ["ssh", "-o", "BatchMode=yes", "3sm-docker"]
PSQL = [
    "docker", "exec", "-i", "{container}", "psql",
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
    "-h", SOCKET_DIRECTORY, "-U", "postgres", "-d", DB,
]

STRICT_GUARD = f"""DO $guard$ BEGIN
  IF current_database() <> '{DB}'
     OR current_setting('data_directory') <> '{DATA_DIRECTORY}'
     OR current_setting('unix_socket_directories') <> '{SOCKET_DIRECTORY}'
     OR current_user <> 'postgres'
     OR inet_server_addr() IS NOT NULL THEN
    RAISE EXCEPTION 'CONTROLLED PERF GUARD: wrong database, data_directory, socket, user or TCP connection';
  END IF;
END $guard$;
"""

MAINTENANCE_COMMANDS = [
    ("GUARD: current_database()=pitwall_learning_p1_rehearsal AND "
     "data_directory=/work/data AND unix_socket_directories=/work AND "
     "current_user=postgres"),
    "VACUUM (ANALYZE) public.simhub_measurement_events;",
    "VACUUM (ANALYZE) public.simhub_lap_summaries;",
    "VACUUM (ANALYZE) pitwall_learning.capture_batches;",
    "VACUUM (ANALYZE) pitwall_learning.source_revisions;",
    "VACUUM (ANALYZE) pitwall_learning.jobs;",
    "CHECKPOINT;",
]

MAINTENANCE_SQL = (
    STRICT_GUARD
    + "\n" + "\n".join(MAINTENANCE_COMMANDS[1:])
    + "\n"
)

IDENTITY_SQL = f"""
SELECT jsonb_build_object(
  'database', current_database(),
  'data_directory', current_setting('data_directory'),
  'unix_socket_directories', current_setting('unix_socket_directories'),
  'current_user', current_user,
  'server_addr', inet_server_addr()::text,
  'server_port', current_setting('port'),
  'version', version(),
  'is_superuser', current_setting('is_superuser'),
  'capture_batches', (SELECT count(*) FROM pitwall_learning.capture_batches),
  'source_revisions', (SELECT count(*) FROM pitwall_learning.source_revisions),
  'jobs', (SELECT count(*) FROM pitwall_learning.jobs),
  'measurement_events', (SELECT count(*) FROM public.simhub_measurement_events),
  'lap_summaries', (SELECT count(*) FROM public.simhub_lap_summaries),
  'runtime_settings', (SELECT count(*) FROM pitwall_learning.runtime_settings),
  'worker_role', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitwall_learning_worker'),
  'capture_triggers', (SELECT count(*) FROM pg_trigger t
                        JOIN pg_class c ON c.oid = t.tgrelid
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE NOT t.tgisinternal
                         AND t.tgname IN ('pitwall_learning_capture_event_ins',
                                          'pitwall_learning_capture_event_upd',
                                          'pitwall_learning_capture_lap_ins',
                                          'pitwall_learning_capture_lap_upd')),
  'legacy_triggers', (SELECT count(*) FROM pg_trigger t
                       WHERE NOT t.tgisinternal
                         AND t.tgname IN ('pitwall_learning_capture_event',
                                          'pitwall_learning_capture_lap')),
  'tcp_listeners', (SELECT count(*) FROM pg_stat_activity
                     WHERE backend_type = 'client backend')
)::text;
"""

PG_STATS_SQL = """
SELECT jsonb_build_object(
  'database', (SELECT to_jsonb(d) FROM pg_stat_database d
                WHERE d.datname = current_database()),
  'bgwriter', (SELECT to_jsonb(b) FROM pg_stat_bgwriter b),
  'wal', (SELECT to_jsonb(w) FROM pg_stat_wal w),
  'activity', (SELECT count(*) FROM pg_stat_activity),
  'db_size_bytes', pg_database_size(current_database()),
  'tables', (SELECT jsonb_object_agg(schemaname || '.' || relname,
              jsonb_build_object(
                'n_live_tup', n_live_tup,
                'n_dead_tup', n_dead_tup,
                'n_tup_ins', n_tup_ins,
                'n_tup_upd', n_tup_upd,
                'n_tup_del', n_tup_del,
                'last_vacuum', last_vacuum,
                'last_autovacuum', last_autovacuum,
                'last_analyze', last_analyze,
                'last_autoanalyze', last_autoanalyze))
             FROM pg_stat_user_tables
            WHERE (schemaname = 'pitwall_learning')
               OR (schemaname = 'public'
                   AND relname IN ('simhub_measurement_events',
                                   'simhub_lap_summaries',
                                   'simhub_devices')))
)::text;
"""

LOGICAL_STATE_SQL = """
SELECT jsonb_build_object(
  'measurement_events', (SELECT count(*) FROM public.simhub_measurement_events),
  'lap_summaries', (SELECT count(*) FROM public.simhub_lap_summaries),
  'capture_batches', (SELECT count(*) FROM pitwall_learning.capture_batches),
  'source_revisions', (SELECT count(*) FROM pitwall_learning.source_revisions),
  'jobs', (SELECT count(*) FROM pitwall_learning.jobs),
  'runtime_settings', (SELECT count(*) FROM pitwall_learning.runtime_settings),
  'devices', (SELECT count(*) FROM public.simhub_devices),
  'auth_users', (SELECT count(*) FROM auth.users),
  'event_fingerprint', coalesce((SELECT md5(string_agg(id::text, ',' ORDER BY id))
                                   FROM public.simhub_measurement_events), ''),
  'lap_fingerprint', coalesce((SELECT md5(string_agg(id::text, ',' ORDER BY id))
                                 FROM public.simhub_lap_summaries), ''),
  'batch_fingerprint', coalesce((SELECT md5(string_agg(id::text, ',' ORDER BY id))
                                   FROM pitwall_learning.capture_batches), ''),
  'revision_fingerprint', coalesce((SELECT md5(string_agg(id::text, ',' ORDER BY id))
                                      FROM pitwall_learning.source_revisions), ''),
  'job_fingerprint', coalesce((SELECT md5(string_agg(id::text, ',' ORDER BY id))
                                 FROM pitwall_learning.jobs), ''),
  'policy_fingerprint', coalesce((SELECT md5(string_agg(
        owner_user_id::text || ':' || policy_version::text || ':' ||
        capture_enabled::text || ':' || personal_fit_enabled::text || ':' ||
        pooling_enabled::text || ':' || serving_enabled::text, ',' ORDER BY owner_user_id))
      FROM pitwall_learning.account_policy), ''),
  'settings_fingerprint', coalesce((SELECT md5(string_agg(
        id::text || ':' || capture_enabled::text || ':' || worker_enabled::text || ':' ||
        shadow_enabled::text || ':' || advice_enabled::text, ',' ORDER BY id))
      FROM pitwall_learning.runtime_settings), '')
)::text;
"""

RUNTIME_CONFIG_SQL = """
SELECT jsonb_build_object(
  'settings', (SELECT jsonb_object_agg(name, jsonb_build_object(
                 'setting', setting, 'unit', unit, 'source', source,
                 'context', context))
               FROM pg_settings),
  'function_hashes', jsonb_build_object(
    'simhub_persist_measurement_batch',
      md5(pg_get_functiondef('public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb)'::regprocedure)),
    'capture_source_batch',
      md5(pg_get_functiondef('pitwall_learning.capture_source_batch(text,jsonb)'::regprocedure)),
    'materialize_capture_batch',
      md5(pg_get_functiondef('pitwall_learning.materialize_capture_batch(uuid,uuid)'::regprocedure)),
    'claim_jobs',
      md5(pg_get_functiondef('pitwall_learning.claim_jobs(integer,integer)'::regprocedure)),
    'finish_job',
      md5(pg_get_functiondef('pitwall_learning.finish_job(uuid,uuid,text,text)'::regprocedure))),
  'role_flags', (SELECT jsonb_object_agg(rolname, jsonb_build_object(
                    'super', rolsuper, 'inherit', rolinherit, 'login', rolcanlogin,
                    'createdb', rolcreatedb, 'createrole', rolcreaterole,
                    'bypassrls', rolbypassrls, 'replication', rolreplication,
                    'connlimit', rolconnlimit))
                  FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%')
)::text;
"""

PRODUCTION_REFERENCE_SQL = """
SELECT jsonb_build_object(
  'container', 'supabase-db',
  'id', id,
  'image', image,
  'started_at', started_at,
  'running', running
)::text FROM (
  SELECT 'dummy'::text AS id, 'dummy'::text AS image,
         'dummy'::timestamptz AS started_at, false AS running
  WHERE false
) x;
"""


class ProtocolError(ValueError):
    """The committed protocol is missing, changed or not the 200-round design."""


class GuardError(RuntimeError):
    """A container/database identity guard refused the operation."""


class RunFailure(RuntimeError):
    """A measurement phase failed after the run started; never retried."""

    def __init__(self, message: str, **context):
        super().__init__(message)
        self.context = context


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_json(path: Path, payload: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n",
                   encoding="utf-8")
    os.replace(tmp, path)


def _append_jsonl(handle, payload: dict, *, fsync: bool = False) -> None:
    handle.write(json.dumps(payload, default=str, sort_keys=False) + "\n")
    handle.flush()
    if fsync:
        os.fsync(handle.fileno())


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------
def _expect(errors: list[str], condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def validate_protocol_data(data: dict) -> list[str]:
    errors: list[str] = []
    _expect(errors, isinstance(data, dict), "protocol is not a JSON object")
    if not isinstance(data, dict):
        return errors

    _expect(errors, data.get("protocol_version")
            == "3sm.pitwall-learning.p1.controlled-perf.v1",
            "unexpected protocol_version")
    _expect(errors, data.get("experiment_id")
            == "pitwall-learning-p1-controlled-20261111",
            "unexpected experiment_id")
    _expect(errors, data.get("status") == "PREREGISTERED_BEFORE_DATABASE_MEASUREMENT",
            "protocol is not marked as pre-registered before measurement")

    target = data.get("target") or {}
    expected_target = {
        "host": "3sm-docker",
        "container_name": CONTAINER_NAME,
        "container_label": f"{CONTAINER_LABEL_KEY}={CONTAINER_LABEL_VALUE}",
        "image": IMAGE,
        "image_id": IMAGE_ID,
        "network": "none",
        "published_ports": [],
        "readonly_rootfs": True,
        "user": "100:101",
        "memory_bytes": MEMORY_BYTES,
        "nano_cpus": NANO_CPUS,
        "pids_limit": PIDS_LIMIT,
        "preload_libraries": "",
        "shared_buffers": "32MB",
        "work_mem": "4MB",
        "max_connections": 20,
        "max_worker_processes": 2,
        "database": DB,
        "data_directory": DATA_DIRECTORY,
        "unix_socket_directory": SOCKET_DIRECTORY,
        "production_changed": False,
    }
    for key, value in expected_target.items():
        _expect(errors, target.get(key) == value,
                f"target.{key} differs from the pinned value {value!r}")
    tmpfs = target.get("tmpfs") or {}
    _expect(errors, tmpfs.get("path") == "/work", "target.tmpfs.path is not /work")
    _expect(errors, tmpfs.get("size_bytes") == TMPFS_BYTES,
            "target.tmpfs.size_bytes is not 384 MiB")
    _expect(errors, tmpfs.get("uid") == 100 and tmpfs.get("gid") == 101,
            "target.tmpfs uid/gid are not 100:101")

    design = data.get("design") or {}
    _expect(errors, design.get("rounds") == ROUNDS,
            "rounds must be exactly 200")
    _expect(errors, design.get("cycles") == CYCLES,
            "cycles must be exactly 20")
    _expect(errors, design.get("orders_per_cycle") == ORDERS_PER_CYCLE,
            "orders_per_cycle must be exactly 10")
    _expect(errors, design.get("phase_names") == PHASES,
            "phase_names differ from absent/absent_aa/off/off_aa/on")
    _expect(errors, design.get("warmup_ingests_per_phase") == WARMUPS_PER_PHASE,
            "warmups must be exactly three full ingests per phase")
    _expect(errors, design.get("measured_samples") == MEASURED_SAMPLES,
            "measured_samples must be 1000")
    _expect(errors, design.get("total_rpcs") == TOTAL_RPCS,
            "total_rpcs must be 4000 including warm-ups")
    _expect(errors, design.get("fresh_backend_per_phase") is True,
            "fresh_backend_per_phase must be true")
    _expect(errors, design.get("ddl_and_flag_before_warmups") is True,
            "ddl_and_flag_before_warmups must be true")
    _expect(errors, design.get("rounds_per_cycle") == MAINTENANCE_INTERVAL,
            "rounds_per_cycle must match the maintenance interval")
    _expect(errors,
            design.get("maintenance_boundary_rounds") == list(range(10, 201, 10)),
            "maintenance boundaries must be every ten rounds through 200")
    positions = design.get("position_target_per_phase") or {}
    _expect(errors, positions == {str(i): 40 for i in range(1, 6)},
            "each phase must target 40 samples at each of the five positions")
    if (design.get("rounds") == ROUNDS
            and design.get("cycles") == CYCLES
            and design.get("orders_per_cycle") == ORDERS_PER_CYCLE):
        _expect(errors, design["cycles"] * design["orders_per_cycle"]
                == design["rounds"], "cycles x orders must equal rounds")
    if design.get("rounds") == ROUNDS:
        _expect(errors, design.get("measured_samples")
                == design["rounds"] * len(PHASES),
                "measured_samples must equal rounds x phases")
        _expect(errors, design.get("total_rpcs")
                == design["measured_samples"]
                + WARMUPS_PER_PHASE * design["rounds"] * len(PHASES),
                "total_rpcs must include three warm-ups per phase")

    statistic = data.get("statistic") or {}
    _expect(errors, statistic.get("quantile") == "nearest-rank p95",
            "statistic must be nearest-rank p95")
    _expect(errors, "ceil(0.95*n)-1" in str(statistic.get("formula", "")),
            "statistic formula must be nearest-rank, not interpolated")
    _expect(errors, statistic.get("n_per_phase") == ROUNDS,
            "n_per_phase must be 200")

    gate = data.get("gate") or {}
    _expect(errors, gate.get("delta_ms_max") == 20.0,
            "gate delta_ms_max must stay 20.0")
    _expect(errors, gate.get("delta_pct_max") == 10.0,
            "gate delta_pct_max must stay 10.0")
    _expect(errors, gate.get("threshold_changed") is False,
            "gate threshold_changed must be false")
    _expect(errors, gate.get("p50_substitution_allowed") is False,
            "p50 substitution must be forbidden")

    aa = data.get("aa_control") or {}
    _expect(errors, aa.get("absolute_delta") is True,
            "A/A control must use absolute deltas")
    _expect(errors, aa.get("delta_ms_max") == 20.0,
            "A/A delta_ms_max must stay 20.0")
    _expect(errors, aa.get("delta_pct_max") == 10.0,
            "A/A delta_pct_max must stay 10.0")
    _expect(errors, aa.get("out_of_budget_result") == "INCONCLUSIVE",
            "A/A out-of-budget result must be INCONCLUSIVE")

    contract = data.get("contract") or {}
    _expect(errors, contract.get("ack_events") == 20,
            "contract must require 20 accepted events")
    _expect(errors, contract.get("ack_laps") == 3,
            "contract must require 3 accepted laps")
    _expect(errors, contract.get("every_record_checked") is True,
            "contract must check every record")
    _expect(errors, (contract.get("byte_budgets") or {}).get(
        "event_plus_lap_part_bytes_max") == 16384,
        "event+lap part budget must stay 16384")
    _expect(errors, (contract.get("byte_budgets") or {}).get(
        "body_bytes_max") == 24576, "body budget must stay 24576")
    _expect(errors, (contract.get("byte_budgets") or {}).get(
        "raw_batch_text_bytes_max") == 262144,
        "raw batch budget must stay 262144")
    on_contract = contract.get("on") or {}
    for key, value in {
        "batch_rows": 2, "batch_items": 23, "event_batch_rows": 1,
        "event_batch_items": 20, "lap_batch_rows": 1, "lap_batch_items": 3,
        "source_revision_delta": 0, "job_delta": 2,
    }.items():
        _expect(errors, on_contract.get(key) == value,
                f"on contract {key} must be {value}")

    maintenance = data.get("maintenance") or {}
    _expect(errors, maintenance.get("interval_rounds") == MAINTENANCE_INTERVAL,
            "maintenance interval must be ten rounds")
    _expect(errors, maintenance.get("commands") == MAINTENANCE_COMMANDS,
            "maintenance commands differ from the fixed allowlist")
    _expect(errors, maintenance.get("outside_measured_phases") is True,
            "maintenance must be outside measured phases")

    resources = data.get("resources") or {}
    _expect(errors, resources.get("collected_outside_clocked_rpc_window") is True,
            "resource collection must be outside the clocked RPC window")
    _expect(errors, resources.get("per_round_before_and_after") is True,
            "resources must be collected before and after every round")

    uncertainty = data.get("uncertainty") or {}
    _expect(errors, uncertainty.get("role") ==
            "diagnostic_only_not_gate_and_not_replacement_statistic",
            "bootstrap interval must be diagnostic only")
    _expect(errors, uncertainty.get("resamples") == 10000,
            "bootstrap must use 10000 resamples")
    _expect(errors, uncertainty.get("seed") == 20261111,
            "bootstrap seed must be pinned")

    stops = data.get("stop_rules") or []
    _expect(errors, isinstance(stops, list) and len(stops) >= 5,
            "protocol must list the stop rules")
    return errors


def load_protocol(path: Path) -> tuple[dict, str]:
    path = Path(path)
    if not path.is_file():
        raise ProtocolError(f"protocol file not found: {path}")
    raw = path.read_bytes()
    digest = sha256_bytes(raw)
    sidecar = path.with_suffix(".sha256")
    if not sidecar.is_file():
        raise ProtocolError(f"missing pre-registration hash sidecar: {sidecar}")
    expected = sidecar.read_text(encoding="utf-8").split()[0].strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ProtocolError("pre-registration hash sidecar is not a sha256")
    if expected != digest:
        raise ProtocolError(
            f"protocol hash mismatch: sidecar {expected} != file {digest}")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProtocolError(f"protocol is not valid JSON: {exc}") from exc
    errors = validate_protocol_data(data)
    if errors:
        raise ProtocolError("protocol refused: " + "; ".join(errors))
    return data, digest


def order_sequence() -> list[list[str]]:
    """200 rounds from the ten fixed orders, rotating the cycle start.

    Each 10-round cycle still contains every one of the ten calibrated orders
    exactly once. Rotating which order starts each cycle prevents the
    ten-round maintenance boundary from always preceding the same phase at
    position 1.
    """
    base = rehearse.calibrated_phase_orders(PHASES)
    sequence: list[list[str]] = []
    for run in range(1, ROUNDS + 1):
        cycle = (run - 1) // ORDERS_PER_CYCLE
        index = (((run - 1) % ORDERS_PER_CYCLE) + cycle) % ORDERS_PER_CYCLE
        sequence.append(list(base[index]))
    return sequence


def position_counts(sequence: list[list[str]]) -> dict[str, dict[str, int]]:
    counts = {phase: {str(i): 0 for i in range(1, 6)} for phase in PHASES}
    for order in sequence:
        for position, phase in enumerate(order, start=1):
            counts[phase][str(position)] += 1
    return counts


def expected_container(protocol: dict, container_id: str = "") -> dict:
    target = protocol["target"]
    return {
        "id": container_id,
        "name": target["container_name"],
        "label": target["container_label"],
        "image_id": target["image_id"],
        "image": target["image"],
        "network": target["network"],
        "user": target["user"],
        "memory": target["memory_bytes"],
        "nano_cpus": target["nano_cpus"],
        "pids_limit": target["pids_limit"],
        "tmpfs_path": target["tmpfs"]["path"],
        "tmpfs_bytes": target["tmpfs"]["size_bytes"],
        "tmpfs_uid": target["tmpfs"]["uid"],
        "tmpfs_gid": target["tmpfs"]["gid"],
        "readonly_rootfs": target["readonly_rootfs"],
    }


def _tmpfs_options(info: dict) -> dict[str, str]:
    opts = ((info.get("HostConfig") or {}).get("Tmpfs") or {}).get("/work") or ""
    result = {}
    for token in opts.split(","):
        if "=" in token:
            key, value = token.split("=", 1)
            result[key.strip()] = value.strip()
        elif token.strip():
            result[token.strip()] = "true"
    return result


def _parse_size(token: str) -> int | None:
    token = str(token).strip().lower()
    match = re.fullmatch(r"(\d+)([kmg]?)", token)
    if not match:
        return None
    value = int(match.group(1))
    unit = match.group(2)
    return value * {"": 1, "k": 1024, "m": 1024 ** 2, "g": 1024 ** 3}[unit]


def assert_container_identity(info: dict, expected: dict) -> None:
    errors: list[str] = []
    host = info.get("HostConfig") or {}
    config = info.get("Config") or {}
    labels = config.get("Labels") or {}
    ports = info.get("NetworkSettings", {}).get("Ports") or {}
    bindings = host.get("PortBindings") or {}
    options = _tmpfs_options(info)

    _expect(errors, info.get("Id") == expected["id"],
            f"container Id {info.get('Id')!r} is not the explicit id")
    _expect(errors, info.get("Name") == "/" + expected["name"],
            f"container name {info.get('Name')!r} is not /{expected['name']}")
    _expect(errors, labels.get(CONTAINER_LABEL_KEY) == CONTAINER_LABEL_VALUE,
            f"label {CONTAINER_LABEL_KEY} is not {CONTAINER_LABEL_VALUE}")
    _expect(errors, not ports and not bindings,
            "container publishes ports")
    _expect(errors, host.get("NetworkMode") == expected["network"],
            f"network mode {host.get('NetworkMode')!r} is not none")
    _expect(errors, info.get("Image") == expected["image_id"],
            f"image {info.get('Image')!r} is not the pinned image id")
    _expect(errors, (info.get("State") or {}).get("Running") is True,
            "container is not running")
    _expect(errors, config.get("User") == expected["user"],
            f"user {config.get('User')!r} is not {expected['user']}")
    _expect(errors, host.get("ReadonlyRootfs") is True,
            "root filesystem is not read-only")
    _expect(errors, host.get("Memory") == expected["memory"],
            f"memory limit {host.get('Memory')!r} is not {expected['memory']}")
    _expect(errors, host.get("NanoCpus") == expected["nano_cpus"],
            f"nano_cpus {host.get('NanoCpus')!r} is not {expected['nano_cpus']}")
    _expect(errors, host.get("PidsLimit") == expected["pids_limit"],
            f"pids limit {host.get('PidsLimit')!r} is not {expected['pids_limit']}")
    _expect(errors, options.get("uid") == str(expected["tmpfs_uid"]),
            "tmpfs uid is not 100")
    _expect(errors, options.get("gid") == str(expected["tmpfs_gid"]),
            "tmpfs gid is not 101")
    _expect(errors, _parse_size(options.get("size", "")) == expected["tmpfs_bytes"],
            f"tmpfs size {options.get('size')!r} is not 384 MiB")
    if errors:
        raise GuardError("container identity refused: " + "; ".join(errors))


# ---------------------------------------------------------------------------
# Subprocess boundary
# ---------------------------------------------------------------------------
def _valid_container_id(container_id: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{64}", container_id))


def _ssh(argv: list[str], *, input_text: str | None = None,
         timeout: int = 300) -> subprocess.CompletedProcess:
    # OpenSSH joins its arguments with spaces and hands the result to the
    # remote shell. Quote every remote token so a `sh -c` script or an
    # inspect format containing `|` cannot be split or piped by that shell.
    remote = " ".join(shlex.quote(part) for part in argv)
    return subprocess.run(
        SSH + [remote], input=input_text, text=True,
        capture_output=True, timeout=timeout,
    )


def _docker_inspect(container_id: str) -> dict:
    if not _valid_container_id(container_id):
        raise GuardError("container id must be the exact 64-character docker id")
    proc = _ssh(["docker", "inspect", container_id], timeout=60)
    if proc.returncode != 0:
        raise GuardError(f"docker inspect failed: {proc.stderr.strip()}")
    payload = json.loads(proc.stdout)
    if not isinstance(payload, list) or len(payload) != 1:
        raise GuardError("docker inspect returned no unique container")
    return payload[0]


def _docker_image_inspect(image_id: str) -> dict:
    proc = _ssh(["docker", "image", "inspect", image_id], timeout=60)
    if proc.returncode != 0:
        raise GuardError(f"docker image inspect failed: {proc.stderr.strip()}")
    payload = json.loads(proc.stdout)
    if not isinstance(payload, list) or len(payload) != 1:
        raise GuardError("image is not present in the local cache")
    return payload[0]


def _docker_exec_sh(container_id: str, script: str,
                    *, timeout: int = 120) -> subprocess.CompletedProcess:
    if not _valid_container_id(container_id):
        raise GuardError("container id must be the exact 64-character docker id")
    return _ssh(["docker", "exec", container_id, "sh", "-c", script],
                timeout=timeout)


def _psql(container_id: str, sql: str, *,
          timeout: int = 300) -> subprocess.CompletedProcess:
    if not _valid_container_id(container_id):
        raise GuardError("container id must be the exact 64-character docker id")
    argv = [part.format(container=container_id) for part in PSQL]
    return _ssh(argv, input_text=sql, timeout=timeout)


def _psql_json(container_id: str, sql: str, *, timeout: int = 120) -> dict:
    proc = _psql(container_id, sql, timeout=timeout)
    if proc.returncode != 0:
        raise RunFailure(f"psql failed: {proc.stderr.strip()}",
                         sql=sql[:500])
    for line in reversed(proc.stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            return json.loads(line)
    raise RunFailure(f"no JSON object in psql output: {proc.stdout[:1000]!r}")


def _git(*args: str) -> str:
    try:
        return subprocess.run(
            ["git", *args], cwd=REPO, text=True, capture_output=True,
            check=False, timeout=30,
        ).stdout.strip()
    except Exception as exc:  # pragma: no cover - git is present in this repo
        return f"<git error: {exc}>"


# ---------------------------------------------------------------------------
# Proof root and evidence writers
# ---------------------------------------------------------------------------
def prepare_proof_root(path: Path) -> Path:
    path = Path(path)
    if path.exists():
        if not path.is_dir():
            raise FileExistsError(f"proof root is not a directory: {path}")
        # The pre-run setup and TDD logs are deliberately kept beside the
        # measurement.  They were created before the run and are never
        # overwritten; any other pre-existing content means this is not a new
        # proof root and is refused.
        allowed = {"setup", "tdd"}
        entries = list(path.iterdir())
        unexpected = [entry for entry in entries
                      if entry.name not in allowed or not entry.is_dir()]
        if unexpected:
            raise FileExistsError(
                f"proof root already contains files: {unexpected[0]}")
    else:
        path.mkdir(parents=True, mode=0o700)
    os.chmod(path, 0o700)
    return path


def _production_reference(container_id: str) -> dict:
    """Read-only reference; this never mutates a production container."""
    proc = _ssh([
        "docker", "inspect", "supabase-db",
        "--format",
        "{{.Id}}|{{.Image}}|{{.State.StartedAt}}|{{.State.Running}}",
    ], timeout=30)
    if proc.returncode != 0:
        return {"error": proc.stderr.strip(), "mutated": False}
    parts = proc.stdout.strip().split("|")
    return {
        "container": "supabase-db",
        "id": parts[0] if parts else None,
        "image": parts[1] if len(parts) > 1 else None,
        "started_at": parts[2] if len(parts) > 2 else None,
        "running": (parts[3] if len(parts) > 3 else "").lower() == "true",
        "mutated": False,
    }


# ---------------------------------------------------------------------------
# Resource evidence
# ---------------------------------------------------------------------------
CGROUP_SCRIPT = r"""
set -u
for f in /sys/fs/cgroup/cpu.stat \
         /sys/fs/cgroup/memory.current \
         /sys/fs/cgroup/memory.peak \
         /sys/fs/cgroup/memory.events \
         /sys/fs/cgroup/pids.current \
         /sys/fs/cgroup/io.stat; do
  echo "### $f"
  cat "$f" 2>&1 || true
done
echo "### df"
df -kP /work 2>&1 || true
echo "### meminfo"
head -8 /proc/meminfo 2>&1 || true
echo "### loadavg"
cat /proc/loadavg 2>&1 || true
echo "### procstat"
head -1 /proc/stat 2>&1 || true
grep '^ctxt ' /proc/stat 2>&1 || true
"""


def parse_cgroup(text: str) -> dict:
    sections: dict[str, list[str]] = {}
    current = None
    for line in text.splitlines():
        if line.startswith("### "):
            current = line[4:].strip()
            sections[current] = []
        elif current is not None:
            sections[current].append(line)

    def kv(name: str) -> dict[str, int]:
        result = {}
        for line in sections.get(name, []):
            parts = line.split()
            if len(parts) == 2 and parts[1].lstrip("-").isdigit():
                result[parts[0]] = int(parts[1])
        return result

    cpu = kv("/sys/fs/cgroup/cpu.stat")
    memory_events = kv("/sys/fs/cgroup/memory.events")
    raw_mem = (sections.get("/sys/fs/cgroup/memory.current") or [""])[0].strip()
    raw_peak = (sections.get("/sys/fs/cgroup/memory.peak") or [""])[0].strip()
    raw_pids = (sections.get("/sys/fs/cgroup/pids.current") or [""])[0].strip()
    df_line = next((line for line in sections.get("df", [])
                    if line.strip().endswith("/work")), "")
    available = None
    if df_line:
        fields = df_line.split()
        if len(fields) >= 4 and fields[3].isdigit():
            available = int(fields[3]) * 1024
    procstat = sections.get("procstat", [])
    ctxt = None
    for line in procstat:
        if line.startswith("ctxt "):
            ctxt = int(line.split()[1])
    load = (sections.get("loadavg") or [""])[0].strip()
    return {
        "cpu_usage_usec": cpu.get("usage_usec"),
        "cpu_user_usec": cpu.get("user_usec"),
        "cpu_system_usec": cpu.get("system_usec"),
        "nr_periods": cpu.get("nr_periods"),
        "nr_throttled": cpu.get("nr_throttled"),
        "throttled_usec": cpu.get("throttled_usec"),
        "memory_current_bytes": int(raw_mem) if raw_mem.isdigit() else None,
        "memory_peak_bytes": int(raw_peak) if raw_peak.isdigit() else None,
        "pids_current": int(raw_pids) if raw_pids.isdigit() else None,
        "memory_events": memory_events,
        "oom_kill": memory_events.get("oom_kill"),
        "tmpfs_available_bytes": available,
        "ctxt_host_wide": ctxt,
        "loadavg": load,
        "io_stat_lines": sections.get("/sys/fs/cgroup/io.stat", []),
        "raw_sha256": sha256_bytes(text.encode("utf-8")),
    }


def collect_resources(container_id: str, *, stage: str, run: int | None = None,
                      phase: str | None = None) -> dict:
    proc = _docker_exec_sh(container_id, CGROUP_SCRIPT, timeout=60)
    if proc.returncode != 0:
        raise RunFailure(f"cgroup observation failed: {proc.stderr.strip()}",
                         stage=stage, run=run)
    cgroup = parse_cgroup(proc.stdout)
    try:
        pg = _psql_json(container_id, PG_STATS_SQL, timeout=60)
    except RunFailure as exc:
        raise RunFailure(f"Postgres stats observation failed: {exc}",
                         stage=stage, run=run) from exc
    return {
        "observed_at": utc_now(),
        "stage": stage,
        "run": run,
        "phase": phase,
        "cgroup": cgroup,
        "cgroup_raw": proc.stdout,
        "postgres": pg,
    }


def _resource_delta(before: dict, after: dict) -> dict:
    b = before.get("cgroup", {})
    a = after.get("cgroup", {})
    keys = ["cpu_usage_usec", "nr_periods", "nr_throttled", "throttled_usec",
            "memory_current_bytes", "pids_current", "ctxt_host_wide"]
    delta = {}
    for key in keys:
        if b.get(key) is not None and a.get(key) is not None:
            delta[key] = a[key] - b[key]
    if b.get("tmpfs_available_bytes") is not None:
        delta["tmpfs_available_change_bytes"] = (
            a.get("tmpfs_available_bytes") - b["tmpfs_available_bytes"])
    return delta


def _stop_on_resources(container_id: str, snapshot: dict, *, stage: str) -> None:
    cg = snapshot["cgroup"]
    free = cg.get("tmpfs_available_bytes")
    memory = cg.get("memory_current_bytes")
    if free is not None and free < 64 * 1024 * 1024:
        raise RunFailure(f"tmpfs free space below 64 MiB ({free} bytes)",
                         stage=stage)
    if memory is not None and memory >= 460 * 1024 * 1024:
        raise RunFailure(f"cgroup memory.current at/above 460 MiB ({memory})",
                         stage=stage)
    if cg.get("oom_kill"):
        raise RunFailure(f"cgroup OOM kill observed ({cg['oom_kill']})",
                         stage=stage)


# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
def preflight(container_id: str, protocol: dict) -> tuple[dict, dict, dict]:
    info = _docker_inspect(container_id)
    expected = expected_container(protocol, container_id)
    assert_container_identity(info, expected)

    image_info = _docker_image_inspect(protocol["target"]["image_id"])
    if image_info.get("Id") != protocol["target"]["image_id"]:
        raise GuardError(
            f"cached image id {image_info.get('Id')!r} != pinned image id")

    ids = _docker_exec_sh(container_id, "id -u; id -g; id -un; id -gn",
                          timeout=30)
    id_lines = [line.strip() for line in ids.stdout.splitlines() if line.strip()]
    if ids.returncode != 0 or id_lines[:2] != ["100", "101"]:
        raise GuardError(f"container process is not uid/gid 100:101: {id_lines}")

    identity = _psql_json(container_id, IDENTITY_SQL, timeout=60)
    checks = {
        "database": DB,
        "data_directory": DATA_DIRECTORY,
        "unix_socket_directories": SOCKET_DIRECTORY,
        "current_user": "postgres",
        "server_addr": None,
    }
    for key, value in checks.items():
        if identity.get(key) != value:
            raise GuardError(
                f"database identity refused: {key}={identity.get(key)!r}, "
                f"expected {value!r}")
    for key in ("capture_batches", "source_revisions", "jobs",
                "measurement_events", "lap_summaries"):
        if identity.get(key) != 0:
            raise GuardError(
                f"fresh-clone preflight requires {key}=0, got {identity.get(key)}")
    if identity.get("runtime_settings") != 1:
        raise GuardError("runtime_settings singleton is missing")
    if identity.get("worker_role") is not True:
        raise GuardError("pitwall_learning_worker role is missing")
    if identity.get("capture_triggers") != 4:
        raise GuardError(
            f"expected 4 capture triggers, got {identity.get('capture_triggers')}")
    if identity.get("legacy_triggers") != 0:
        raise GuardError("legacy row triggers are present on the fresh clone")

    snapshot = collect_resources(container_id, stage="preflight")
    _stop_on_resources(container_id, snapshot, stage="preflight")
    free = snapshot["cgroup"].get("tmpfs_available_bytes")
    if free is not None and free < 96 * 1024 * 1024:
        raise GuardError(f"tmpfs free at preflight is below 96 MiB ({free})")

    runtime = _psql_json(container_id, RUNTIME_CONFIG_SQL, timeout=120)
    state = _psql_json(container_id, LOGICAL_STATE_SQL, timeout=60)
    env = {
        "observed_at": utc_now(),
        "container": {
            "inspect": info,
            "image_inspect": {
                "Id": image_info.get("Id"),
                "RepoTags": image_info.get("RepoTags"),
                "Created": image_info.get("Created"),
                "Size": image_info.get("Size"),
            },
            "uid_gid": id_lines,
        },
        "identity": identity,
        "runtime_config": runtime,
        "logical_state": state,
        "resource_snapshot": snapshot,
        "production_reference": _production_reference(container_id),
    }
    preflight_doc = {
        "observed_at": utc_now(),
        "container_id": container_id,
        "identity": identity,
        "logical_state": state,
        "resource_snapshot": snapshot,
        "guards": {
            "container_identity": "PASS",
            "image_cache": "PASS",
            "database_identity": "PASS",
            "fresh_dataset": "PASS",
            "capture_triggers": 4,
            "legacy_triggers": 0,
        },
    }
    return env, preflight_doc, snapshot


# ---------------------------------------------------------------------------
# Measurement SQL
# ---------------------------------------------------------------------------
def build_phase_sql(phase: str, run: int) -> str:
    if phase not in PHASES:
        raise ValueError(f"unknown phase {phase!r}")
    session = f"controlled-{phase}-{run}"
    parts = ["BEGIN;", STRICT_GUARD]
    if phase in ("absent", "absent_aa"):
        parts.append(rehearse.DROP_TRIGGERS)
    parts.append(rehearse._measure_block(phase, "wire", session, run, warmups=3))
    parts.append("ROLLBACK;")
    return "\n".join(parts) + "\n"


def maintenance(container_id: str, run: int) -> dict:
    before = collect_resources(container_id, stage="pre_maintenance", run=run)
    _stop_on_resources(container_id, before, stage="pre_maintenance")
    started = time.perf_counter()
    try:
        proc = _psql(container_id, MAINTENANCE_SQL, timeout=300)
    except Exception as exc:
        raise RunFailure(f"maintenance failed at round {run}: {exc}",
                         run=run) from exc
    duration = round((time.perf_counter() - started) * 1000, 3)
    if proc.returncode != 0:
        raise RunFailure(
            f"maintenance exit {proc.returncode} at round {run}: "
            f"{proc.stderr.strip()}", run=run,
            stdout=proc.stdout[-2000:], stderr=proc.stderr[-4000:])
    after = collect_resources(container_id, stage="post_maintenance", run=run)
    _stop_on_resources(container_id, after, stage="post_maintenance")
    return {
        "run": run,
        "commands": MAINTENANCE_COMMANDS,
        "sql_sha256": sha256_bytes(MAINTENANCE_SQL.encode("utf-8")),
        "duration_ms": duration,
        "before": before,
        "after": after,
        "delta": _resource_delta(before, after),
        "exit": proc.returncode,
        "stdout": proc.stdout[-2000:],
        "stderr": proc.stderr[-4000:],
    }


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------
def _p95(values: list[float]) -> float:
    return rehearse.nearest_rank(values, 0.95)


def _p50(values: list[float]) -> float:
    return rehearse.nearest_rank(values, 0.50)


def bootstrap_p95_ci(xs: list[float], ys: list[float], *,
                     seed: int, resamples: int = 10000) -> dict:
    """Percentile bootstrap of p95(x) - p95(y). Diagnostic only."""
    if not xs or not ys:
        raise ValueError("bootstrap needs two non-empty samples")
    rng = random.Random(seed)
    nx, ny = len(xs), len(ys)
    diffs: list[float] = []
    for _ in range(resamples):
        bx = [xs[rng.randrange(nx)] for _ in range(nx)]
        by = [ys[rng.randrange(ny)] for _ in range(ny)]
        diffs.append(_p95(bx) - _p95(by))
    diffs.sort()
    return {
        "method": "percentile bootstrap of nearest-rank p95 difference",
        "resamples": resamples,
        "seed": seed,
        "confidence": 0.95,
        "ci_low_ms": round(rehearse.nearest_rank(diffs, 0.025), 3),
        "ci_high_ms": round(rehearse.nearest_rank(diffs, 0.975), 3),
        "median_ms": round(rehearse.nearest_rank(diffs, 0.50), 3),
        "role": "diagnostic_only_not_gate",
    }


def analyze_samples(samples: list[dict], protocol: dict) -> dict:
    by_phase: dict[str, list[dict]] = {phase: [] for phase in PHASES}
    for rec in samples:
        by_phase.setdefault(rec["phase"], []).append(rec)

    errors: list[str] = []
    for phase in PHASES:
        if len(by_phase.get(phase, [])) != ROUNDS:
            errors.append(
                f"dataset: phase {phase} has {len(by_phase.get(phase, []))} "
                f"samples, expected {ROUNDS}")
    if len(samples) != MEASURED_SAMPLES:
        errors.append(
            f"dataset: {len(samples)} samples, expected {MEASURED_SAMPLES}")

    complete = all(len(by_phase.get(phase, [])) == ROUNDS for phase in PHASES)
    if not complete:
        return {
            "run_status": "INCOMPLETE",
            "gate_status": "INCOMPLETE",
            "gate_pass": False,
            "sample_count": len(samples),
            "expected_samples": MEASURED_SAMPLES,
            "measurement_contract_errors": errors,
            "stats": {},
            "protocol_sha256": None,
        }

    positions = {phase: {str(i): 0 for i in range(1, 6)} for phase in PHASES}
    contract_errors: list[str] = []
    for rec in samples:
        run = rec.get("run")
        position = rec.get("position")
        phase = rec["phase"]
        if position in range(1, 6):
            positions[phase][str(position)] += 1
        for err in rehearse.measurement_contract_errors(phase, rec["fields"]):
            contract_errors.append(f"run {run} position {position} {err}")

    for phase in PHASES:
        if positions[phase] != {str(i): 40 for i in range(1, 6)}:
            errors.append(
                f"design: phase {phase} position counts {positions[phase]} "
                "are not 40 at each of five positions")
    if errors:
        contract_errors.extend(errors)

    values = {phase: [float(rec["fields"]["ms"]) for rec in by_phase[phase]]
              for phase in PHASES}
    stats = {}
    for phase, xs in values.items():
        ordered = sorted(xs)
        stats[phase] = {
            "n": len(xs),
            "p50_ms": round(_p50(xs), 3),
            "p95_ms": round(_p95(xs), 3),
            "min_ms": round(min(xs), 3),
            "max_ms": round(max(xs), 3),
            "mean_ms": round(sum(xs) / len(xs), 3),
            "over_120ms": sum(1 for value in xs if value > 120),
            "over_150ms": sum(1 for value in xs if value > 150),
            "samples_ms": [round(value, 3) for value in values[phase]],
            "sorted_tail_ms": [round(value, 3) for value in ordered[-20:]],
        }

    base_abs = stats["absent"]["p95_ms"]
    base_off = stats["off"]["p95_ms"]
    delta_abs_p95 = round(stats["on"]["p95_ms"] - base_abs, 3)
    delta_off_p95 = round(stats["on"]["p95_ms"] - base_off, 3)
    delta_abs_pct = round(delta_abs_p95 / base_abs * 100.0, 3) if base_abs else None
    delta_off_pct = round(delta_off_p95 / base_off * 100.0, 3) if base_off else None

    aa_absent_delta = round(stats["absent_aa"]["p95_ms"] - base_abs, 3)
    aa_off_delta = round(stats["off_aa"]["p95_ms"] - base_off, 3)
    aa_absent_pct = round(aa_absent_delta / base_abs * 100.0, 3) if base_abs else None
    aa_off_pct = round(aa_off_delta / base_off * 100.0, 3) if base_off else None
    aa_within_budget = (
        abs(aa_absent_delta) <= 20.0
        and abs(aa_absent_pct or 0.0) <= 10.0
        and abs(aa_off_delta) <= 20.0
        and abs(aa_off_pct or 0.0) <= 10.0
    )

    paired_abs = [float(rec["fields"]["ms"]) for rec in by_phase["on"]]
    paired_base = [float(rec["fields"]["ms"]) for rec in by_phase["absent"]]
    paired_off_base = [float(rec["fields"]["ms"]) for rec in by_phase["off"]]
    paired_deltas_abs = [a - b for a, b in zip(paired_abs, paired_base)]
    paired_deltas_off = [a - b for a, b in zip(paired_abs, paired_off_base)]

    all_fields = [rec["fields"] for rec in samples]
    field_keys = sorted({key for fields in all_fields for key in fields})
    byte_values = {
        "ev_bytes": [int(fields["ev_bytes"]) for fields in all_fields],
        "lp_bytes": [int(fields["lp_bytes"]) for fields in all_fields],
        "body_bytes": [int(fields["body_bytes"]) for fields in all_fields],
        "batch_text_bytes": [int(fields["batch_text_bytes"]) for fields in all_fields],
        "batch_stored_bytes": [int(fields["batch_stored_bytes"]) for fields in all_fields],
    }
    sizes = {
        "every_sample_fields_checked": True,
        "sample_field_keys": field_keys,
        "max_ev_bytes": max(byte_values["ev_bytes"]),
        "max_lp_bytes": max(byte_values["lp_bytes"]),
        "max_body_bytes": max(byte_values["body_bytes"]),
        "max_batch_text_bytes": max(byte_values["batch_text_bytes"]),
        "max_batch_stored_bytes": max(byte_values["batch_stored_bytes"]),
        "all_within_part_budget": all(
            ev + lp <= 16384 for ev, lp in zip(byte_values["ev_bytes"],
                                               byte_values["lp_bytes"])),
        "all_within_body_budget": all(
            value <= 24576 for value in byte_values["body_bytes"]),
        "all_within_raw_batch_budget": all(
            value <= 262144 for value in byte_values["batch_text_bytes"]),
        "limits": {"event_plus_lap_part_bytes_max": 16384,
                   "body_bytes_max": 24576,
                   "raw_batch_text_bytes_max": 262144,
                   "batch_items_max": 200},
        "note": ("Batch payload is reported both as stored/compressed JSONB "
                 "(pg_column_size) and raw UTF-8 JSON text (octet_length). "
                 "Every sample is checked, not only the first."),
    }

    per_position = {}
    for phase in PHASES:
        per_position[phase] = {}
        for position in range(1, 6):
            xs = [float(rec["fields"]["ms"]) for rec in by_phase[phase]
                  if rec.get("position") == position]
            per_position[phase][str(position)] = {
                "n": len(xs),
                "p50_ms": round(_p50(xs), 3) if xs else None,
                "p95_ms": round(_p95(xs), 3) if xs else None,
            }

    uncertainty: dict[str, object] = {
        "primary_on_minus_absent": bootstrap_p95_ci(
            values["on"], values["absent"], seed=20261111, resamples=10000),
        "secondary_on_minus_off": bootstrap_p95_ci(
            values["on"], values["off"], seed=20261112, resamples=10000),
        "aa_absent_aa_minus_absent": bootstrap_p95_ci(
            values["absent_aa"], values["absent"], seed=20261113, resamples=10000),
        "aa_off_aa_minus_off": bootstrap_p95_ci(
            values["off_aa"], values["off"], seed=20261114, resamples=10000),
    }
    uncertainty["note"] = (
        "Diagnostic only. The gate remains the single pre-registered "
        "phase-p95 difference with the fixed 20 ms / 10% thresholds.")

    timing_pass = (delta_abs_p95 <= 20.0 and delta_abs_pct is not None
                   and delta_abs_pct <= 10.0
                   and sizes["all_within_part_budget"]
                   and sizes["all_within_body_budget"]
                   and sizes["all_within_raw_batch_budget"])
    gate_status = rehearse.classify_gate(
        delta_abs_p95, delta_abs_pct, aa_within_budget, contract_errors)

    return {
        "run_status": "COMPLETE",
        "gate_status": gate_status,
        "gate_pass": gate_status == "PASS",
        "sample_count": len(samples),
        "expected_samples": MEASURED_SAMPLES,
        "rpc_count": MEASURED_SAMPLES + WARMUPS_PER_PHASE * ROUNDS * len(PHASES),
        "stats": stats,
        "phase_position_counts": positions,
        "per_position_stats": per_position,
        "measurement_contract_errors": contract_errors,
        "contract_error_count": len(contract_errors),
        "overhead_vs_absent": {
            "p95_ms": delta_abs_p95,
            "p95_pct": delta_abs_pct,
            "basis": "phase p95(on) - phase p95(absent) (primary gate)",
        },
        "overhead_vs_installed_off": {
            "p95_ms": delta_off_p95,
            "p95_pct": delta_off_pct,
            "basis": "phase p95(on) - phase p95(off) (secondary)",
        },
        "paired_diagnostic": {
            "vs_absent_p95_ms": round(_p95(paired_deltas_abs), 3),
            "vs_off_p95_ms": round(_p95(paired_deltas_off), 3),
            "basis": "p95 of per-round paired delta; diagnostic only",
        },
        "aa_control": {
            "absent_delta_ms": aa_absent_delta,
            "absent_delta_pct": aa_absent_pct,
            "off_delta_ms": aa_off_delta,
            "off_delta_pct": aa_off_pct,
            "within_budget": aa_within_budget,
            "budget": "absolute delta <= 20 ms AND <= 10% per baseline; "
                      "negative delta counts as noise",
        },
        "sizes": sizes,
        "timing_pass": timing_pass,
        "uncertainty": uncertainty,
        "method": {
            "rounds": ROUNDS,
            "cycles": CYCLES,
            "orders_per_cycle": ORDERS_PER_CYCLE,
            "phases": PHASES,
            "warmups_per_phase": WARMUPS_PER_PHASE,
            "quantile": "nearest-rank p95",
            "primary_gate": "p95(on) - p95(absent) <= 20 ms AND <= 10%",
            "aa_control": "absolute A/A p95 delta <= 20 ms AND <= 10%",
            "gate_threshold_changed": False,
            "p50_substituted": False,
        },
    }


# ---------------------------------------------------------------------------
# Run orchestration
# ---------------------------------------------------------------------------
def _sample_record(run: int, cycle: int, position: int, order_index: int,
                   order: list[str], phase: str, fields: dict,
                   raw_notice: str, client_roundtrip_ms: float,
                   contract_errors: list[str]) -> dict:
    return {
        "run": run,
        "cycle": cycle,
        "position": position,
        "order_index": order_index,
        "order": order,
        "phase": phase,
        "fields": fields,
        "all_field_keys": sorted(fields),
        "raw_notice": raw_notice,
        "client_roundtrip_ms": round(client_roundtrip_ms, 3),
        "contract_errors": contract_errors,
    }


def run_experiment(protocol_path: Path, container_id: str,
                   proof_root: Path, *, require_clean_git: bool = True) -> dict:
    data, digest = load_protocol(protocol_path)
    if not _valid_container_id(container_id):
        raise GuardError("an exact 64-character new container id is required")

    root = prepare_proof_root(proof_root)
    protocol_copy = root / "protocol.json"
    protocol_copy.write_bytes(Path(protocol_path).read_bytes())
    (root / "protocol.sha256").write_text(
        f"{digest}  protocol.json\n", encoding="utf-8")

    # This is written before the first database statement.
    start = {
        "started_at": utc_now(),
        "protocol_sha256": digest,
        "experiment_id": data["experiment_id"],
        "container_id": container_id,
        "git_head": _git("rev-parse", "HEAD"),
        "git_branch": _git("rev-parse", "--abbrev-ref", "HEAD"),
        "git_status_porcelain": _git("status", "--porcelain=v1"),
        "driver_sha256": sha256_file(Path(__file__).resolve()),
        "rehearse_sha256": sha256_file(REHEARSE_PATH),
        "migration_sha256": sha256_file(
            REPO / "supabase/migrations/20261111163052_pitwall_learning_evidence.sql"),
        "fixture_sha256": sha256_file(
            REPO / "supabase/tests/fixtures/pitwall-learning-p1-fixtures.sql"),
        "python": sys.version,
        "platform": platform.platform(),
    }
    if require_clean_git and start["git_status_porcelain"]:
        raise ProtocolError(
            "refusing to measure from a dirty worktree; commit the protocol and "
            "driver first: " + start["git_status_porcelain"][:500])
    _write_json(root / "run-start.json", start)

    env, preflight_doc, preflight_snapshot = preflight(container_id, data)
    _write_json(root / "env.json", env)
    _write_json(root / "preflight.json", preflight_doc)

    sequence = order_sequence()
    expected_positions = position_counts(sequence)
    if any(counts != {str(i): 40 for i in range(1, 6)}
           for counts in expected_positions.values()):
        raise RuntimeError("internal order design is not balanced")
    _write_json(root / "order-design.json", {
        "sequence": sequence,
        "phase_position_counts": expected_positions,
        "first_order_after_each_maintenance_boundary": [
            {"run": run, "order_index": (run % 10),
             "order": sequence[run - 1]}
            for run in range(10, 201, 10)
        ],
    })

    samples: list[dict] = []
    rounds: list[dict] = []
    maintenance_log: list[dict] = []
    raw_handle = (root / "raw-notices.log").open("w", encoding="utf-8")
    samples_handle = (root / "samples.jsonl").open("w", encoding="utf-8")
    rounds_handle = (root / "rounds.jsonl").open("w", encoding="utf-8")
    resources_handle = (root / "resources.jsonl").open("w", encoding="utf-8")
    maintenance_handle = (root / "maintenance.jsonl").open("w", encoding="utf-8")

    def write_snapshot(snapshot: dict) -> None:
        _append_jsonl(resources_handle, snapshot)

    write_snapshot(preflight_snapshot)
    abort: dict | None = None
    try:
        for run in range(1, ROUNDS + 1):
            cycle = (run - 1) // ORDERS_PER_CYCLE
            order = sequence[run - 1]
            order_index = (((run - 1) % ORDERS_PER_CYCLE) + cycle) % ORDERS_PER_CYCLE
            before = collect_resources(container_id, stage="pre_round", run=run)
            write_snapshot(before)
            _stop_on_resources(container_id, before, stage="pre_round")

            phase_records = {}
            for position, phase in enumerate(order, start=1):
                sql = build_phase_sql(phase, run)
                started = time.perf_counter()
                try:
                    proc = _psql(container_id, sql, timeout=300)
                except Exception as exc:
                    raise RunFailure(
                        f"round {run} phase {phase} psql transport failed: {exc}",
                        run=run, phase=phase, position=position) from exc
                wall_ms = (time.perf_counter() - started) * 1000.0
                parsed = rehearse._parse_perf(proc.stderr)
                notices = [line for line in proc.stderr.splitlines()
                           if "P1PERF " in line]
                raw_handle.write("\n".join(notices) + "\n")
                raw_handle.flush()
                if proc.returncode != 0:
                    raise RunFailure(
                        f"round {run} phase {phase} psql exit {proc.returncode}",
                        run=run, phase=phase, position=position,
                        stdout=proc.stdout[-3000:], stderr=proc.stderr[-5000:])
                if len(parsed) != 1:
                    raise RunFailure(
                        f"round {run} phase {phase} produced {len(parsed)} samples",
                        run=run, phase=phase, position=position,
                        stdout=proc.stdout[-3000:], stderr=proc.stderr[-5000:])
                fields = parsed[0]
                contract = rehearse.measurement_contract_errors(phase, fields)
                rec = _sample_record(
                    run, cycle, position, order_index, order, phase, fields,
                    notices[0] if notices else "", wall_ms, contract)
                samples.append(rec)
                phase_records[phase] = rec
                _append_jsonl(samples_handle, rec, fsync=False)

            after = collect_resources(container_id, stage="post_round", run=run)
            write_snapshot(after)
            _stop_on_resources(container_id, after, stage="post_round")
            round_rec = {
                "run": run,
                "cycle": cycle,
                "order_index": order_index,
                "order": order,
                "ms": {phase: round(float(phase_records[phase]["fields"]["ms"]), 3)
                       for phase in PHASES},
                "position": {phase: phase_records[phase]["position"]
                             for phase in PHASES},
                "client_roundtrip_ms": {
                    phase: phase_records[phase]["client_roundtrip_ms"]
                    for phase in PHASES},
                "contract_errors": [
                    err for phase in PHASES
                    for err in phase_records[phase]["contract_errors"]],
                "resource_before": before["cgroup"],
                "resource_after": after["cgroup"],
                "resource_delta": _resource_delta(before, after),
            }
            rounds.append(round_rec)
            _append_jsonl(rounds_handle, round_rec, fsync=True)
            os.fsync(samples_handle.fileno())

            if run % MAINTENANCE_INTERVAL == 0:
                record = maintenance(container_id, run)
                maintenance_log.append(record)
                _append_jsonl(maintenance_handle, record, fsync=True)
                # Keep an after-maintenance snapshot in the resource stream.
                write_snapshot(record["after"])

            _write_json(root / "progress.json", {
                "updated_at": utc_now(),
                "rounds_completed": run,
                "samples": len(samples),
                "expected_samples": MEASURED_SAMPLES,
                "contract_errors_so_far": sum(
                    len(rec["contract_errors"]) for rec in samples),
                "last_round": round_rec,
            })
    except RunFailure as exc:
        abort = {
            "aborted_at": utc_now(),
            "error": str(exc),
            "context": exc.context,
            "rounds_completed": len(rounds),
            "samples": len(samples),
            "note": "The pre-registered run is not retried. Partial evidence is kept.",
        }
        _write_json(root / "abort.json", abort)
    finally:
        raw_handle.close()
        samples_handle.close()
        rounds_handle.close()
        resources_handle.close()
        maintenance_handle.close()

    postflight = {}
    postflight_error = None
    try:
        post_info = _docker_inspect(container_id)
        assert_container_identity(post_info, {**expected_container(data, container_id),
                                              "id": container_id})
        post_identity = _psql_json(container_id, IDENTITY_SQL, timeout=60)
        post_state = _psql_json(container_id, LOGICAL_STATE_SQL, timeout=60)
        post_runtime = _psql_json(container_id, RUNTIME_CONFIG_SQL, timeout=120)
        post_snapshot = collect_resources(container_id, stage="postflight")
        postflight = {
            "observed_at": utc_now(),
            "identity": post_identity,
            "logical_state": post_state,
            "runtime_config": post_runtime,
            "resource_snapshot": post_snapshot,
            "container_inspect": post_info,
            "production_reference": _production_reference(container_id),
        }
        _write_json(root / "postflight.json", postflight)
    except Exception as exc:  # evidence-only failure; never masks a measurement
        postflight_error = str(exc)
        _write_json(root / "postflight-error.json", {
            "observed_at": utc_now(), "error": postflight_error})

    analysis = analyze_samples(samples, data)
    result = {
        "experiment_id": data["experiment_id"],
        "protocol_sha256": digest,
        "protocol_path": str(protocol_path),
        "proof_root": str(root),
        "container_id": container_id,
        "completed_at": utc_now(),
        "run_status": "ABORTED" if abort else analysis["run_status"],
        "abort": abort,
        "gate_status": analysis["gate_status"],
        "gate_pass": analysis["gate_pass"],
        "analysis": analysis,
        "postflight_error": postflight_error,
        "production_changed": False,
        "no_retry": True,
        "raw_evidence": {
            "samples_jsonl": str(root / "samples.jsonl"),
            "rounds_jsonl": str(root / "rounds.jsonl"),
            "resources_jsonl": str(root / "resources.jsonl"),
            "maintenance_jsonl": str(root / "maintenance.jsonl"),
            "raw_notices": str(root / "raw-notices.log"),
        },
    }
    _write_json(root / "result.json", result)
    _write_summary(root, result, data)
    _write_manifest(root)
    return result


def _fmt(value, digits: int = 3) -> str:
    if value is None:
        return "n/a"
    return f"{value:.{digits}f}"


def _write_summary(root: Path, result: dict, protocol: dict) -> None:
    analysis = result["analysis"]
    stats = analysis.get("stats") or {}
    lines = [
        "# Pitwall learning P1 — controlled 200-round performance measurement",
        "",
        f"- Experiment: `{result['experiment_id']}`",
        f"- Protocol sha256: `{result['protocol_sha256']}`",
        f"- Container: `{result['container_id']}`",
        f"- Completed: `{result['completed_at']}`",
        f"- Run status: **{result['run_status']}**",
        f"- Gate status: **{result['gate_status']}**",
        f"- Production changed: **NO**",
        f"- Retried: **NO** (one pre-registered run)",
        "",
        "## Gate",
        "",
        "The gate is unchanged: phase p95(on) - phase p95(absent) <= 20 ms "
        "AND <= 10% of p95(absent). A/A uses absolute deltas with the same "
        "20 ms / 10% budget. The p50 and the bootstrap interval are diagnostic.",
        "",
    ]
    if stats:
        lines += [
            "| Phase | n | p50 ms | p95 ms | min ms | max ms | >120 ms | >150 ms |",
            "|---|---:|---:|---:|---:|---:|---:|---:|",
        ]
        for phase in PHASES:
            row = stats[phase]
            lines.append(
                f"| {phase} | {row['n']} | {_fmt(row['p50_ms'])} | "
                f"{_fmt(row['p95_ms'])} | {_fmt(row['min_ms'])} | "
                f"{_fmt(row['max_ms'])} | {row['over_120ms']} | "
                f"{row['over_150ms']} |")
        lines += [
            "",
            f"- Primary: on - absent = **{_fmt(analysis['overhead_vs_absent']['p95_ms'])} ms "
            f"({_fmt(analysis['overhead_vs_absent']['p95_pct'])}%)**",
            f"- Secondary: on - off = {_fmt(analysis['overhead_vs_installed_off']['p95_ms'])} ms "
            f"({_fmt(analysis['overhead_vs_installed_off']['p95_pct'])}%)",
            f"- A/A absent: {_fmt(analysis['aa_control']['absent_delta_ms'])} ms "
            f"({_fmt(analysis['aa_control']['absent_delta_pct'])}%)",
            f"- A/A off: {_fmt(analysis['aa_control']['off_delta_ms'])} ms "
            f"({_fmt(analysis['aa_control']['off_delta_pct'])}%)",
            f"- A/A within budget: **{analysis['aa_control']['within_budget']}**",
            f"- Contract errors: **{analysis.get('contract_error_count', 0)}**",
            "",
        ]
    if analysis.get("uncertainty"):
        lines += [
            "## Diagnostic 95% bootstrap intervals",
            "",
            "These intervals never replace the gate.",
            "",
            "| Pair | 2.5% ms | median ms | 97.5% ms | resamples |",
            "|---|---:|---:|---:|---:|",
        ]
        for name, ci in analysis["uncertainty"].items():
            if not isinstance(ci, dict):
                continue
            lines.append(
                f"| {name} | {_fmt(ci['ci_low_ms'])} | {_fmt(ci['median_ms'])} | "
                f"{_fmt(ci['ci_high_ms'])} | {ci['resamples']} |")
        lines.append("")
    lines += [
        "## Evidence",
        "",
        "- `samples.jsonl` — every measured sample with all raw `P1PERF` fields, "
        "run, cycle, position, order, client round-trip and contract result.",
        "- `rounds.jsonl` — per-round order, phase timings, cgroup deltas and "
        "resource snapshots.",
        "- `resources.jsonl` — cgroup CPU throttling/I/O/memory plus Postgres "
        "statistics outside every clocked RPC window.",
        "- `maintenance.jsonl` — guarded VACUUM/ANALYZE/CHECKPOINT at every "
        "ten-round boundary.",
        "- `raw-notices.log`, `env.json`, `preflight.json`, `postflight.json`.",
        "- `result.json`, `FINAL-SHA256SUMS`.",
        "",
    ]
    if result.get("abort"):
        lines += [
            "## Abort",
            "",
            f"Stopped: {result['abort']['error']}",
            "",
            "The partial run was kept and was **not** retried.",
            "",
        ]
    (root / "result-summary.md").write_text("\n".join(lines) + "\n",
                                            encoding="utf-8")


def _write_manifest(root: Path) -> None:
    files = sorted(path for path in root.rglob("*")
                   if path.is_file() and path.name not in ("FINAL-SHA256SUMS",
                                                          "FINAL-SHA256SUMS.check.log"))
    lines = [f"{sha256_file(path)}  {path.relative_to(root).as_posix()}"
             for path in files]
    (root / "FINAL-SHA256SUMS").write_text("\n".join(lines) + "\n",
                                           encoding="utf-8")
    check = ["verifying every file in FINAL-SHA256SUMS"]
    ok = True
    for line in lines:
        digest, name = line.split("  ", 1)
        actual = sha256_file(root / name)
        good = digest == actual
        ok = ok and good
        check.append(f"{'OK' if good else 'MISMATCH'}  {name}")
    check.append(f"RESULT: {'ALL FILES VERIFIED' if ok else 'MISMATCH'}")
    (root / "FINAL-SHA256SUMS.check.log").write_text(
        "\n".join(check) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="One pre-registered 200-round controlled P1 performance run")
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("check", help="validate a protocol/hash without a database")
    check.add_argument("--protocol", type=Path, required=True)

    run = sub.add_parser("run", help="run the one pre-registered measurement")
    run.add_argument("--protocol", type=Path, required=True)
    run.add_argument("--container-id", required=True,
                     help="exact 64-character docker id of the new private clone")
    run.add_argument("--proof-root", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "check":
            data, digest = load_protocol(args.protocol)
            print(json.dumps({
                "protocol": str(args.protocol),
                "sha256": digest,
                "rounds": data["design"]["rounds"],
                "samples": data["design"]["measured_samples"],
                "total_rpcs": data["design"]["total_rpcs"],
                "valid": True,
            }, indent=2))
            return 0

        if not re.fullmatch(r"[0-9a-f]{64}", args.container_id):
            raise GuardError(
                "run requires the exact 64-character container id, not a name "
                "or short id")
        load_protocol(args.protocol)  # refuse before touching Docker/SSH
        result = run_experiment(args.protocol, args.container_id,
                                args.proof_root)
        print(json.dumps({
            "run_status": result["run_status"],
            "gate_status": result["gate_status"],
            "gate_pass": result["gate_pass"],
            "proof_root": result["proof_root"],
            "protocol_sha256": result["protocol_sha256"],
        }, indent=2))
        return 0 if result["run_status"] == "COMPLETE" else 2
    except (ProtocolError, GuardError, FileExistsError) as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    except RunFailure as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
