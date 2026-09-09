import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StintPlanner } from "./StintPlanner";
import type { EnduranceEvent } from "../core/types";
const mocks = vi.hoisted(() => ({ teams: [] as unknown[], rows: [] as unknown[], publish: vi.fn(), upsert:vi.fn(), manager:true }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user:{id:mocks.manager ? "manager" : "a"}, isSuperAdmin:false, isEnduranceManager:mocks.manager }) }));
vi.mock("../core/ActorContext", () => ({ useEnduranceActor: () => ({actorId:"manager",displayName:(id:string)=>id}) }));
vi.mock("../repository/teamsRepository", () => ({ useEnduranceTeamWorkspace: () => ({ data:{teams:mocks.teams,members:[{id:"member",team_id:"t",user_id:"a",role:"driver"}]} }) }));
vi.mock("../repository/registrationsRepository", () => ({useEnduranceRegistrations:()=>({data:[{user_id:"a",status:"provisional"}]})}));
vi.mock("../repository/availabilityRepository", () => ({useEnduranceAvailability:()=>({data:[{id:"av",user_id:"a",start_at:"2026-09-08T12:00:00.000Z",end_at:"2026-09-08T13:00:00.000Z",type:"available"}]})}));
vi.mock("../repository/paceRepository", () => ({useEndurancePace:()=>({data:[]})}));
vi.mock("../repository/stintsRepository", () => ({useEnduranceStints:()=>({data:mocks.rows}),useEnduranceStintMutations:()=>({upsert:{mutateAsync:mocks.upsert},remove:{mutateAsync:vi.fn()},replaceDraft:{mutateAsync:vi.fn()}})}));
vi.mock("../repository/planRepository", () => ({ useEndurancePlanWorkspace:()=>({data:{versions:[],confirmations:[]}}),useEndurancePlanMutations:()=>({publish:{mutateAsync:mocks.publish},confirm:{mutateAsync:vi.fn()}})}));
const event = { id:"race",startAt:"2026-09-08T12:00:00.000Z",endAt:"2026-09-08T13:00:00.000Z" } as EnduranceEvent;
const row = { id:"s",event_id:"race",team_id:"t",driver_id:"a",original_start_at:event.startAt,original_end_at:event.endAt,actual_start_at:event.startAt,actual_end_at:event.endAt,status:"draft",expected_laps:30,fuel_litres:90,tyre_change:true,double_stint:false,notes:"preserve" };
beforeEach(()=>{mocks.teams=[{id:"t",event_id:"race",name:"Team One",manager_id:"someone-else"}];mocks.rows=[row];mocks.manager=true;mocks.publish.mockReset();mocks.upsert.mockReset();});
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
