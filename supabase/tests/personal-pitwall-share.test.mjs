#!/usr/bin/env node
/**
 * Isolated PostgreSQL/PGlite lifecycle test for personal Pitwall sharing.
 *
 * This runs the real forward migration and its paired rollback against a fresh
 * in-memory PostgreSQL, with anon/authenticated/service_role roles and the
 * auth.uid()/auth.role() contract PostgREST uses. It covers cross-owner access,
 * wrong links, revoke/expiry/device/session changes, token-at-rest hashing,
 * viewer write denial, public payload whitelisting and rollback/re-apply.
 *
 * Run: npm run test:db:pitwall-share
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(here, "../migrations/20261119120000_personal_pitwall_share.sql");
const rollbackPath = resolve(here, "../rollbacks/20261119120000_personal_pitwall_share.down.sql");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEVICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_DEVICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TEAM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RUN = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SESSION = "sess-1";
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
    if (!pattern.test(message)) throw new Error(`FAIL: ${label} (unexpected error: ${message})`);
    check(true, label);
    return;
  }
  throw new Error(`FAIL: ${label} (no error)`);
};

const makeV3 = (overrides = {}) => ({
  protocolVersion: 3,
  capturedAt: new Date().toISOString(),
  transportSessionId: SESSION,
  identity: {
    currentDriverId: "driver-account-id-must-not-leak",
    currentDriverName: "Test Driver",
    carId: "car-1",
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
    sessionState: "racing",
  },
  timing: {
    currentLapElapsedSeconds: 30,
    lastLapTimeSeconds: 102.4,
    bestLapTimeSeconds: 101.8,
    completedLaps: 18,
  },
  position: { position: 3, classPosition: 2, gapToLeaderSeconds: 12.3 },
  track: { lapDistancePct: 0.42, trackSurface: "dry", onPitRoad: false },
  fuel: { fuelLitres: 55.4, fuelPct: 0.6, fuelCapacityLitres: 90, fuelPerLapLitres: 3.2, lapsRemaining: 17 },
  tyres: {
    wearPercent: { frontLeft: [90, 80, 70], frontRight: [90, 80, 70], rearLeft: [90, 80, 70], rearRight: [90, 80, 70] },
    carcassTempC: { frontLeft: [80, 80, 80], frontRight: [80, 80, 80], rearLeft: [80, 80, 80], rearRight: [80, 80, 80] },
    sets: { used: 2, available: 3, frontLeft: 2, frontRight: 2, rearLeft: 2, rearRight: 2 },
    compoundId: 4,
    environment: { trackTempC: 31, airTempC: 21, rubberState: "moderate" },
    pitEntry: null,
    pressuresBar: { fl: 2.1, fr: 2.1, rl: 2.0, rr: 2.0 },
  },
  vehicle: {
    speedKph: 210,
    throttlePct: 82,
    brakePct: 0,
    rpm: 7000,
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
    brakeLinePressureBar: { frontLeft: 60, frontRight: 60 },
    steeringWheelAngleDeg: -20,
    latAccelG: 1.2,
    longAccelG: -0.8,
  },
  opponents: [
    { id: "car-0", driverName: "Leader", position: 1, classPosition: 1, lastLapSeconds: 101.2, bestLapSeconds: 100.9, gapToLeaderSeconds: 0, connected: true },
    { id: "driver-account-id-2", driverName: "Test Driver", position: 3, classPosition: 2, lastLapSeconds: 102.4, bestLapSeconds: 101.8, gapToLeaderSeconds: 12.3, connected: true, isPlayer: true },
    { id: "car-1", driverName: "Rival", position: 4, classPosition: 3, lastLapSeconds: 102.9, bestLapSeconds: 102.1, gapToLeaderSeconds: 14.1, connected: true },
  ],
  ...overrides,
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

CREATE OR REPLACE FUNCTION public.simhub_pace_project_v1(snapshot jsonb, reference_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT snapshot - 'paceHistory' - 'paceCapture'
$$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated;
`;

const seed = async (db, { withSecondFresh = false } = {}) => {
  await db.query("INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4)", [OWNER, "owner@example.test", OTHER, "other@example.test"]);
  await db.query(
    `INSERT INTO public.endurance_events (id,name) VALUES ($1,'Test Endurance')`,
    [EVENT],
  );
  await db.query(`INSERT INTO public.endurance_teams (id,name) VALUES ($1,'Test Team')`, [TEAM]);
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
    `INSERT INTO public.simhub_device_laps (device_id, connector_id, session_key, lap_number, lap_seconds, driver_name)
     SELECT $1,'connector-1',$2, n, 100 + n * 0.1, 'Test Driver' FROM generate_series(1, 12) n`,
    [DEVICE, SESSION],
  );
  await db.query(
    `INSERT INTO public.simhub_telemetry_latest
      (device_id, owner_user_id, session_id, sequence, captured_at, received_at, connector_id, simhub_version, game,
       current_driver_name, car_name, track_name, track_config, race_run_id, v3_normalized)
     VALUES ($1,$2,$3,42,now(),now(),'connector-1','9.3.1','IRacing','Test Driver','Porsche 911 GT3 R',
             'Spa-Francorchamps','Endurance',$4,$5::jsonb)`,
    [DEVICE, OWNER, SESSION, RUN, JSON.stringify(makeV3())],
  );
  if (withSecondFresh) {
    await db.query(
      `INSERT INTO public.simhub_telemetry_latest
        (device_id, owner_user_id, session_id, sequence, captured_at, received_at, connector_id, simhub_version, game,
         current_driver_name, car_name, track_name, track_config, race_run_id, v3_normalized)
       VALUES ($1,$2,$3,7,now(),now(),'connector-2','9.3.1','IRacing','Second Driver','BMW M4 GT3',
               'Monza','Grand Prix',NULL,$4::jsonb)`,
      [DEVICE_2, OWNER, "sess-2", JSON.stringify(makeV3({
        transportSessionId: "sess-2",
        identity: { currentDriverName: "Second Driver", carName: "BMW M4 GT3", trackName: "Monza", trackConfig: "Grand Prix" },
      }))],
    );
  }
};

const run = async () => {
  const db = new PGlite();
  const migration = await readFile(migrationPath, "utf8");
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
  const resetLive = async () => {
    await asAdmin(async () => {
      await db.query("UPDATE public.simhub_devices SET revoked_at = NULL, device_status = 'active_binding', expires_at = NULL WHERE id = $1", [DEVICE]);
      await db.query(
        `UPDATE public.simhub_telemetry_latest SET
           owner_user_id=$2, session_id=$3, received_at=now(), v3_normalized=$4::jsonb, race_run_id=$5
         WHERE device_id=$1`,
        [DEVICE, OWNER, SESSION, JSON.stringify(makeV3()), RUN],
      );
    });
  };

  console.log("1. forward migration + role setup");
  await db.exec(setupSql);
  await seed(db);
  await db.exec(migration);
  check(true, "migration applied on isolated PostgreSQL");

  console.log("2. ACL / RLS baseline");
  check(await asAnon(async () => (await db.query("SELECT has_function_privilege('anon','public.pitwall_shared_snapshot_v1(text)','EXECUTE') AS x")).rows[0].x), "anon may execute the public snapshot RPC");
  check(!(await asAnon(async () => (await db.query("SELECT has_function_privilege('anon','public.pitwall_my_devices_v1()','EXECUTE') AS x")).rows[0].x)), "anon may not execute owner inventory");
  check(!(await asAnon(async () => (await db.query("SELECT has_function_privilege('anon','public.pitwall_share_create_v1(uuid,integer)','EXECUTE') AS x")).rows[0].x)), "anon may not execute share creation");
  await expectError(() => asAnon(async () => db.query("SELECT public.pitwall_my_devices_v1()")), /permission denied/i, "anon owner inventory is denied at execute");
  await expectError(() => asAnon(async () => db.query("SELECT count(*) FROM public.pitwall_shared_races")), /permission denied/i, "anon cannot read the share table");
  await expectError(() => asAnon(async () => db.query("SELECT count(*) FROM public.simhub_telemetry_latest")), /permission denied/i, "anon cannot read raw telemetry");
  await expectError(() => asAnon(async () => db.query("SELECT count(*) FROM public.simhub_device_laps")), /permission denied/i, "anon cannot read the lap archive");
  await expectError(() => asAnon(async () => db.query("SELECT count(*) FROM public.simhub_devices")), /permission denied/i, "anon cannot read the device table");
  await expectError(() => asOwner(OWNER, async () => db.query("INSERT INTO public.pitwall_shared_races (token_hash,owner_user_id,device_id,session_key,track_name,anchor_session_time_seconds,anchor_completed_laps,expires_at) VALUES (repeat('d',64),$1,$2,'s','t',20,0,now()+interval '1 hour')", [OWNER, DEVICE])), /permission denied/i, "authenticated owner cannot insert shares directly");
  await expectError(() => asOwner(OWNER, async () => db.query("UPDATE public.pitwall_shared_races SET revoked_at=now()")), /permission denied/i, "authenticated owner cannot update shares directly");

  console.log("3. owner discovery is auth.uid()-scoped");
  const devices = await asOwner(OWNER, () => rpc("pitwall_my_devices_v1"));
  check(devices.devices.length === 2, "owner sees exactly their two devices");
  check(devices.devices.every((d) => !("owner_user_id" in d) && !("token_hash" in d)), "inventory leaks no owner id or token hash");
  check(devices.devices[0].id === DEVICE && devices.devices[0].fresh === true && devices.devices[0].shareable === true, "fresh device is first and shareable");
  check(devices.devices.find((d) => d.id === DEVICE_2)?.fresh === false, "offline device is not fresh");
  const otherDevices = await asOwner(OTHER, () => rpc("pitwall_my_devices_v1"));
  check(otherDevices.devices.length === 1 && otherDevices.devices[0].id === OTHER_DEVICE, "other owner only sees their device");
  await expectError(() => asOwner(OTHER, () => rpc("pitwall_owner_device_detail_v1", [DEVICE], ["uuid"])), /permission denied/i, "cross-owner device detail is denied");
  await expectError(() => asOwner(OTHER, () => rpc("pitwall_share_create_v1", [DEVICE, 14400], ["uuid", "int"])), /permission denied/i, "cross-owner share creation is denied");
  await expectError(() => asOwner(OTHER, () => rpc("pitwall_share_revoke_v1", [DEVICE], ["uuid"])), /permission denied/i, "cross-owner revoke is denied");
  const detail = await asOwner(OWNER, () => rpc("pitwall_owner_device_detail_v1", [DEVICE], ["uuid"]));
  check(detail.device.id === DEVICE && detail.telemetry?.v3_normalized?.identity?.trackName === "Spa-Francorchamps", "owner detail returns the real session");
  check(!("owner_user_id" in detail.telemetry), "owner detail omits account ids from telemetry");

  console.log("4. share creation + token at rest");
  const created = await asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 14400], ["uuid", "int"]));
  check(created.ok === true && TOKEN_RE.test(created.token), "create returns a 64-hex unguessable token");
  check(created.session_key === SESSION && created.track_name === "Spa-Francorchamps", "share is bound to the real session and track");
  const stored = await asAdmin(async () => (await db.query("SELECT token_hash, expires_at, created_at FROM public.pitwall_shared_races WHERE device_id=$1 AND revoked_at IS NULL", [DEVICE])).rows[0]);
  check(stored.token_hash !== created.token && /^[0-9a-f]{64}$/.test(stored.token_hash), "only a hash is stored at rest");
  check(stored.token_hash === (await asAdmin(async () => (await db.query("SELECT encode(pg_catalog.sha256(pg_catalog.convert_to($1,'UTF8')),'hex') AS h", [created.token])).rows[0].h)), "stored hash matches SHA-256 of the token");
  check(new Date(stored.expires_at) - new Date(stored.created_at) <= 6 * 3600 * 1000, "absolute TTL is bounded to 6 hours");
  await expectError(() => asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 60], ["uuid", "int"])), /Invalid share lifetime/i, "TTL below 5 minutes is rejected");
  await expectError(() => asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 999999], ["uuid", "int"])), /Invalid share lifetime/i, "TTL above 6 hours is rejected");

  console.log("5. public projection is whitelisted and bounded");
  const shared = await asAnon(() => rpc("pitwall_shared_snapshot_v1", [created.token]));
  check(shared.ok === true, "anon can read the shared race");
  const text = JSON.stringify(shared);
  for (const forbidden of ["ownerUserId", "owner_user_id", "device_id", "deviceId", "connector_id", "race_run_id", "raceRunId", "eventId", "teamId", "currentDriverId", "driver_id", "driverId", "carId", "trackId", "paceHistory", "paceCapture", "irating", "safetyRating", "licenseClass", "account"]) {
    check(!text.includes(forbidden), `payload omits ${forbidden}`);
  }
  check(!("telemetry" in shared) && !("raw" in shared), "payload omits the raw telemetry blob");
  check(shared.v3.opponents.length <= 40 && shared.v3.opponents[0].id === "opponent-1", "opponents are bounded and pseudonymous");
  check(shared.laps.length <= 20, "lap points are bounded");
  check(shared.pace.count === 12 && shared.pace.fastest > 0, "real session pace is present");
  check(shared.track.name === "Spa-Francorchamps" && shared.session.state === "racing", "track and active session are present");
  const wrong = await asAnon(() => rpc("pitwall_shared_snapshot_v1", ["0".repeat(64)]));
  check(wrong.ok === false && wrong.code === "invalid", "wrong token fails closed");

  console.log("6. owner RLS and viewer write denial");
  const ownRows = await asOwner(OWNER, async () => (await db.query("SELECT id, device_id, expires_at FROM public.pitwall_shared_races")).rows);
  check(ownRows.length === 1, "owner can see their own share metadata through RLS");
  await expectError(() => asOwner(OWNER, () => db.query("SELECT token_hash FROM public.pitwall_shared_races")), /permission denied/i, "owner cannot select token_hash");
  const otherRows = await asOwner(OTHER, async () => (await db.query("SELECT count(*)::int AS n FROM public.pitwall_shared_races")).rows[0].n);
  check(otherRows === 0, "cross-owner RLS returns no rows");
  await expectError(() => asAnon(async () => db.query("UPDATE public.pitwall_shared_races SET revoked_at=now()")), /permission denied/i, "viewer cannot revoke/update");
  await expectError(() => asAnon(async () => db.query("DELETE FROM public.pitwall_shared_races")), /permission denied/i, "viewer cannot delete");

  console.log("7. fresh link supersedes and owner revoke invalidates old token");
  const second = await asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 14400], ["uuid", "int"]));
  check(second.ok === true && second.token !== created.token, "a fresh link creates a different token");
  const oldAfterFresh = await asAnon(() => rpc("pitwall_shared_snapshot_v1", [created.token]));
  check(oldAfterFresh.ok === false && oldAfterFresh.code === "ended", "the previous link is invalid immediately");
  const revoke = await asOwner(OWNER, () => rpc("pitwall_share_revoke_v1", [DEVICE], ["uuid"]));
  check(revoke.ok === true && revoke.revoked === 1, "owner revoke reports one active share");
  const afterRevoke = await asAnon(() => rpc("pitwall_shared_snapshot_v1", [second.token]));
  check(afterRevoke.ok === false && afterRevoke.code === "ended", "revoked token is invalid on the next poll");

  console.log("8. expiry, device state, session identity and terminal state fail closed");
  await resetLive();
  const expiring = await asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 300], ["uuid", "int"]));
  await asAdmin(async () => {
    await db.query("UPDATE public.pitwall_shared_races SET created_at=now() - interval '10 minutes', expires_at=now() - interval '1 minute' WHERE token_hash=encode(pg_catalog.sha256(pg_catalog.convert_to($1,'UTF8')),'hex')", [expiring.token]);
  });
  const expired = await asAnon(() => rpc("pitwall_shared_snapshot_v1", [expiring.token]));
  check(expired.ok === false && expired.code === "ended", "expired link is ended");
  await resetLive();
  const deviceShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 300], ["uuid", "int"]));
  await asAdmin(async () => db.query("UPDATE public.simhub_devices SET revoked_at=now() WHERE id=$1", [DEVICE]));
  const afterDeviceRevoke = await asAnon(() => rpc("pitwall_shared_snapshot_v1", [deviceShare.token]));
  check(afterDeviceRevoke.ok === false && afterDeviceRevoke.code === "ended", "device revoke ends the share");
  await resetLive();
  const sessionShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 300], ["uuid", "int"]));
  await asAdmin(async () => db.query("UPDATE public.simhub_telemetry_latest SET session_id='sess-next' WHERE device_id=$1", [DEVICE]));
  const afterSession = await asAnon(() => rpc("pitwall_shared_snapshot_v1", [sessionShare.token]));
  check(afterSession.ok === false && afterSession.code === "ended", "a different transport session ends the share");
  await resetLive();
  const terminalShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 300], ["uuid", "int"]));
  const terminalV3 = makeV3({ session: { ...makeV3().session, sessionState: "checkered", flags: ["checkered"] } });
  await asAdmin(async () => db.query("UPDATE public.simhub_telemetry_latest SET v3_normalized=$2::jsonb WHERE device_id=$1", [DEVICE, JSON.stringify(terminalV3)]));
  const afterTerminal = await asAnon(() => rpc("pitwall_shared_snapshot_v1", [terminalShare.token]));
  check(afterTerminal.ok === false && afterTerminal.code === "ended", "terminal session state ends the share");

  console.log("9. freshness, transport reuse and no stale payload");
  await resetLive();
  const staleShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 300], ["uuid", "int"]));
  await asAdmin(async () => db.query("UPDATE public.simhub_telemetry_latest SET received_at=now() - interval '2 minutes' WHERE device_id=$1", [DEVICE]));
  const stale = await asAnon(() => rpc("pitwall_shared_snapshot_v1", [staleShare.token]));
  check(stale.ok === false && stale.code === "stale", "stale telemetry returns no race data");
  await resetLive();
  const reuseShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 300], ["uuid", "int"]));
  const resetSessionV3 = makeV3({ session: { ...makeV3().session, sessionTimeSeconds: 5, sessionState: "racing" } });
  await asAdmin(async () => db.query("UPDATE public.simhub_telemetry_latest SET v3_normalized=$2::jsonb WHERE device_id=$1", [DEVICE, JSON.stringify(resetSessionV3)]));
  const afterReuse = await asAnon(() => rpc("pitwall_shared_snapshot_v1", [reuseShare.token]));
  check(afterReuse.ok === false && afterReuse.code === "ended", "reused transport id with a reset session clock ends the share");
  await resetLive();
  await asAdmin(async () => db.query("UPDATE public.simhub_telemetry_latest SET received_at=now() - interval '2 minutes' WHERE device_id=$1", [DEVICE]));
  const notFresh = await asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 300], ["uuid", "int"]));
  check(notFresh.ok === false && notFresh.code === "not_fresh", "creation refuses stale telemetry");

  console.log("10. rollback and re-apply");
  const beforeRollback = await asAdmin(async () => (await db.query("SELECT to_regclass('public.pitwall_shared_races') AS t, to_regprocedure('public.pitwall_shared_snapshot_v1(text)') AS f")).rows[0]);
  check(beforeRollback.t !== null && beforeRollback.f !== null, "forward objects exist before rollback");
  await db.exec(rollback);
  const afterRollback = await asAdmin(async () => (await db.query("SELECT to_regclass('public.pitwall_shared_races') AS t, to_regprocedure('public.pitwall_shared_snapshot_v1(text)') AS f, to_regclass('public.simhub_devices') AS d")).rows[0]);
  check(afterRollback.t === null && afterRollback.f === null, "rollback removes the table and functions");
  check(afterRollback.d !== null, "rollback leaves the existing device schema intact");
  await db.exec(migration);
  const reapplied = await asAdmin(async () => (await db.query("SELECT to_regclass('public.pitwall_shared_races') AS t, to_regprocedure('public.pitwall_shared_snapshot_v1(text)') AS f")).rows[0]);
  check(reapplied.t !== null && reapplied.f !== null, "migration can be applied again after rollback");
  await resetLive();
  const finalShare = await asOwner(OWNER, () => rpc("pitwall_share_create_v1", [DEVICE, 300], ["uuid", "int"]));
  check(finalShare.ok === true, "sharing works again after rollback/re-apply");

  await db.close();
  console.log(`\nPASS: ${results.length} checks`);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
