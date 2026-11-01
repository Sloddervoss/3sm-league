// Synthetic acquisition-shaped data for local browser tests ONLY. Never imported by an app route.
import type { PaceHistory, PaceChunk } from "../../../supabase/functions/_shared/paceCapture";
import { fixtureV3 } from "./fixtures";
export const paceFixtureV3 = structuredClone(fixtureV3);
const own = paceFixtureV3.opponents!.find(o=>o.isPlayer)!;
const leader = paceFixtureV3.opponents!.find(o=>o.position===1 && !o.isPlayer)!;
const ids=[own.id,leader.id];
const trace=(id:string):PaceChunk & {complete:boolean}=>({id,traceId:`trace-${id}`,lap:141,chunkIndex:0,finalChunk:true,anchorSessionTimeMs:0,anchorUncertaintyMs:100,lapSeconds:103.162,provenance:"simhub-opponent-sampled",speedUnit:"km/h",complete:true,points:Array.from({length:128},(_,i)=>[i,Math.round(i/127*103162),Math.round(1600+600*Math.sin(i/15))])});
const h:PaceHistory={schemaRevision:1,observedSessionId:"fixture",segmentId:"fixture-segment",transportSessionId:paceFixtureV3.transportSessionId!,updatedAt:new Date().toISOString(),cars:ids.map(id=>({id,laps:Array.from({length:10},(_,i)=>({id,lap:132+i,seconds:103+i/20,observedSessionTimeSeconds:paceFixtureV3.session!.sessionTimeSeconds!,quality:"sampled",observationId:`${id}-${i}`})),traces:[trace(id)],metrics:{id,observedSessionTimeSeconds:paceFixtureV3.session!.sessionTimeSeconds!,lastLapSeconds:paceFixtureV3.opponents!.find(o=>o.id===id)!.lastLapSeconds!,bestLapSeconds:null,lastLapSectorSeconds:null,bestLapSectorSeconds:null,bestSectorSeconds:null,bestLapDeltaToFieldBestSeconds:null,bestLapDeltaToPlayerSeconds:null,lapValid:null,lapHighPrecision:null,trackPositionPercentRaw:null,sectorMismatchCount:1}}))};
paceFixtureV3.paceHistory=h;

// The sector source here is synthetic too; browser checks only presentation, not acquisition.
const sectorCount=new URLSearchParams(window.location.search).get("sectors")==="3" ? 3 : 6;
for (const [index,car] of h.cars.entries()) {
  car.metrics!.sectorCount=sectorCount;
  car.metrics!.sectorSource="measured";
  car.metrics!.sectorErrorSeconds=0;
  car.metrics!.lastLapSectorSeconds=Array.from({length:sectorCount},()=>car.metrics!.lastLapSeconds!/sectorCount);
  car.laps.forEach(l=>{l.seconds+=index*0.35;});
  car.traces[0].points.forEach(p=>{p[1]!+=Math.round(p[0]/127*index*350);p[2]!+=index*15;});
}
