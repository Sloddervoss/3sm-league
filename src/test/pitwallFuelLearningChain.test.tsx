import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PitwallTab } from "@/features/endurance/pitwall/PitwallTab";
import type { EnduranceEvent } from "@/features/endurance/core/types";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), learning: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isSuperAdmin: true }) }));
vi.mock("@/features/endurance/core/ActorContext", () => ({ useEnduranceActor: () => ({ actorId: "owner", displayName: (id: string) => id }) }));
vi.mock("@/features/endurance/repository/pitwallRepository", () => ({
 listPitwallTeams: async () => [{ id: "team", name: "Team" }],
 fetchPitwallData: (...args: unknown[]) => mocks.fetch(...args),
 fetchPersonalFuelLearning: (...args: unknown[]) => mocks.learning(...args),
}));
vi.mock("@/features/endurance/pitwall/DecisionBand", () => ({ DecisionBand: ({ advice }: {advice: {fuel: {perLap: number | null}}}) => <output data-testid="real-advice">{advice?.fuel?.perLap ?? "none"}</output> }));
let client: QueryClient;
function response() {
 const now=Date.now();
 return { team:{id:"team",name:"Team"}, telemetry:{received_at:new Date(now).toISOString()},strategy:{},timeline:[],planned_stints:[],
  v3_normalized:{capturedAt:new Date(now).toISOString(),transportSessionId:"simhub-current",identity:{currentDriverId:"12345",carId:"1321",trackId:42,trackConfig:"Endurance"},fuel:{fuelLitres:50,fuelPerLapLitres:3,fuelCapacityLitres:100},timing:{completedLaps:5},session:{sessionTimeRemainingSeconds:3600}} };
}
function envelope() {const now=Date.now(); return {knownModelVersions:["fuel-known-v1"],scope:{driver:"12345",car:"1321",track:42,layout:"Endurance"},transportSessionId:"simhub-current",contribution:{schemaVersion:1,target:"fuel",state:"active",unit:"L/lap",corner:null,modelVersion:"fuel-known-v1",featureVersion:"previous-complete-lap-v1",policyVersion:"personal-fuel-v1",trainedThrough:new Date(now-60000).toISOString(),sourceObservedAt:new Date(now-1000).toISOString(),sourceFrameSequence:null,estimate:3.2,lower:3.1,upper:3.3,independentSessions:20,independentSets:null,contextMatch:true,decisive:true,reasonCodes:[]}};}
function mount() {client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/endurance/races/race"]}><PitwallTab event={{id:"race",name:"Race"} as EnduranceEvent}/></MemoryRouter></QueryClientProvider>);}
afterEach(()=>{cleanup();client?.clear();});
beforeEach(()=>{mocks.fetch.mockReset().mockImplementation(async()=>response());mocks.learning.mockReset().mockResolvedValue(null);});
describe("normal endurance pitwall learning chain",()=>{
 it("carries an authorized contribution from the real data hook into the real strategy and normal component",async()=>{
  mocks.learning.mockImplementation(async()=>envelope());mount();
  await waitFor(()=>expect(screen.getByTestId("real-advice")).toHaveTextContent("3.3"));
  expect(mocks.learning).toHaveBeenCalledWith("race","team");
 });
 it.each(["absent","denied","context-mismatch"])("preserves measured baseline when %s",async kind=>{
  if(kind==="denied")mocks.learning.mockRejectedValue(new Error("permission denied"));
  if(kind==="context-mismatch")mocks.learning.mockImplementation(async()=>({...envelope(),transportSessionId:"wrong"}));
  mount();await waitFor(()=>expect(mocks.learning).toHaveBeenCalled());
  await waitFor(()=>expect(screen.getByTestId("real-advice")).toHaveTextContent("3"));
 });
 it("does not block telemetry or baseline while optional learning never responds",async()=>{
  mocks.learning.mockImplementation(()=>new Promise(()=>{}));mount();
  await waitFor(()=>expect(mocks.learning).toHaveBeenCalled());
  expect(screen.getByTestId("real-advice")).toHaveTextContent("3");
 });
 it("does not request personal learning with stale telemetry",async()=>{
  mocks.fetch.mockImplementation(async()=>({...response(),telemetry:{received_at:new Date(Date.now()-60000).toISOString()}}));mount();
  await waitFor(()=>expect(mocks.fetch).toHaveBeenCalled());expect(mocks.learning).not.toHaveBeenCalled();
 });
});
