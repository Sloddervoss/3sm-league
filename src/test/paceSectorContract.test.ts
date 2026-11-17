import {describe,expect,it} from 'vitest';
import {parsePaceCapture,type PaceSectorUpdate} from '../../supabase/functions/_shared/paceCapture';
import {parseTelemetryV3Envelope} from '../../supabase/functions/_shared/simhub';
import {readFileSync} from 'node:fs';
const frame=JSON.parse(readFileSync('tools/simhub-plugin/3SM.EnduranceConnector.DiagnosticsTests/Fixtures/v3-frame-baseline.json','utf8'));
const capture=()=>({schemaRevision:1,observedSessionId:'sim',segmentId:'segment',opponentMetrics:[],opponentLaps:[],traceChunks:[]});
const sector=(overrides:Partial<PaceSectorUpdate>={}):PaceSectorUpdate=>({id:'rival',lap:2,sectorIndex:0,sectorCount:3,seconds:31.125,completedSessionTimeSeconds:131.125,observedSessionTimeSeconds:131.125,revision:1,status:'provisional',referenceSeconds:32,...overrides});
describe('additive live sector contract',()=>{
 it('preserves a partial live sector without requiring a completed lap',()=>{
  const s=sector();expect(parsePaceCapture({...capture(),sectorUpdates:[s]})?.sectorUpdates).toEqual([s]);
 });
 it('preserves old clients exactly when new key is absent',()=>expect(parsePaceCapture(capture())).toEqual(capture()));
 it('supports bounded real track layouts instead of hardcoded thirds',()=>{
  for(const count of [1,3,6,16]){const s=sector({sectorCount:count,sectorIndex:count-1});expect(parsePaceCapture({...capture(),sectorUpdates:[s]})?.sectorUpdates).toEqual([s]);}
 });
 it('accepts verification revisions and explicit invalidation',()=>{
  for(const status of ['provisional','verified','invalidated'] as const){const s=sector({status,seconds:status==='invalidated'?null:31.125,revision:2,observedSessionTimeSeconds:200});expect(parsePaceCapture({...capture(),sectorUpdates:[s]})?.sectorUpdates).toEqual([s]);}
 });
 it.each([
  {seconds:-1},{seconds:0},{seconds:Infinity},{seconds:null},{sectorIndex:3},{sectorIndex:-1},{sectorCount:0},{sectorCount:17},
  {lap:0},{lap:100001},{revision:0},{revision:1.2},{revision:Number.MAX_SAFE_INTEGER+1},
  {observedSessionTimeSeconds:100},{completedSessionTimeSeconds:86401},{referenceSeconds:0},{referenceSeconds:Infinity},
  {status:'invalidated',seconds:5},{status:'other'},{id:''},{extra:true},
 ])('isolates a malformed sector entry without losing legacy PACE: %j',bad=>{
  const good=sector({id:'good'});const wire={...capture(),sectorUpdates:[{...sector(),...bad},good]};
  const parsed=parsePaceCapture(wire);expect(parsed).not.toBeNull();expect(parsed?.sectorUpdates).toEqual([good]);
 });
 it('isolates malformed optional arrays and overflow instead of losing core telemetry',()=>{
  for(const value of [null,{},'bad',Array.from({length:9},()=>sector())]){
   const wire={...capture(),sectorUpdates:value};expect(parsePaceCapture(wire)).not.toBeNull();
   const normalized=parseTelemetryV3Envelope({...frame,paceCapture:wire});
   expect(normalized.fuel.fuelLitres).toBe(frame.fuel.fuelLitres);expect(normalized.paceCapture).not.toBeNull();
  }
 });
 it('keeps a valid optional sector through the real V3 adapter',()=>{
  const s=sector();const normalized=parseTelemetryV3Envelope({...frame,paceCapture:{...capture(),sectorUpdates:[s]}});
  expect(normalized.paceCapture?.sectorUpdates).toEqual([s]);expect(normalized.opponents).toEqual(parseTelemetryV3Envelope(frame).opponents);
 });
 it('keeps existing root PACE fail-closed and the whole-lap sum gate unchanged',()=>{
  expect(parsePaceCapture({...capture(),unknown:true})).toBeNull();
  expect(parsePaceCapture({...capture(),sectorUpdates:[sector()],schemaRevision:2})).toBeNull();
 });
});
