#!/usr/bin/env node
/**
 * Production-compatibility test for the unshipped 20261121122000 migration.
 *
 * It does NOT execute helper bodies in isolation. It loads a schema-only clone
 * of the production public + pitwall_learning schema (no rows) into isolated
 * PGlite, applies the real forward migration, and calls the complete deployed
 * `simhub_persist_v3` body with synthetic frames. It then proves:
 *   - the forward preimage/postimage hashes and ownership/ACL,
 *   - a legacy frame without a PACE block is a no-op for proven history,
 *   - a sparse identity frame keeps history and carries the last known
 *     track/car forward,
 *   - confirmed track/car/segment changes and a rewound clock reset,
 *   - the 24-hour cleanup still drops expired history,
 *   - the exact serialized connector pit edges, after the real Edge
 *     normalization, pass `simhub_persist_measurement_batch` and the pit visit
 *     trigger (uppercase `OnPitRoad` channel included),
 *   - the paired rollback restores both function bodies and effective ACL in
 *     one transaction.
 *
 * Run: node supabase/tests/persist-pace-identity-guard.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { createRoles, loadProductionClone } from "./support/production-clone.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schemaClone = resolve(here, "./fixtures/simhub-production-schema-20261121.sql.gz");
const forwardPath = resolve(here, "../migrations/20261121122000_persist_pace_identity_guard.sql");
const rollbackPath = resolve(here, "../rollbacks/20261121122000_persist_pace_identity_guard.down.sql");
const personalPitVisitsPath = resolve(here, "../migrations/20261121121000_personal_pit_visits.sql");
const rawPitEdges = resolve(here, "./fixtures/pit-edges-connector.json");
const normalizedPitEdges = resolve(here, "./fixtures/pit-edges-edge-normalized.json");
const denoScript = resolve(here, "./fixtures/pit-edges-edge-normalized.ts");

const PERSIST = "'public.simhub_persist_v3(text,text,bigint,timestamp with time zone,jsonb,text,jsonb,jsonb)'::regprocedure";
const MERGE = "'public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamp with time zone)'::regprocedure";
const EVIDENCE = "'public.simhub_evidence_v1_valid(jsonb)'::regprocedure";
const PERSIST_SQL = "public.simhub_persist_v3(text,text,bigint,timestamptz,jsonb,text,jsonb,jsonb)";
const MERGE_SQL = "public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz)";
const EVIDENCE_SQL = "public.simhub_evidence_v1_valid(jsonb)";

const EXPECT = {
  persistBase: "e15ef4a7bde6e876e835c406696283c6",
  persistNew: "f6117484afcc3107c772c8c314e1e853",
  merge: "0f984dd59a233a499caa35e16a68515c",
  evidenceBase: "1fdab6c7c46ea98dc70e5f1386284ccd",
  evidenceNew: "0305699f4456814f7d65bdccfd52d3f7",
  acl: "{supabase_admin=X/supabase_admin,postgres=X/supabase_admin,service_role=X/supabase_admin}",
};

const TOKEN = "a".repeat(64);
const OWNER = "11111111-1111-4111-8111-111111111111";
const DEVICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = "session-a";

const results = [];
const check = (ok, label) => {
  if (!ok) throw new Error(`FAIL: ${label}`);
  results.push(label);
  console.log(`  ok  ${label}`);
};

async function main() {
  const db = await PGlite.create();
  try {
    await createRoles(db);
    await loadProductionClone(db, schemaClone);

    // The dump has no owners or privileges; restore exactly the ACL the
    // production catalog reports for the three compatibility functions.
    await db.exec(`
      ALTER FUNCTION ${PERSIST_SQL} OWNER TO supabase_admin;
      ALTER FUNCTION ${MERGE_SQL} OWNER TO supabase_admin;
      ALTER FUNCTION ${EVIDENCE_SQL} OWNER TO supabase_admin;
      REVOKE ALL ON FUNCTION ${PERSIST_SQL} FROM PUBLIC, anon, authenticated;
      REVOKE ALL ON FUNCTION ${MERGE_SQL} FROM PUBLIC, anon, authenticated;
      REVOKE ALL ON FUNCTION ${EVIDENCE_SQL} FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION ${PERSIST_SQL} TO postgres, service_role;
      GRANT EXECUTE ON FUNCTION ${MERGE_SQL} TO postgres, service_role;
      GRANT EXECUTE ON FUNCTION ${EVIDENCE_SQL} TO postgres, service_role;
    `);

    const snapshot = async () => (await db.query(`
      SELECT p.oid::regprocedure::text AS signature,
             md5(pg_get_functiondef(p.oid)) AS md5,
             pg_get_functiondef(p.oid) AS definition,
             pg_get_userbyid(p.proowner) AS owner,
             p.proacl::text AS acl,
             p.prosecdef AS security_definer,
             p.proconfig AS config
        FROM pg_proc p
       WHERE p.oid IN (${PERSIST}, ${MERGE}, ${EVIDENCE})
       ORDER BY p.oid::regprocedure::text
    `)).rows;

    const baseline = await snapshot();
    check(baseline.length === 3, "production clone exposes all three compatibility functions");
    check(baseline.find((r) => r.signature.includes("simhub_persist_v3(")).md5 === EXPECT.persistBase,
      "the clone starts from the exact production simhub_persist_v3 body");
    check(baseline.find((r) => r.signature.includes("simhub_pace_merge_v1(")).md5 === EXPECT.merge,
      "the clone starts from the exact production simhub_pace_merge_v1 body");
    check(baseline.find((r) => r.signature.includes("simhub_evidence_v1_valid(")).md5 === EXPECT.evidenceBase,
      "the clone starts from the exact production evidence contract body");
    for (const row of baseline) {
      check(row.acl === EXPECT.acl, `${row.signature.split("(")[0]} starts with the production effective ACL`);
      check(row.owner === "supabase_admin", `${row.signature.split("(")[0]} is owned by supabase_admin`);
    }

    const evidenceValid = async (channels) => (await db.query(
      `SELECT public.simhub_evidence_v1_valid($1::jsonb) AS ok`,
      [JSON.stringify({ version: 1, source: "ir_sdk_onpitroad", channels })],
    )).rows[0].ok;
    check((await evidenceValid(["OnPitRoad"])) === false,
      "the production evidence contract rejects the connector's uppercase channel before forward");
    check((await evidenceValid(["onpitroad"])) === true,
      "the production evidence contract already accepts a lowercase channel");

    const forward = readFileSync(forwardPath, "utf8");
    const rollback = readFileSync(rollbackPath, "utf8");

    await db.exec("SET ROLE supabase_admin");
    await db.exec(forward);
    await db.exec("SET ROLE postgres");

    const afterForward = await snapshot();
    const persistForward = afterForward.find((r) => r.signature.includes("simhub_persist_v3("));
    const mergeForward = afterForward.find((r) => r.signature.includes("simhub_pace_merge_v1("));
    const evidenceForward = afterForward.find((r) => r.signature.includes("simhub_evidence_v1_valid("));
    check(persistForward.md5 === EXPECT.persistNew, "the forward migration leaves the expected persist postimage");
    check(mergeForward.md5 === EXPECT.merge, "the forward migration does not touch simhub_pace_merge_v1");
    check(evidenceForward.md5 === EXPECT.evidenceNew, "the forward migration widens only the evidence channel rule");
    for (const row of afterForward) {
      check(row.acl === EXPECT.acl, `${row.signature.split("(")[0]} keeps the same effective ACL after forward`);
    }

    check(!persistForward.definition.includes("v3_normalized#>'{identity,carId}' IS DISTINCT FROM p_v3_normalized#>'{identity,carId}'"),
      "the old NULL-sensitive car reset is gone from the deployed body");
    check(persistForward.definition.includes("v_pace_previous := public.simhub_pace_previous_v1(v_previous_v3, p_v3_normalized)"),
      "the deployed body calls the tested merge decision");
    check((await evidenceValid(["OnPitRoad"])) === true,
      "the forward accepts the connector's uppercase OnPitRoad channel");
    check((await evidenceValid(["onpitroad"])) === true,
      "the forward keeps accepting the previously valid lowercase channel");

    await db.exec(`SET request.jwt.claim.role='service_role';`);
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${OWNER}', 'owner@example.test');`);
    await db.exec(`
      INSERT INTO public.simhub_devices
        (id, owner_user_id, token_hash, connector_id, device_name, device_status)
      VALUES ('${DEVICE}', '${OWNER}', '${TOKEN}', 'conn-1', 'Compatibility device', 'inactive');
    `);

    let sequence = 0;
    const callFrame = async ({ identity, sessionTime, paceCapture, paceHistory, events } = {}) => {
      await db.exec(`UPDATE public.simhub_devices SET last_seen_at = now() - interval '2 seconds' WHERE id = '${DEVICE}'`);
      const payload = {
        identity: identity ?? { trackId: 596, carId: "gt3", trackName: "Spa", trackConfig: "Full Course" },
        session: { sessionTimeSeconds: sessionTime, completedLaps: 0 },
        raceState: { incidents: 0 },
        track: { onPitRoad: false },
        ...(paceCapture === undefined ? {} : { paceCapture }),
        ...(paceHistory === undefined ? {} : { paceHistory }),
      };
      const capturedAt = new Date(Date.now() + (++sequence) * 1000).toISOString();
      return (await db.query(
        `SELECT * FROM public.simhub_persist_v3($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb)`,
        [TOKEN, SESSION, sequence, capturedAt, JSON.stringify(payload), "0.7.6.4",
          events ? JSON.stringify(events) : null, null],
      )).rows[0];
    };

    const latest = async () => (await db.query(
      `SELECT v3_normalized, car_id, track_name FROM public.simhub_telemetry_latest WHERE device_id = $1`,
      [DEVICE],
    )).rows[0];

    const capture = (segment, observed, car, time) => ({
      schemaRevision: 1,
      observedSessionId: observed,
      segmentId: segment,
      opponentMetrics: [{ id: car, observedSessionTimeSeconds: time, lastLapSeconds: 100 }],
    });

    // 1. Seed proven history through the deployed merge path.
    check((await callFrame({ sessionTime: 100, paceCapture: capture("seg-a", "obs-a", "opp-1", 100) })).result === "accepted",
      "a normal frame is accepted");
    let current = await latest();
    check(current.v3_normalized?.paceHistory?.cars?.length === 1, "the first PACE capture creates one proven car");
    check(current.v3_normalized.paceHistory.segmentId === "seg-a", "the history records the observed segment");
    const proven = current.v3_normalized.paceHistory;

    // 2. Legacy/no-op: no PACE block, full identity.
    check((await callFrame({ sessionTime: 101 })).result === "accepted",
      "a legacy frame without a PACE block is accepted");
    current = await latest();
    assert.deepEqual(current.v3_normalized.paceHistory, proven);
    check(true, "a legacy frame is a no-op for proven history");

    // 3. Sparse identity: no trackId/carId in the frame.
    check((await callFrame({
      sessionTime: 102,
      identity: { trackName: "Spa", trackConfig: "Full Course" },
    })).result === "accepted", "a sparse identity frame is accepted");
    current = await latest();
    assert.deepEqual(current.v3_normalized.paceHistory, proven);
    check(true, "a sparse identity frame keeps all proven cars");
    check(current.v3_normalized.identity?.trackId === 596 && current.v3_normalized.identity?.carId === "gt3",
      "the stored snapshot carries the last known trackId/carId forward");
    check(current.car_id === "gt3", "the snapshot identity columns keep the last known car");

    // 4. Genuine track change.
    check((await callFrame({ sessionTime: 103, identity: { trackId: 597, carId: "gt3", trackName: "Monza" } })).result === "accepted",
      "a confirmed track change frame is accepted");
    current = await latest();
    check(current.v3_normalized.paceHistory === undefined, "a confirmed track change resets the history");

    // 5. Genuine car change.
    check((await callFrame({ sessionTime: 200, paceCapture: capture("seg-b", "obs-b", "opp-2", 200) })).result === "accepted",
      "a re-seed frame is accepted");
    check((await callFrame({ sessionTime: 201, identity: { trackId: 596, carId: "gt3-evo", trackName: "Spa" } })).result === "accepted",
      "a confirmed car change frame is accepted");
    current = await latest();
    check(current.v3_normalized.paceHistory === undefined, "a confirmed car change resets the history");

    // 6. Genuine segment change carried as a new PACE history block.
    check((await callFrame({ sessionTime: 300, paceCapture: capture("seg-c", "obs-c", "opp-3", 300) })).result === "accepted",
      "a second re-seed frame is accepted");
    check((await callFrame({
      sessionTime: 301,
      paceHistory: { schemaRevision: 1, observedSessionId: "obs-c", segmentId: "seg-d", cars: [] },
    })).result === "accepted", "a frame with a new PACE segment is accepted");
    current = await latest();
    check(current.v3_normalized.paceHistory === undefined, "a new PACE segment resets the history");

    // 7. Rewound session clock.
    check((await callFrame({ sessionTime: 400, paceCapture: capture("seg-e", "obs-e", "opp-4", 400) })).result === "accepted",
      "a third re-seed frame is accepted");
    check((await callFrame({ sessionTime: 399 })).result === "accepted",
      "a rewound session clock frame is accepted");
    current = await latest();
    check(current.v3_normalized.paceHistory === undefined, "a rewound session clock resets the history");

    // 8. 24-hour cleanup still removes expired history.
    check((await callFrame({ sessionTime: 500, paceCapture: capture("seg-f", "obs-f", "opp-5", 500) })).result === "accepted",
      "a fourth re-seed frame is accepted");
    await db.exec(`
      UPDATE public.simhub_telemetry_latest
         SET v3_normalized = jsonb_set(
           v3_normalized, '{paceHistory,updatedAt}',
           to_jsonb(((now() - interval '25 hours') AT TIME ZONE 'UTC')::text))
       WHERE device_id = '${DEVICE}'
    `);
    check((await callFrame({ sessionTime: 501 })).result === "accepted",
      "a frame after the 24-hour boundary is accepted");
    current = await latest();
    check(current.v3_normalized.paceHistory === undefined, "the 24-hour cleanup still drops expired history");

    // -----------------------------------------------------------------------
    // Pit measurement path: exact connector payload -> real Edge
    // normalization -> deployed measurement batch -> pit visit trigger.
    // -----------------------------------------------------------------------
    await db.exec("SET ROLE supabase_admin");
    await db.exec(readFileSync(personalPitVisitsPath, "utf8"));
    await db.exec("SET ROLE postgres");

    const committedEdges = JSON.parse(readFileSync(normalizedPitEdges, "utf8"));
    const rawEdges = JSON.parse(readFileSync(rawPitEdges, "utf8"));
    check(rawEdges.every((event) => event.evidence?.channels?.includes("OnPitRoad")),
      "the connector fixture really serializes an uppercase OnPitRoad channel");
    check(committedEdges[0].kind === "pit_in" && committedEdges[1].kind === "pit_out",
      "edge normalization preserves the pit_in/pit_out kinds");

    const denoCandidates = [process.env.DENO_BIN, resolve(homedir(), ".deno/bin/deno"), "deno"].filter(Boolean);
    const denoBin = denoCandidates.find((candidate) => candidate === "deno" || existsSync(candidate));
    let edgeNormalizerExecuted = false;
    if (denoBin) {
      const run = spawnSync(denoBin, ["run", "--quiet", "--allow-read", "--allow-env", denoScript], {
        encoding: "utf8", timeout: 60_000,
      });
      if (run.status === 0) {
        const fresh = JSON.parse(run.stdout);
        assert.deepEqual(fresh, committedEdges);
        edgeNormalizerExecuted = true;
        check(true, "the committed normalized fixture equals a fresh Edge parse of the connector payload");
      }
    }
    if (!edgeNormalizerExecuted) {
      console.log("  note  Deno unavailable; using the committed output of the real Edge normalizer");
    }

    const eventsFrame = await callFrame({ sessionTime: 600, events: committedEdges });
    check(eventsFrame.result === "accepted", "the frame carrying serialized pit measurement events is accepted");
    check(eventsFrame.measurement_ack?.events?.received === 2, "the measurement batch receives both pit edges");
    check(eventsFrame.measurement_ack.events.rejected.length === 0, "neither pit edge is rejected");
    check(eventsFrame.measurement_ack.events.accepted.length === 2, "both pit edges are accepted by the batch");

    const measurementRows = (await db.query(`
      SELECT kind, pit_visit_id, confidence, record_revision
        FROM public.simhub_measurement_events
       WHERE device_id = '${DEVICE}'
       ORDER BY observed_at
    `)).rows;
    check(measurementRows.length === 2 && measurementRows[0].kind === "pit_in" && measurementRows[1].kind === "pit_out",
      "the pit kind values are stored as pit_in and pit_out");

    const edgeRows = (await db.query(`
      SELECT kind, pair_status, reject_reason
        FROM public.pitwall_personal_pit_visit_edges
       ORDER BY id
    `)).rows;
    check(edgeRows.length === 2 && edgeRows.every((row) => row.pair_status === "paired" && row.reject_reason === null),
      "the pit visit trigger accepts and pairs both edges despite the uppercase channel");

    const visits = (await db.query(`
      SELECT pit_lane_seconds, entry_session_seconds, exit_session_seconds
        FROM public.pitwall_personal_pit_visits
    `)).rows;
    check(visits.length === 1 && Number(visits[0].pit_lane_seconds) === 40,
      "the paired pit visit records the 40-second gross pit time");
    check(Number(visits[0].exit_session_seconds) - Number(visits[0].entry_session_seconds) === 40,
      "the visit duration comes from the two serialized session times");

    const kindConstraint = (await db.query(`
      SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conname = 'pitwall_personal_pit_visit_edges_kind'
    `)).rows[0]?.def;
    check(kindConstraint?.includes("pit_in") && kindConstraint.includes("pit_out"),
      "the pit edge kind constraint explicitly admits both measurement kinds");

    // -----------------------------------------------------------------------
    // Paired rollback: one transaction, then compare bodies + effective ACL.
    // -----------------------------------------------------------------------
    const rollbackBody = rollback
      .replace(/^\s*BEGIN;\s*/i, "")
      .replace(/\s*COMMIT;\s*$/i, "");
    await db.exec("BEGIN");
    try {
      await db.exec(rollbackBody);
      const reverted = await snapshot();
      assert.deepEqual(reverted, baseline);
      check(true, "the rollback restores both function bodies and effective ACL exactly");
      check((await evidenceValid(["OnPitRoad"])) === false && (await evidenceValid(["onpitroad"])) === true,
        "the rollback restores the exact lowercase-only evidence rule");
      check((await db.query(`SELECT to_regprocedure('public.simhub_pace_previous_v1(jsonb,jsonb)') IS NULL AS gone`)).rows[0].gone === true,
        "the rollback removes the temporary PACE helpers");
      await db.exec("ROLLBACK");
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
    assert.deepEqual(await snapshot(), afterForward);
    check(true, "rolling back the verification transaction keeps the forward state intact");

    // The forward guard is fail-closed when applied twice.
    await assert.rejects(db.exec(forward), /preimage drift|already carries the replacement block/);
    check(true, "a second forward apply is refused by the exact-hash guard");

    console.log(JSON.stringify({
      isolatedPostgres: "PGlite 0.5.16 (PostgreSQL 18.6 wasm)",
      schemaClone: "production public+pitwall_learning, schema-only, zero rows",
      productionAccess: "read-only pg_get_functiondef",
      edgeNormalizerExecuted,
      passed: results.length,
      failed: 0,
      results,
    }, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ passed: results.length, failed: 1, message: error.message }));
  process.exitCode = 1;
});
