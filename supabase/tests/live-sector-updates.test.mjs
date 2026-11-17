import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const {PGlite}=await import(process.env.PGLITE_MODULE??'@electric-sql/pglite');
const db=await PGlite.create();
const prefix='20261117201558';
const forward=readFileSync(resolve(root,`supabase/migrations/${prefix}_live_sector_updates.sql`),'utf8');
const rollback=readFileSync(resolve(root,`supabase/rollbacks/${prefix}_live_sector_updates.rollback.sql`),'utf8');
const at='2026-11-17T20:00:00Z';
const capture=(updates,extra={})=>({schemaRevision:1,observedSessionId:'session',segmentId:'segment',opponentMetrics:[],opponentLaps:[],traceChunks:[],...(updates===undefined?{}:{sectorUpdates:updates}),...extra});
const sector=(o={})=>({id:'rival',lap:2,sectorIndex:0,sectorCount:3,seconds:31.125,completedSessionTimeSeconds:131.125,observedSessionTimeSeconds:131.125,revision:1,status:'provisional',referenceSeconds:32,...o});
async function merge(previous,c,transport='transport',time=at){return (await db.query('select public.simhub_pace_merge_v1($1::jsonb,$2::jsonb,$3,$4::timestamptz) as h',[previous==null?null:JSON.stringify(previous),c==null?null:JSON.stringify(c),transport,time])).rows[0].h;}
const car=h=>h.cars.find(c=>c.id==='rival');
const results=[];
async function test(name,fn){try{await fn();results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:String(e.stack??e)});throw e;}}
try{
 await db.exec("CREATE ROLE service_role");
 await db.exec(rollback);
 await db.exec('GRANT EXECUTE ON FUNCTION public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz) TO service_role');
 await db.exec('REVOKE ALL ON FUNCTION public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz) FROM PUBLIC');
 const original=(await db.query("select prosrc,provolatile,prosecdef,proconfig,proargnames,proacl::text from pg_proc where oid='public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz)'::regprocedure")).rows[0];
 const baseline=await merge(null,capture(undefined));
 await test('RED: production helper rejects the new sector key before migration',async()=>assert.equal(await merge(null,capture([sector()])),null));
 await db.exec(forward);
 await test('old-client output remains byte-structurally equal',async()=>assert.deepEqual(await merge(null,capture(undefined)),baseline));
 await test('existing merge signature/volatility/security/ACL are unchanged',async()=>{
  const now=(await db.query("select provolatile,prosecdef,proconfig,proargnames,proacl::text from pg_proc where oid='public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz)'::regprocedure")).rows[0];
  const {prosrc,...metadata}=original;assert.deepEqual(now,metadata);
 });
 await test('existing trusted invoker can use the new nested helpers',async()=>{
  await db.exec('SET ROLE service_role');try{const v=await merge(null,capture([sector()]));assert.equal(car(v).sectors[0].seconds,31.125);}finally{await db.exec('RESET ROLE');}
 });
 let h;
 await test('partial sector is stored without waiting for a completed lap',async()=>{h=await merge(null,capture([sector()]));assert.equal(car(h).sectors[0].seconds,31.125);assert.deepEqual(car(h).sectorBests,[]);});
 await test('result survives six seconds without a new capture',async()=>{const next=await merge(h,null,'transport','2026-11-17T20:00:06Z');assert.deepEqual(next,h);});
 await test('verified promotion freezes reference and creates proven best',async()=>{h=await merge(h,capture([sector({status:'verified',revision:2,observedSessionTimeSeconds:200})]));assert.equal(car(h).sectors[0].referenceSeconds,32);assert.deepEqual(car(h).sectorBests,[{lap:2,sectorIndex:0,seconds:31.125}]);});
 await test('same revision conflicts and stale revisions are no-ops',async()=>{for(const s of [sector({seconds:1,revision:2}),sector({revision:1})]){const n=await merge(h,capture([s]));assert.deepEqual(n,h);}});
 await test('independent next-lap replacement retains other previous-lap slots',async()=>{
  h=await merge(h,capture([sector({sectorIndex:1,revision:3,seconds:29}),sector({sectorIndex:2,revision:4,seconds:40})]));
  h=await merge(h,capture([sector({lap:3,revision:5,seconds:30,referenceSeconds:31.125,completedSessionTimeSeconds:230,observedSessionTimeSeconds:230})]));
  assert.deepEqual(car(h).sectors.map(s=>[s.sectorIndex,s.lap,s.seconds]),[[0,3,30],[1,2,29],[2,2,40]]);
 });
 await test('new personal best keeps negative comparison against the former best',async()=>{
  h=await merge(h,capture([sector({lap:3,revision:6,status:'verified',seconds:30,referenceSeconds:31.125,completedSessionTimeSeconds:230,observedSessionTimeSeconds:300})]));
  assert.equal(car(h).sectorBests[0].seconds,30);assert.equal(car(h).sectors[0].seconds-car(h).sectors[0].referenceSeconds,-1.125);
 });
 await test('invalidation removes the matching best and cannot resurrect by replay',async()=>{
  const invalid=sector({lap:3,revision:7,status:'invalidated',seconds:null,referenceSeconds:31.125,completedSessionTimeSeconds:230,observedSessionTimeSeconds:301});
  h=await merge(h,capture([invalid]));assert.equal(car(h).sectors[0].status,'invalidated');assert.equal(car(h).sectorBests.length,0);
  const n=await merge(h,capture([sector({lap:3,revision:8,status:'verified',seconds:30,referenceSeconds:31.125,completedSessionTimeSeconds:230,observedSessionTimeSeconds:302})]));assert.deepEqual(n,h);
 });
 await test('late verification improves best without replacing a newer-lap display',async()=>{
  let v=await merge(null,capture([sector()]));
  v=await merge(v,capture([sector({lap:3,revision:20,seconds:32,completedSessionTimeSeconds:232,observedSessionTimeSeconds:232})]));
  v=await merge(v,capture([sector({revision:10,status:'verified',observedSessionTimeSeconds:200})]));
  assert.equal(car(v).sectors[0].lap,3);assert.equal(car(v).sectorBests[0].lap,2);
  v=await merge(v,capture([sector({revision:11,status:'invalidated',seconds:null,observedSessionTimeSeconds:201})]));assert.equal(car(v).sectorBests.length,0);
  const replay=await merge(v,capture([sector({revision:12,status:'verified',observedSessionTimeSeconds:202})]));assert.equal(car(replay).sectorBests.length,0);
 });
 await test('invalidated ancient best cannot return after bounded ledger pruning',async()=>{
  let v=await merge(null,capture([sector({lap:1,status:'verified'})]));
  v=await merge(v,capture([sector({lap:6,revision:20,seconds:33})]));
  v=await merge(v,capture([sector({lap:1,revision:21,status:'invalidated',seconds:null})]));
  v=await merge(v,capture([sector({lap:1,revision:22,status:'verified'})]));assert.equal(car(v).sectorBests.length,0);
 });
 await test('layout mismatch is rejected until a new source segment',async()=>{
  const s=sector({sectorCount:6,revision:30});const n=await merge(h,capture([s]));assert.deepEqual(car(n),car(h));
  const reset=await merge(h,capture([s],{segmentId:'new-segment'}));assert.equal(car(reset).sectors[0].sectorCount,6);assert.equal(car(reset).sectors.length,1);
 });
 await test('transport and observed-session changes clear previous results',async()=>{
  for(const [c,t] of [[capture([]),'new-transport'],[capture([],{observedSessionId:'new-session'}),'transport']])assert.deepEqual((await merge(h,c,t)).cars,[]);
 });
 await test('expiry remains 24 hours, not five seconds',async()=>assert.equal(await merge(h,null,'transport','2026-11-19T20:00:00Z'),null));
 await test('bad optional entry cannot discard good sectors or legacy metrics',async()=>{
  const c=capture([{...sector(),id:'bad',seconds:-1},sector()],{opponentMetrics:[{id:'legacy',observedSessionTimeSeconds:100}]});
  const v=await merge(null,c);assert.equal(v.cars.length,2);assert.equal(car(v).sectors.length,1);assert.ok(v.cars.find(c=>c.id==='legacy').metrics);
 });
 await test('bad optional arrays and array overflow preserve legacy metrics',async()=>{
  for(const updates of [{},null,Array.from({length:9},()=>sector())]){const v=await merge(null,capture(updates,{opponentMetrics:[{id:'legacy',observedSessionTimeSeconds:100}]}));assert.equal(v.cars[0].metrics.id,'legacy');}
 });
 await test('SQL validator agrees on numeric types, bounds and exact keys',async()=>{
  for(const bad of [{seconds:0},{seconds:'31.125'},{revision:0},{sectorIndex:3},{lap:1.5},{id:1},{referenceSeconds:0},{observedSessionTimeSeconds:100},{unknown:1}]){
   const r=await db.query('select public.simhub_sector_update_valid_v1($1::jsonb) as valid',[JSON.stringify({...sector(),...bad})]);assert.equal(r.rows[0].valid,false,JSON.stringify(bad));
  }
 });
 await test('16 sectors for 40 cars remain bounded with verified best history',async()=>{
  let v=null,updates=[];
  for(let i=0;i<40;i++)for(let index=0;index<16;index++)updates.push(sector({id:`car-${i}`,sectorCount:16,sectorIndex:index,revision:index+1,status:'verified'}));
  for(let i=0;i<updates.length;i+=8)v=await merge(v,capture(updates.slice(i,i+8)));
  assert.equal(v.cars.length,40);for(const c of v.cars){assert.equal(c.sectors.length,16);assert.equal(c.sectorBests.length,16);assert.ok(c.sectorGuards.length<=48);}
  const bytes=(await db.query('select octet_length($1::jsonb::text) as bytes',[JSON.stringify(v)])).rows[0].bytes;assert.ok(bytes<=524288);globalThis.largeHistory=v;
 });
 await test('combined history sheds heavy traces instead of losing sectors/core',async()=>{
  const v=structuredClone(globalThis.largeHistory);
  for(const c of v.cars)c.traces=Array.from({length:3},(_,i)=>({id:c.id,traceId:`${c.id}-${i}`,lap:2,points:Array.from({length:128},(_,b)=>[b,86300000+b*100,5999]),complete:false,finalChunk:false,anchorSessionTimeMs:86300000,anchorUncertaintyMs:100,lapSeconds:null,provenance:'simhub-opponent-sampled',speedUnit:'km/h'}));
  const n=await merge(v,capture([sector({id:'car-0',sectorCount:16,lap:3,revision:50,seconds:30})]));
  assert.ok(n);assert.equal(n.cars.length,40);assert.equal(n.cars.find(c=>c.id==='car-0').sectors[0].lap,3);
  const bytes=(await db.query('select octet_length($1::jsonb::text) as bytes',[JSON.stringify(n)])).rows[0].bytes;assert.ok(bytes<=524288);
 });
 await test('rollback restores the exact previous function body and metadata',async()=>{
  await db.exec(rollback);const restored=(await db.query("select prosrc,provolatile,prosecdef,proconfig,proargnames,proacl::text from pg_proc where oid='public.simhub_pace_merge_v1(jsonb,jsonb,text,timestamptz)'::regprocedure")).rows[0];assert.deepEqual(restored,original);
  assert.equal((await db.query("select to_regprocedure('public.simhub_sector_car_merge_v1(jsonb,jsonb)') as f")).rows[0].f,null);
 });
 console.log(JSON.stringify({engine:'actual isolated PostgreSQL via PGlite; not production Postgres 15',passed:results.length,failed:0,results}));
 if(process.env.SECTOR_SQL_REPORT)writeFileSync(process.env.SECTOR_SQL_REPORT,JSON.stringify({passed:results.length,failed:0,results},null,2));
}catch(error){console.error(JSON.stringify({passed:results.filter(r=>r.passed).length,failed:1,message:error.message,sqlState:error.code,position:error.position,where:error.where}));process.exitCode=1;if(process.env.SECTOR_SQL_REPORT)writeFileSync(process.env.SECTOR_SQL_REPORT,JSON.stringify({results,error:error.message},null,2));}finally{await db.close();}
