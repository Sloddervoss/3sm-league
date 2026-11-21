#!/usr/bin/env node
/**
 * Isolated PGlite test for personal pit-in -> pit-out visits.
 *
 * The source is the raw tyre observation stream (explicit OnPitRoad flanks +
 * session time), never measurement_events, received_at or a whole pit lap.
 * Covers: a completed visit, idempotent trigger, initial-in-pit, missing exit,
 * session-time reset, 5–900 s bounds, null gaps, team switch, current-session
 * read scope, permission denial and rollback. No remote database is touched.
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
const rollback = resolve(here, "../rollbacks/20261121121000_personal_pit_visits.down.sql");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEVICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TEAM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TEAM_2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";

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
  CREATE TABLE public.simhub_telemetry_latest (
    device_id uuid PRIMARY KEY REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
    session_id text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE public.simhub_tyre_observations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id uuid NOT NULL REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
    endurance_event_id uuid,
    endurance_team_id uuid,
    session_key text NOT NULL,
    frame_sequence bigint NOT NULL,
    observed_at timestamptz,
    session_time_seconds numeric(12,3),
    lap integer,
    driver_name text,
    on_pit_road boolean,
    UNIQUE (device_id, session_key, frame_sequence)
  );
  CREATE FUNCTION public.can_manage_simhub() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  INSERT INTO public.simhub_devices VALUES ('${DEVICE}', '${OWNER}');
  INSERT INTO public.simhub_telemetry_latest(device_id, session_id, received_at) VALUES ('${DEVICE}', 'session-a', now());
`);

await db.exec(await readFile(migration, "utf8"));

let seq = 0;
const obs = async ({ session = "session-a", onPit, time, lap = 10, team = TEAM, event = EVENT, driver = "Driver A" }) => {
  seq += 1;
  await db.query(
    `INSERT INTO public.simhub_tyre_observations
       (device_id, endurance_event_id, endurance_team_id, session_key, frame_sequence, observed_at, session_time_seconds, lap, driver_name, on_pit_road)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [DEVICE, event, team, session, seq, new Date(Date.UTC(2026, 10, 21, 12, 0, 0) + time * 1000).toISOString(), time, lap, driver, onPit],
  );
};

const visitCount = async () => (await db.query("SELECT count(*)::int AS n FROM public.pitwall_personal_pit_visits")).rows[0].n;
const visits = async () => (await db.query("SELECT * FROM public.pitwall_personal_pit_visits ORDER BY entry_frame_sequence")).rows;
const read = async (uid = OWNER, device = DEVICE, limit = 5) => {
  await db.query("SELECT set_config('test.uid', $1, false)", [uid]);
  return (await db.query("SELECT public.pitwall_personal_pit_visits_v1($1,$2) AS out", [device, limit])).rows[0].out;
};

try {
  await obs({ onPit: false, time: 100 });
  await obs({ onPit: true, time: 110 });
  await obs({ onPit: true, time: 130 });
  await obs({ onPit: false, time: 148 });
  let current = await visits();
  check(current.length === 1, "one explicit true -> false transition creates one visit");
  check(Number(current[0].pit_lane_seconds) === 38, "duration is exit session time minus entry session time (38 s)");
  check(current[0].entry_lap === 10 && current[0].entry_driver_name === "Driver A", "lap and entry driver are stored from the entry frame");

  await db.query("INSERT INTO public.simhub_tyre_observations (device_id, session_key, frame_sequence, session_time_seconds, on_pit_road) VALUES ($1,'session-a',1,100,false) ON CONFLICT DO NOTHING", [DEVICE]);
  check(await visitCount() === 1, "replaying the same frames is idempotent (unique visit key)");

  await obs({ session: "session-init", onPit: true, time: 200, lap: 11 });
  await obs({ session: "session-init", onPit: false, time: 248, lap: 11 });
  check(await visitCount() === 1, "a visit that starts in the pit without a prior false is not recorded");

  await obs({ session: "session-open", onPit: true, time: 300, lap: 12 });
  check(await visitCount() === 1, "an open visit without exit is not recorded");

  await obs({ session: "session-reset", onPit: false, time: 0, lap: 13 });
  await obs({ session: "session-reset", onPit: true, time: 400, lap: 13 });
  await obs({ session: "session-reset", onPit: false, time: 390, lap: 13 });
  check(await visitCount() === 1, "a backward session clock is a reset and is not recorded");

  await obs({ session: "session-short", onPit: false, time: 0, lap: 14 });
  await obs({ session: "session-short", onPit: true, time: 500, lap: 14 });
  await obs({ session: "session-short", onPit: false, time: 503, lap: 14 });
  check(await visitCount() === 1, "a pit-lane time below 5 s is not recorded");

  await obs({ session: "session-long", onPit: false, time: 0, lap: 15 });
  await obs({ session: "session-long", onPit: true, time: 600, lap: 15 });
  await obs({ session: "session-long", onPit: false, time: 1601, lap: 15 });
  check(await visitCount() === 1, "a pit-lane time above 900 s is not recorded");

  await obs({ session: "session-null", onPit: false, time: 0, lap: 16 });
  await obs({ session: "session-null", onPit: true, time: 700, lap: 16 });
  await obs({ session: "session-null", onPit: null, time: 720, lap: 16 });
  await obs({ session: "session-null", onPit: false, time: 750, lap: 16 });
  current = await visits();
  check(current.length === 2 && Number(current[1].pit_lane_seconds) === 50, "an unknown (NULL) pit flag does not split the visit");

  await obs({ session: "session-team", onPit: false, time: 0, lap: 17 });
  await obs({ session: "session-team", onPit: true, time: 800, lap: 17, team: TEAM });
  await obs({ session: "session-team", onPit: false, time: 840, lap: 17, team: TEAM_2 });
  check(await visitCount() === 2, "a team switch mid-visit makes the duration unusable");

  await obs({ session: "session-b", onPit: false, time: 10 });
  await obs({ session: "session-b", onPit: true, time: 20 });
  await obs({ session: "session-b", onPit: false, time: 67 });
  current = await visits();
  check(current.length === 3, "a new session records its own visit");
  check(current[2].session_key === "session-b" && Number(current[2].pit_lane_seconds) === 47, "session B keeps its own duration");

  await db.query("UPDATE public.simhub_telemetry_latest SET session_id='session-b', received_at=now() WHERE device_id=$1", [DEVICE]);
  let feed = await read();
  check(feed.available === true && feed.sessionKey === "session-b" && feed.visits.length === 1, "the personal reader returns only the current session");
  check(Number(feed.visits[0].pitLaneSeconds) === 47 && feed.visits[0].source === "tyre_observation_pit_edges", "the reader exposes the measured gross duration and its source");

  await db.query("UPDATE public.simhub_telemetry_latest SET session_id='session-c', received_at=now() WHERE device_id=$1", [DEVICE]);
  feed = await read();
  check(feed.available === false && feed.reason === "no_completed_visit", "a new session without a completed visit returns an explicit empty state");

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
      has_table_privilege('authenticated','public.pitwall_personal_pit_visits','SELECT') AS table_read,
      has_table_privilege('anon','public.pitwall_personal_pit_visits','SELECT') AS anon_read,
      has_function_privilege('authenticated','public.pitwall_personal_pit_visits_v1(uuid,integer)','EXECUTE') AS fn_exec
  `);
  check(grants.rows[0].table_read === false && grants.rows[0].anon_read === false && grants.rows[0].fn_exec === true,
    "the table is service-role only; the owner RPC is the authenticated gate");

  await db.exec(await readFile(rollback, "utf8"));
  const gone = await db.query("SELECT to_regclass('public.pitwall_personal_pit_visits') AS t, to_regprocedure('public.pitwall_personal_pit_visits_v1(uuid,integer)') AS f");
  check(gone.rows[0].t === null && gone.rows[0].f === null, "rollback removes the table and reader");

  console.log(JSON.stringify({ isolatedPGlite: true, productionExecuted: false, backfill: false, passed: results.length, failed: 0, results }));
} catch (error) {
  console.error(JSON.stringify({ passed: results.length, failed: 1, message: error.message }));
  process.exitCode = 1;
} finally {
  await db.close();
}
