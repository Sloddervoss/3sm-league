import type {
  AvailabilityBlock,
  EnduranceEvent,
  EndurancePersona,
  EnduranceRegistration,
  EnduranceState,
  EnduranceStint,
  EnduranceTeam,
  PaceEntry,
} from "./types";

const activeRegistrationStatuses = new Set(["interest", "provisional", "confirmed", "reserve"]);

export const getActivePersona = (state: EnduranceState) =>
  state.personas.find((persona) => persona.id === state.activePersonaId) ?? state.personas[0];

export const getRegistration = (state: EnduranceState, eventId: string, userId: string) =>
  state.registrations.find((registration) => registration.eventId === eventId && registration.userId === userId);

export const hasActiveRegistration = (registration?: EnduranceRegistration) =>
  Boolean(registration && activeRegistrationStatuses.has(registration.status));

export const canSeeEventCard = (state: EnduranceState, event: EnduranceEvent, persona: EndurancePersona) => {
  if (persona.role === "endurance_admin" || event.managerIds.includes(persona.id)) return true;
  if (event.visibility === "open") return true;
  if (event.invitedUserIds.includes(persona.id)) return true;
  return hasActiveRegistration(getRegistration(state, event.id, persona.id));
};

export const canAccessWorkspace = (state: EnduranceState, event: EnduranceEvent, persona: EndurancePersona) => {
  if (persona.role === "endurance_admin" || event.managerIds.includes(persona.id)) return true;
  if (state.teams.some((team) => team.eventId === event.id && team.managerId === persona.id)) return true;
  return hasActiveRegistration(getRegistration(state, event.id, persona.id));
};

export const canManageEvent = (event: EnduranceEvent, persona: EndurancePersona) =>
  persona.role === "endurance_admin" || event.managerIds.includes(persona.id);

export const canManageTeam = (state: EnduranceState, team: EnduranceTeam, persona: EndurancePersona) => {
  const event = state.events.find((candidate) => candidate.id === team.eventId);
  return persona.role === "endurance_admin" || Boolean(event?.managerIds.includes(persona.id)) || team.managerId === persona.id;
};

export const paceConfidence = (entry: PaceEntry): "Hoog" | "Gemiddeld" | "Laag" => {
  const ageDays = Math.max(0, (Date.now() - new Date(entry.recordedAt).getTime()) / 86_400_000);
  if (entry.validLaps >= 40 && ageDays <= 90) return "Hoog";
  if (entry.validLaps >= 12 && ageDays <= 180) return "Gemiddeld";
  return "Laag";
};

export const paceScore = (entry: PaceEntry) => {
  const consistency = Math.max(0, 100 - entry.consistencySeconds * 16);
  const incidentScore = Math.max(0, 100 - (entry.incidents / Math.max(1, entry.validLaps)) * 1000);
  const dataScore = Math.min(100, entry.validLaps * 2.5);
  return Math.round(consistency * 0.45 + incidentScore * 0.2 + dataScore * 0.35);
};

export const formatLapTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
};

export const formatAmsterdam = (iso: string, options: Intl.DateTimeFormatOptions = {}) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(date);
}

export const rangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();

export const availabilityForStint = (blocks: AvailabilityBlock[], stint: EnduranceStint) => {
  const matching = blocks.filter((block) => block.userId === stint.driverId && rangesOverlap(block.startAt, block.endAt, stint.actualStartAt, stint.actualEndAt));
  if (matching.some((block) => block.type === "unavailable")) return "hard" as const;
  if (matching.some((block) => block.type === "uncertain" || block.type === "avoid")) return "soft" as const;
  if (matching.some((block) => block.type === "available" || block.type === "preferred")) return "covered" as const;
  return "missing" as const;
};

export interface PlanningWarning { id: string; level: "hard" | "soft"; message: string; stintId?: string }

export const planningWarnings = (state: EnduranceState, eventId: string, teamId?: string): PlanningWarning[] => {
  const stints = state.stints
    .filter((stint) => stint.eventId === eventId && (!teamId || stint.teamId === teamId))
    .sort((a, b) => a.actualStartAt.localeCompare(b.actualStartAt));
  const warnings: PlanningWarning[] = [];

  stints.forEach((stint, index) => {
    const availability = availabilityForStint(state.availability.filter((block) => block.eventId === eventId), stint);
    if (availability === "hard") warnings.push({ id: `unavailable-${stint.id}`, level: "hard", message: "Coureur is niet beschikbaar tijdens deze stint.", stintId: stint.id });
    if (availability === "soft" || availability === "missing") warnings.push({ id: `uncertain-${stint.id}`, level: "soft", message: availability === "missing" ? "Geen beschikbaarheid doorgegeven voor deze stint." : "Stint valt in een onzekere of ongewenste periode.", stintId: stint.id });

    stints.slice(index + 1).forEach((other) => {
      if (other.driverId === stint.driverId && rangesOverlap(stint.actualStartAt, stint.actualEndAt, other.actualStartAt, other.actualEndAt)) {
        warnings.push({ id: `overlap-${stint.id}-${other.id}`, level: "hard", message: "Coureur is dubbel ingepland.", stintId: stint.id });
      }
    });
  });

  const event = state.events.find((candidate) => candidate.id === eventId);
  if (event && stints.length) {
    const first = stints[0];
    const last = stints[stints.length - 1];
    if (new Date(first.actualStartAt).getTime() > new Date(event.startAt).getTime()) warnings.push({ id: "start-gap", level: "hard", message: "De race-start is niet gedekt." });
    if (new Date(last.actualEndAt).getTime() < new Date(event.endAt).getTime()) warnings.push({ id: "finish-gap", level: "hard", message: "De race-finish is niet gedekt." });
    for (let index = 1; index < stints.length; index += 1) {
      if (new Date(stints[index].actualStartAt).getTime() > new Date(stints[index - 1].actualEndAt).getTime()) warnings.push({ id: `gap-${index}`, level: "hard", message: "Er zit een ongedekt tijdvak in de planning." });
    }
  }
  return warnings;
};

export const teamCoveragePercent = (state: EnduranceState, event: EnduranceEvent, teamId: string) => {
  const members = state.teamMembers.filter((member) => member.teamId === teamId).map((member) => member.userId);
  const blocks = state.availability.filter((block) => block.eventId === event.id && members.includes(block.userId) && ["available", "preferred"].includes(block.type));
  const raceMinutes = (new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 60_000;
  const covered = blocks.reduce((total, block) => {
    const start = Math.max(new Date(event.startAt).getTime(), new Date(block.startAt).getTime());
    const end = Math.min(new Date(event.endAt).getTime(), new Date(block.endAt).getTime());
    return total + Math.max(0, (end - start) / 60_000);
  }, 0);
  return Math.min(100, Math.round((covered / Math.max(1, raceMinutes)) * 100));
};
