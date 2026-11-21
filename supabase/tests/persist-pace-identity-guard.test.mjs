#!/usr/bin/env node
/**
 * Isolated PGlite test for the actual PACE merge decision that replaced the
 * identity-gap `IS DISTINCT FROM` reset in simhub_persist_v3.
 *
 * It executes the real helper bodies from the migration, not a reimplementation:
 * sparse payloads, missing identity, confirmed car/track/segment changes,
 * clock rewind, stale updatedAt and the 24-hour cleanup. No remote DB.
 *
 * Run: node supabase/tests/persist-pace-identity-guard.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../migrations/20261121122000_persist_pace_identity_guard.sql");
const migration = await readFile(migrationPath, "utf8");

function functionBody(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `${name} exists in the migration`);
  const end = migration.indexOf("$fill$;", start) !== -1 && migration.indexOf("$fill$;", start) < migration.indexOf("$previous$;", start)
    ? migration.indexOf("$fill$;", start) + "$fill$;".length
    : migration.indexOf("$previous$;", start) + "$previous$;".length;
  return migration.slice(start, end);
}

const db = await PGlite.create();
await db.exec(functionBody("simhub_pace_identity_fill_v1"));
await db.exec(functionBody("simhub_pace_previous_v1"));

const results = [];
const check = (ok, label) => {
  if (!ok) throw new Error(`FAIL: ${label}`);
  results.push(label);
  console.log(`  ok  ${label}`);
};

const car = (id) => ({
  id, laps: [], traces: [], sectorBests: [],
  sectors: [{ id, lap: 4, sectorIndex: 0, sectorCount: 3, seconds: 35.5, status: "verified", referenceSeconds: null, revision: 1, completedSessionTimeSeconds: 490, observedSessionTimeSeconds: 500 }],
});

const history = (segment = "seg-a", observed = "obs-a", count = 5, updatedAt = "2026-11-21T12:00:00.000Z") => ({
  schemaRevision: 1, observedSessionId: observed, segmentId: segment,
  transportSessionId: "transport-reused", updatedAt,
  cars: Array.from({ length: count }, (_, index) => car(`car-${index}`)),
});

const v3 = ({ trackId = 596, carId = "gt3", sessionTime = 600, segment = "seg-a", observed = "obs-a", cars = 5, updatedAt = "2026-11-21T12:00:00.000Z", includeHistory = true } = {}) => ({
  identity: {
    ...(trackId == null ? {} : { trackId }),
    ...(carId == null ? {} : { carId }),
    trackName: "Spa", trackConfig: "Full Course",
  },
  session: { sessionTimeSeconds: sessionTime },
  ...(includeHistory ? { paceHistory: history(segment, observed, cars, updatedAt) } : {}),
});

const apply = async (previous, next) => (await db.query(
  "SELECT public.simhub_pace_previous_v1($1::jsonb,$2::jsonb) AS h",
  [JSON.stringify(previous), JSON.stringify(next)],
)).rows[0].h;
const fill = async (next, previous) => (await db.query(
  "SELECT public.simhub_pace_identity_fill_v1($1::jsonb,$2::jsonb) AS v",
  [JSON.stringify(next), JSON.stringify(previous)],
)).rows[0].v;

try {
  const previous = v3();

  const sparse = await apply(previous, v3({ trackId: null, carId: null, cars: 1, updatedAt: "2026-11-21T12:00:01.000Z" }));
  check(sparse?.cars?.length === 5 && sparse.segmentId === "seg-a", "a sparse frame without identity keeps all five proven cars");

  const noHistory = await apply(previous, v3({ includeHistory: false }));
  check(noHistory?.cars?.length === 5, "a payload without paceHistory does not erase the proven history");

  const olderUpdated = await apply(previous, v3({ cars: 2, updatedAt: "2026-11-21T11:59:59.000Z" }));
  check(olderUpdated?.cars?.length === 5, "an older updatedAt cannot replace the newer history");

  check((await apply(previous, v3({ trackId: 597, cars: 1 }))) === null, "a confirmed track change resets");
  check((await apply(previous, v3({ carId: "gt3-evo", cars: 1 }))) === null, "a confirmed car change resets");
  check((await apply(previous, v3({ segment: "seg-b", cars: 1 }))) === null, "a new PACE segment resets");
  check((await apply(previous, v3({ observed: "obs-b", cars: 1 }))) === null, "a new observed session resets");
  check((await apply(previous, v3({ sessionTime: 599, cars: 1 }))) === null, "a rewound session clock resets");

  const complete = await apply(previous, v3({ cars: 6, updatedAt: "2026-11-21T12:00:02.000Z" }));
  check(complete?.cars?.length === 6, "a complete newer frame is accepted as-is");

  const staleOld = v3({ updatedAt: "2026-11-19T00:00:00.000Z" });
  check((await apply(staleOld, v3({ cars: 6 }))) === null, "the 24-hour cleanup can still drop expired history");

  const missingIdentity = v3({ trackId: null, carId: null });
  const filled = await fill(missingIdentity, previous);
  check(filled.identity.trackId === 596 && filled.identity.carId === "gt3", "the merge fills a missing trackId/carId from the last known identity");
  const knownDifferent = v3({ trackId: 597 });
  const untouched = await fill(knownDifferent, previous);
  check(untouched.identity.trackId === 597, "a known different identity is never overwritten by the carry-forward");

  // The old faulty comparison must be gone from the actual persist body copy.
  check(!migration.includes("v3_normalized#>'{identity,carId}' IS DISTINCT FROM p_v3_normalized#>'{identity,carId}'"),
    "the actual persist body no longer resets on a NULL/distinct car identity");
  check(migration.includes("v_pace_previous := public.simhub_pace_previous_v1(v_previous_v3, p_v3_normalized)"),
    "the actual persist body calls the tested merge decision");

  console.log(JSON.stringify({ isolatedPGlite: true, productionExecuted: false, passed: results.length, failed: 0, results }));
} catch (error) {
  console.error(JSON.stringify({ passed: results.length, failed: 1, message: error.message }));
  process.exitCode = 1;
} finally {
  await db.close();
}
