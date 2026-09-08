import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RaceControlPanel } from "@/features/endurance/race-control/RaceControlPanel";
import type { EnduranceEvent } from "@/features/endurance/core/types";
const state = vi.hoisted(() => ({ userId: "racer", team: { id: "team", name: "Team One", manager_id: "manager" } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock("@/features/endurance/core/ActorContext", () => ({ useEnduranceActor: () => ({ displayName: () => "Current driver" }) }));
vi.mock("@/features/endurance/repository/teamsRepository", () => ({ useEnduranceTeamWorkspace: () => ({ data: { teams: [state.team], members: [] } }) }));
vi.mock("@/features/endurance/repository/stintsRepository", () => ({
 useEnduranceStints: () => ({ data: [{ id: "stint", eventId: "race", teamId: "team", driverId: "racer", status: "in_car", actualStartAt: new Date(Date.now()-60000).toISOString(), originalStartAt: new Date(Date.now()-60000).toISOString(), actualEndAt: new Date(Date.now()+60000).toISOString() }] }),
 useRaceControlAudit: () => ({ data: [] }), useEnduranceStintMutations: () => ({ raceControlApply: { isPending: false } }), RaceControlConflictError: class extends Error {}
}));
vi.mock("@/features/endurance/repository/mappers", () => ({ enduranceStintRowsToAppModels: (rows: unknown) => rows }));
afterEach(cleanup);
const event = { id: "race", startAt: "2020-01-01T12:00:00Z", endAt: new Date(Date.now()+3600000).toISOString() } as EnduranceEvent;
it("lets racers view the live stint without manager controls", () => {
 state.userId = "racer";
 render(<RaceControlPanel event={event} selectedTeamId="team" embedded />);
 expect(screen.getByText("Current driver")).toBeInTheDocument();
 expect(screen.queryByRole("button", { name: "Stint beëindigen" })).not.toBeInTheDocument();
 expect(screen.getByRole("checkbox", { name: "Live tijd volgen" })).toBeChecked();
});
it("retains correction controls for the team manager", () => {
 state.userId = "manager";
 render(<RaceControlPanel event={event} selectedTeamId="team" embedded />);
 expect(screen.getByRole("button", { name: "Stint beëindigen" })).toBeInTheDocument();
 expect(screen.getByText("Handmatige correcties")).toBeInTheDocument();
});
