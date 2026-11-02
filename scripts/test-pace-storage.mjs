// Disposable PostgreSQL (PGlite), never a production connection.
// Usage: node scripts/test-pace-storage.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
const {PGlite}=await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : "@electric-sql/pglite");
const db=new PGlite(); let passed=0;
console.log((await db.query("SELECT version() version")).rows[0].version);
const check=(name,value)=>{assert.ok(value,name); passed++; console.log(`PASS SQL-PACE ${name}`);};
const migration=readFileSync("supabase/migrations/20261101113047_pace_capture.sql","utf8");
const rollback=readFileSync("supabase/rollbacks/20261101113047_pace_capture.sql","utf8");
const base=rollback.split("\nDROP FUNCTION")[0].replace("BEGIN;","");
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role',true) $$;
-- Explicit test doubles for unrelated routing/strategy/auth backing services.
CREATE FUNCTION public.can_manage_simhub() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.manager',true)='true',false) $$;
CREATE FUNCTION public.is_endurance_manager(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.can_manage_simhub() $$;
CREATE FUNCTION public.simhub_resolve_driver_user(uuid,uuid,text) RETURNS text LANGUAGE sql AS $$ SELECT null::text $$;
CREATE FUNCTION public.pitwall_opponent_trends_v1(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.pitwall_tyre_estimate_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.pitwall_pit_loss_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE TABLE test_measurement_calls (events jsonb,laps jsonb);
CREATE FUNCTION public.simhub_persist_measurement_batch(uuid,text,jsonb,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN INSERT INTO test_measurement_calls VALUES($3,$4); RETURN '{"ok":true}'::jsonb; END $$;`);
await db.exec(readFileSync("supabase/tests/pace-rehearsal-schema.sql","utf8"));
await db.exec(base);
const original=await db.query("SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE proname IN ('simhub_persist_v3','get_pitwall_data','get_simhub_device_details','simhub_connector_config_apply') ORDER BY proname");
await db.exec(migration); check("forward migration executes",true);
const now=new Date().toISOString();
const capture=(id="car")=>({schemaRevision:1,observedSessionId:"sim",segmentId:"seg",opponentMetrics:[],opponentLaps:[],traceChunks:[]});
const merge=async(previous,c,transport="t",at=now)=>(await db.query("SELECT public.simhub_pace_merge_v1($1,$2,$3,$4) h",[previous,c,transport,at])).rows[0].h;
let h=await merge(null,capture()); check("empty optional capture",h?.cars.length===0);
check("legacy missing capture",await merge(null,null)===null);
check("malformed isolated",await merge(null,{schemaRevision:1,observedSessionId:"sim",segmentId:"seg",opponentMetrics:3})===null);
const chunk=(start)=>({id:"car",traceId:"trace",lap:2,chunkIndex:start/32,finalChunk:true,anchorSessionTimeMs:0,anchorUncertaintyMs:100,lapSeconds:100,provenance:"simhub-opponent-sampled",speedUnit:"km/h",points:Array.from({length:32},(_,i)=>[start+i,Math.round((start+i)*100000/127),1800])});
for(const start of [64,0,96]) {const c=capture();c.traceChunks=[chunk(start)];h=await merge(h,c);}
check("out-of-order incomplete chunks stay incomplete",h.cars[0].traces[0].complete===false);
const c=capture();c.traceChunks=[chunk(32)];h=await merge(h,c);check("all 128 bins with checked anchor complete",h.cars[0].traces[0].complete===true);
const duplicate=await merge(h,c); check("duplicate is idempotent",JSON.stringify(duplicate)===JSON.stringify(h));
const conflict=structuredClone(c);conflict.traceChunks[0].points[0][1]++;
const poisoned=await merge(h,conflict); check("conflict fails closed",poisoned.cars[0].traces[0].conflict && !poisoned.cars[0].traces[0].complete);
const noAnchor=structuredClone(c);noAnchor.segmentId="no-anchor";noAnchor.traceChunks=Array.from({length:4},(_,i)=>({...chunk(i*32),anchorSessionTimeMs:null}));
check("missing finish anchor never complete",!(await merge(null,noAnchor)).cars[0].traces[0].complete);
const badDuration=structuredClone(noAnchor);badDuration.traceChunks.forEach(t=>{t.anchorSessionTimeMs=0;t.lapSeconds=99;});
check("finish duration mismatch never complete",!(await merge(null,badDuration)).cars[0].traces[0].complete);
let capped=null;
for(let i=0;i<45;i++){ const x=capture();x.opponentLaps=[{id:`car-${i}`,lap:1,seconds:100,observedSessionTimeSeconds:1,quality:"sampled",observationId:`lap-${i}`}];capped=await merge(capped,x); }
check("40 identity cap with churn",capped.cars.length===40);
for(let i=0;i<40;i++){const x=capture();x.opponentLaps=[{id:"car",lap:i+1,seconds:100,observedSessionTimeSeconds:i,quality:"sampled",observationId:`lap-${i}`}];h=await merge(h,x);}
check("20 laps and identical lap times survive",h.cars[0].laps.length===20 && h.cars[0].laps.every(l=>l.seconds===100));
for(let i=0;i<8;i++){const x=capture();x.traceChunks=[{...chunk(0),traceId:`other-${i}`,lap:i+3}];h=await merge(h,x);}
check("three traces cap",h.cars[0].traces.length===3);
check("bounded stored bytes",Buffer.byteLength(JSON.stringify(capped))<524288);
check("new transport resets",await merge(h,null,"other")===null);
const reset=capture();reset.segmentId="other";check("new segment resets",(await merge(h,reset)).cars.length===0);
check("24h TTL",await merge(h,null,"t",new Date(Date.parse(now)+25*3600000).toISOString())===null);
const project=async(s,ref=null)=>(await db.query("SELECT public.simhub_pace_project_v1($1,$2) v",[s,ref])).rows[0].v;
const many={...h,cars:["own","leader","third"].map(id=>({...h.cars[0],id}))};
const snapshot={opponents:[{id:"own",isPlayer:true},{id:"leader",position:1}],paceHistory:many};
const projected=await project(snapshot); check("read projection only two full cars",projected.paceHistory.cars.filter(c=>c.traces).length===2);
const chosen=await project(snapshot,"third");check("chosen reference projects correct identity",chosen.paceHistory.cars.find(c=>c.id==="third").traces && !chosen.paceHistory.cars.find(c=>c.id==="leader").traces);
check("read TTL suppresses expired history",!(await project({...snapshot,paceHistory:{...many,updatedAt:"2000-01-01T00:00:00Z"}})).paceHistory);
// Actual unbound persist function, not a rewritten test imitation.
const device="11111111-1111-1111-1111-111111111111",token="a".repeat(64);
await db.query("INSERT INTO simhub_devices(id,token_hash,connector_id) VALUES($1,$2,'test')",[device,token]);
await db.exec("SET test.role='service_role'; SET test.uid='22222222-2222-2222-2222-222222222222';");
let seq=0;
const persist=async(frame,args=5,s=seq++)=>{
 await db.query("UPDATE simhub_devices SET last_seen_at=null WHERE id=$1",[device]);
 const params=[token,"t",s,now,frame]; if(args>=6)params.push(null);if(args===8)params.push([{test:"unchanged"}],[]);
 return (await db.query(`SELECT * FROM simhub_persist_v3(${params.map((_,i)=>`$${i+1}`).join(",")})`,params)).rows[0];
};
for(const args of [5,6,8]) check(`${args}-argument persist compatibility`,(await persist({paceCapture:capture()},args)).result==="accepted");
check("eight-argument measurement batch unchanged",(await db.query("SELECT events FROM test_measurement_calls")).rows[0].events[0].test==="unchanged");
let current=(await db.query("SELECT v3_normalized FROM simhub_telemetry_latest")).rows[0].v3_normalized;
check("transport stripped, history stored in existing JSON",!current.paceCapture && !!current.paceHistory);
check("replay rejected before pace merge",(await persist({paceCapture:reset},5,0)).result==="replayed");
check("old frame retains same-segment history",(await persist({fuel:{fuelLitres:12}})).result==="accepted");
current=(await db.query("SELECT v3_normalized FROM simhub_telemetry_latest")).rows[0].v3_normalized;check("core fuel unchanged by pace",current.fuel.fuelLitres===12 && !!current.paceHistory);
await db.exec("SET test.role='authenticated';");check("unauthorized persist unchanged",(await persist({})).result==="unauthorized");
await db.exec("SET test.manager='false';");
let denied=false;try{await db.query("SELECT get_pitwall_pace($1,null,null,null)",[device]);}catch(e){denied=e.code==="42501";}check("device reader guard reused",denied);
await db.exec("SET test.manager='true';");check("manager can read bounded device pace",!!(await db.query("SELECT get_pitwall_pace($1,null,null,null) h",[device])).rows[0].h);
await db.exec("SET test.manager='false';");
const event="33333333-3333-3333-3333-333333333333",team="44444444-4444-4444-4444-444444444444";
denied=false;try{await db.query("SELECT get_pitwall_pace(null,null,$1,$2)",[event,team]);}catch(e){denied=e.code==="42501";}check("foreign team denied",denied);
await db.query("INSERT INTO endurance_team_members(id,team_id,user_id,event_id) VALUES(gen_random_uuid(),$1,'22222222-2222-2222-2222-222222222222',$2)",[team,event]);
await db.query("UPDATE simhub_telemetry_latest SET endurance_event_id=$1,endurance_team_id=$2",[event,team]);
check("own-team guard allows projected pace",!!(await db.query("SELECT get_pitwall_pace(null,null,$1,$2) h",[event,team])).rows[0].h);
await db.exec("SET test.uid='';");denied=false;try{await db.query("SELECT get_pitwall_pace($1,null,null,null)",[device]);}catch(e){denied=e.code==="42501";}check("anonymous denied",denied);
const priv=(await db.query("SELECT has_function_privilege('authenticated','simhub_pace_cleanup_v1()','EXECUTE') cleanup,has_function_privilege('anon','get_pitwall_pace(uuid,text,uuid,uuid)','EXECUTE') reader")).rows[0];check("cleanup service-only and anon reader denied",!priv.cleanup && !priv.reader);
await db.query("UPDATE simhub_telemetry_latest SET v3_normalized=jsonb_set(v3_normalized,'{paceHistory,updatedAt}','\"2000-01-01T00:00:00Z\"'::jsonb)");
check("physical TTL cleanup works",Number((await db.query("SELECT simhub_pace_cleanup_v1() n")).rows[0].n)===1);
await db.exec(rollback);
const restored=await db.query("SELECT proname,pg_get_functiondef(oid) definition FROM pg_proc WHERE proname IN ('simhub_persist_v3','get_pitwall_data','get_simhub_device_details','simhub_connector_config_apply') ORDER BY proname");
check("rollback restores exact four predecessor definitions",JSON.stringify(original.rows)===JSON.stringify(restored.rows));
await db.exec(migration);check("forward after rollback",true);
console.log(`SUMMARY SQL-PACE PASS=${passed} FAIL=0`);await db.close();
