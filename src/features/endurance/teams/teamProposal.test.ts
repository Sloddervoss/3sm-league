import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "../core/seed";
import type { EnduranceRegistrationRow } from "../repository/registrationsRepository";
import type { EndurancePaceRow } from "../repository/paceRepository";
import { assessTeam, comparablePace, proposeTeams } from "./teamProposal";
import { generateStints } from "../stints/stintGenerator";

const event = {...createEnduranceSeed().events[0],maxDriversPerCar:16};
const registration = (id:string,extra:Partial<EnduranceRegistrationRow>={}):EnduranceRegistrationRow => ({id,user_id:id,event_id:event.id,status:"provisional",class_preference:null,preferred_car_id:null,slot_id:null,max_stints:null,max_stint_minutes:null,max_total_minutes:null,max_consecutive_stints:null,min_rest_minutes:null,night_driving:true,willing_to_start:false,willing_to_finish:false,notes:null,registered_at:event.startAt,...extra});
const paceRow = (id:string,extra:Partial<EndurancePaceRow>={}):EndurancePaceRow => ({id,event_id:event.id,user_id:id,circuit:event.circuit,configuration:event.configuration,car:event.selectedCarId!,conditions:"dry",average_lap_seconds:100,median_lap_seconds:100,best_lap_seconds:99,best_five_average_seconds:99,consistency_seconds:1,valid_laps:20,incidents:0,average_stint_minutes:30,recorded_at:event.startAt,source:"practice",notes:null,...extra});
const pace = (count:number) => new Map(Array.from({length:count},(_,i)=>[String(i),{seconds:100+i*.1,laps:20,source:"practice",recordedAt:event.startAt}]));

describe("pace-based team workflow",()=>{
 it("creates five adjacent, balanced crews for 18 drivers with a target of four",()=>{
  const result=proposeTeams(event,Array.from({length:18},(_,i)=>registration(String(i))),pace(18),new Set(),4);
  expect(result.teams.map(t=>t.userIds.length)).toEqual([4,4,4,3,3]);
  expect(result.teams[0].userIds).toEqual(["0","1","2","3"]);
  expect(new Set(result.teams.flatMap(t=>t.userIds)).size).toBe(18);
 });
 it("supports teams of four, six and eight in the same race",()=>{
  const regs=Array.from({length:18},(_,i)=>registration(String(i),{preferred_team_size:i<4?4:i<10?6:8,team_approach:i<4?"competitive":"fun"}));
  expect(proposeTeams(event,regs,pace(18),new Set(),4).teams.map(t=>t.capacity)).toEqual([4,6,8]);
 });
 it("does not reassign existing members, reserves, interest or unknown pace",()=>{
  const regs=[registration("0"),registration("1",{status:"reserve"}),registration("2",{status:"interest"}),registration("unknown"),registration("3")];
  const result=proposeTeams(event,regs,pace(4),new Set(["0"]),4);
  expect(result.teams.flatMap(t=>t.userIds)).toEqual(["3"]);
  expect(result.pendingIds).toEqual(["unknown"]);
 });
 it("keeps a preference above the event maximum pending",()=>{
  const result=proposeTeams({...event,maxDriversPerCar:4},[registration("0",{preferred_team_size:8})],pace(1),new Set(),4);
  expect(result.teams).toEqual([]);expect(result.pendingIds).toEqual(["0"]);
 });
 it("compares only sufficient runs on the selected car, layout and conditions",()=>{
  const rows=[paceRow("ok"),paceRow("few",{valid_laps:9}),paceRow("wet",{conditions:"wet"}),paceRow("layout",{configuration:"other"}),paceRow("car",{car:"other"}),paceRow("bad",{average_lap_seconds:0})];
  expect([...comparablePace(event,rows).keys()]).toEqual(["ok"]);
 });
 it("uses the latest qualified practice rather than the fastest or adding snapshots",()=>{
  const rows=[paceRow("0",{id:"older",average_lap_seconds:90,recorded_at:"2026-01-01"}),paceRow("0",{id:"new",average_lap_seconds:101,recorded_at:"2026-02-01"}),paceRow("0",{id:"manual",source:"manual",average_lap_seconds:80,recorded_at:"2026-03-01"})];
  expect(comparablePace(event,rows).get("0")).toMatchObject({seconds:101,laps:20});
 });
 it("does not claim readiness without availability or enough driving time",()=>{
  const result=assessTeam(event,["0","1"],[registration("0",{max_total_minutes:30}),registration("1",{max_total_minutes:30})],[]);
  expect(result.ready).toBe(false);expect(result.issues.join(" ")).toContain("rijcapaciteit tekort");expect(result.missingAvailability).toHaveLength(2);
 });
 it("proves a schedule for two available drivers and catches withdrawn drivers",()=>{
  const availability=["0","1"].map(id=>({id,eventId:event.id,userId:id,startAt:event.startAt,endAt:event.endAt,type:"available" as const,note:""}));
  expect(assessTeam(event,["0","1"],[registration("0"),registration("1")],availability).ready).toBe(true);
  expect(assessTeam(event,["0","1"],[registration("0"),registration("1",{status:"withdrawn"})],availability).ready).toBe(false);
 });
 it("respects the total stint count in generation",()=>{
  const state=createEnduranceSeed();
  expect(()=>generateStints(state,state.events[0],"team-orange-31",90,{driverLimits:{"user-jaimy":{maxStints:0},"user-sven":{maxStints:0},"user-ricky":{maxStints:0}}})).toThrow();
 });
});
