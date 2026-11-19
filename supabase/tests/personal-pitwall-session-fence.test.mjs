#!/usr/bin/env node
/**
 * Isolated PostgreSQL/PGlite test for the personal Pitwall session fence.
 *
 * Runs the real base share migration plus the additive session-provenance
 * migration. Covers the production-shaped "unknown" state, simulator identity
 * binding, ingest-time revocation without any spectator poll, cross-session
 * archive isolation, the bounded public sector projection and rollback.
 *
 * Run: node supabase/tests/personal-pitwall-session-fence.test.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const basePath = resolve(here, "../migrations/20261119120000_personal_pitwall_share.sql");
const fencePath = resolve(here, "../migrations/20261119130000_personal_pitwall_session_fence.sql");
const rollbackPath = resolve(here, "../rollbacks/20261119130000_personal_pitwall_session_fence.down.sql");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEVICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_DEVICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TEAM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SESSION = "simhub-transport-1";
const SESSION_2 = "simhub-transport-2";
const OBS = "sim-778899-s4";
const TOKEN_RE = /^[0-9a-f]{64}$/;

const results = [];
const check = (ok, label) => {
  if (!ok) throw new Error(`FAIL: ${label}`);
  results.push(label);
  console.log(`  ok  ${label}`);
};
const expectError = async (fn, pattern, label) => {
  try {
    await fn();
  } catch (error) {
    const message = String(error?.message ?? error);
    if (!pattern.test(message)) throw new Error(`FAIL: ${label} (unexpected: ${message})`);
    check(true, label);
    return;
  }
  throw new Error(`FAIL: ${label} (no error)`);
};

const paceCar = (id, sectorCount, sectorSeconds) => ({
  id,
  laps: [],
  traces: [],
  metrics: {
    observedSessionTimeSeconds: 500,
    lastLapSeconds: sectorSeconds.reduce((a, b) => a + b, 0),
    bestLapSeconds: sectorSeconds.reduce((a, b) => a + b, 0),
    sectorCount,
    sectorLap: 18,
    lapValid: true,
    sectorSource: "measured",
    sectorErrorSeconds: 0,
  },
  sectors: sectorSeconds.map((seconds, sectorIndex) => ({
    sectorIndex,
    sectorCount,
    lap: 18,
    seconds,
    status: "verified",
    referenceSeconds: seconds + 0.5,
    revision: 1,
    completedSessionTimeSeconds: 470,
    observedSessionTimeSeconds: 500,
  })),
  sectorBests: sectorSeconds.map((seconds, sectorIndex) => ({ sectorIndex, lap: 18, seconds })),
});

const makeV3 = (overrides = {}) => ({
  protocolVersion: 3,
  capturedAt: new Date().toISOString(),
  transportSessionId: SESSION,
  identity: {
    currentDriverId: "account-driver-id-must-not-leak",
    currentDriverName: "Test Driver",
    carId: "car-model-id",
    carName: "Porsche 911 GT3 R",
    trackName: "Spa-Francorchamps",
    trackConfig: "Endurance",
    trackId: 42,
  },
  session: {
    isInCar: true,
    sessionTimeSeconds: 500,
    sessionTimeRemainingSeconds: 3600,
    sessionLapsRemaining: 50,
    flags: [],
    // Production shape: the connector reports "unknown" while the driver is
    // actually running. It must not be treated as active on its own.
    sessionState: "unknown",
  },
  timing: {
    currentLapElapsedSeconds: 31,
    lastLapTimeSeconds: 102.4,
    bestLapTimeSeconds: 101.8,
    completedLaps: 18,
  },
  position: { position: 3, classPosition: 2, gapToLeaderSeconds: 12.3 },
  track: { lapDistancePct: 0.42, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 55.4, fuelPct: 0.6, fuelCapacityLitres: 90, fuelPerLapLitres: 3.2, lapsRemaining: 17 },
  tyres: { sets: { used: 2, available: 3 } },
  vehicle: {
    speedKph: 210,
    gear: "4",
    sector1Seconds: 38,
    sector2Seconds: 41,
    sector3Seconds: 39,
    tyreDataMode: "last_available",
    pressureUnit: "psi",
    temperatureUnit: "C",
    frontLeft: { wearPercent: 88, temperature: 84, pressure: 26 },
    frontRight: { wearPercent: 86, temperature: 85, pressure: 26 },
    rearLeft: { wearPercent: 91, temperature: 80, pressure: 25 },
    rearRight: { wearPercent: 90, temperature: 81, pressure: 25 },
  },
  opponents: [
    { id: "driver-a", driverName: "Leader", carNumber: "1", position: 1, classPosition: 1, connected: true },
    { id: "driver-b", driverName: "Test Driver", carNumber: "3", position: 3, classPosition: 2, connected: true, isPlayer: true },
    { id: "driver-c", driverName: "Rival", carNumber: "4", position: 4, classPosition: 3, connected: true },
  ],
  paceHistory: {
    schemaRevision: 1,
    observedSessionId: OBS,
    segmentId: "segment-1",
    transportSessionId: SESSION,
    updatedAt: new Date().toISOString(),
    cars: [paceCar("driver-a", 3, [38.1, 41.2, 39.0]), paceCar("driver-b", 3, [37.9, 41.0, 38.8])],
  },
  ...overrides,
});

const withSession = (v3, sessionId, observedSessionId, extra = {}) => ({
  ...v3,
  transportSessionId: sessionId,
  paceHistory: {
    ...v3.paceHistory,
    transportSessionId: sessionId,
    observedSessionId,
    updatedAt: new Date().toISOString(),
  },
  ...extra,
});

const setupSql = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user)
$$;

CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'moderator', 'editor', 'endurance_manager');
CREATE TABLE public.user_roles (user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, role public.app_role NOT NULL);

CREATE TABLE public.endurance_events (id uuid PRIMARY KEY, name text);
CREATE TABLE public.endurance_teams (id uuid PRIMARY KEY, name text);

CREATE TABLE public.simhub_devices (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  race_id uuid,
  team_id uuid,
  token_hash text NOT NULL,
  connector_id text NOT NULL,
  device_name text NOT NULL,
  paired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_seen_at timestamptz,
  last_session_id text,
  last_sequence bigint NOT NULL DEFAULT -1,
  revoked_at timestamptz,
  revoked_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  endurance_event_id uuid REFERENCES public.endurance_events(id),
  endurance_team_id uuid REFERENCES public.endurance_teams(id),
  endurance_binding_source text,
  device_status text,
  device_role text
);

CREATE TABLE public.simhub_telemetry_latest (
  device_id uuid PRIMARY KEY REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  race_id uuid,
  team_id uuid,
  session_id text NOT NULL,
  sequence bigint NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  connector_id text NOT NULL,
  simhub_version text NOT NULL,
  game text NOT NULL,
  telemetry jsonb NOT NULL DEFAULT '{}'::jsonb,
  endurance_event_id uuid,
  endurance_team_id uuid,
  driver_id text,
  current_driver_id text,
  current_driver_name text,
  car_id text,
  car_name text,
  track_name text,
  track_config text,
  race_run_id uuid,
  v3_normalized jsonb,
  connector_version text
);

CREATE TABLE public.simhub_device_health (
  device_id uuid PRIMARY KEY REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  connector_version text NOT NULL,
  simhub_version text NOT NULL,
  game_connected boolean NOT NULL DEFAULT false,
  telemetry_available boolean NOT NULL DEFAULT false,
  raw_data_available boolean NOT NULL DEFAULT false,
  raw_telemetry_available boolean NOT NULL DEFAULT false,
  session_time_read_ok boolean NOT NULL DEFAULT false,
  session_time_seconds double precision,
  session_time_reader text NOT NULL DEFAULT '',
  sequence bigint NOT NULL DEFAULT 0,
  client_last_telemetry_attempt_utc timestamptz,
  client_last_successful_ingest_utc timestamptz,
  client_last_ingest_http_status integer,
  diagnostic_code text NOT NULL DEFAULT 'ok',
  updater_state text NOT NULL DEFAULT 'current',
  updater_current_version text NOT NULL DEFAULT '0.0.0',
  updater_target_version text,
  last_update_result text,
  last_update_utc timestamptz,
  client_reported_at_utc timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.simhub_device_laps (
  device_id uuid NOT NULL REFERENCES public.simhub_devices(id) ON DELETE CASCADE,
  connector_id text NOT NULL,
  session_key text NOT NULL,
  lap_number integer NOT NULL,
  lap_seconds numeric(8,3),
  driver_name text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, session_key, lap_number)
);

CREATE TABLE public.simhub_lap_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id text NOT NULL,
  device_id text NOT NULL,
  transport_session_id text,
  delivered_session_id text,
  observed_session_id text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.simhub_measurement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text,
  device_id text NOT NULL,
  transport_session_id text,
  delivered_session_id text,
  observed_session_id text,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.simhub_pace_project_v1(snapshot jsonb, reference_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT snapshot - 'paceHistory' - 'paceCapture'
$$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated;
`;

const seed = async (db) => {
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4)", [OWNER, "owner@example.test", OTHER, "other@example.test"]);
  await db.query("INSERT INTO public.endurance_events (id,name) VALUES ($1,'Test Endurance')", [EVENT]);
  await db.query("INSERT INTO public.endurance_teams (id,name) VALUES ($1,'Test Team')", [TEAM]);
  await db.query(
    `INSERT INTO public.simhub_devices
      (id, owner_user_id, token_hash, connector_id, device_name, last_seen_at, device_status, device_role, endurance_event_id, endurance_team_id)
     VALUES
      ($1,$2,repeat('a',64),'connector-1','Owner PC',now(),'active_binding','primary',$5,$6),
      ($3,$2,repeat('b',64),'connector-2','Owner Laptop',now() - interval '10 minutes','inactive',NULL,NULL,NULL),
      ($4,$7,repeat('c',64),'connector-3','Other PC',now(),'active_unbound',NULL,NULL,NULL)`,
    [DEVICE, OWNER, DEVICE_2, OTHER_DEVICE, EVENT, TEAM, OTHER],
  );
  await db.query(
    `INSERT INTO public.simhub_device_health
      (device_id, connector_version, simhub_version, game_connected, telemetry_available, session_time_read_ok, session_time_seconds, sequence)
     VALUES ($1,'0.8.0.0','9.3.1',true,true,true,500,42)`,
    [DEVICE],
  );
  await db.query(
    `INSERT INTO public.simhub_telemetry_latest
      (device_id, owner_user_id, session_id, sequence, captured_at, received_at, connector_id, simhub_version, game,
       current_driver_name, car_name, track_name, track_config, race_run_id, v3_normalized)
     VALUES ($1,$2,$3,42,now(),now(),'connector-1','9.3.1','IRacing','Test Driver','Porsche 911 GT3 R',
             'Spa-Francorchamps','Endurance',$4,$5::jsonb)`,
    [DEVICE, OWNER, SESSION, null, JSON.stringify(makeV3())],
  );
};

const run = async () => {
  const db = new PGlite();
  const base = await readFile(basePath, "utf8");
  const fence = await readFile(fencePath, "utf8");
  const rollback = await readFile(rollbackPath, "utf8");

  const as = async (role, uid, fn) => {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
    await db.query("SELECT set_config('request.jwt.claim.role', $1, false)", [role]);
    await db.exec(`SET ROLE ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("RESET ROLE");
    }
  };
  const asOwner = (uid, fn) => as("authenticated", uid, fn);
  const asAnon = (fn) => as("anon", "", fn);
  const asAdmin = async (fn) => {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
    return fn();
  };
  const rpc = async (name, params = [], casts = []) => {
    const placeholders = params.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ""}`).join(",");
    const { rows } = await db.query(`SELECT public.${name}(${placeholders}) AS r`, params);
    return rows[0].r;
  };
  const tokenHash = async (token) => (await db.query(
    "SELECT encode(pg_catalog.sha256(pg_catalog.convert_to($1,'UTF8')),'hex') AS h",
    [token],
  )).rows[0].h;
  const setLive = async (v3, { receivedAt = "now()", session = SESSION } = {}) => {
    await asAdmin(async () => {
      await db.query(
        `UPDATE public.simhub_telemetry_latest
         SET v3_normalized=$2::jsonb, session_id=$3, received_at=${receivedAt},
             track_name=$4, track_config='Endurance', owner_user_id=$5
         WHERE device_id=$1`,
        [DEVICE, JSON.stringify(v3), session, v3.identity.trackName, OWNER],
      );
    });
  };
  const resetLive = async () => {
    await asAdmin(async () => {
      await db.query("UPDATE public.simhub_devices SET revoked_at=NULL, device_status='active_binding', expires_at=NULL WHERE id=$1", [DEVICE]);
      await db.query("DELETE FROM public.simhub_device_laps WHERE device_id=$1", [DEVICE]);
      await db.query("DELETE FROM public.simhub_lap_summaries WHERE device_id=$1", [DEVICE]);
      await db.query("DELETE FROM public.simhub_measurement_events WHERE device_id=$1", [DEVICE]);
    });
    await setLive(makeV3(), { receivedAt: "now()" });
  };
  const activeShare = async () => asAdmin(async () => (await db.query(
    "SELECT revoked_at, revoke_reason, observed_session_key, track_id FROM public.pitwall_shared_races WHERE device_id=$1 ORDER BY created_at DESC LIMIT 1",
    [DEVICE],
  )).rows[0]);

  console.log("1. migrations apply on isolated PostgreSQL");
  await db.exec(setupSql);
  await seed(db);
  await db.exec(base);
  await db.exec(fence);
  check(true, "base share migration + session fence migration applied");

  console.log("2. ACL: only the v2 surface is callable");
  check(await asAnon(async () => (await db.query("SELECT has_function_privilege('anon','public.pitwall_shared_snapshot_v2(text)','EXECUTE') AS x")).rows[0].x), "anon may execute the v2 snapshot");
  check(!(await asAnon(async () => (await db.query("SELECT has_function_privilege('anon','public.pitwall_shared_snapshot_v1(text)','EXECUTE') AS x")).rows[0].x)), "transport-only v1 snapshot is revoked");
  check(!(await asAnon(async () => (await db.query("SELECT has_function_privilege('anon','public.pitwall_share_create_v2(uuid,integer)','EXECUTE') AS x")).rows[0].x)), "anon may not create shares");
  check(!(await asOwner(OWNER, async () => (await db.query("SELECT has_function_privilege('authenticated','public.pitwall_share_create_v1(uuid,integer)','EXECUTE') AS x")).rows[0].x)), "v1 creator is revoked");

  console.log("3. production-shaped unknown state is shareable only with corroboration");
  const devices = await asOwner(OWNER, () => rpc("pitwall_my_devices_v2"));
  check(devices.devices[0].shareable === true && devices.devices[0].shareable_reason == null, "unknown + in-car + active clock + laps is shareable");
  check(devices.devices[0].session_state === "unknown", "the real unknown state is reported unchanged");
  check(devices.devices[0].id === DEVICE, "owner discovery stays owner-scoped");
  check(devices.devices.every((d) => !("owner_user_id" in d) && !("token_hash" in d)), "discovery leaks no owner id or token hash");

  const noEvidence = makeV3({ timing: { ...makeV3().timing, completedLaps: 0, currentLapElapsedSeconds: 1, lastLapTimeSeconds: null } });
  await db.query("DELETE FROM public.simhub_device_laps WHERE device_id=$1", [DEVICE]);
  await db.query("DELETE FROM public.simhub_lap_summaries WHERE device_id=$1", [DEVICE]);
  await setLive(noEvidence);
  const noEvidenceDevices = await asOwner(OWNER, () => rpc("pitwall_my_devices_v2"));
  check(noEvidenceDevices.devices[0].shareable === false && noEvidenceDevices.devices[0].shareable_reason === "session_inactive", "unknown alone without lap/clock evidence is not shareable");
  const noEvidenceCreate = await asOwner(OWNER, () => rpc("pitwall_share_create_v2", [DEVICE, 14400], ["uuid", "int"]));
  check(noEvidenceCreate.ok === false && noEvidenceCreate.code === "not_shareable", "creation refuses unknown-without-corroboration");

  const parked = makeV3({ session: { ...makeV3().session, isInCar: false } });
  await setLive(parked);
  const parkedDevices = await asOwner(OWNER, () => rpc("pitwall_my_devices_v2"));
  check(parkedDevices.devices[0].shareable === false, "isInCar false is not shareable");

  await resetLive();
  console.log("3b. meatball/mechanical warning is not a session end");
  const meatballV3 = makeV3({ session: { ...makeV3().session, sessionState: "racing", flags: ["yellow", "meatball"] } });
  await setLive(meatballV3);
  check(await asAdmin(async () => (await db.query(
    "SELECT public.pitwall_share_session_active_v2($1::jsonb) AS x",
    [JSON.stringify(meatballV3)],
  )).rows[0].x), "a meatball frame is still an active session");
  const meatballDevices = await asOwner(OWNER, () => rpc("pitwall_my_devices_v2"));
  check(meatballDevices.devices[0].shareable === true, "the owner can still share while meatball is shown");
  const meatballShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v2", [DEVICE, 14400], ["uuid", "int"]));
  check(meatballShare.ok === true && TOKEN_RE.test(meatballShare.token), "share creation succeeds under a meatball flag");
  // Real driving shape: the flag stays set on subsequent accepted frames.
  const meatballNext = makeV3({
    session: { ...meatballV3.session, sessionTimeSeconds: 620 },
    timing: { ...makeV3().timing, completedLaps: 19, lastLapTimeSeconds: 103.1 },
  });
  await setLive(meatballNext);
  const meatballStored = await activeShare();
  check(meatballStored.revoked_at === null && meatballStored.revoke_reason === null, "a meatball ingest frame does not revoke the share");
  const meatballRead = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [meatballShare.token]));
  check(meatballRead.ok === true, "the spectator still reads the session while meatball is shown");

  await resetLive();
  console.log("4. share creation binds the simulator session");
  const created = await asOwner(OWNER, () => rpc("pitwall_share_create_v2", [DEVICE, 14400], ["uuid", "int"]));
  check(created.ok === true && TOKEN_RE.test(created.token), "create returns a 64-hex token");
  const stored = await activeShare();
  check(stored.observed_session_key === OBS && stored.track_id === 42, "share stores observed session and public track id");
  check(stored.revoke_reason === null && stored.revoked_at === null, "new share is active");

  await asAdmin(async () => {
    await db.query(
      `INSERT INTO public.simhub_device_laps (device_id, connector_id, session_key, lap_number, lap_seconds, observed_session_id)
       VALUES ($1,'connector-1',$2,17,102.1,$3),($1,'connector-1',$2,18,102.4,$3)`,
      [DEVICE, SESSION, OBS],
    );
  });

  console.log("5. public projection: circuit, stable car keys, visible sectors");
  const shared = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [created.token]));
  check(shared.ok === true, "anon can read the bounded shared race");
  check(shared.circuit.trackId === 42 && shared.circuit.name === "Spa-Francorchamps", "public circuit exposes the official track id/name");
  check(shared.sectors.available === true && shared.sectors.sectorCount === 3, "sector board is available with three sectors");
  check(shared.sectors.cars.length === 2 && shared.sectors.cars[0].sectors.length === 3, "sector board carries bounded per-car sectors");
  check(shared.sectors.cars.every((c) => c.id.startsWith("car-") && c.id.length === 16), "sector cars use pseudonymous keys");
  const rawIds = shared.v3.opponents.map((o) => o.id);
  check(rawIds.every((id) => id.startsWith("car-") && id.length === 16), "opponents use stable pseudonymous keys");
  check(shared.sectors.cars.every((c) => rawIds.includes(c.id)), "sector keys match opponent keys");
  const payload = JSON.stringify(shared);
  for (const forbidden of ["owner_user_id", "ownerUserId", "device_id", "deviceId", "connector_id", "race_run_id", "raceRunId", "currentDriverId", "driver_id", "driverId", "car_id", "paceHistory", "paceCapture", "sectorGuards", "sim-778899-s4", SESSION, "driver-a", "driver-b"]) {
    check(!payload.includes(forbidden), `payload omits ${forbidden}`);
  }
  check(!("transportSessionId" in shared.v3), "payload omits the reusable transport id");
  check(shared.pace.count > 0 && shared.laps.length > 0, "session pace and laps remain available");

  console.log("6. rows reordering does not change car identity");
  const reversed = makeV3({ opponents: [...makeV3().opponents].reverse() });
  await setLive(reversed);
  const reordered = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [created.token]));
  const afterOrder = reordered.v3.opponents.map((o) => o.id).sort();
  check(JSON.stringify(afterOrder) === JSON.stringify([...rawIds].sort()), "stable keys survive an opponent order change");
  check(reordered.sectors.cars.length === 2, "sector board still matches after reorder");

  console.log("7. terminal + reset + identity change revoke at ingest without a reader poll");
  const beforeTerminal = await activeShare();
  check(beforeTerminal.revoked_at === null, "share is still active before terminal frame");
  const terminalV3 = makeV3({ session: { ...makeV3().session, sessionState: "checkered", flags: ["checkered"] } });
  await setLive(terminalV3);
  const afterTerminal = await activeShare();
  check(afterTerminal.revoked_at !== null && afterTerminal.revoke_reason === "session_ended", "terminal frame revokes immediately at ingest (no poll)");
  const terminalRead = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [created.token]));
  check(terminalRead.ok === false && terminalRead.code === "ended", "old token is ended after terminal");

  await resetLive();
  const resetShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v2", [DEVICE, 14400], ["uuid", "int"]));
  const resetV3 = makeV3({ session: { ...makeV3().session, sessionTimeSeconds: 5 }, timing: { ...makeV3().timing, completedLaps: 0 } });
  await setLive(resetV3);
  const afterReset = await activeShare();
  check(afterReset.revoked_at !== null && afterReset.revoke_reason === "session_reset", "authoritative clock/lap reset revokes at ingest");
  const resetRead = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [resetShare.token]));
  check(resetRead.ok === false && resetRead.code === "ended", "reset token is ended");

  await resetLive();
  const switchShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v2", [DEVICE, 14400], ["uuid", "int"]));
  const switched = withSession(makeV3(), SESSION, "sim-778899-s5", {
    session: { ...makeV3().session, sessionTimeSeconds: 600 },
    timing: { ...makeV3().timing, completedLaps: 20 },
  });
  await setLive(switched);
  const afterSwitch = await activeShare();
  check(afterSwitch.revoked_at !== null && afterSwitch.revoke_reason === "session_changed", "same transport/track, new simulator session revokes at ingest");
  // Counters catch up later: the capability must not come back.
  const caughtUp = withSession(makeV3(), SESSION, "sim-778899-s5", {
    session: { ...makeV3().session, sessionTimeSeconds: 3000 },
    timing: { ...makeV3().timing, completedLaps: 40 },
  });
  await setLive(caughtUp);
  const caughtUpRead = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [switchShare.token]));
  check(caughtUpRead.ok === false && caughtUpRead.code === "ended", "old bearer cannot read the later session after counters catch up");

  await resetLive();
  const gapShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v2", [DEVICE, 14400], ["uuid", "int"]));
  await setLive(makeV3(), { receivedAt: "now() + interval '5 minutes'" });
  const afterGap = await activeShare();
  check(afterGap.revoked_at !== null && afterGap.revoke_reason === "session_gap", "ingest gap revokes at ingest");
  const gapRead = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [gapShare.token]));
  check(gapRead.ok === false && gapRead.code === "ended", "gap token is ended");

  await resetLive();
  const unprovenShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v2", [DEVICE, 14400], ["uuid", "int"]));
  const noIdentity = makeV3({ paceHistory: undefined });
  await setLive(noIdentity);
  const afterUnproven = await activeShare();
  check(afterUnproven.revoked_at !== null && afterUnproven.revoke_reason === "session_unproven", "identity disappearance revokes at ingest");
  const unprovenRead = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [unprovenShare.token]));
  check(unprovenRead.ok === false && unprovenRead.code === "ended", "unproven token cannot disclose");

  console.log("8. persisted measurement segments can prove identity; ambiguity cannot");
  await resetLive();
  await asAdmin(async () => {
    await db.query(
      "INSERT INTO public.simhub_lap_summaries (summary_id, device_id, delivered_session_id, observed_session_id) VALUES ('sum-1',$1,$2,$3)",
      [DEVICE, SESSION, OBS],
    );
  });
  const segmentV3 = makeV3({ paceHistory: undefined });
  await setLive(segmentV3);
  const segmentDevices = await asOwner(OWNER, () => rpc("pitwall_my_devices_v2"));
  check(segmentDevices.devices[0].shareable === true, "one unambiguous persisted segment proves the session");
  const ambiguous = await asAdmin(async () => {
    await db.query(
      "INSERT INTO public.simhub_lap_summaries (summary_id, device_id, delivered_session_id, observed_session_id) VALUES ('sum-2',$1,$2,'sim-778899-s9')",
      [DEVICE, SESSION],
    );
    return true;
  });
  check(ambiguous, "second segment inserted");
  const ambiguousDevices = await asOwner(OWNER, () => rpc("pitwall_my_devices_v2"));
  check(ambiguousDevices.devices[0].shareable === false && ambiguousDevices.devices[0].shareable_reason === "session_unproven", "two observed ids for one transport are ambiguous and not shareable");

  await resetLive();
  await asAdmin(async () => {
    await db.query(
      "INSERT INTO public.simhub_lap_summaries (summary_id, device_id, delivered_session_id, observed_session_id) VALUES ('sum-3',$1,$2,$3)",
      [DEVICE, SESSION, OBS],
    );
  });
  await setLive(makeV3({ paceHistory: undefined }));
  const segmentShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v2", [DEVICE, 14400], ["uuid", "int"]));
  check(segmentShare.ok === true, "a segment-proven solo frame can be shared");
  const segmentRead = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [segmentShare.token]));
  check(segmentRead.ok === true, "a segment-proven share reads while the frame has no pace history");
  await setLive(makeV3({ paceHistory: undefined, session: { ...makeV3().session, sessionTimeSeconds: 510 } }));
  const segmentStill = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [segmentShare.token]));
  check(segmentStill.ok === true, "continuity stays valid while the single segment is unchanged");
  await asAdmin(async () => {
    await db.query(
      "INSERT INTO public.simhub_lap_summaries (summary_id, device_id, delivered_session_id, observed_session_id) VALUES ('sum-4',$1,$2,'sim-778899-s9')",
      [DEVICE, SESSION],
    );
  });
  await setLive(makeV3({ paceHistory: undefined, session: { ...makeV3().session, sessionTimeSeconds: 520 } }));
  const ambiguousRead = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [segmentShare.token]));
  check(ambiguousRead.ok === false && ambiguousRead.code === "ended", "a second segment makes continuity ambiguous and ends the share");

  console.log("9. lap archive cannot leak across a reused transport");
  await resetLive();
  const lapShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v2", [DEVICE, 14400], ["uuid", "int"]));
  await asAdmin(async () => {
    await db.query("DELETE FROM public.simhub_device_laps WHERE device_id=$1", [DEVICE]);
    await db.query(
      `INSERT INTO public.simhub_device_laps (device_id, connector_id, session_key, lap_number, lap_seconds, observed_session_id)
       VALUES ($1,'connector-1',$2,1,101.1,$3),($1,'connector-1',$2,2,101.2,$3),
              ($1,'connector-1',$2,21,99.1,'sim-000001-s1'),($1,'connector-1',$2,22,99.2,'sim-000001-s1'),
              ($1,'connector-1',$2,23,120.0,NULL)`,
      [DEVICE, SESSION, OBS],
    );
  });
  const lapSnapshot = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [lapShare.token]));
  check(lapSnapshot.ok === true, "lap snapshot still reads");
  check(lapSnapshot.laps.length === 2 && lapSnapshot.laps.every((l) => [1, 2].includes(l.lap)), "only laps from the bound simulator session are returned");
  check(lapSnapshot.pace.count === 2 && lapSnapshot.pace.fastest === 101.1, "pace aggregate uses only the bound simulator session");
  check(!JSON.stringify(lapSnapshot.laps).includes("99."), "later-session laps are not disclosed");

  console.log("10. no identity means no share and no disclosure");
  await resetLive();
  await asAdmin(async () => {
    await db.query("DELETE FROM public.simhub_lap_summaries WHERE device_id=$1", [DEVICE]);
    await db.query("DELETE FROM public.simhub_measurement_events WHERE device_id=$1", [DEVICE]);
  });
  const unboundV3 = makeV3({ paceHistory: undefined });
  await setLive(unboundV3);
  const unboundCreate = await asOwner(OWNER, () => rpc("pitwall_share_create_v2", [DEVICE, 14400], ["uuid", "int"]));
  check(unboundCreate.ok === false && unboundCreate.code === "session_unproven", "creation refuses an unprovable session");
  const legacyRow = await asAdmin(async () => {
    const t = "c".repeat(64);
    const h = await tokenHash(t);
    await db.query(
      `INSERT INTO public.pitwall_shared_races
        (token_hash, owner_user_id, device_id, session_key, track_name, track_config, anchor_session_time_seconds, anchor_completed_laps, expires_at)
       VALUES ($1,$2,$3,$4,'Spa-Francorchamps','Endurance',500,18,now()+interval '1 hour')`,
      [h, OWNER, DEVICE, SESSION],
    );
    return t;
  });
  const legacyRead = await asAnon(() => rpc("pitwall_shared_snapshot_v2", [legacyRow]));
  check(legacyRead.ok === false && legacyRead.code === "ended", "legacy share without provenance fails closed");

  console.log("11. owner detail is owner-bound and guards revoked/expired devices");
  await resetLive();
  const detail = await asOwner(OWNER, () => rpc("pitwall_owner_device_detail_v2", [DEVICE], ["uuid"]));
  check(detail.device.id === DEVICE && detail.telemetry.session_id === SESSION, "owner detail returns the real telemetry");
  check(!("owner_user_id" in detail.telemetry), "owner detail omits account ids from telemetry");
  await expectError(() => asOwner(OTHER, () => rpc("pitwall_owner_device_detail_v2", [DEVICE], ["uuid"])), /permission denied/i, "cross-owner detail is denied");

  await asAdmin(async () => {
    await db.query("UPDATE public.simhub_devices SET revoked_at=now() WHERE id=$1", [DEVICE]);
  });
  await expectError(() => asOwner(OWNER, () => rpc("pitwall_owner_device_detail_v2", [DEVICE], ["uuid"])), /permission denied/i, "revoked device detail is denied");
  await asAdmin(async () => {
    await db.query("UPDATE public.simhub_devices SET revoked_at=NULL, expires_at=now() - interval '1 second' WHERE id=$1", [DEVICE]);
  });
  await expectError(() => asOwner(OWNER, () => rpc("pitwall_owner_device_detail_v2", [DEVICE], ["uuid"])), /permission denied/i, "expired device detail is denied");
  await asAdmin(async () => {
    await db.query("UPDATE public.simhub_devices SET expires_at=NULL WHERE id=$1", [DEVICE]);
    await db.query("UPDATE public.simhub_telemetry_latest SET owner_user_id=$2 WHERE device_id=$1", [DEVICE, OTHER]);
  });
  const mismatched = await asOwner(OWNER, () => rpc("pitwall_owner_device_detail_v2", [DEVICE], ["uuid"]));
  check(mismatched.telemetry == null, "detail does not bind telemetry owned by another account");

  console.log("12. rollback restores the previous surface");
  await asAdmin(async () => {
    await db.query("UPDATE public.simhub_telemetry_latest SET owner_user_id=$2 WHERE device_id=$1", [DEVICE, OWNER]);
  });
  await db.exec(rollback);
  const afterRollback = await asAdmin(async () => (await db.query(
    `SELECT to_regprocedure('public.pitwall_shared_snapshot_v2(text)') AS v2,
            to_regprocedure('public.pitwall_shared_snapshot_v1(text)') AS v1,
            to_regclass('public.pitwall_shared_races') AS share,
            (SELECT count(*)::int FROM information_schema.columns WHERE table_name='pitwall_shared_races' AND column_name IN ('observed_session_key','track_id')) AS new_cols,
            (SELECT count(*)::int FROM information_schema.columns WHERE table_name='simhub_device_laps' AND column_name='observed_session_id') AS lap_col,
            (SELECT count(*)::int FROM pg_trigger WHERE tgname='pitwall_session_fence_trg') AS fence_trg`,
  )).rows[0]);
  check(afterRollback.v2 === null && afterRollback.v1 !== null, "rollback drops v2 and keeps v1");
  check(afterRollback.new_cols === 0 && afterRollback.lap_col === 0, "rollback removes the additive binding columns");
  check(afterRollback.fence_trg === 0, "rollback removes the ingest fence trigger");
  check(afterRollback.share !== null, "rollback keeps the existing share table");
  const restoredCapture = await asAdmin(async () => (await db.query(
    "SELECT pg_catalog.md5(prosrc) AS h FROM pg_proc WHERE proname='simhub_capture_lap' AND pronamespace='public'::regnamespace",
  )).rows[0].h);
  check(restoredCapture === "01678a9619cad2dbcfa94deeb4d0ca6d", "rollback restores the exact production lap-capture baseline");
  check(await asAnon(async () => (await db.query("SELECT has_function_privilege('anon','public.pitwall_shared_snapshot_v1(text)','EXECUTE') AS x")).rows[0].x), "rollback re-grants the v1 reader");
  await db.exec(fence);
  check(true, "session fence migration can be re-applied after rollback");

  await db.close();
  console.log(`\nPASS: ${results.length} checks`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
