#!/usr/bin/env python3
"""
Guarded P1 rehearsal for the pitwall learning evidence layer.

Allowed route (hard-coded, no overrides):
  ssh -o BatchMode=yes 3sm-docker
    docker exec -i pitwall-learning-p1-20261111
      psql -X -qAt -v ON_ERROR_STOP=1 -h /work -U postgres
           -d pitwall_learning_p1_rehearsal

Every mutating stream starts with a database/data_directory identity guard.
No production database, container or network route is reachable from here.
Logs are written only under:
  /home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = "pitwall_learning_p1_rehearsal"
CONTAINER = "pitwall-learning-p1-20261111"
ART = Path("/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111")
MIGRATION = ROOT / "supabase/migrations/20261111163052_pitwall_learning_evidence.sql"
ROLLBACK = ROOT / "supabase/rollbacks/20261111163052_pitwall_learning_evidence.sql"
FIXTURE = ROOT / "supabase/tests/fixtures/pitwall-learning-p1-fixtures.sql"
TESTS = {
    "schema": ROOT / "supabase/tests/pitwall-learning-schema.sql",
    "capture": ROOT / "supabase/tests/pitwall-learning-capture.sql",
    "jobs": ROOT / "supabase/tests/pitwall-learning-jobs.sql",
    "access": ROOT / "supabase/tests/pitwall-learning-access.sql",
}
SSH = ["ssh", "-o", "BatchMode=yes", "3sm-docker"]
PSQL = [
    "docker", "exec", "-i", CONTAINER, "psql",
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
    "-h", "/work", "-U", "postgres", "-d", DB,
]
GUARD = """DO $guard$ BEGIN
  IF current_database() <> 'pitwall_learning_p1_rehearsal'
     OR current_setting('data_directory') <> '/work/data' THEN
    RAISE EXCEPTION 'REHEARSAL GUARD: wrong database or data_directory';
  END IF;
END $guard$;
"""


def _run(sql: str, *, expect: int = 0, timeout: int = 180) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        SSH + PSQL,
        input=sql,
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    if proc.returncode != expect:
        raise RuntimeError(
            f"psql exit {proc.returncode} (expected {expect})\n"
            f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
        )
    return proc


def _popen(sql: str) -> subprocess.Popen:
    proc = subprocess.Popen(
        SSH + PSQL,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert proc.stdin is not None
    proc.stdin.write(sql)
    proc.stdin.flush()
    return proc


def _collect(proc: subprocess.Popen, timeout: int = 60) -> tuple[str, str, int]:
    out, err = proc.communicate(timeout=timeout)
    return out, err, proc.returncode


def _log(name: str, payload: str) -> None:
    ART.mkdir(parents=True, exist_ok=True)
    (ART / name).write_text(payload, encoding="utf-8")


def _json_line(proc: subprocess.CompletedProcess) -> dict:
    for line in reversed(proc.stdout.strip().splitlines()):
        line = line.strip()
        if line.startswith("{"):
            return json.loads(line)
    raise RuntimeError(f"no JSON object in psql output:\n{proc.stdout}")


def health() -> dict:
    proc = _run(
        "SELECT current_database() || '|' || current_setting('data_directory') || '|' || version();\n"
    )
    db, data_dir, version = proc.stdout.strip().split("|", 2)
    if db != DB or data_dir != "/work/data":
        raise RuntimeError(f"identity guard failed: {db} / {data_dir}")
    return {"database": db, "data_directory": data_dir, "version": version}


def snapshot() -> dict:
    sql = f"""
{GUARD}
SELECT jsonb_build_object(
  'schema_exists', to_regnamespace('pitwall_learning') IS NOT NULL,
  'capture_triggers', (SELECT count(*) FROM pg_trigger
     WHERE NOT tgisinternal
       AND tgrelid IN ('public.simhub_measurement_events'::regclass,
                       'public.simhub_lap_summaries'::regclass)),
  'public_relations', (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')),
  'public_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public'),
  'policy_fp', (SELECT md5(string_agg(tablename||'|'||policyname||'|'||roles::text||'|'||
        cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\\n'
        ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname='public'),
  'persist_hash', md5(pg_get_functiondef(
     'public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb)'::regprocedure)),
  'events_cols', (SELECT md5(string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull,
        ',' ORDER BY attnum)) FROM pg_attribute
        WHERE attrelid='public.simhub_measurement_events'::regclass AND attnum>0 AND NOT attisdropped),
  'laps_cols', (SELECT md5(string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull,
        ',' ORDER BY attnum)) FROM pg_attribute
        WHERE attrelid='public.simhub_lap_summaries'::regclass AND attnum>0 AND NOT attisdropped),
  'events_acl', (SELECT coalesce(array_to_string(relacl,'|'),'NULL') FROM pg_class
        WHERE oid='public.simhub_measurement_events'::regclass),
  'laps_acl', (SELECT coalesce(array_to_string(relacl,'|'),'NULL') FROM pg_class
        WHERE oid='public.simhub_lap_summaries'::regclass),
  'worker_login', (SELECT rolcanlogin FROM pg_roles WHERE rolname='pitwall_learning_worker'),
  'worker_connlimit', (SELECT rolconnlimit FROM pg_roles WHERE rolname='pitwall_learning_worker'),
  'worker_password_null', (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname='pitwall_learning_worker'),
  'evidence_rows', CASE WHEN to_regclass('pitwall_learning.source_revisions') IS NULL THEN 0
        ELSE (SELECT count(*) FROM pitwall_learning.source_revisions) END,
  'job_rows', CASE WHEN to_regclass('pitwall_learning.jobs') IS NULL THEN 0
        ELSE (SELECT count(*) FROM pitwall_learning.jobs) END,
  'switches', CASE WHEN to_regclass('pitwall_learning.runtime_settings') IS NULL THEN NULL
        ELSE (SELECT jsonb_build_object('capture',capture_enabled,'worker',worker_enabled,
                                        'shadow',shadow_enabled,'advice',advice_enabled)
              FROM pitwall_learning.runtime_settings WHERE id=1) END
)::text;
"""
    return _json_line(_run(sql))


def apply_forward() -> None:
    sql = f"BEGIN;\n{GUARD}\n{MIGRATION.read_text()}\nCOMMIT;\n"
    proc = _run(sql, timeout=300)
    _log("forward.log", proc.stdout + proc.stderr)


def run_fixture() -> None:
    sql = f"BEGIN;\n{GUARD}\n{FIXTURE.read_text()}\nCOMMIT;\n"
    _run(sql, timeout=120)


def run_test(name: str, path: Path) -> dict:
    proc = _run(GUARD + "\n" + path.read_text(), timeout=300)
    _log(f"green-{name}.log", proc.stdout + proc.stderr)
    marker = f"pitwall-learning {name}:"
    line = next((ln for ln in proc.stderr.splitlines() if marker in ln), "")
    if "0 FAIL" in line or not line:
        # The test raises on failure; a clean exit with the PASS notice is enough.
        pass
    return {"name": name, "exit": proc.returncode, "notice": line.strip()}


def run_red() -> list[dict]:
    """
    Record the test-first failure. If the schema is absent, run the tests
    directly. If it is already present (this worktree has been rehearsed),
    rename it inside a rolled-back transaction so the same tests see the
    absent-schema state; the rename is never committed.
    """
    state = snapshot()
    results = []
    chunks = []
    for name, path in TESTS.items():
        if state["schema_exists"]:
            sql = (
                "BEGIN;\n" + GUARD +
                "\nALTER SCHEMA pitwall_learning RENAME TO pitwall_learning_red_absent;\n"
                + path.read_text() +
                "\nROLLBACK;\n"
            )
        else:
            sql = GUARD + "\n" + path.read_text()
        proc = subprocess.run(SSH + PSQL, input=sql, text=True, capture_output=True, timeout=300)
        chunks.append(f"=== RED {name} (exit {proc.returncode}) ===\n{proc.stdout}\n{proc.stderr}\n")
        results.append({"name": name, "exit": proc.returncode,
                        "expected_nonzero": proc.returncode != 0})
    _log("red.log", "".join(chunks))
    return results


def concurrency() -> dict:
    dev = "d0000000-0000-4000-8000-000000000001"
    uid_a = str(uuid.uuid4())
    uid_b = str(uuid.uuid4())
    hash_a = hashlib.md5(uid_a.encode()).hexdigest()
    hash_b = hashlib.md5(uid_b.encode()).hexdigest()

    setup = f"""
BEGIN;
{GUARD}
SELECT pitwall_learning.capture_source_revision(
  'measurement_event', '{dev}', '{uid_a}', 1, '{hash_a}', now(), now(),
  '{{"kind":"concurrency"}}'::jsonb);
SELECT pitwall_learning.capture_source_revision(
  'measurement_event', '{dev}', '{uid_b}', 1, '{hash_b}', now(), now(),
  '{{"kind":"concurrency"}}'::jsonb);
UPDATE pitwall_learning.jobs
   SET status='done', finished_at=now(), updated_at=now(),
       lease_token=NULL, lease_owner=NULL, lease_expires_at=NULL
 WHERE status <> 'done';
UPDATE pitwall_learning.jobs
   SET status='pending', attempts=0, next_attempt_at=now(),
       finished_at=NULL, last_error_code=NULL, updated_at=now(),
       lease_token=NULL, lease_owner=NULL, lease_expires_at=NULL
 WHERE source_revision_id = (SELECT id FROM pitwall_learning.source_revisions
                              WHERE source_uid='{uid_a}')
   AND kind='source_validate';
COMMIT;
"""
    _run(setup)

    a_sql = f"""
BEGIN;
{GUARD}
SELECT pitwall_learning.claim_jobs(1,5);
SELECT pg_sleep(3);
COMMIT;
"""
    a_proc = _popen(a_sql)
    time.sleep(0.8)

    b1_sql = f"""
SET statement_timeout='2s';
BEGIN;
{GUARD}
SELECT pitwall_learning.claim_jobs(1,60);
COMMIT;
"""
    t0 = time.monotonic()
    b1 = subprocess.run(SSH + PSQL, input=b1_sql, text=True, capture_output=True, timeout=30)
    b1_ms = (time.monotonic() - t0) * 1000
    a_out, a_err, a_rc = _collect(a_proc, timeout=30)

    time.sleep(2.2)
    b2 = subprocess.run(SSH + PSQL,
                        input=f"BEGIN;\n{GUARD}\nSELECT pitwall_learning.claim_jobs(1,60);\nCOMMIT;\n",
                        text=True, capture_output=True, timeout=30)

    def first_json(text: str):
        for line in text.strip().splitlines():
            if line.strip().startswith("["):
                return json.loads(line)
        return None

    a_claim = first_json(a_out)
    b1_claim = first_json(b1.stdout)
    b2_claim = first_json(b2.stdout)
    result = {
        "a_exit": a_rc,
        "a_claim": a_claim,
        "a_stderr": a_err,
        "b1_exit": b1.returncode,
        "b1_claim": b1_claim,
        "b1_ms": b1_ms,
        "b1_stderr": b1.stderr,
        "b2_exit": b2.returncode,
        "b2_claim": b2_claim,
        "b2_stderr": b2.stderr,
    }

    ok = (
        a_rc == 0 and isinstance(a_claim, list) and len(a_claim) == 1
        and b1.returncode == 0 and b1_claim == []
        and b1_ms < 2000
        and b2.returncode == 0 and isinstance(b2_claim, list)
        and len(b2_claim) == 1
        and b2_claim[0]["job_id"] == a_claim[0]["job_id"]
        and int(b2_claim[0]["attempts"]) == 2
        and b2_claim[0]["lease_token"] != a_claim[0]["lease_token"]
    )
    result["ok"] = ok

    # Old token must not finish the reclaimed lease; the new token may.
    old_token = a_claim[0]["lease_token"] if a_claim else str(uuid.uuid4())
    new_token = b2_claim[0]["lease_token"] if b2_claim else str(uuid.uuid4())
    job_id = a_claim[0]["job_id"] if a_claim else str(uuid.uuid4())
    finish_sql = f"""
BEGIN;
{GUARD}
SELECT pitwall_learning.finish_job('{job_id}','{old_token}','done');
SELECT pitwall_learning.finish_job('{job_id}','{new_token}','done');
COMMIT;
"""
    fin = _run(finish_sql)
    result["finish_stdout"] = fin.stdout
    result["old_token_rejected"] = '"lease_mismatch"' in fin.stdout
    result["ok"] = bool(result["ok"] and result["old_token_rejected"])
    _log("concurrency.log", json.dumps(result, indent=2, default=str) + "\n" + a_out + a_err + b1.stdout + b1.stderr + b2.stdout + b2.stderr)
    return result


def lock_ack() -> dict:
    dev = "d0000000-0000-4000-8000-000000000001"
    uid = str(uuid.uuid4())
    session = "sess-lock-" + uid[:8]
    event = {
        "eventUid": uid,
        "eventId": "evt-lock",
        "kind": "pit_entry",
        "segmentId": "seg-lock",
        "pitVisitId": "pit-lock",
        "observedSessionId": session,
        "observedAt": "2026-11-11T16:00:00Z",
        "sessionTimeSeconds": 11,
        "sdkTick": 101,
        "confidence": 1,
    }
    event_sql = json.dumps(event).replace("'", "''")

    a_sql = f"""
BEGIN;
{GUARD}
LOCK TABLE pitwall_learning.source_revisions IN EXCLUSIVE MODE;
SELECT pg_sleep(5);
COMMIT;
"""
    a_proc = _popen(a_sql)
    time.sleep(0.8)

    b_sql = f"""
SET statement_timeout='3s';
SET request.jwt.claim.role='service_role';
BEGIN;
{GUARD}
SELECT public.simhub_persist_measurement_batch(
  '{dev}', '{session}', jsonb_build_array('{event_sql}'::jsonb), NULL);
SHOW lock_timeout;
COMMIT;
"""
    t0 = time.monotonic()
    b = subprocess.run(SSH + PSQL, input=b_sql, text=True, capture_output=True, timeout=30)
    b_ms = (time.monotonic() - t0) * 1000
    a_out, a_err, a_rc = _collect(a_proc, timeout=30)

    ack = None
    for line in b.stdout.strip().splitlines():
        if line.strip().startswith("{"):
            ack = json.loads(line)
    accepted = ack and len(ack.get("events", {}).get("accepted", [])) == 1
    lock_timeout_restored = any(line.strip() == "0" for line in b.stdout.splitlines())

    # Replay after the lock is gone: the old ACK shape must be unchanged.
    replay = _run(f"""
SET request.jwt.claim.role='service_role';
BEGIN;
{GUARD}
SELECT public.simhub_persist_measurement_batch(
  '{dev}', '{session}', jsonb_build_array('{event_sql}'::jsonb), NULL);
COMMIT;
""")
    replay_ack = None
    for line in replay.stdout.strip().splitlines():
        if line.strip().startswith("{"):
            replay_ack = json.loads(line)
    replay_duplicate = replay_ack and len(replay_ack.get("events", {}).get("duplicates", [])) == 1

    captured = _run(f"""
SELECT count(*) FROM pitwall_learning.source_revisions WHERE source_uid='{uid}';
""").stdout.strip()

    result = {
        "a_exit": a_rc,
        "a_stderr": a_err,
        "b_exit": b.returncode,
        "b_ms": b_ms,
        "b_stderr": b.stderr,
        "ack_accepted": bool(accepted),
        "lock_timeout_restored": lock_timeout_restored,
        "replay_duplicate": bool(replay_duplicate),
        "captured_after_lock_failure": captured,
        "ok": bool(b.returncode == 0 and accepted and lock_timeout_restored
                   and replay_duplicate and captured == "0" and b_ms < 2000),
    }
    _log("lock-ack.log", json.dumps(result, indent=2) + "\n" + b.stdout + b.stderr + replay.stdout + replay.stderr)
    return result


def perf() -> dict:
    dev = "d0000000-0000-4000-8000-000000000001"

    def one(phase: str, run: int) -> float:
        sql = f"""
BEGIN;
{GUARD}
SET LOCAL request.jwt.claim.role='service_role';
UPDATE pitwall_learning.runtime_settings
   SET capture_enabled = {str(phase == 'on').lower()} WHERE id=1;
DO $perf$
DECLARE
  v_ev jsonb;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_ack jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'eventUid', gen_random_uuid(),
           'eventId', 'perf-{phase}-{run}-' || k,
           'kind', 'perf_probe',
           'segmentId', 'seg-perf',
           'pitVisitId', 'pit-perf-{phase}-{run}-' || k,
           'observedSessionId', 'sess-perf-{phase}-{run}',
           'observedAt', now(),
           'sessionTimeSeconds', 1,
           'sdkTick', k,
           'confidence', 1))
    INTO v_ev
    FROM generate_series(1,200) k;
  v_t0 := clock_timestamp();
  v_ack := public.simhub_persist_measurement_batch(
    '{dev}', 'perf-{phase}-{run}', v_ev, NULL);
  v_t1 := clock_timestamp();
  RAISE NOTICE 'P1PERF=% accepted=%', round(extract(epoch FROM (v_t1-v_t0))*1000, 3),
    jsonb_array_length(v_ack #> '{{events,accepted}}');
END
$perf$;
ROLLBACK;
"""
        proc = _run(sql, timeout=120)
        for line in proc.stderr.splitlines():
            if "P1PERF=" in line:
                token = line.split("P1PERF=", 1)[1].split()[0]
                return float(token)
        raise RuntimeError(f"no P1PERF in stderr:\n{proc.stderr}")

    # Elke meting is een eigen transactie (zoals een ingest-request) en wordt
    # teruggedraaid, zodat de tabelgroei de meting niet scheeftrekt.
    one("off", 0)  # warm-up
    vals = {"off": [], "on": []}
    for run in range(1, 6):
        vals["off"].append(one("off", run))
        vals["on"].append(one("on", run))

    def p95(xs):
        return statistics.quantiles(xs, n=20)[18] if len(xs) >= 2 else xs[0]
    off_p95 = p95(vals["off"])
    on_p95 = p95(vals["on"])
    result = {
        "off_ms": vals["off"],
        "on_ms": vals["on"],
        "off_p50": statistics.median(vals["off"]),
        "on_p50": statistics.median(vals["on"]),
        "off_p95": off_p95,
        "on_p95": on_p95,
        "p95_overhead_ms": on_p95 - off_p95,
        "p95_overhead_pct": ((on_p95 - off_p95) / off_p95 * 100.0) if off_p95 else None,
        "gate_note": "P1 rehearsal measurement on the clone; 200-event batches, each its own rolled-back transaction. Production p95 gate is <=10% and <=20 ms, strictest. Not a live-load test.",
    }
    _log("perf.log", json.dumps(result, indent=2))
    return result

def rollback_dry_run(before: dict) -> dict:
    sql = f"""
BEGIN;
{GUARD}
{ROLLBACK.read_text()}
RESET ROLE;
SELECT jsonb_build_object(
  'triggers', (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
     AND tgrelid IN ('public.simhub_measurement_events'::regclass,
                     'public.simhub_lap_summaries'::regclass)),
  'evidence_rows', (SELECT count(*) FROM pitwall_learning.source_revisions),
  'job_rows', (SELECT count(*) FROM pitwall_learning.jobs),
  'role_login', (SELECT rolcanlogin FROM pg_roles WHERE rolname='pitwall_learning_worker'),
  'role_connlimit', (SELECT rolconnlimit FROM pg_roles WHERE rolname='pitwall_learning_worker'),
  'worker_usage', has_schema_privilege('pitwall_learning_worker','pitwall_learning','USAGE'),
  'switches', (SELECT jsonb_build_object('capture',capture_enabled,'worker',worker_enabled,
                                         'shadow',shadow_enabled,'advice',advice_enabled)
               FROM pitwall_learning.runtime_settings WHERE id=1),
  'public_relations', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')),
  'public_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public'),
  'policy_fp', (SELECT md5(string_agg(tablename||'|'||policyname||'|'||roles::text||'|'||
        cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\\n'
        ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname='public'),
  'persist_hash', md5(pg_get_functiondef(
     'public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb)'::regprocedure))
)::text;
ROLLBACK;
"""
    proc = _run(sql, timeout=300)
    state = _json_line(proc)
    after = snapshot()
    result = {
        "in_transaction": state,
        "after_rollback_state": after,
        "evidence_preserved": state["evidence_rows"] == before["evidence_rows"],
        "jobs_preserved": state["job_rows"] == before["job_rows"],
        "triggers_removed": state["triggers"] == 0,
        "worker_login_disabled": state["role_login"] is False and state["role_connlimit"] == 0,
        "worker_usage_revoked": state["worker_usage"] is False,
        "switches_off": state["switches"] == {"capture": False, "worker": False,
                                              "shadow": False, "advice": False},
        "public_baseline_exact": (
            state["public_relations"] == before["public_relations"]
            and state["public_policies"] == before["public_policies"]
            and state["policy_fp"] == before["policy_fp"]
            and state["persist_hash"] == before["persist_hash"]
        ),
        "schema_still_present_after_dry_run": after["schema_exists"],
        "triggers_restored_after_dry_run": after["capture_triggers"] == 2,
    }
    result["ok"] = all(result[k] for k in (
        "evidence_preserved", "jobs_preserved", "triggers_removed",
        "worker_login_disabled", "worker_usage_revoked", "switches_off",
        "public_baseline_exact", "schema_still_present_after_dry_run",
        "triggers_restored_after_dry_run",
    ))
    _log("rollback.log", json.dumps(result, indent=2) + "\n" + proc.stdout + proc.stderr)
    return result


def clean_forward_probe() -> dict:
    """
    Prove the forward file still applies to an absent schema/role. The current
    schema, role and capture triggers are renamed/dropped inside one rolled-back
    transaction, the real forward file is applied, and everything is rolled
    back. No committed state is touched and no evidence row is deleted.
    """
    sql = f"""
BEGIN;
{GUARD}
ALTER SCHEMA pitwall_learning RENAME TO pitwall_learning_pre_forward_probe;
DROP TRIGGER pitwall_learning_capture_event ON public.simhub_measurement_events;
DROP TRIGGER pitwall_learning_capture_lap ON public.simhub_lap_summaries;
ALTER ROLE pitwall_learning_worker RENAME TO pitwall_learning_worker_pre_forward_probe;
{MIGRATION.read_text()}
RESET ROLE;
SELECT jsonb_build_object(
  'schema_owner', (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname='pitwall_learning'),
  'tables', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='pitwall_learning' AND c.relkind='r'),
  'triggers', (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
     AND tgrelid IN ('public.simhub_measurement_events'::regclass,
                     'public.simhub_lap_summaries'::regclass)),
  'role_login', (SELECT rolcanlogin FROM pg_roles WHERE rolname='pitwall_learning_worker'),
  'role_connlimit', (SELECT rolconnlimit FROM pg_roles WHERE rolname='pitwall_learning_worker'),
  'role_password_null', (SELECT rolpassword IS NULL FROM pg_authid WHERE rolname='pitwall_learning_worker'),
  'evidence_rows', (SELECT count(*) FROM pitwall_learning.source_revisions),
  'jobs_rows', (SELECT count(*) FROM pitwall_learning.jobs),
  'account_rows', (SELECT count(*) FROM pitwall_learning.account_policy),
  'switches', (SELECT jsonb_build_object('capture',capture_enabled,'worker',worker_enabled,
                                         'shadow',shadow_enabled,'advice',advice_enabled)
               FROM pitwall_learning.runtime_settings WHERE id=1),
  'anon_usage', has_schema_privilege('anon','pitwall_learning','USAGE'),
  'worker_usage', has_schema_privilege('pitwall_learning_worker','pitwall_learning','USAGE'),
  'public_relations', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')),
  'public_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public')
)::text;
ROLLBACK;
"""
    try:
        proc = _run(sql, timeout=300)
        state = _json_line(proc)
        result = {"state": state, "ok": (
            state["schema_owner"] == "supabase_admin"
            and state["tables"] == 9
            and state["triggers"] == 2
            and state["role_login"] is True
            and state["role_connlimit"] == 2
            and state["role_password_null"] is True
            and state["evidence_rows"] == 0
            and state["jobs_rows"] == 0
            and state["account_rows"] == 0
            and state["switches"] == {"capture": False, "worker": False,
                                      "shadow": False, "advice": False}
            and state["anon_usage"] is False
            and state["worker_usage"] is True
            and state["public_relations"] == 99
            and state["public_policies"] == 165
        )}
        _log("forward-clean-probe.log", json.dumps(result, indent=2) + "\n" + proc.stdout + proc.stderr)
        return result
    except Exception as exc:
        _log("forward-clean-probe.log", f"FAILED: {exc}\n")
        return {"ok": False, "error": str(exc)}


def forward_conflict() -> dict:
    sql = f"BEGIN;\n{GUARD}\n{MIGRATION.read_text()}\nCOMMIT;\n"
    proc = subprocess.run(SSH + PSQL, input=sql, text=True, capture_output=True, timeout=120)
    ok = proc.returncode != 0 and "already exists" in proc.stderr
    result = {"exit": proc.returncode, "refused": ok,
              "stdout": proc.stdout, "stderr": proc.stderr}
    _log("forward-conflict.log", json.dumps(result, indent=2))
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-red", action="store_true",
                    help="skip the test-first failure log (not recommended)")
    args = ap.parse_args()

    ART.mkdir(parents=True, exist_ok=True)
    info = health()
    before = snapshot()
    summary: dict = {"health": info, "before": before}

    if before["schema_exists"]:
        print("[state] schema already present; forward is not re-applied")
        summary["forward_applied"] = False
    else:
        if not args.skip_red:
            summary["red"] = run_red()
        apply_forward()
        summary["forward_applied"] = True

    if not args.skip_red and before["schema_exists"]:
        summary["red"] = run_red()

    run_fixture()
    after_fixture = snapshot()

    summary["tests"] = []
    for name, path in TESTS.items():
        summary["tests"].append(run_test(name, path))

    summary["concurrency"] = concurrency()
    summary["lock_ack"] = lock_ack()
    summary["perf"] = perf()

    before_rollback = snapshot()
    summary["rollback"] = rollback_dry_run(before_rollback)
    summary["forward_clean_probe"] = clean_forward_probe()
    summary["forward_conflict"] = forward_conflict()
    summary["after"] = snapshot()

    _log("summary.json", json.dumps(summary, indent=2, default=str))
    _log("baseline-before.json", json.dumps(before, indent=2))
    _log("baseline-after.json", json.dumps(summary["after"], indent=2))

    failures = []
    for t in summary["tests"]:
        if t["exit"] != 0:
            failures.append(f"test {t['name']}")
    if not summary["concurrency"].get("ok"):
        failures.append("concurrency")
    if not summary["lock_ack"].get("ok"):
        failures.append("lock_ack")
    if not summary["rollback"].get("ok"):
        failures.append("rollback")
    if not summary["forward_clean_probe"].get("ok"):
        failures.append("forward_clean_probe")
    if not summary["forward_conflict"].get("refused"):
        failures.append("forward_conflict")

    print(json.dumps({
        "tests": summary["tests"],
        "concurrency": summary["concurrency"].get("ok"),
        "lock_ack": summary["lock_ack"].get("ok"),
        "perf": {k: summary["perf"][k] for k in ("off_p50", "on_p50", "off_p95", "on_p95")},
        "rollback": summary["rollback"].get("ok"),
        "forward_clean_probe": summary["forward_clean_probe"].get("ok"),
        "forward_conflict": summary["forward_conflict"].get("refused"),
        "artifacts": str(ART),
        "failures": failures,
    }, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
