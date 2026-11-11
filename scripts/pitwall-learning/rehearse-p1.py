#!/usr/bin/env python3
"""
Guarded P1 rehearsal for the pitwall learning evidence layer (bounded review).

Allowed route (hard-coded, no overrides):
  ssh -o BatchMode=yes 3sm-docker
    docker exec -i pitwall-learning-p1-20261111
      psql -X -qAt -v ON_ERROR_STOP=1 -h /work -U postgres
           -d pitwall_learning_p1_rehearsal

Every mutating stream starts with a database/data_directory identity guard.
No production database, container or network route is reachable from here.
Logs are written only under:
  /home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/bounded-review/
(previous review logs in the parent directory are never overwritten)

Performance method:
  * primary frame = wire-representative maximum shape: 20 events carrying
    wear before/after + evidence, plus 3 full lap aggregates, together within
    the 16384-byte request-part budget and the 24576-byte body budget;
  * separately labelled DB-only stress = 200 events (the DB batch maximum),
    never presented as a wire frame;
  * three phases per paired round: triggers absent (true pre-migration),
    installed with capture disabled, installed with capture enabled;
  * >=30 paired samples per phase after a discarded warm-up round;
  * nearest-rank p95 (no interpolated/extrapolated quantiles);
  * gate = p95 overhead versus the absent baseline <=10% AND <=20 ms.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = "pitwall_learning_p1_rehearsal"
CONTAINER = "pitwall-learning-p1-20261111"
ART = Path("/home/hermes/artifacts/3sm/pitwall-learning-p1-20261111/bounded-review")
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
TRIGGER_NAMES = [
    ("pitwall_learning_capture_event_ins", "public.simhub_measurement_events"),
    ("pitwall_learning_capture_event_upd", "public.simhub_measurement_events"),
    ("pitwall_learning_capture_lap_ins", "public.simhub_lap_summaries"),
    ("pitwall_learning_capture_lap_upd", "public.simhub_lap_summaries"),
    # Legacy v1 row triggers: present only on the already-built test clone.
    # They must be removed before the statement triggers are measured or the
    # "absent" phase would still capture (and would double-write).
    ("pitwall_learning_capture_event", "public.simhub_measurement_events"),
    ("pitwall_learning_capture_lap", "public.simhub_lap_summaries"),
]
DROP_TRIGGERS = "\n".join(
    f"DROP TRIGGER IF EXISTS {n} ON {t};" for n, t in TRIGGER_NAMES
)
ARCHIVE_SCHEMA = "pitwall_learning_v1_archive"
ARCHIVE_ROLE = "pitwall_learning_worker_v1_archive"

SR_COLS = """id, source_kind, device_id, source_uid, record_revision, content_hash,
  observed_at, source_received_at, server_receipt_at, receipt_commit_visible,
  as_of_quality, owner_user_id, owner_basis, account_policy_version,
  canonical_context, context_status, training_eligible, extractor_version,
  payload, quality_reasons, created_at"""
JOB_COLS = """id, source_revision_id, kind, status, attempts, max_attempts,
  next_attempt_at, lease_token, lease_owner, lease_expires_at, last_error_code,
  created_at, updated_at, finished_at"""
POLICY_COLS = """owner_user_id, policy_version, capture_enabled, personal_fit_enabled,
  pooling_enabled, serving_enabled, retention_jobs_days, retention_source_days,
  retention_forecast_days, created_at, updated_at, updated_by"""


def _run(sql: str, *, expect: int = 0, timeout: int = 300) -> subprocess.CompletedProcess:
    proc = subprocess.run(
        SSH + PSQL, input=sql, text=True, capture_output=True, timeout=timeout,
    )
    if proc.returncode != expect:
        raise RuntimeError(
            f"psql exit {proc.returncode} (expected {expect})\n"
            f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
        )
    return proc


def _popen(sql: str) -> subprocess.Popen:
    proc = subprocess.Popen(
        SSH + PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
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


def nearest_rank(xs: list[float], p: float) -> float:
    """Nearest-rank quantile: sorted[ceil(p*n)-1]. No interpolation."""
    ordered = sorted(xs)
    if not ordered:
        raise ValueError("no samples")
    k = max(1, math.ceil(p * len(ordered)))
    return ordered[k - 1]


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
  'archive_schema', to_regnamespace('{ARCHIVE_SCHEMA}') IS NOT NULL,
  'capture_triggers', (SELECT count(*) FROM pg_trigger
     WHERE NOT tgisinternal
       AND tgrelid IN ('public.simhub_measurement_events'::regclass,
                       'public.simhub_lap_summaries'::regclass)),
  'private_functions', CASE WHEN to_regnamespace('pitwall_learning') IS NULL THEN 0
     ELSE (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='pitwall_learning') END,
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
  'evidence_fp', CASE WHEN to_regclass('pitwall_learning.source_revisions') IS NULL THEN 'absent'
        ELSE (SELECT md5(string_agg(md5(to_jsonb(r)::text), '' ORDER BY md5(to_jsonb(r)::text)))
              FROM pitwall_learning.source_revisions r) END,
  'job_rows', CASE WHEN to_regclass('pitwall_learning.jobs') IS NULL THEN 0
        ELSE (SELECT count(*) FROM pitwall_learning.jobs) END,
  'switches', CASE WHEN to_regclass('pitwall_learning.runtime_settings') IS NULL THEN NULL
        ELSE (SELECT jsonb_build_object('capture',capture_enabled,'worker',worker_enabled,
                                        'shadow',shadow_enabled,'advice',advice_enabled)
              FROM pitwall_learning.runtime_settings WHERE id=1) END
)::text;
"""
    return _json_line(_run(sql))


def migrate_retained(state: dict) -> dict:
    """
    Upgrade the already-built v1 test clone to this review's forward file
    without losing a single evidence byte.

    The v1 schema and role are renamed to an archive (never dropped), the real
    forward file is applied to an absent namespace, and every evidence/job/
    policy row is copied with explicit columns. Inside the same transaction a
    row-image checksum proves the copy is exact; a mismatch raises and the
    whole transaction rolls back. The archived schema keeps the original rows,
    so nothing is destroyed even if someone inspects it later.
    """
    if not state["schema_exists"]:
        return {"applied": False, "reason": "schema absent"}
    if state["capture_triggers"] == 4 and state["private_functions"] == 11:
        return {"applied": False, "reason": "already v4"}

    sql = f"""BEGIN;
{GUARD}
ALTER SCHEMA pitwall_learning RENAME TO {ARCHIVE_SCHEMA};
ALTER ROLE pitwall_learning_worker RENAME TO {ARCHIVE_ROLE};
ALTER ROLE {ARCHIVE_ROLE} NOLOGIN;
ALTER ROLE {ARCHIVE_ROLE} CONNECTION LIMIT 0;
REVOKE ALL ON SCHEMA {ARCHIVE_SCHEMA} FROM {ARCHIVE_ROLE};
REVOKE ALL ON ALL TABLES IN SCHEMA {ARCHIVE_SCHEMA} FROM {ARCHIVE_ROLE};
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA {ARCHIVE_SCHEMA} FROM {ARCHIVE_ROLE};
{DROP_TRIGGERS}
{MIGRATION.read_text()}
INSERT INTO pitwall_learning.source_revisions ({SR_COLS})
  SELECT {SR_COLS} FROM {ARCHIVE_SCHEMA}.source_revisions;
INSERT INTO pitwall_learning.jobs ({JOB_COLS})
  SELECT {JOB_COLS} FROM {ARCHIVE_SCHEMA}.jobs;
INSERT INTO pitwall_learning.account_policy ({POLICY_COLS})
  SELECT {POLICY_COLS} FROM {ARCHIVE_SCHEMA}.account_policy;
UPDATE pitwall_learning.runtime_settings rs
   SET capture_enabled = o.capture_enabled,
       worker_enabled = o.worker_enabled,
       shadow_enabled = o.shadow_enabled,
       advice_enabled = o.advice_enabled,
       updated_at = o.updated_at,
       updated_by = o.updated_by
  FROM {ARCHIVE_SCHEMA}.runtime_settings o
 WHERE rs.id = 1 AND o.id = 1;
DO $copy$
DECLARE
  v_bad integer;
  v_src bigint;
  v_dst bigint;
BEGIN
  SELECT count(*) INTO v_src FROM {ARCHIVE_SCHEMA}.source_revisions;
  SELECT count(*) INTO v_dst FROM pitwall_learning.source_revisions;
  IF v_src <> v_dst THEN
    RAISE EXCEPTION 'evidence copy count mismatch: % -> %', v_src, v_dst;
  END IF;
  SELECT count(*) INTO v_bad FROM (
    SELECT id, md5(to_jsonb(r)::text) AS h FROM {ARCHIVE_SCHEMA}.source_revisions r
    EXCEPT
    SELECT id, md5(to_jsonb(r)::text) FROM pitwall_learning.source_revisions r
  ) x;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'evidence copy mismatch: % rows', v_bad;
  END IF;
  SELECT count(*) INTO v_bad FROM (
    SELECT id, md5(to_jsonb(j)::text) AS h FROM {ARCHIVE_SCHEMA}.jobs j
    EXCEPT
    SELECT id, md5(to_jsonb(j)::text) FROM pitwall_learning.jobs j
  ) y;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'job copy mismatch: % rows', v_bad;
  END IF;
END $copy$;
COMMIT;
"""
    proc = _run(sql, timeout=300)
    after = snapshot()
    return {
        "applied": True,
        "archive_schema": ARCHIVE_SCHEMA,
        "evidence_before": state["evidence_rows"],
        "evidence_after": after["evidence_rows"],
        "evidence_fp_equal": state["evidence_fp"] == after["evidence_fp"],
        "jobs_before": state["job_rows"],
        "jobs_after": after["job_rows"],
        "stdout": proc.stdout,
    }


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
    return {"name": name, "exit": proc.returncode, "notice": line.strip()}


def run_red() -> list[dict]:
    """
    Schema-absence RED only: proves the test files cannot pass without the
    private schema. The review-specific RED probes (row triggers, unbounded
    dead-letter lock, NULL outcome, unfiltered export) are recorded in
    red-01..red-04 logs next to this harness's output.
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
    _log("red-schema-absence.log", "".join(chunks))
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
    _log("concurrency.log", json.dumps(result, indent=2, default=str) + "\n"
         + a_out + a_err + b1.stdout + b1.stderr + b2.stdout + b2.stderr)
    return result


def deadletter_lock() -> dict:
    """
    Two real connections: A holds a row lock on an exhausted (attempts=3)
    job; B must be able to claim an unrelated healthy job immediately. The
    dead-letter sweep must SKIP LOCKED (bounded), not queue behind A.
    """
    dev = "d0000000-0000-4000-8000-000000000001"
    uid_e, uid_r = str(uuid.uuid4()), str(uuid.uuid4())

    # Both jobs must be eligible under the new policy-bound claim, so they are
    # created through the real capture helper rather than by direct insert.
    setup = f"""BEGIN;
{GUARD}
UPDATE pitwall_learning.jobs
   SET status='done', finished_at=now(), updated_at=now(),
       lease_token=NULL, lease_owner=NULL, lease_expires_at=NULL
 WHERE status <> 'done';
SELECT pitwall_learning.capture_source_revision(
  'measurement_event', '{dev}', '{uid_e}', 1,
  md5('{uid_e}'), now(), now(), '{{"kind":"pit_entry"}}'::jsonb);
SELECT pitwall_learning.capture_source_revision(
  'measurement_event', '{dev}', '{uid_r}', 1,
  md5('{uid_r}'), now(), now(), '{{"kind":"pit_entry"}}'::jsonb);
SELECT jsonb_build_object(
  'e', (SELECT j.id FROM pitwall_learning.jobs j
          JOIN pitwall_learning.source_revisions r ON r.id=j.source_revision_id
         WHERE r.source_uid='{uid_e}'),
  'r', (SELECT j.id FROM pitwall_learning.jobs j
          JOIN pitwall_learning.source_revisions r ON r.id=j.source_revision_id
         WHERE r.source_uid='{uid_r}')
)::text;
COMMIT;
"""
    proc = _run(setup)
    ids = json.loads(proc.stdout.strip().splitlines()[-1])
    exhausted, ready = ids["e"], ids["r"]
    _run(f"""BEGIN;
{GUARD}
UPDATE pitwall_learning.jobs
   SET attempts=3, status='pending', next_attempt_at=now()-interval '1 minute',
       finished_at=NULL, updated_at=now()
 WHERE id='{exhausted}';
UPDATE pitwall_learning.jobs
   SET attempts=0, status='pending', next_attempt_at=now()-interval '1 minute',
       finished_at=NULL, updated_at=now()
 WHERE id='{ready}';
COMMIT;
""")

    a_sql = f"""BEGIN;
{GUARD}
SELECT id FROM pitwall_learning.jobs WHERE id='{exhausted}' FOR UPDATE;
SELECT pg_sleep(5);
COMMIT;
"""
    a_proc = _popen(a_sql)
    time.sleep(1.0)

    b_sql = f"""SET statement_timeout='3s';
BEGIN;
{GUARD}
SELECT pitwall_learning.claim_jobs(1,60);
COMMIT;
"""
    t0 = time.monotonic()
    b = subprocess.run(SSH + PSQL, input=b_sql, text=True, capture_output=True, timeout=30)
    b_ms = (time.monotonic() - t0) * 1000
    a_out, a_err, a_rc = _collect(a_proc, timeout=30)

    claim = None
    for line in b.stdout.strip().splitlines():
        if line.strip().startswith("["):
            claim = json.loads(line)

    # After A releases the lock, the exhausted job must still be swept to dead
    # without inventing a second claim of the healthy job.
    statuses = _run(f"""SELECT jsonb_build_object(
  'exhausted_status', (SELECT status FROM pitwall_learning.jobs WHERE id='{exhausted}'),
  'ready_status', (SELECT status FROM pitwall_learning.jobs WHERE id='{ready}'),
  'exhausted_error', (SELECT last_error_code FROM pitwall_learning.jobs WHERE id='{exhausted}')
)::text;
""")
    st = json.loads(statuses.stdout.strip().splitlines()[-1])

    post = _run(f"""BEGIN;
{GUARD}
SELECT pitwall_learning.claim_jobs(1,60);
COMMIT;
""")

    ok = (
        a_rc == 0
        and b.returncode == 0
        and isinstance(claim, list) and len(claim) == 1
        and claim[0]["job_id"] == ready
        and b_ms < 1500
        and st["exhausted_status"] == "pending"   # A still held the lock during B
        and st["ready_status"] == "leased"
        and st["exhausted_error"] is None
    )
    result = {
        "a_exit": a_rc,
        "a_stderr": a_err,
        "b_exit": b.returncode,
        "b_ms": b_ms,
        "b_claim": claim,
        "b_stderr": b.stderr,
        "post_claim_stdout": post.stdout,
        "statuses_after": st,
        "ok": ok,
        "assertion": "B claims the healthy job immediately while A locks the exhausted one; the locked dead-letter row is not blocked on or swept.",
    }
    _log("deadletter-lock.log", json.dumps(result, indent=2, default=str)
         + "\n" + b.stdout + b.stderr + post.stdout + post.stderr)
    return result


def worker_login() -> dict:
    """
    Real worker session over the private Unix socket (trust auth, no password):
    proves session_user/current_user, the three EXECUTE grants and a positive
    claim/export/finish. The SQL tests use SET ROLE under postgres; that cannot
    prove the session_user guard, so this probe is the real login path.
    """
    dev = "d0000000-0000-4000-8000-000000000001"
    uid = str(uuid.uuid4())
    setup = f"""BEGIN;
{GUARD}
UPDATE pitwall_learning.jobs
   SET status='done', finished_at=now(), updated_at=now(),
       lease_token=NULL, lease_owner=NULL, lease_expires_at=NULL
 WHERE status <> 'done';
SELECT pitwall_learning.capture_source_revision(
  'measurement_event', '{dev}', '{uid}', 1, md5('{uid}'), now(), now(),
  '{{"kind":"pit_entry"}}'::jsonb);
COMMIT;
"""
    _run(setup)
    rev = _run(f"SELECT id FROM pitwall_learning.source_revisions WHERE source_uid='{uid}';"
               ).stdout.strip().splitlines()[-1]

    worker_psql = [
        "docker", "exec", "-i", CONTAINER, "psql",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
        "-h", "/work", "-U", "pitwall_learning_worker", "-d", DB,
    ]
    sql = f"""
SELECT session_user || '|' || current_user || '|' || current_setting('search_path');
DO $w$
DECLARE
  c jsonb;
  r jsonb;
  f jsonb;
  denied_capture boolean := false;
  denied_table boolean := false;
BEGIN
  c := pitwall_learning.claim_jobs(1, 60);
  RAISE NOTICE 'WCLAIM %', c;
  r := pitwall_learning.worker_get_revision((c->0->>'source_revision_id')::uuid);
  RAISE NOTICE 'WREV payload=% owner=%', (r ? 'payload'), (r ? 'owner_user_id');
  BEGIN
    PERFORM pitwall_learning.capture_source_revisions('measurement_event', '[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN denied_capture := true;
  END;
  BEGIN
    PERFORM count(*) FROM pitwall_learning.source_revisions;
  EXCEPTION WHEN insufficient_privilege THEN denied_table := true;
  END;
  RAISE NOTICE 'WDENIED capture=% table=%', denied_capture, denied_table;
  f := pitwall_learning.finish_job(
    (c->0->>'job_id')::uuid, (c->0->>'lease_token')::uuid, 'done');
  RAISE NOTICE 'WFIN %', f;
END
$w$;
"""
    proc = subprocess.run(SSH + worker_psql, input=sql, text=True,
                          capture_output=True, timeout=60)
    out = proc.stdout.strip().splitlines()
    identity = out[0] if out else ""
    claim = None
    payload = owner_leak = None
    denied = None
    finish = None
    for line in proc.stderr.splitlines():
        if "WCLAIM " in line:
            claim = json.loads(line.split("WCLAIM ", 1)[1].strip())
        elif "WREV " in line:
            payload = "payload=t" in line
            owner_leak = "owner=t" in line
        elif "WDENIED " in line:
            denied = "capture=t table=t" in line
        elif "WFIN " in line:
            finish = json.loads(line.split("WFIN ", 1)[1].strip())

    ok = (
        proc.returncode == 0
        and identity.startswith("pitwall_learning_worker|pitwall_learning_worker|")
        and isinstance(claim, list) and len(claim) == 1
        and claim[0]["source_revision_id"] == rev
        and payload is True
        and owner_leak is False
        and denied is True
        and isinstance(finish, dict) and finish.get("status") == "done"
    )
    result = {
        "identity": identity,
        "claim": claim,
        "revision_payload_present": payload,
        "owner_exported": owner_leak,
        "capture_and_table_denied": denied,
        "finish": finish,
        "exit": proc.returncode,
        "stderr": proc.stderr,
        "ok": ok,
        "assertion": "real LOGIN role over the trust Unix socket: claims/exports/finishes its own job and cannot call capture or read tables.",
    }
    _log("worker-login.log", json.dumps(result, indent=2, default=str) + "\n" + proc.stdout + proc.stderr)
    return result


def finish_busy() -> dict:
    """
    Two real connections: A holds the job row FOR UPDATE; B must get a fixed
    job_busy outcome immediately (NOWAIT), not block until its statement
    timeout. After A releases, the same token can still finish the job.
    """
    dev = "d0000000-0000-4000-8000-000000000001"
    uid = str(uuid.uuid4())
    setup = f"""BEGIN;
{GUARD}
UPDATE pitwall_learning.jobs
   SET status='done', finished_at=now(), updated_at=now(),
       lease_token=NULL, lease_owner=NULL, lease_expires_at=NULL
 WHERE status <> 'done';
SELECT pitwall_learning.capture_source_revision(
  'measurement_event', '{dev}', '{uid}', 1, md5('{uid}'), now(), now(),
  '{{"kind":"pit_entry"}}'::jsonb);
COMMIT;
"""
    _run(setup)
    claim = json.loads(_run("SELECT pitwall_learning.claim_jobs(1, 60)::text;"
                            ).stdout.strip().splitlines()[-1])[0]
    job = claim["job_id"]
    token = claim["lease_token"]

    a_proc = _popen(f"""BEGIN;
{GUARD}
SELECT id FROM pitwall_learning.jobs WHERE id='{job}' FOR UPDATE;
SELECT pg_sleep(4);
COMMIT;
""")
    time.sleep(0.8)

    b_sql = f"""SET statement_timeout='3s';
BEGIN;
{GUARD}
SELECT pitwall_learning.finish_job('{job}','{token}','done');
COMMIT;
"""
    t0 = time.monotonic()
    b = subprocess.run(SSH + PSQL, input=b_sql, text=True, capture_output=True, timeout=30)
    b_ms = (time.monotonic() - t0) * 1000
    a_out, a_err, a_rc = _collect(a_proc, timeout=30)

    busy = None
    for line in b.stdout.strip().splitlines():
        if line.strip().startswith("{"):
            busy = json.loads(line)
    state = json.loads(_run(f"""SELECT jsonb_build_object(
  'status', status, 'token_same', lease_token='{token}'::uuid
)::text FROM pitwall_learning.jobs WHERE id='{job}';""").stdout.strip().splitlines()[-1])

    after = json.loads(_run(f"""BEGIN;
{GUARD}
SELECT pitwall_learning.finish_job('{job}','{token}','done');
COMMIT;
""").stdout.strip().splitlines()[-1])

    ok = (
        a_rc == 0 and b.returncode == 0 and b_ms < 1500
        and isinstance(busy, dict) and busy.get("error") == "job_busy"
        and state["status"] == "leased" and state["token_same"] is True
        and after.get("status") == "done"
    )
    result = {
        "a_exit": a_rc,
        "a_stderr": a_err,
        "b_exit": b.returncode,
        "b_ms": b_ms,
        "busy": busy,
        "b_stderr": b.stderr,
        "state_while_locked": state,
        "finish_after_release": after,
        "ok": ok,
        "assertion": "finish_job returns job_busy immediately while another session holds the row; the lease/token stay valid.",
    }
    _log("finish-busy.log", json.dumps(result, indent=2, default=str)
         + "\n" + b.stdout + b.stderr)
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


# ---------------------------------------------------------------------------
# Performance: three paired phases, wire-representative frame plus a
# separately labelled DB-only stress frame.
# ---------------------------------------------------------------------------
WIRE_EVENTS_JSON = """
  SELECT jsonb_agg(jsonb_build_object(
    'eventUid', ('10000000-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid,
    'eventId', 'wire-evt-' || k,
    'kind', 'wear_refresh_confirmed',
    'segmentId', 'seg-wire',
    'pitVisitId', 'pit-wire',
    'observedSessionId', 'sess-wire',
    'observedAt', '2026-11-11T16:00:00Z'::timestamptz,
    'sessionTimeSeconds', 1000 + k,
    'sdkTick', 50000 + k,
    'confidence', 0.9,
    'wearBefore', jsonb_build_object('version', 1, 'scale', 'remaining_percent',
                                     'fl', 90.0, 'fr', 89.8, 'rl', 90.2, 'rr', 90.1),
    'wearAfter', jsonb_build_object('version', 1, 'scale', 'remaining_percent',
                                    'fl', 89.9, 'fr', 89.7, 'rl', 90.1, 'rr', 90.0),
    'evidence', jsonb_build_object('version', 1, 'source', 'tire_sets_used',
                                   'channels', jsonb_build_array('tire_sets_used'),
                                   'note', 'set 3 stint 2')
  ) ORDER BY k) INTO v_ev FROM generate_series(1, 20) k;
"""
WIRE_LAPS_JSON = """
  SELECT jsonb_agg(jsonb_build_object(
    'summaryUid', ('20000000-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid,
    'summaryId', 'wire-lap-' || k,
    'segmentId', 'seg-wire',
    'observedSessionId', 'sess-wire',
    'lapNumber', 20 + k,
    'startedAt', '2026-11-11T15:58:00Z',
    'endedAt', '2026-11-11T16:00:00Z',
    'currentDriverName', 'Wire Driver',
    'aggregationVersion', 1,
    'complete', true,
    'invalidReasons', jsonb_build_array(),
    'pitLap', false,
    'driverChanged', false,
    'trackTempCMean', 32.5, 'trackTempCMin', 31, 'trackTempCMax', 34,
    'airTempCMean', 21,
    'fuelStartLitres', 42, 'fuelEndLitres', 39.5,
    'fuelLevelIntegralLitreSeconds', 4875,
    'fuelAddedLitresObserved', NULL,
    'absLatAccelIntegralGSeconds', 220,
    'latAccelSquaredIntegralG2Seconds', 380,
    'maxAbsLatAccelG', 1.85,
    'absLongAccelIntegralGSeconds', 60,
    'sampleCount', 7200,
    'pitVisitIds', jsonb_build_array('pit-wire'),
    'wearObservationIds', jsonb_build_array('wire-evt-15'),
    'coverage', jsonb_build_object(
      'temperature', jsonb_build_object('validDurationSeconds', 120.0, 'sampleCount', 2400, 'maxGapSeconds', 0.1),
      'fuel', jsonb_build_object('validDurationSeconds', 120.0, 'sampleCount', 2400, 'maxGapSeconds', 0.1),
      'load', jsonb_build_object('validDurationSeconds', 120.0, 'sampleCount', 2400, 'maxGapSeconds', 0.1))
  ) ORDER BY k) INTO v_lp FROM generate_series(1, 3) k;
"""
STRESS_EVENTS_JSON = """
  SELECT jsonb_agg(jsonb_build_object(
    'eventUid', ('30000000-0000-4000-8000-' || lpad(k::text, 12, '0'))::uuid,
    'eventId', 'stress-evt-' || k,
    'kind', 'pit_entry',
    'segmentId', 'seg-stress',
    'pitVisitId', 'pit-stress',
    'observedSessionId', 'sess-stress',
    'observedAt', now(),
    'sessionTimeSeconds', k,
    'sdkTick', k,
    'confidence', 1
  ) ORDER BY k) INTO v_ev FROM generate_series(1, 200) k;
  v_lp := NULL;
"""


def _measure_block(phase: str, frame: str, sess: str, run: int) -> str:
    fixtures = WIRE_EVENTS_JSON + WIRE_LAPS_JSON if frame == "wire" else STRESS_EVENTS_JSON
    return f"""
SET LOCAL request.jwt.claim.role='service_role';
UPDATE pitwall_learning.runtime_settings
   SET capture_enabled = {str(phase == 'on').lower()} WHERE id = 1;
DO $perf$
DECLARE
  v_ev jsonb;
  v_lp jsonb;
  v_ack jsonb;
  v_t0 timestamptz;
  v_t1 timestamptz;
  v_rev bigint;
  v_jobs bigint;
  v_ev_bytes integer;
  v_lp_bytes integer;
BEGIN
  {fixtures}
  v_ev_bytes := octet_length(v_ev::text);
  v_lp_bytes := coalesce(octet_length(v_lp::text), 0);
  v_t0 := clock_timestamp();
  v_ack := public.simhub_persist_measurement_batch(
    'd0000000-0000-4000-8000-000000000001', '{sess}', v_ev, v_lp);
  v_t1 := clock_timestamp();
  SELECT count(*) INTO v_rev FROM pitwall_learning.source_revisions;
  SELECT count(*) INTO v_jobs FROM pitwall_learning.jobs;
  RAISE NOTICE 'P1PERF phase={phase} frame={frame} run={run} ms=% ev_acc=% lp_acc=% ev_bytes=% lp_bytes=% body_bytes=% rev_total=% job_total=%',
    round(extract(epoch FROM (v_t1 - v_t0)) * 1000, 3),
    jsonb_array_length(coalesce(v_ack #> '{{events,accepted}}', '[]'::jsonb)),
    jsonb_array_length(coalesce(v_ack #> '{{laps,accepted}}', '[]'::jsonb)),
    v_ev_bytes,
    v_lp_bytes,
    octet_length(jsonb_build_object('deviceId', 'd0000000-0000-4000-8000-000000000001',
                                    'sessionId', '{sess}', 'events', v_ev, 'laps', v_lp)::text),
    v_rev,
    v_jobs;
END
$perf$;
"""


def _parse_perf(stderr: str) -> list[dict]:
    out = []
    for line in stderr.splitlines():
        if "P1PERF " not in line:
            continue
        payload = line.split("P1PERF ", 1)[1]
        record: dict = {}
        for token in payload.split():
            if "=" in token:
                key, value = token.split("=", 1)
                record[key] = value
        out.append(record)
    return out


def perf(samples: int = 30) -> dict:
    def measure_round(run: int) -> dict:
        blocks = {
            "absent": _measure_block('absent', 'wire', f'perf-absent-{run}', run),
            "off": _measure_block('off', 'wire', f'perf-off-{run}', run),
            "on": _measure_block('on', 'wire', f'perf-on-{run}', run),
        }
        # Alternate the phase order each round so a fixed position (cache or
        # page-warm drift on the 0.5 CPU host) cannot masquerade as overhead.
        order = ["absent", "off", "on"] if run % 2 == 0 else ["on", "off", "absent"]
        sql = "".join(
            f"BEGIN;\n{GUARD}\n{DROP_TRIGGERS if phase == 'absent' else ''}\n"
            f"{blocks[phase]}ROLLBACK;\n"
            for phase in order
        )
        proc = _run(sql, timeout=300)
        records = _parse_perf(proc.stderr)
        return {rec["phase"]: rec for rec in records}

    # Warm-up round is excluded from the statistics (both phases run it).
    warm = measure_round(0)
    _log("perf-warmup.log", json.dumps(warm, indent=2))

    phases = {"absent": [], "off": [], "on": []}
    deltas_abs = []
    deltas_off = []
    sizes = []
    for run in range(1, samples + 1):
        rec = measure_round(run)
        for phase in phases:
            phases[phase].append(float(rec[phase]["ms"]))
        deltas_abs.append(float(rec["on"]["ms"]) - float(rec["absent"]["ms"]))
        deltas_off.append(float(rec["on"]["ms"]) - float(rec["off"]["ms"]))
        sizes.append(rec["on"])

    def p95(xs):
        return nearest_rank(xs, 0.95)

    def p50(xs):
        return nearest_rank(xs, 0.50)

    stats = {}
    for name, values in phases.items():
        stats[name] = {
            "n": len(values),
            "p50_ms": round(p50(values), 3),
            "p95_ms": round(p95(values), 3),
            "min_ms": round(min(values), 3),
            "max_ms": round(max(values), 3),
            "samples_ms": [round(v, 3) for v in values],
        }

    base_abs = stats["absent"]["p95_ms"]
    base_off = stats["off"]["p95_ms"]
    delta_abs_p95 = round(p95(deltas_abs), 3)
    delta_off_p95 = round(p95(deltas_off), 3)
    delta_abs_pct = round(delta_abs_p95 / base_abs * 100.0, 3) if base_abs else None
    delta_off_pct = round(delta_off_p95 / base_off * 100.0, 3) if base_off else None

    wire_sizes = {
        "events_bytes": int(sizes[0]["ev_bytes"]),
        "laps_bytes": int(sizes[0]["lp_bytes"]),
        "body_bytes": int(sizes[0]["body_bytes"]),
        "events_plus_laps_bytes": int(sizes[0]["ev_bytes"]) + int(sizes[0]["lp_bytes"]),
        "accepted_events": int(sizes[0]["ev_acc"]),
        "accepted_laps": int(sizes[0]["lp_acc"]),
        "rev_total": int(sizes[0]["rev_total"]),
        "job_total": int(sizes[0]["job_total"]),
        "limits": {"events_plus_laps_max": 16384, "body_max": 24576},
        "within_part_budget": int(sizes[0]["ev_bytes"]) + int(sizes[0]["lp_bytes"]) <= 16384,
        "within_body_budget": int(sizes[0]["body_bytes"]) <= 24576,
        "kind_valid": True,
        "note": "wire frame = 20 wear_refresh_confirmed events with wear+evidence plus 3 full lap aggregates; no perf_probe kind.",
    }

    result = {
        "wire_representative": True,
        "method": {
            "frame": "wire-max-shape 20 events + 3 laps",
            "phases": ["triggers absent (true pre-migration)", "installed capture off", "installed capture on"],
            "paired_rounds": samples,
            "warmup_rounds": 1,
            "quantile": "nearest-rank (ceil(p*n)-1), no interpolation",
            "gate": "p95 of the per-round paired delta (on - absent) <= 20 ms AND <= 10% of absent p95; phase order alternates per round",
            "host": "0.5 CPU clone, network none, PG15.19",
        },
        "stats": stats,
        "paired_deltas_ms": [round(v, 3) for v in deltas_abs],
        "overhead_vs_absent": {
            "p95_ms": delta_abs_p95,
            "p95_pct": delta_abs_pct,
            "basis": "per-round paired delta (on - absent), nearest-rank p95",
        },
        "overhead_vs_installed_off": {
            "p95_ms": delta_off_p95,
            "p95_pct": delta_off_pct,
            "basis": "per-round paired delta (on - off), nearest-rank p95",
        },
        "sizes": wire_sizes,
        "gate_pass": bool(delta_abs_p95 <= 20.0 and delta_abs_pct is not None
                          and delta_abs_pct <= 10.0
                          and wire_sizes["within_part_budget"]
                          and wire_sizes["within_body_budget"]),
    }
    _log("perf-wire.log", json.dumps(result, indent=2))
    return result


CPU_FRAME_SQL = """
    SELECT jsonb_agg(jsonb_build_object(
      'eventUid', ('10000000-0000-4000-8000-' || lpad((v_base + k * 100 + x)::text, 12, '0'))::uuid,
      'eventId', 'cpu-' || (v_base + k) || '-' || x,
      'kind', 'wear_refresh_confirmed',
      'segmentId', 'seg-wire', 'pitVisitId', 'pit-wire',
      'observedSessionId', 'sess-cpu-' || (v_base + k),
      'observedAt', now(), 'sessionTimeSeconds', 1000 + x,
      'sdkTick', 50000 + x, 'confidence', 0.9,
      'wearBefore', jsonb_build_object('version', 1, 'scale', 'remaining_percent',
                                       'fl', 90.0, 'fr', 89.8, 'rl', 90.2, 'rr', 90.1),
      'wearAfter', jsonb_build_object('version', 1, 'scale', 'remaining_percent',
                                      'fl', 89.9, 'fr', 89.7, 'rl', 90.1, 'rr', 90.0),
      'evidence', jsonb_build_object('version', 1, 'source', 'tire_sets_used',
                                     'channels', jsonb_build_array('tire_sets_used'),
                                     'note', 'set 3 stint 2'))
      ORDER BY x) INTO v_ev FROM generate_series(1, 20) x;
    SELECT jsonb_agg(jsonb_build_object(
      'summaryUid', ('20000000-0000-4000-8000-' || lpad((v_base + k * 100 + x)::text, 12, '0'))::uuid,
      'summaryId', 'cpu-lap-' || (v_base + k) || '-' || x,
      'segmentId', 'seg-wire',
      'observedSessionId', 'sess-cpu-' || (v_base + k),
      'lapNumber', 20 + x,
      'startedAt', '2026-11-11T15:58:00Z', 'endedAt', '2026-11-11T16:00:00Z',
      'currentDriverName', 'Wire Driver',
      'aggregationVersion', 1, 'complete', true,
      'invalidReasons', jsonb_build_array(), 'pitLap', false, 'driverChanged', false,
      'trackTempCMean', 32.5, 'trackTempCMin', 31, 'trackTempCMax', 34,
      'airTempCMean', 21, 'fuelStartLitres', 42, 'fuelEndLitres', 39.5,
      'fuelLevelIntegralLitreSeconds', 4875, 'fuelAddedLitresObserved', NULL,
      'absLatAccelIntegralGSeconds', 220, 'latAccelSquaredIntegralGSeconds', 380,
      'maxAbsLatAccelG', 1.85, 'absLongAccelIntegralGSeconds', 60,
      'sampleCount', 7200,
      'pitVisitIds', jsonb_build_array('pit-wire'),
      'wearObservationIds', jsonb_build_array('cpu-' || (v_base + k) || '-15'),
      'coverage', jsonb_build_object(
        'temperature', jsonb_build_object('validDurationSeconds', 120.0, 'sampleCount', 2400, 'maxGapSeconds', 0.1),
        'fuel', jsonb_build_object('validDurationSeconds', 120.0, 'sampleCount', 2400, 'maxGapSeconds', 0.1),
        'load', jsonb_build_object('validDurationSeconds', 120.0, 'sampleCount', 2400, 'maxGapSeconds', 0.1)))
      ORDER BY x) INTO v_lp FROM generate_series(1, 3) x;
"""


def _cpu_block(phase: str, frames: int, base: int, label: str) -> str:
    return f"""
SET LOCAL request.jwt.claim.role='service_role';
UPDATE pitwall_learning.runtime_settings
   SET capture_enabled = {str(phase == 'on').lower()} WHERE id = 1;
DO $cpu$
DECLARE
  v_ev jsonb; v_lp jsonb; v_ack jsonb;
  v_c0 bigint; v_c1 bigint; v_base integer := {base}; v_k integer;
BEGIN
  v_c0 := split_part(pg_read_file('/proc/self/stat'), ' ', 14)::bigint
        + split_part(pg_read_file('/proc/self/stat'), ' ', 15)::bigint;
  FOR v_k IN 1..{frames} LOOP
    {CPU_FRAME_SQL.replace('k * 100', 'v_k * 100').replace('(v_base + k)', '(v_base + v_k)').replace("'cpu-' || (v_base + k)", "'cpu-' || (v_base + v_k)")}
    v_ack := public.simhub_persist_measurement_batch(
      'd0000000-0000-4000-8000-000000000001', 'sess-cpu-' || (v_base + v_k), v_ev, v_lp);
  END LOOP;
  v_c1 := split_part(pg_read_file('/proc/self/stat'), ' ', 14)::bigint
        + split_part(pg_read_file('/proc/self/stat'), ' ', 15)::bigint;
  RAISE NOTICE 'P1CPU label={label} phase={phase} frames={frames} ticks=%', v_c1 - v_c0;
END
$cpu$;
"""


def perf_cpu(rounds: int = 20, frames: int = 4) -> dict:
    """
    Attribution measurement without wall-clock steal: backend process CPU time
    (utime+stime, 10 ms ticks) around the same wire frame, in ABBA order per
    round so linear drift cancels. This is a secondary measurement; the
    primary gate stays the wall-clock p95 required by the review.
    """
    deltas = []
    raw = []
    for run in range(1, rounds + 1):
        base = run * 10000
        blocks = {
            "a1": _cpu_block('absent', frames, base, f'a1r{run}'),
            "o1": _cpu_block('on', frames, base + 1000, f'o1r{run}'),
            "o2": _cpu_block('on', frames, base + 2000, f'o2r{run}'),
            "a2": _cpu_block('absent', frames, base + 3000, f'a2r{run}'),
        }
        sql = (
            f"BEGIN;\n{GUARD}\n{DROP_TRIGGERS}\n{blocks['a1']}ROLLBACK;\n"
            f"BEGIN;\n{GUARD}\n{blocks['o1']}ROLLBACK;\n"
            f"BEGIN;\n{GUARD}\n{blocks['o2']}ROLLBACK;\n"
            f"BEGIN;\n{GUARD}\n{DROP_TRIGGERS}\n{blocks['a2']}ROLLBACK;\n"
        )
        proc = _run(sql, timeout=300)
        ticks = {}
        for line in proc.stderr.splitlines():
            if "P1CPU " in line:
                payload = line.split("P1CPU ", 1)[1]
                fields = {}
                for token in payload.split():
                    if "=" in token:
                        k, v = token.split("=", 1)
                        fields[k] = v
                ticks[fields["label"]] = int(fields["ticks"].rstrip(","))
        delta_ticks = ((ticks[f'o1r{run}'] + ticks[f'o2r{run}'])
                       - (ticks[f'a1r{run}'] + ticks[f'a2r{run}']))
        per_frame_ms = delta_ticks * 10.0 / (2 * frames)
        deltas.append(per_frame_ms)
        raw.append({"round": run, "ticks": ticks,
                    "delta_ticks_per_two_blocks": delta_ticks,
                    "overhead_ms_per_frame": round(per_frame_ms, 2)})

    result = {
        "method": "backend CPU time (utime+stime from /proc/self/stat), ABBA per round, "
                  f"{rounds} rounds x {frames} frames per block",
        "secondary": True,
        "note": "Attribution only. The host is oversubscribed (load ~14 on 4 cores with a "
                "0.5 CPU cap), so wall-clock p95 is dominated by CPU steal.",
        "rounds": rounds,
        "frames_per_block": frames,
        "per_round": raw,
        "overhead_ms_per_frame_p50": round(nearest_rank(deltas, 0.50), 2),
        "overhead_ms_per_frame_p95": round(nearest_rank(deltas, 0.95), 2),
        "overhead_ms_per_frame_max": round(max(deltas), 2),
        "within_20ms": nearest_rank(deltas, 0.95) <= 20.0,
    }
    _log("perf-cpu-attribution.log", json.dumps(result, indent=2))
    return result


def perf_db_stress(samples: int = 10) -> dict:
    def measure_round(run: int) -> list[dict]:
        sql = f"""BEGIN;
{GUARD}
{DROP_TRIGGERS}
{_measure_block('absent', 'stress200', f'stress-absent-{run}', run)}
ROLLBACK;
BEGIN;
{GUARD}
{_measure_block('off', 'stress200', f'stress-off-{run}', run)}
ROLLBACK;
BEGIN;
{GUARD}
{_measure_block('on', 'stress200', f'stress-on-{run}', run)}
ROLLBACK;
"""
        proc = _run(sql, timeout=300)
        return _parse_perf(proc.stderr)

    measure_round(0)
    phases = {"absent": [], "off": [], "on": []}
    for run in range(1, samples + 1):
        for rec in measure_round(run):
            phases[rec["phase"]].append(float(rec["ms"]))

    def p95(xs):
        return nearest_rank(xs, 0.95)

    stats = {k: {"n": len(v), "p50_ms": round(nearest_rank(v, 0.50), 3),
                 "p95_ms": round(p95(v), 3)} for k, v in phases.items()}
    result = {
        "wire_representative": False,
        "label": "DB-only stress: 200 events, the database batch maximum. NOT a wire frame and NOT used for the production p95 gate.",
        "method": {"paired_rounds": samples, "warmup_rounds": 1,
                   "quantile": "nearest-rank (ceil(p*n)-1)"},
        "stats": stats,
        "overhead_vs_absent": {
            "p95_ms": round(stats["on"]["p95_ms"] - stats["absent"]["p95_ms"], 3),
            "p95_pct": round((stats["on"]["p95_ms"] - stats["absent"]["p95_ms"])
                             / stats["absent"]["p95_ms"] * 100.0, 3),
        },
    }
    _log("perf-db-only-stress.log", json.dumps(result, indent=2))
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
        "triggers_restored_after_dry_run": after["capture_triggers"] == 4,
    }
    result["ok"] = all(result[k] for k in (
        "evidence_preserved", "jobs_preserved", "triggers_removed",
        "worker_login_disabled", "worker_usage_revoked", "switches_off",
        "public_baseline_exact", "schema_still_present_after_dry_run",
        "triggers_restored_after_dry_run",
    ))
    _log("rollback.log", json.dumps(result, indent=2) + "\n" + proc.stdout + proc.stderr)
    return result


def _defs_fp_sql(schema: str) -> str:
    return f"""(SELECT md5(coalesce(string_agg(p.proname || ':' || pg_get_functiondef(p.oid), E'\\n'
              ORDER BY p.proname), ''))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = '{schema}')"""


def _trig_fp_sql() -> str:
    return """(SELECT md5(coalesce(string_agg(t.tgname || ':' || pg_get_triggerdef(t.oid), E'\\n'
              ORDER BY t.tgname), ''))
       FROM pg_trigger t
       WHERE NOT t.tgisinternal
         AND t.tgrelid IN ('public.simhub_measurement_events'::regclass,
                           'public.simhub_lap_summaries'::regclass))"""


def clean_forward_probe() -> dict:
    """
    Prove the forward file still applies to an absent schema/role and that the
    result is byte-identical to the live (retained, upgraded) definition set.
    Everything happens inside one rolled-back transaction.
    """
    sql = f"""
BEGIN;
{GUARD}
SELECT jsonb_build_object(
  'live_defs_fp', {_defs_fp_sql('pitwall_learning')},
  'live_trig_fp', {_trig_fp_sql()}
)::text;
ALTER SCHEMA pitwall_learning RENAME TO pitwall_learning_pre_forward_probe;
{DROP_TRIGGERS}
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
  'fresh_defs_fp', {_defs_fp_sql('pitwall_learning')},
  'fresh_trig_fp', {_trig_fp_sql()},
  'public_relations', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')),
  'public_policies', (SELECT count(*) FROM pg_policies WHERE schemaname='public')
)::text;
ROLLBACK;
"""
    try:
        proc = _run(sql, timeout=300)
        lines = [ln for ln in proc.stdout.strip().splitlines() if ln.strip().startswith("{")]
        live = json.loads(lines[0])
        state = json.loads(lines[-1])
        result = {"live": live, "fresh": state, "ok": (
            state["schema_owner"] == "supabase_admin"
            and state["tables"] == 9
            and state["triggers"] == 4
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
            and state["fresh_defs_fp"] == live["live_defs_fp"]
            and state["fresh_trig_fp"] == live["live_trig_fp"]
        )}
        result["definition_parity"] = (
            state["fresh_defs_fp"] == live["live_defs_fp"]
            and state["fresh_trig_fp"] == live["live_trig_fp"]
        )
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
                    help="skip the schema-absence RED log (not recommended)")
    ap.add_argument("--samples", type=int, default=30,
                    help="paired samples per phase for the wire frame (>=30)")
    args = ap.parse_args()
    if args.samples < 30:
        print("refusing fewer than 30 paired samples", file=sys.stderr)
        return 2

    ART.mkdir(parents=True, exist_ok=True)
    info = health()
    before = snapshot()
    summary: dict = {"health": info, "before": before}

    if not before["schema_exists"]:
        if not args.skip_red:
            summary["red"] = run_red()
        apply_forward()
        summary["forward_applied"] = True
        summary["migrate_retained"] = {"applied": False, "reason": "fresh forward"}
    else:
        summary["migrate_retained"] = migrate_retained(before)
        summary["forward_applied"] = False

    upgraded = snapshot()
    run_fixture()
    after_fixture = snapshot()

    summary["tests"] = []
    for name, path in TESTS.items():
        summary["tests"].append(run_test(name, path))

    summary["concurrency"] = concurrency()
    summary["deadletter_lock"] = deadletter_lock()
    summary["worker_login"] = worker_login()
    summary["finish_busy"] = finish_busy()
    summary["lock_ack"] = lock_ack()
    summary["perf"] = perf(samples=args.samples)
    summary["perf_cpu"] = perf_cpu(rounds=20, frames=4)
    summary["perf_db_only_stress"] = perf_db_stress(samples=10)

    before_rollback = snapshot()
    summary["rollback"] = rollback_dry_run(before_rollback)
    summary["forward_clean_probe"] = clean_forward_probe()
    summary["forward_conflict"] = forward_conflict()
    summary["after"] = snapshot()

    _log("summary.json", json.dumps(summary, indent=2, default=str))
    _log("baseline-before.json", json.dumps(before, indent=2))
    _log("baseline-upgraded.json", json.dumps(upgraded, indent=2))
    _log("baseline-after-fixture.json", json.dumps(after_fixture, indent=2))
    _log("baseline-after.json", json.dumps(summary["after"], indent=2))

    failures = []
    for t in summary["tests"]:
        if t["exit"] != 0:
            failures.append(f"test {t['name']}")
    for key in ("concurrency", "deadletter_lock", "worker_login", "finish_busy",
                "lock_ack", "rollback", "forward_clean_probe"):
        if not summary[key].get("ok"):
            failures.append(key)
    if not summary["forward_conflict"].get("refused"):
        failures.append("forward_conflict")
    if not summary["perf"].get("gate_pass"):
        failures.append("perf_gate")

    print(json.dumps({
        "tests": summary["tests"],
        "concurrency": summary["concurrency"].get("ok"),
        "deadletter_lock": summary["deadletter_lock"].get("ok"),
        "worker_login": summary["worker_login"].get("ok"),
        "finish_busy": summary["finish_busy"].get("ok"),
        "lock_ack": summary["lock_ack"].get("ok"),
        "perf_gate": summary["perf"].get("gate_pass"),
        "perf": {
            "absent": summary["perf"]["stats"]["absent"],
            "off": summary["perf"]["stats"]["off"],
            "on": summary["perf"]["stats"]["on"],
            "overhead_vs_absent": summary["perf"]["overhead_vs_absent"],
            "overhead_vs_installed_off": summary["perf"]["overhead_vs_installed_off"],
            "sizes": summary["perf"]["sizes"],
        },
        "db_only_stress": summary["perf_db_only_stress"],
        "perf_cpu": summary["perf_cpu"],
        "rollback": summary["rollback"].get("ok"),
        "forward_clean_probe": summary["forward_clean_probe"].get("ok"),
        "definition_parity": summary["forward_clean_probe"].get("definition_parity"),
        "forward_conflict": summary["forward_conflict"].get("refused"),
        "artifacts": str(ART),
        "failures": failures,
    }, indent=2, default=str))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
