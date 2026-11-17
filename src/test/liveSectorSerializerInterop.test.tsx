import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {parsePaceCapture} from '../../supabase/functions/_shared/paceCapture';
import {parseTelemetryV3Envelope} from '../../supabase/functions/_shared/simhub';
import {buildSectorTimingIndex} from '../features/endurance/pitwall/sectorTiming';
import {SectorTimingCell} from '../features/endurance/pitwall/SectorTimingCell';

// Hardware/serializer integration proof is explicit: generate the input with
// DiagnosticsTests --export-live-sectors, never replace it with hand-written JSON.
const input=process.env.SECTOR_CSHARP_STREAMS;
const engine=process.env.PGLITE_MODULE;
const streams=input?JSON.parse(readFileSync(input,'utf8')).streams:[];
const rootFrame=JSON.parse(readFileSync('tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures/v3-frame-baseline.json','utf8'));
const reports:any[]=[];
let db:any;
describe.skipIf(!input || !engine)('actual C# sender → V3 parser → PostgreSQL → projector → Pitwall',()=>{
 beforeAll(async()=>{
  const {PGlite}=await import(/* @vite-ignore */ engine!);db=await PGlite.create();
  await db.exec('CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated');
  const rollback=readFileSync('supabase/rollbacks/20261117201558_live_sector_updates.rollback.sql','utf8');
  await db.exec(rollback.match(/CREATE OR REPLACE FUNCTION public\.simhub_pace_merge_v1[\s\S]*?\$function\$;/)![0]);
  await db.exec(readFileSync('supabase/migrations/20261117201558_live_sector_updates.sql','utf8'));
  await db.exec(readFileSync('supabase/tests/fixtures/pace-sector-project-baseline.sql','utf8'));
 },30000);
 afterAll(async()=>{
  if(process.env.SECTOR_INTEROP_REPORT)writeFileSync(process.env.SECTOR_INTEROP_REPORT,JSON.stringify({syntheticSourceSamples:true,actualSenderAndSerializer:true,results:reports},null,2));
  await db?.close();
 });
 for(const stream of streams)it(`${stream.sectorCount} sectors / ${stream.kind}: lossless independent results through real consumers`,async()=>{
  let history:any=null;const seen=new Set<string>();let mixed=false,negative=false,priorToFullLap=false;const projections:any[]=[];
  for(const wire of stream.wires){
   const capture=JSON.parse(wire).paceCapture;
   expect(Buffer.byteLength('"paceCapture":'+JSON.stringify(capture),'utf8')).toBeLessThanOrEqual(4096);
   expect(capture.sectorUpdates.length).toBeLessThanOrEqual(8);
   expect(parsePaceCapture(capture)?.sectorUpdates).toEqual(capture.sectorUpdates);
   const normalized=parseTelemetryV3Envelope({...rootFrame,paceCapture:capture});
   expect(normalized.fuel.fuelLitres).toBe(rootFrame.fuel.fuelLitres);
   expect(normalized.paceCapture?.sectorUpdates).toEqual(capture.sectorUpdates);
   history=(await db.query('select public.simhub_pace_merge_v1($1::jsonb,$2::jsonb,$3,$4::timestamptz) h',[history?JSON.stringify(history):null,JSON.stringify(normalized.paceCapture),'interop-transport','2026-11-17T20:00:00Z'])).rows[0].h;
   const projected=(await db.query('select public.simhub_pace_project_v1($1::jsonb,$2) h',[JSON.stringify(history),'not-the-opponent'])).rows[0].h;
   const car=projected.cars.find((c:any)=>c.id==='stream-car');expect(car).toBeDefined();
   expect(car.sectors.length).toBeLessThanOrEqual(stream.sectorCount);
   const timing=buildSectorTimingIndex(projected,[{id:'stream-car'}]).get('stream-car');expect(timing).toBeDefined();
   for(const update of capture.sectorUpdates){
    seen.add(update.status);
    const persisted=car.sectors.find((s:any)=>s.sectorIndex===update.sectorIndex);
    expect(persisted.lap).toBeGreaterThanOrEqual(update.lap);
    if(persisted.lap===update.lap){expect(persisted.revision).toBeGreaterThanOrEqual(update.revision);if(persisted.revision===update.revision)expect(persisted).toEqual(update);}
   }
   for(const slot of timing!.slots){
    if(!slot)continue;
    const html=renderToStaticMarkup(<SectorTimingCell slot={slot}/>);
    expect(html).toContain(`Ronde ${slot.lap}`);
    if(slot.status==='invalidated'){expect(slot.seconds).toBeNull();expect(html).toContain('—');}
    if(slot.status==='provisional'&&slot.lap===2)priorToFullLap=true;
    if(slot.deltaSeconds!=null&&slot.deltaSeconds<0){negative=true;expect(slot.seconds!-slot.referenceSeconds!).toBeLessThan(0);}
   }
   mixed ||= timing!.mixedLaps;
   // A normal poll without a new capture must not erase old results at five seconds.
   const retained=(await db.query('select public.simhub_pace_merge_v1($1::jsonb,null,$2,$3::timestamptz) h',[JSON.stringify(history),'interop-transport','2026-11-17T20:00:06Z'])).rows[0].h;
   expect(retained).toEqual(history);
   projections.push(projected);
  }
  expect(priorToFullLap).toBe(true);expect(seen.has('provisional')).toBe(true);expect(seen.has('verified')).toBe(true);expect(mixed).toBe(true);
  if(stream.kind==='clean'){expect(negative).toBe(true);expect(history.cars.find((c:any)=>c.id==='stream-car').sectors).toHaveLength(stream.sectorCount);}
  else expect(seen.has('invalidated')).toBe(true);
  reports.push({sectorCount:stream.sectorCount,kind:stream.kind,frames:stream.wires.length,statuses:[...seen],priorToFullLap,mixed,negative,passed:true,projections});
 },30000);
});
