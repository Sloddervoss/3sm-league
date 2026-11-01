import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parsePaceCapture, validatedSectors, type PaceCapture, type PaceHistory } from "../../supabase/functions/_shared/paceCapture";
import { parseTelemetryV3Envelope } from "../../supabase/functions/_shared/simhub";
import { snapshotDto, persistArguments } from "../../supabase/functions/_shared/simhubAggregates";
import { RaceTelemetryStrip } from "@/features/endurance/pitwall/RaceTelemetryStrip";
import { PacePanel } from "@/features/endurance/pitwall/PacePanel";
import { PaceSeriesGraph } from "@/features/endurance/pitwall/PaceSeriesGraph";
import { freshPaceHistory, rowSectors, deltaSeries, linePath, type StoredTrace } from "@/features/endurance/pitwall/paceSeries";
import { StandingsWidget } from "@/features/endurance/pitwall/StandingsWidget";
import { deriveStandings } from "@/features/endurance/pitwall/standings";
import type { V3Normalized } from "@/features/endurance/pitwall/pitwallHelpers";
import { readFileSync } from "node:fs";
const baseline = JSON.parse(readFileSync("tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures/v3-frame-baseline.json","utf8"));
const capture = (): PaceCapture => ({schemaRevision:1,observedSessionId:"sim",segmentId:"seg",opponentMetrics:[],opponentLaps:[],traceChunks:[]});
const trace = (id:string,offset=0):StoredTrace => ({id,traceId:id,lap:2,chunkIndex:0,finalChunk:true,anchorSessionTimeMs:offset,anchorUncertaintyMs:100,lapSeconds:100,provenance:"simhub-opponent-sampled",speedUnit:"km/h",complete:true,points:Array.from({length:128},(_,bin)=>[bin,offset+Math.round(bin/127*100000),1800])});
const history = (): PaceHistory => ({schemaRevision:1,observedSessionId:"sim",segmentId:"seg",transportSessionId:"transport",updatedAt:new Date().toISOString(),cars:["own","rival"].map(id=>({id,laps:[1,2].map(lap=>({id,lap,seconds:id==="own"?100+lap:99+lap,observedSessionTimeSeconds:300,quality:"sampled",observationId:`${id}:${lap}`})),traces:[trace(id)]}))});
const v3 = ():V3Normalized => ({transportSessionId:"transport",session:{sessionTimeSeconds:300,isInCar:true},opponents:[{id:"own",isPlayer:true,position:2,lastLapSeconds:100},{id:"rival",position:1,lastLapSeconds:100}],paceHistory:history()});
describe("PACE contract: optioneel en fail-closed",()=>{
 it("accepteert het echt door C# geserialiseerde synthetische 40-auto-frame",()=>{
   const raw=readFileSync("supabase/tests/fixtures/pace-40cars-frame.json","utf8");
   const frame=JSON.parse(raw); const normalized=parseTelemetryV3Envelope(frame);
   expect(normalized.opponents).toHaveLength(40); expect(normalized.paceCapture).not.toBeNull();
   expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(24000);
 });

 it.each([undefined,null,{},[],{...capture(),schemaRevision:2},{...capture(),traceChunks:[{}]}])("isoleert ongeldig/afwezig blok %s",value=>{
   expect(parsePaceCapture(value)).toBeNull();
   const result=parseTelemetryV3Envelope({...baseline,paceCapture:value});
   expect(result.paceCapture).toBeNull(); expect(result.fuel.fuelLitres).toBe(baseline.fuel.fuelLitres);
 });
 it("behoudt bestaande snapshot en acht argumenten",()=>{
   const result=parseTelemetryV3Envelope({...baseline,paceCapture:capture()});
   expect(snapshotDto(result).paceCapture).toEqual(capture());
   const base={p_token_hash:"t",p_session_id:"s",p_sequence:1,p_captured_at:"now",p_v3_normalized:{},p_simhub_version:null};
   expect(Object.keys(persistArguments(base,{events:[],laps:[]},true))).toEqual([...Object.keys(base),"p_events","p_laps"]);
 });
 it.each([[21.86,18,13.9],[30,null,40],[30,NaN,40],[30,Infinity,40],[0,60,40]])("weigert gemengd triplet %s",(...sectors)=>expect(validatedSectors(sectors,100)).toBeNull());
 it("marge 0,1 s en geen losse sectorlekkage",()=>{
   expect(validatedSectors([30,30,40.1],100)).not.toBeNull(); expect(validatedSectors([30,30,40.101],100)).toBeNull();
 });
 it("weigert meer dan 128 bins, duplicate/unsorted punten, geen unitconversie",()=>{
   const good=trace("own"); const {complete:_,...wire}=good;
   const c=capture(); c.traceChunks=[{...wire,chunkIndex:0,points:wire.points.slice(0,8)}];
   expect(parsePaceCapture(c)?.traceChunks[0].points).toHaveLength(8);
   c.traceChunks[0].points=[[1,100,200],[1,110,201]]; expect(parsePaceCapture(c)).toBeNull();
   c.traceChunks[0].points=[[128,100,200]]; expect(parsePaceCapture(c)).toBeNull();
   c.traceChunks[0].points=[[1,100,200]]; c.traceChunks[0].speedUnit=null; expect(parsePaceCapture(c)?.traceChunks[0].points[0][2]).toBeNull();
 });
});
describe("PACE reeksen en tweede lijn",()=>{
 it("lege of enkele referentiewaarde wordt geen tweede lijn",()=>{
   const {container}=render(<PaceSeriesGraph own={[{x:1,y:100},{x:2,y:101}]} reference={[{x:1,y:99}]} label="test" unit="s" />);
   expect(container.querySelectorAll("[data-pace-line=own]")).toHaveLength(1); expect(container.querySelector("[data-pace-line=reference]")).toBeNull();
 });
 it("toont maximaal twee echte reeksen in alle drie tabs",()=>{
   const {container}=render(<PacePanel v3={v3()} strategy={null} pace={null} />);
   for(const mode of ["Rondetijd","Snelheid","Delta"]){
     fireEvent.click(screen.getByRole("button",{name:mode})); expect(container.querySelectorAll("[data-pace-line]")).toHaveLength(2);
   }
 });
 it("gaten krijgen nieuwe subpaden, geen verbinding door ontbrekende bins",()=>{
   expect(linePath([{x:0,y:1},{x:2,y:2}],x=>x,y=>y,1)).toBe("M0.00,1.00 M2.00,2.00");
 });
 it("delta gebruikt finishanker en dezelfde afstand, teken positief=langzamer",()=>{
   const own=trace("own",1000),ref=trace("ref"); own.points[50][1]!+=100;
   expect(deltaSeries(own,ref)[0][50].y).toBeCloseTo(0.1);
   own.anchorSessionTimeMs=null; expect(deltaSeries(own,ref)).toEqual([[],[]]);
 });
 it("TTL/sessiewissel en offline verliezen data",()=>{
   const old=v3(); old.transportSessionId="changed"; expect(freshPaceHistory(old)).toBeNull();
   const expired=v3(); expired.paceHistory!.updatedAt="2000-01-01T00:00:00Z"; expect(freshPaceHistory(expired)).toBeNull();
   const {container}=render(<PacePanel v3={v3()} strategy={null} pace={null} live={false} />); expect(container.querySelector("[data-pace-line]")).toBeNull();
 });
 it("KPI-strip lekt geen ongecontroleerde oude voertuigsectoren",()=>{
   const state=v3(); state.vehicle={sector1Seconds:1,sector2Seconds:2,sector3Seconds:3} as V3Normalized["vehicle"];
   const {rerender}=render(<RaceTelemetryStrip v3={state} live />);
   expect(screen.getByText("Sectoren · niet gecontroleerd")).toBeInTheDocument();
   state.paceHistory!.cars[0].metrics={id:"own",observedSessionTimeSeconds:300,lastLapSeconds:100,bestLapSeconds:null,lastLapSectorSeconds:[30,30,40],bestLapSectorSeconds:null,bestSectorSeconds:null,bestLapDeltaToFieldBestSeconds:null,bestLapDeltaToPlayerSeconds:null,lapValid:null,lapHighPrecision:null,trackPositionPercentRaw:null,sectorMismatchCount:0};
   rerender(<RaceTelemetryStrip v3={state} live />);
   expect(screen.getByText("40.000")).toBeInTheDocument(); expect(screen.queryByText("1.000")).not.toBeInTheDocument();
 });
 it("sectorkolommen tonen alleen een actueel gecontroleerd triplet",()=>{
   const state=v3(); const metric={id:"rival",observedSessionTimeSeconds:300,lastLapSeconds:100,bestLapSeconds:100,lastLapSectorSeconds:[30,30,40],bestLapSectorSeconds:null,bestSectorSeconds:null,bestLapDeltaToFieldBestSeconds:null,bestLapDeltaToPlayerSeconds:null,lapValid:null,lapHighPrecision:null,trackPositionPercentRaw:null,sectorMismatchCount:2};
   state.paceHistory!.cars[1].metrics=metric;
   expect(rowSectors(state,"rival",100)).toEqual([30,30,40]);
   const {rerender}=render(<StandingsWidget v3={state} standings={deriveStandings(state,40)} ownCarLabel="Eigen" ownCarNumber={null} />);
   expect(screen.getByText("40.000")).toBeInTheDocument();
   metric.lastLapSectorSeconds=[1,2,3]; rerender(<StandingsWidget v3={state} standings={deriveStandings(state,40)} ownCarLabel="Eigen" ownCarNumber={null} />);
   expect(screen.queryByText("40.000")).not.toBeInTheDocument(); expect(rowSectors(state,"rival",100)).toBeNull();
   metric.lastLapSectorSeconds=[30,30,40]; metric.observedSessionTimeSeconds=290; expect(rowSectors(state,"rival",100)).toBeNull();
 });
});
