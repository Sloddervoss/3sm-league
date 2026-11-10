// Disposable PostgreSQL (PGlite), never a production connection.
// Usage: node scripts/test-pace-storage.mjs [/absolute/path/to/@electric-sql/pglite/dist/index.js]
//
// De baseline is de echte live-definitie van 2026-11-10
// (supabase/tests/fixtures/pace-live-baseline-functions.sql), niet de oude
// 1-november-testfixture. Dezelfde rehearsal draait op PG15 in
// supabase/tests/pace-production-rehearsal.sql tegen een productiekloon.
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const {PGlite} = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : "@electric-sql/pglite");
const db = new PGlite();
let passed = 0;
const check = (name, value) => { assert.ok(value, name); passed++; console.log(`PASS SQL-PACE ${name}`); };
const sql = (name) => readFileSync(name, "utf8");

console.log((await db.query("SELECT version() version")).rows[0].version);
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role',true),'') $$;
-- Explicit test doubles for unrelated routing/strategy/auth backing services.
CREATE FUNCTION public.can_manage_simhub() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.manager',true)='true',false) $$;
CREATE FUNCTION public.is_endurance_manager(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.can_manage_simhub() $$;
CREATE FUNCTION public.simhub_resolve_driver_user(uuid,uuid,text) RETURNS text LANGUAGE sql AS $$ SELECT null::text $$;
CREATE FUNCTION public.pitwall_opponent_trends_v1(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.pitwall_tyre_estimate_v1(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.pitwall_pit_loss_v1(uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE TABLE test_measurement_calls (events jsonb,laps jsonb);
CREATE FUNCTION public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN INSERT INTO test_measurement_calls VALUES($3,$4); RETURN '{"ok":true,"events":{"accepted":[],"rejected":[],"duplicates":[]},"laps":{"accepted":[],"rejected":[],"duplicates":[]}}'::jsonb; END $$;`);

await db.exec(sql("supabase/tests/pace-rehearsal-schema.sql"));
await db.exec(sql("supabase/tests/fixtures/pace-live-baseline-functions.sql"));

const baseline = (await db.query(`SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc
  WHERE proname IN ('simhub_persist_v3','get_pitwall_data','get_simhub_device_details','simhub_connector_config_apply','get_pitwall_pace')
  ORDER BY proname`)).rows;
assert.equal(baseline.length, 5, "baseline must hold five functions");

await db.exec(sql("supabase/migrations/20261110231000_pitwall_pace_storage.sql"));
check("forward migration executes", true);

const now = new Date().toISOString();
const capture = () => ({schemaRevision:1, observedSessionId:"sim", segmentId:"seg", opponentMetrics:[], opponentLaps:[], traceChunks:[]});
const merge = async (previous, c, transport = "t", at = now) =>
  (await db.query("SELECT public.simhub_pace_merge_v1($1,$2,$3,$4) h", [previous, c, transport, at])).rows[0].h;

let h = await merge(null, capture());
check("empty optional capture", h?.cars.length === 0);
check("legacy missing capture", await merge(null, null) === null);
check("missing schemaRevision keeps history", JSON.stringify(await merge({...h, cars: [{id:"x",laps:[],traces:[]}]}, {observedSessionId:"sim",segmentId:"seg"})) !== "null");
check("malformed array keeps history", (await merge({...h, cars: [{id:"x",laps:[],traces:[]}]}, {schemaRevision:1,observedSessionId:"sim",segmentId:"seg",opponentMetrics:3})).cars.length === 1);
check("unknown key keeps history", (await merge({...h, cars: [{id:"x",laps:[],traces:[]}]}, {schemaRevision:1,observedSessionId:"sim",segmentId:"seg",evil:1})).cars.length === 1);

const chunk = (start, final = false) => ({id:"car", traceId:"trace", lap:2, chunkIndex:start,
  finalChunk:final, anchorSessionTimeMs:0, anchorUncertaintyMs:100, lapSeconds:127,
  provenance:"simhub-opponent-sampled", speedUnit:"km/h",
  points:Array.from({length:32}, (_,i) => [start+i, (start+i)*1000, 1800])});
for (const start of [64,0,96]) { const c = capture(); c.traceChunks = [chunk(start)]; h = await merge(h, c); }
check("out-of-order incomplete chunks stay incomplete", h.cars[0].traces[0].complete === false);
const c = capture(); c.traceChunks = [chunk(32,true)]; h = await merge(h, c);
check("all 128 bins with checked anchor complete", h.cars[0].traces[0].complete === true);
const duplicate = await merge(h, c);
check("duplicate is idempotent", JSON.stringify(duplicate) === JSON.stringify(h));
const conflict = structuredClone(c); conflict.traceChunks[0].points[0][1]++;
const poisoned = await merge(h, conflict);
check("conflict fails closed", poisoned.cars[0].traces[0].conflict && !poisoned.cars[0].traces[0].complete);
const noAnchor = structuredClone(c); noAnchor.segmentId = "no-anchor";
noAnchor.traceChunks = [0,32,64,96].map(i => ({...chunk(i, i === 96), anchorSessionTimeMs:null}));
check("missing finish anchor never complete", !(await merge(null, noAnchor)).cars[0].traces[0].complete);
const badDuration = structuredClone(noAnchor);
badDuration.traceChunks.forEach(t => { t.anchorSessionTimeMs = 0; t.lapSeconds = 99; });
check("finish duration mismatch never complete", !(await merge(null, badDuration)).cars[0].traces[0].complete);

let capped = null;
for (let i = 0; i < 45; i++) {
  const x = capture();
  x.opponentLaps = [{id:`car-${i}`, lap:1, seconds:100, observedSessionTimeSeconds:i, quality:"sampled", observationId:`lap-${i}`}];
  capped = await merge(capped, x);
}
check("40 identity cap with churn", capped.cars.length === 40);
check("bounded stored bytes", Buffer.byteLength(JSON.stringify(capped)) < 524288);

h = null;
for (let i = 1; i <= 40; i++) {
  const x = capture();
  x.opponentLaps = [{id:"car", lap:i, seconds:100, observedSessionTimeSeconds:i, quality:"sampled", observationId:`lap-${i}`}];
  h = await merge(h, x);
}
check("20 laps and identical lap times survive", h.cars[0].laps.length === 20 && h.cars[0].laps.every(l => l.seconds === 100));

for (let i = 0; i < 8; i++) {
  const x = capture();
  x.traceChunks = [{...chunk(0), traceId:`other-${i}`, lap:i + 3}];
  h = await merge(h, x);
}
check("three traces cap", h.cars[0].traces.length === 3);
check("new transport resets", await merge(h, null, "other") === null);
const reset = capture(); reset.segmentId = "other";
check("new segment resets", (await merge(h, reset)).cars.length === 0);
check("24h TTL", await merge(h, null, "t", new Date(Date.parse(now) + 25*3600000).toISOString()) === null);

const project = async (s, ref = null) => (await db.query("SELECT public.simhub_pace_project_v1($1,$2) v", [s, ref])).rows[0].v;
const many = {...h, cars:["own","leader","third"].map(id => ({...h.cars[0], id}))};
const snapshot = {opponents:[{id:"own",isPlayer:true},{id:"leader",position:1}], paceHistory:many};
const projected = await project(snapshot);
check("read projection only two full cars", projected.paceHistory.cars.filter(c => c.traces).length === 2);
const chosen = await project(snapshot, "third");
check("chosen reference projects correct identity", chosen.paceHistory.cars.find(c => c.id === "third").traces && !chosen.paceHistory.cars.find(c => c.id === "leader").traces);
check("read TTL suppresses expired history", !(await project({...snapshot, paceHistory:{...many, updatedAt:"2000-01-01T00:00:00Z"}})).paceHistory);

// Actual unbound persist function, not a rewritten test imitation.
const device = "11111111-1111-1111-1111-111111111111", token = "a".repeat(64);
await db.query("INSERT INTO simhub_devices(id,token_hash,connector_id) VALUES($1,$2,'test')", [device, token]);
await db.exec("SET test.role='service_role'; SET test.uid='22222222-2222-2222-2222-222222222222';");
let seq = 0;
const frame = (pace = capture(), extra = {}) => ({transportSessionId:"t", session:{sessionTimeSeconds:100 + seq}, identity:{carId:"car",trackId:1}, fuel:{fuelLitres:12}, paceCapture:pace, ...extra});
const persist = async (payload, args = 5, s = seq++) => {
  await db.query("UPDATE simhub_devices SET last_seen_at=null WHERE id=$1", [device]);
  const params = [token, "t", s, now, payload];
  if (args >= 6) params.push(null);
  if (args === 8) params.push([{test:"unchanged"}], []);
  return (await db.query(`SELECT * FROM simhub_persist_v3(${params.map((_, i) => `$${i+1}`).join(",")})`, params)).rows[0];
};
for (const args of [5,6,8]) check(`${args}-argument persist compatibility`, (await persist(frame(), args)).result === "accepted");
check("eight-argument measurement batch unchanged", (await db.query("SELECT events FROM test_measurement_calls")).rows[0].events[0].test === "unchanged");

let current = (await db.query("SELECT v3_normalized FROM simhub_telemetry_latest")).rows[0].v3_normalized;
check("transport stripped, history stored in existing JSON", !current.paceCapture && !!current.paceHistory);
check("replay rejected before pace merge", (await persist(frame(), 5, 0)).result === "replayed");
check("old frame retains same-segment history", (await persist({transportSessionId:"t", session:{sessionTimeSeconds:104}, identity:{carId:"car",trackId:1}, fuel:{fuelLitres:12}}, 5)).result === "accepted");
current = (await db.query("SELECT v3_normalized FROM simhub_telemetry_latest")).rows[0].v3_normalized;
check("core fuel unchanged by pace", current.fuel.fuelLitres === 12 && !!current.paceHistory);
await db.exec("SET test.role='authenticated';");
check("unauthorized persist unchanged", (await persist(frame())).result === "unauthorized");
await db.exec("SET test.manager='false';");
let denied = false;
try { await db.query("SELECT get_pitwall_pace($1,null,null,null)", [device]); } catch (e) { denied = e.code === "42501"; }
check("device reader guard reused", denied);
await db.exec("SET test.manager='true';");
check("manager can read bounded device pace", !!(await db.query("SELECT get_pitwall_pace($1,null,null,null) h", [device])).rows[0].h);
check("cleanup and anon grants closed",
  !(await db.query("SELECT has_function_privilege('authenticated','simhub_pace_cleanup_v1()','EXECUTE') c,has_function_privilege('anon','get_pitwall_pace(uuid,text,uuid,uuid)','EXECUTE') r")).rows[0].c
  && !(await db.query("SELECT has_function_privilege('anon','get_pitwall_pace(uuid,text,uuid,uuid)','EXECUTE') r")).rows[0].r);
await db.query("UPDATE simhub_telemetry_latest SET v3_normalized=jsonb_set(v3_normalized,'{paceHistory,updatedAt}','\"2000-01-01T00:00:00Z\"'::jsonb)");
check("physical TTL cleanup works", Number((await db.query("SELECT simhub_pace_cleanup_v1() n")).rows[0].n) === 1);

await db.exec(sql("supabase/rollbacks/20261110231000_pitwall_pace_storage.sql"));
const restored = (await db.query(`SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc
  WHERE proname IN ('simhub_persist_v3','get_pitwall_data','get_simhub_device_details','simhub_connector_config_apply','get_pitwall_pace')
  ORDER BY proname`)).rows;
check("rollback restores exact five live definitions", JSON.stringify(baseline) === JSON.stringify(restored));
check("rollback removes helpers", (await db.query("SELECT count(*) n FROM pg_proc WHERE proname IN ('simhub_pace_merge_v1','simhub_pace_project_v1','simhub_pace_cleanup_v1')")).rows[0].n === 0);
await db.exec(sql("supabase/migrations/20261110231000_pitwall_pace_storage.sql"));
check("forward after rollback", true);
console.log(`SUMMARY SQL-PACE PASS=${passed} FAIL=0`);
await db.close();
