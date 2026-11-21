#!/usr/bin/env node
/**
 * Isolated PGlite test for personal pit-in -> pit-out visits.
 *
 * The source is the pair of explicit connector measurement events `pit_in` and
 * `pit_out`, each with its own observed_at, session time and SDK tick. Never
 * the sampled tyre table, received_at or a whole pit lap. Covers: real pair,
 * out-of-order delivery, retry idempotency, missing entry/exit, cross-session
 * and cross-visit isolation, clock/tick discontinuities, confidence rejection,
 * duration bounds, current-session read scope, permission denial, grants and
 * rollback. No remote database is touched.
 *
 * Run: node supabase/tests/personal-pit-visits.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const migration = resolve(here, "../migrations/20261121121000_personal_pit_visits.sql");
const connectorFixture = resolve(here, "./fixtures/pit-edges-connector.json");
const rollback = resolve(here, "../rollbacks/20261121121000_personal_pit_visits.down.sql");

const OWNER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEVICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const db = await PGlite.create();
const results = [];
const check = (ok, label) => {
  if (!ok) throw new Error(`FAIL: ${label}`);
  results.push(label);
  console.log(`  ok  ${label}`);
};

await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('test.uid', true), '')::uuid
  $$;
  CREATE TABLE public.simhub_devices (
    id uuid PRIMARY KEY,
    owner_user_id uuid NOT NULL
  );
  CREATE TABLE public.simhub_measurement_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id text NOT NULL,
    event_uid uuid NOT NULL,
    event_id text,
    kind text NOT NULL,
    segment_id text,
    pit_visit_id text,
    observed_session_id text,
    delivered_session_id text,
    transport_session_id text,
    observed_at timestamptz,
    received_at timestamptz NOT NULL DEFAULT now(),
    session_time_seconds double precision,
    sdk_tick bigint,
    evidence jsonb,
    confidence double precision,
    UNIQUE (device_id, event_uid)
  );
  CREATE FUNCTION public.can_manage_simhub() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('test.manage', true), ''), '0')::boolean
  $$;
  INSERT INTO public.simhub_devices VALUES ('${DEVICE}', '${OWNER}');
  INSERT INTO public.simhub_devices VALUES ('${DEVICE_2}', '${OWNER}');
`);

// Historische rijen van vóór de trigger: de migratie mag ze niet backfillen.
await db.exec(`
  INSERT INTO public.simhub_measurement_events
    (device_id,event_uid,kind,pit_visit_id,observed_session_id,observed_at,session_time_seconds,sdk_tick,confidence)
  VALUES
    ('${DEVICE}','00000000-0000-4000-8000-0000000000aa','pit_in','pit-historic-1','sim-historic','2026-11-20T10:00:00Z',10,1000,1),
    ('${DEVICE}','00000000-0000-4000-8000-0000000000ab','pit_out','pit-historic-1','sim-historic','2026-11-20T10:00:40Z',50,3400,1);
`);

await db.exec(await readFile(migration, "utf8"));

const noBackfill = await db.query("SELECT count(*)::int AS n FROM public.pitwall_personal_pit_visits");
check(noBackfill.rows[0].n === 0, "the migration does not backfill historical measurement events");
const noBackfillEdges = await db.query("SELECT count(*)::int AS n FROM public.pitwall_personal_pit_visit_edges");
check(noBackfillEdges.rows[0].n === 0, "historical events do not create diagnostic edge rows either");

let uid = 0;
const newUid = () => {
  uid += 1;
  return `00000000-0000-4000-8000-${String(uid).padStart(12, "0")}`;
};
const edge = async ({
  kind,
  visit = "pit-seg-abc-1",
  session = "sim-42-s1",
  time,
  wall = time,
  tick = 100000 + time * 60,
  confidence = 1,
  note = null,
  device = DEVICE,
  eventUid = newUid(),
}) => {
  await db.query(
    `INSERT INTO public.simhub_measurement_events
       (device_id, event_uid, kind, segment_id, pit_visit_id, observed_session_id,
        delivered_session_id, observed_at, session_time_seconds, sdk_tick, confidence, evidence)
     VALUES ($1,$2,$3,'seg-abc',$4,$5,'transport-reused',$6,$7,$8,$9,$10)
     ON CONFLICT (device_id, event_uid) DO NOTHING`,
    [device, eventUid, kind, visit, session, new Date(Date.UTC(2026, 10, 21, 12, 0, 0) + wall * 1000).toISOString(),
      time, tick, confidence, note == null ? null : JSON.stringify({ version: 1, source: "ir_sdk_onpitroad", channels: ["OnPitRoad"], note })],
  );
  return eventUid;
};

const visitCount = async () => (await db.query("SELECT count(*)::int AS n FROM public.pitwall_personal_pit_visits WHERE device_id=$1", [DEVICE])).rows[0].n;
const visits = async () => (await db.query("SELECT * FROM public.pitwall_personal_pit_visits WHERE device_id=$1 ORDER BY entry_observed_at", [DEVICE])).rows;
const read = async (uid = OWNER, device = DEVICE, limit = 5) => {
  await db.query("SELECT set_config('test.uid', $1, false)", [uid]);
  return (await db.query("SELECT public.pitwall_personal_pit_visits_v1($1,$2) AS out", [device, limit])).rows[0].out;
};

let current;
try {
  // Echte C#-serializeroutput: dezelfde wire-DTO als de connector-outbox.
  const serialized = JSON.parse(await readFile(connectorFixture, "utf8"));
  for (const row of serialized) {
    await db.query(
      `INSERT INTO public.simhub_measurement_events
         (device_id, event_uid, event_id, kind, segment_id, pit_visit_id, observed_session_id,
          delivered_session_id, observed_at, session_time_seconds, sdk_tick, confidence, evidence)
       VALUES ('${DEVICE_2}',$1,$2,$3,$4,$5,$6,'transport-reused',$7,$8,$9,$10,$11)`,
      [row.eventUid, row.eventId, row.kind, row.segmentId, row.pitVisitId, row.observedSessionId,
        row.observedAt, row.sessionTimeSeconds, row.sdkTick, row.confidence, JSON.stringify(row.evidence)],
    );
  }
  const fixtureVisit = (await db.query(
    "SELECT pit_lane_seconds FROM public.pitwall_personal_pit_visits WHERE device_id=$1",
    [DEVICE_2],
  )).rows;
  check(fixtureVisit.length === 1 && Number(fixtureVisit[0].pit_lane_seconds) === 40,
    "the real connector serializer output parses and pairs into one 40 s visit");

  await edge({ kind: "pit_in", time: 100, wall: 100 });
  await edge({ kind: "pit_out", time: 138, wall: 138 });
  current = await visits();
  check(current.length === 1, "one explicit pit_in/pit_out pair creates one visit");
  check(Number(current[0].pit_lane_seconds) === 38, "duration is exit session time minus entry session time (38 s)");
  check(current[0].entry_sdk_tick === 106000 && current[0].exit_sdk_tick === 108280, "both source SDK ticks are stored");
  check((await db.query("SELECT pair_status FROM public.pitwall_personal_pit_visit_edges")).rows.every((row) => row.pair_status === "paired"),
    "both edges are marked paired");

  await edge({ kind: "pit_in", time: 100, wall: 100, eventUid: current[0].entry_event_uid });
  check(await visitCount() === 1, "retrying the same entry event is idempotent");

  // Out-of-order delivery: the exit is stored before the entry, then pairs.
  const lateVisit = "pit-seg-abc-2";
  await edge({ kind: "pit_out", visit: lateVisit, time: 240, wall: 240, tick: 114400 });
  check(await visitCount() === 1, "an exit without an entry stays pending and creates no duration");
  await edge({ kind: "pit_in", visit: lateVisit, time: 200, wall: 200, tick: 112000 });
  current = await visits();
  check(current.length === 2 && Number(current[1].pit_lane_seconds) === 40,
    "a later entry pairs with the earlier exit (out-of-order delivery)");

  // The same pitVisitId in another observed session is a different visit.
  await edge({ kind: "pit_in", visit: "pit-seg-abc-3", session: "sim-42-s2", time: 300, wall: 300 });
  check(await visitCount() === 2, "an entry from another observed session cannot pair with a different session's exit");
  await edge({ kind: "pit_out", visit: "pit-seg-abc-3", session: "sim-42-s2", time: 340, wall: 340 });
  check(await visitCount() === 3, "the same pitVisitId in a new observed session is its own visit");

  // Missing exit.
  await edge({ kind: "pit_in", visit: "pit-open", time: 400, wall: 400 });
  check(await visitCount() === 3, "an open visit without an exit is not recorded");

  // Same pitVisitId but different device never pairs.
  await edge({ kind: "pit_in", visit: "pit-cross-device", time: 500, wall: 500, device: DEVICE_2 });
  await edge({ kind: "pit_out", visit: "pit-cross-device", time: 540, wall: 540, device: DEVICE });
  check(await visitCount() === 3, "two devices cannot share one pit visit");

  // Non-monotone SDK tick.
  await edge({ kind: "pit_in", visit: "pit-tick", session: "sim-42-s2", time: 600, wall: 600, tick: 140000 });
  await edge({ kind: "pit_out", visit: "pit-tick", session: "sim-42-s2", time: 640, wall: 640, tick: 140000 });
  const tickEdges = (await db.query("SELECT pair_status,reject_reason FROM public.pitwall_personal_pit_visit_edges WHERE pit_visit_id='pit-tick'")).rows;
  check(await visitCount() === 3 && tickEdges.every((row) => row.pair_status === "rejected" && row.reject_reason === "sdk_tick_not_monotone"),
    "a non-monotone source tick is rejected with its reason");

  // Clock and telemetry gap: session time and wall clock disagree by > 30 s.
  await edge({ kind: "pit_in", visit: "pit-gap", session: "sim-42-s2", time: 700, wall: 700 });
  await edge({ kind: "pit_out", visit: "pit-gap", session: "sim-42-s2", time: 760, wall: 900 });
  const gapEdges = (await db.query("SELECT pair_status,reject_reason FROM public.pitwall_personal_pit_visit_edges WHERE pit_visit_id='pit-gap'")).rows;
  check(await visitCount() === 3 && gapEdges.every((row) => row.pair_status === "rejected" && row.reject_reason === "clock_telemetry_gap"),
    "a clock/telemetry gap is rejected, never turned into a longer pit time");

  // Duration bounds.
  await edge({ kind: "pit_in", visit: "pit-short", session: "sim-42-s2", time: 800, wall: 800 });
  await edge({ kind: "pit_out", visit: "pit-short", session: "sim-42-s2", time: 803, wall: 803 });
  await edge({ kind: "pit_in", visit: "pit-long", session: "sim-42-s2", time: 900, wall: 900 });
  await edge({ kind: "pit_out", visit: "pit-long", session: "sim-42-s2", time: 1901, wall: 1901 });
  check(await visitCount() === 3, "durations below 5 s and above 900 s are not visits");

  // A connector-rejected flank (unknown pit flag, tow/reset, gap) carries
  // confidence 0 and must never pair just because both edges exist.
  await edge({ kind: "pit_in", visit: "pit-unknown", session: "sim-42-s2", time: 2000, wall: 2000 });
  await edge({ kind: "pit_out", visit: "pit-unknown", session: "sim-42-s2", time: 2040, wall: 2040, confidence: 0, note: "pit_flag_unknown" });
  const unknownEdges = (await db.query("SELECT pair_status,reject_reason FROM public.pitwall_personal_pit_visit_edges WHERE pit_visit_id='pit-unknown'")).rows;
  check(await visitCount() === 3 && unknownEdges.some((row) => row.pair_status === "rejected" && row.reject_reason === "pit_flag_unknown"),
    "an unknown/tow/gap flank is rejected with the connector's explicit reason");

  // The reader follows the newest observed session, not the reused transport.
  let feed = await read();
  check(feed.available === true && feed.sessionKey === "sim-42-s2" && feed.visits.length === 1,
    "the personal reader returns only the newest observed session");
  check(Number(feed.visits[0].pitLaneSeconds) === 40 && feed.visits[0].source === "measurement_event_pit_edges",
    "the reader exposes the measured gross duration and its source");
  check(feed.diagnostics.rejectedEdges >= 3 && typeof feed.diagnostics.lastRejectReason === "string",
    "rejected edges stay visible as an explicit diagnostic, not as a silent gap");

  // Admin-pitwalltest: dezelfde lezer, dezelfde bron, maar een beheerder die
  // niet de eigenaar is. Alleen de bestaande can_manage_simhub()-poort opent
  // dit; de ownerroute en de grants blijven ongewijzigd.
  await db.query("SELECT set_config('test.uid', $1, false)", [ADMIN]);
  await db.query("SELECT set_config('test.manage', '1', false)");
  const adminFeed = await read(ADMIN, DEVICE);
  check(adminFeed.available === true && adminFeed.sessionKey === "sim-42-s2" && adminFeed.visits.length === 1,
    "an admin with can_manage_simhub can read the same current-session visit of a non-owned device");
  check(Number(adminFeed.visits[0].pitLaneSeconds) === 40 && adminFeed.visits[0].source === "measurement_event_pit_edges",
    "the admin reader exposes the identical measured gross duration and source as the owner reader");
  await db.query("SELECT set_config('test.manage', '0', false)");
  let adminWithoutGrantDenied = false;
  try {
    await read(ADMIN, DEVICE);
  } catch (error) {
    adminWithoutGrantDenied = /Permission denied/.test(String(error.message));
  }
  check(adminWithoutGrantDenied, "without can_manage_simhub an admin uid has no access to another owner's device");

  await edge({ kind: "pit_in", visit: "pit-new-session", session: "sim-42-s3", time: 3000, wall: 3000 });
  feed = await read();
  check(feed.available === false && feed.reason === "no_completed_visit" && feed.sessionKey === "sim-42-s3",
    "a new session without a completed visit returns an explicit empty state");

  await db.query("SELECT set_config('test.uid', $1, false)", [OTHER]);
  let denied = false;
  try {
    await db.query("SELECT public.pitwall_personal_pit_visits_v1($1,5)", [DEVICE]);
  } catch (error) {
    denied = /Permission denied/.test(String(error.message));
  }
  check(denied, "another authenticated user cannot read this device's pit visits");

  const grants = await db.query(`
    SELECT
      has_table_privilege('authenticated','public.pitwall_personal_pit_visits','SELECT') AS visits_read,
      has_table_privilege('authenticated','public.pitwall_personal_pit_visit_edges','SELECT') AS edges_read,
      has_table_privilege('anon','public.pitwall_personal_pit_visits','SELECT') AS anon_read,
      has_function_privilege('authenticated','public.pitwall_personal_pit_visits_v1(uuid,integer)','EXECUTE') AS fn_exec,
      has_function_privilege('service_role','public.simhub_capture_personal_pit_visit_v2()','EXECUTE') AS trigger_fn
  `);
  check(grants.rows[0].visits_read === false && grants.rows[0].edges_read === false && grants.rows[0].anon_read === false
    && grants.rows[0].fn_exec === true && grants.rows[0].trigger_fn === true,
    "tables are service-role only; the owner RPC is the authenticated gate");

  await db.exec(await readFile(rollback, "utf8"));
  const gone = await db.query(`
    SELECT to_regclass('public.pitwall_personal_pit_visits') AS visits,
           to_regclass('public.pitwall_personal_pit_visit_edges') AS edges,
           to_regprocedure('public.pitwall_personal_pit_visits_v1(uuid,integer)') AS fn
  `);
  check(gone.rows[0].visits === null && gone.rows[0].edges === null && gone.rows[0].fn === null,
    "rollback removes both tables and the reader");

  console.log(JSON.stringify({ isolatedPGlite: true, productionExecuted: false, backfill: false, passed: results.length, failed: 0, results }));
} catch (error) {
  console.error(JSON.stringify({ passed: results.length, failed: 1, message: error.message }));
  process.exitCode = 1;
} finally {
  await db.close();
}
