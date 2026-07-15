import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "../core/seed";
import { proposeTeams } from "./teamProposal";

describe("team proposals", () => {
  it("groups nearest pace drivers together", () => {
    const state = createEnduranceSeed(); const teams = state.teams.filter((team) => team.eventId === state.events[0].id);
    const members = proposeTeams(state, state.events[0].id, teams, "pace_groups");
    expect(members).toHaveLength(3);
    expect(members.filter((member) => member.teamId === teams[0].id).map((member) => member.userId)).toContain("user-jaimy");
  });
  it("distributes drivers across teams in balanced mode", () => {
    const state = createEnduranceSeed(); const teams = state.teams.filter((team) => team.eventId === state.events[0].id);
    const members = proposeTeams(state, state.events[0].id, teams, "balanced");
    expect(new Set(members.map((member) => member.teamId)).size).toBe(2);
  });
});
