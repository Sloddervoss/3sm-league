import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StintPlanner } from "./StintPlanner";
import type { EnduranceEvent } from "../core/types";
const mocks = vi.hoisted(() => ({
  teams: [] as unknown[],
  rows: [] as unknown[],
  members: [{ id: "member", team_id: "t", user_id: "a", role: "driver" }] as unknown[],
  registrations: [{ user_id: "a", status: "provisional" }] as unknown[],
  availability: [{ id: "av", user_id: "a", start_at: "2026-09-08T12:00:00.000Z", end_at: "2026-09-08T13:00:00.000Z", type: "available" }] as unknown[],
  publish: vi.fn(), upsert: vi.fn(), replaceDraft: vi.fn(), manager: true,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user:{id:mocks.manager ? "manager" : "a"}, isSuperAdmin:false, isEnduranceManager:mocks.manager }) }));
vi.mock("../core/ActorContext", () => ({ useEnduranceActor: () => ({actorId:"manager",displayName:(id:string)=>id}) }));
vi.mock("../repository/teamsRepository", () => ({ useEnduranceTeamWorkspace: () => ({ data:{teams:mocks.teams,members:mocks.members} }) }));
vi.mock("../repository/registrationsRepository", () => ({useEnduranceRegistrations:()=>({data:mocks.registrations})}));
vi.mock("../repository/availabilityRepository", () => ({useEnduranceAvailability:()=>({data:mocks.availability})}));
vi.mock("../repository/paceRepository", () => ({useEndurancePace:()=>({data:[]})}));
vi.mock("../repository/carSpecRepository", () => ({useEnduranceCarSpecs:()=>({data:[{car_id:"lamborghinievogt3",display_name:"Lamborghini Huracán GT3 EVO",tank_capacity_litres:104,fuel_per_lap_prior_litres:2.947}]})}));
vi.mock("../repository/stintsRepository", () => ({useEnduranceStints:()=>({data:mocks.rows}),useEnduranceStintMutations:()=>({upsert:{mutateAsync:mocks.upsert},remove:{mutateAsync:vi.fn()},replaceDraft:{mutateAsync:mocks.replaceDraft}})}));
vi.mock("../repository/planRepository", () => ({ useEndurancePlanWorkspace:()=>({data:{versions:[],confirmations:[]}}),useEndurancePlanMutations:()=>({publish:{mutateAsync:mocks.publish},confirm:{mutateAsync:vi.fn()}})}));
const event = { id:"race",startAt:"2026-09-08T12:00:00.000Z",endAt:"2026-09-08T13:00:00.000Z" } as EnduranceEvent;
const row = { id:"s",event_id:"race",team_id:"t",driver_id:"a",original_start_at:event.startAt,original_end_at:event.endAt,actual_start_at:event.startAt,actual_end_at:event.endAt,status:"draft",expected_laps:30,fuel_litres:90,tyre_change:true,double_stint:false,notes:"preserve" };
beforeEach(()=>{
  mocks.teams=[{id:"t",event_id:"race",name:"Team One",manager_id:"someone-else"}];
  mocks.rows=[row];
  mocks.members=[{id:"member",team_id:"t",user_id:"a",role:"driver"}];
  mocks.registrations=[{user_id:"a",status:"provisional"}];
  mocks.availability=[{id:"av",user_id:"a",start_at:"2026-09-08T12:00:00.000Z",end_at:"2026-09-08T13:00:00.000Z",type:"available"}];
  mocks.manager=true;mocks.publish.mockReset();mocks.upsert.mockReset();mocks.replaceDraft.mockReset();
});
afterEach(cleanup);
it("selects the first team after loading and permits a global endurance manager",()=>{
 mocks.teams=[];
 const view=render(<StintPlanner event={event}/>);
 mocks.teams=[{id:"t",event_id:"race",name:"Team One",manager_id:"someone-else"}];
 view.rerender(<StintPlanner event={event}/>);
 expect(screen.getByRole("combobox",{name:"Auto / team"})).toHaveValue("t");
 expect(screen.getByRole("button",{name:"Publiceren"})).toBeEnabled();
});
it("waits for publish success and prevents duplicate submissions",async()=>{
 let resolve!:()=>void;
 mocks.publish.mockImplementation(()=>new Promise<void>(r=>{resolve=r;}));
 render(<StintPlanner event={event}/>);
 fireEvent.click(screen.getByRole("button",{name:"Publiceren"}));
 expect(screen.queryByText("Planning gepubliceerd en bevestigingen aangevraagd.")).not.toBeInTheDocument();
 expect(screen.getByRole("button",{name:"Publiceren"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"Publiceren"})); expect(mocks.publish).toHaveBeenCalledTimes(1);
 await act(async()=>resolve());
 expect(await screen.findByText("Planning gepubliceerd en bevestigingen aangevraagd.")).toBeInTheDocument();
});
it("shows a failed publication without a false success message",async()=>{
 mocks.publish.mockRejectedValue(new Error("Server niet bereikbaar"));
 render(<StintPlanner event={event}/>); fireEvent.click(screen.getByRole("button",{name:"Publiceren"}));
 expect(await screen.findByText("Server niet bereikbaar")).toBeInTheDocument();
 expect(screen.queryByText("Planning gepubliceerd en bevestigingen aangevraagd.")).not.toBeInTheDocument();
});
it("blocks publishing an incomplete schedule and editing active stints",()=>{
 mocks.rows=[{...row,actual_end_at:"2026-09-08T12:30:00.000Z"}];
 const view=render(<StintPlanner event={event}/>); expect(screen.getByRole("button",{name:"Publiceren"})).toBeDisabled();
 mocks.rows=[{...row,status:"in_car"}];view.rerender(<StintPlanner event={event}/>);
 expect(screen.getByRole("button",{name:"Voorstel genereren"})).toBeDisabled();
 expect(screen.getByText(/Gebruik Pitwall/)).toBeInTheDocument();
});
it("keeps racer actions read-only",()=>{
 mocks.manager=false; mocks.teams=[{id:"t",event_id:"race",name:"Team One",manager_id:"other"}];
 render(<StintPlanner event={event}/>);
 expect(screen.queryByRole("button",{name:"Publiceren"})).not.toBeInTheDocument();
});
it("laat de manager kiezen wie start en schuift daarmee de rijvolgorde door",async()=>{
 // Drie uur, twee coureurs, tank 90 min: twee stints. Wie start bepaalt de
 // volgorde; de verdeling (één stint ieder) blijft gelijk.
 const longEvent={...event,endAt:"2026-09-08T15:00:00.000Z"} as EnduranceEvent;
 mocks.members=[{id:"m-a",team_id:"t",user_id:"a",role:"driver"},{id:"m-b",team_id:"t",user_id:"b",role:"driver"}];
 mocks.registrations=[{user_id:"a",status:"provisional",willing_to_start:true},{user_id:"b",status:"provisional"}];
 mocks.availability=[
  {id:"av-a",user_id:"a",start_at:"2026-09-08T12:00:00.000Z",end_at:"2026-09-08T15:00:00.000Z",type:"available"},
  {id:"av-b",user_id:"b",start_at:"2026-09-08T12:00:00.000Z",end_at:"2026-09-08T15:00:00.000Z",type:"available"},
 ];
 mocks.replaceDraft.mockResolvedValue(undefined);
 render(<StintPlanner event={longEvent}/>);
 // Standaard de coureur die zich als starter opgaf.
 const field=screen.getByRole("combobox",{name:/Wie start/});
 expect(field).toHaveValue("a");
 expect(screen.getByRole("option",{name:"b"})).toBeInTheDocument();
 fireEvent.change(field,{target:{value:"b"}});
 expect(field).toHaveValue("b");
 fireEvent.click(screen.getByRole("button",{name:"Voorstel genereren"}));
 await screen.findByText("Nieuw automatisch voorstel opgeslagen.");
 const payload=mocks.replaceDraft.mock.calls[0][0] as {stints:Array<{driver_id:string}>};
 expect(payload.stints.map((stint)=>stint.driver_id)).toEqual(["b","a"]);
});
it("toont het keuzeveld 'wie start' niet aan coureurs die niet mogen bewerken",()=>{
 mocks.manager=false; mocks.teams=[{id:"t",event_id:"race",name:"Team One",manager_id:"other"}];
 render(<StintPlanner event={event}/>);
 expect(screen.queryByRole("combobox",{name:/Wie start/})).not.toBeInTheDocument();
});
