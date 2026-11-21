#!/usr/bin/env node
/**
 * Isolated PGlite test for the PACE-history identity guard.
 *
 * Covers the production failure mode (a frame without trackId must not erase
 * the proven history), the real resets that must still go through (session,
 * track, segment) and the stale old-session frame that must not replace a
 * newer snapshot. No remote database is touched.
 *
 * Run: node supabase/tests/pace-history-identity-guard.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const migration = resolve(here, "../migrations/20261121120000_pace_history_identity_guard.sql");
const rollback = resolve(here, "../rollbacks/20261121120000_pace_history_identity_guard.down.sql");

const db = await PGlite.create();
const results = [];
const check = (ok, label) => {
  if (!ok) throw new Error(`FAIL: ${label}`);
  results.push(label);
  console.log(`  ok  ${label}`);
};

const car = (id) => ({
  id,
  laps: [],
  traces: [],
  sectors: [{ id, lap: 4, sectorIndex: 0, sectorCount: 3, seconds: 35.5, status: "verified", referenceSeconds: null, revision: 1, completedSessionTimeSeconds: 490, observedSessionTimeSeconds: 500 }],
  sectorBests: [],
});

const history = (segment = "seg-a", observed = "obs-a", count = 5) => ({
  schemaRevision: 1,
  observedSessionId: observed,
  segmentId: segment,
  transportSessionId: "transport-a",
  updatedAt: "2026-11-21T12:00:00.000Z",
  cars: Array.from({ length: count }, (_, index) => car(`car-${index}`)),
});

const v3 = ({ trackId = 596, carId = "gt3", sessionTime = 600, segment = "seg-a", observed = "obs-a", cars = 5, updatedAt = "2026-11-21T12:00:00.000Z" } = {}) => ({
  identity: {
    ...(trackId == null ? {} : { trackId }),
    ...(carId == null ? {} : { carId }),
    trackName: "Spa",
    trackConfig: "Full Course",
  },
  session: { sessionTimeSeconds: sessionTime },
  transportSessionId: "transport-a",
  paceHistory: { ...history(segment, observed, cars), updatedAt },
});

await db.exec(`
  CREATE TABLE public.simhub_telemetry_latest (
    device_id uuid PRIMARY KEY,
    session_id text NOT NULL,
    sequence bigint NOT NULL,
    captured_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    v3_normalized jsonb NOT NULL
  );
  INSERT INTO public.simhub_telemetry_latest(device_id, session_id, sequence, captured_at, v3_normalized)
  VALUES ('11111111-1111-4111-8111-111111111111', 'transport-a', 10, '2026-11-21T12:00:00Z', '${JSON.stringify(v3())}');
`);

await db.exec(await readFile(migration, "utf8"));

const row = async () => (await db.query("SELECT session_id, sequence, captured_at, v3_normalized FROM public.simhub_telemetry_latest")).rows[0];
const update = async ({ sessionId = "transport-a", sequence = 11, capturedAt = "2026-11-21T12:00:01Z", next = v3() } = {}) =>
  db.query(
    "UPDATE public.simhub_telemetry_latest SET session_id=$1, sequence=$2, captured_at=$3, v3_normalized=$4 WHERE device_id='11111111-1111-4111-8111-111111111111'",
    [sessionId, sequence, capturedAt, JSON.stringify(next)],
  );

try {
  await update({ next: v3({ trackId: null, carId: null, cars: 1, updatedAt: "2026-11-21T12:00:01.000Z" }) });
  let current = await row();
  check(current.v3_normalized.paceHistory.cars.length === 5, "transient missing trackId/carId keeps all five proven cars");
  check(current.v3_normalized.paceHistory.segmentId === "seg-a", "transient frame keeps the same segment");

  await update({ next: v3({ trackId: 597, cars: 1, updatedAt: "2026-11-21T12:00:02.000Z" }) });
  current = await row();
  check(current.v3_normalized.paceHistory.cars.length === 1, "a confirmed track change still resets the history");

  await db.exec(`UPDATE public.simhub_telemetry_latest SET v3_normalized='${JSON.stringify(v3())}' WHERE device_id='11111111-1111-4111-8111-111111111111'`);
  await update({ next: v3({ segment: "seg-b", cars: 1, updatedAt: "2026-11-21T12:00:03.000Z" }) });
  current = await row();
  check(current.v3_normalized.paceHistory.segmentId === "seg-b" && current.v3_normalized.paceHistory.cars.length === 1, "a new PACE segment still resets");

  await db.exec(`UPDATE public.simhub_telemetry_latest SET v3_normalized='${JSON.stringify(v3())}' WHERE device_id='11111111-1111-4111-8111-111111111111'`);
  await update({ sessionId: "transport-b", capturedAt: "2026-11-21T12:00:04Z", next: v3({ cars: 2, updatedAt: "2026-11-21T12:00:04.000Z" }) });
  current = await row();
  check(current.session_id === "transport-b" && current.v3_normalized.paceHistory.cars.length === 2, "a later transport session is a real reset");

  const beforeStale = await row();
  await update({ sessionId: "transport-a", capturedAt: "2026-11-21T11:59:59Z", next: v3({ cars: 1, updatedAt: "2026-11-21T11:59:59.000Z" }) });
  current = await row();
  check(current.session_id === "transport-b", "an older frame from a previous session cannot replace the newer snapshot");
  check(JSON.stringify(current.v3_normalized) === JSON.stringify(beforeStale.v3_normalized), "the cancelled stale update leaves the snapshot byte-identical");

  // The 24-hour cleanup route must still be able to remove expired history.
  await db.exec("ALTER TABLE public.simhub_telemetry_latest DISABLE TRIGGER simhub_telemetry_latest_pace_guard");
  await db.query(
    "UPDATE public.simhub_telemetry_latest SET v3_normalized=$1 WHERE device_id='11111111-1111-4111-8111-111111111111'",
    [JSON.stringify({ identity: { trackId: 596 }, session: { sessionTimeSeconds: 600 }, paceHistory: { ...history(), updatedAt: "2026-11-20T00:00:00.000Z" } })],
  );
  await db.exec("ALTER TABLE public.simhub_telemetry_latest ENABLE TRIGGER simhub_telemetry_latest_pace_guard");
  await db.query(
    "UPDATE public.simhub_telemetry_latest SET v3_normalized = v3_normalized - 'paceHistory' WHERE device_id='11111111-1111-4111-8111-111111111111'",
  );
  current = await row();
  check(current.v3_normalized.paceHistory === undefined, "the 24-hour cleanup can still remove expired history");

  await db.exec(await readFile(rollback, "utf8"));
  const gone = await db.query("SELECT to_regprocedure('public.simhub_pace_history_guard_v1()') AS fn");
  const trigger = await db.query("SELECT tgname FROM pg_trigger WHERE tgname = 'simhub_telemetry_latest_pace_guard'");
  check(gone.rows[0].fn === null && trigger.rows.length === 0, "rollback removes the guard function and trigger");

  console.log(JSON.stringify({ isolatedPGlite: true, productionExecuted: false, passed: results.length, failed: 0, results }));
} catch (error) {
  console.error(JSON.stringify({ passed: results.length, failed: 1, message: error.message }));
  process.exitCode = 1;
} finally {
  await db.close();
}
