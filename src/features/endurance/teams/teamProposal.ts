import { makeId } from "../core/actions";
import type { EnduranceState, EnduranceTeam, TeamMember } from "../core/types";

export type ProposalMode = "pace_groups" | "balanced";

export const proposeTeams = (state: EnduranceState, eventId: string, teams: EnduranceTeam[], mode: ProposalMode): TeamMember[] => {
  if (teams.length === 0) return [];
  const drivers = state.registrations.filter((registration) => registration.eventId === eventId && ["confirmed", "provisional"].includes(registration.status)).map((registration) => registration.userId);
  const pace = (userId: string) => state.paceEntries.filter((entry) => entry.eventId === eventId && entry.userId === userId).sort((a, b) => a.averageLapSeconds - b.averageLapSeconds)[0]?.averageLapSeconds ?? Number.POSITIVE_INFINITY;
  const sorted = [...drivers].sort((a, b) => pace(a) - pace(b) || a.localeCompare(b));
  const assignments = new Map<string, string[]>(); teams.forEach((team) => assignments.set(team.id, []));
  if (mode === "pace_groups") {
    sorted.forEach((userId, index) => { const teamIndex = Math.min(teams.length - 1, Math.floor(index / Math.ceil(sorted.length / teams.length))); assignments.get(teams[teamIndex].id)!.push(userId); });
  } else {
    sorted.forEach((userId, index) => { const cycle = Math.floor(index / teams.length); const position = index % teams.length; const teamIndex = cycle % 2 === 0 ? position : teams.length - 1 - position; assignments.get(teams[teamIndex].id)!.push(userId); });
  }
  return teams.flatMap((team) => assignments.get(team.id)!.map((userId) => ({ id: makeId("team-member"), teamId: team.id, userId, role: team.managerId === userId ? "manager" as const : "driver" as const })));
};
