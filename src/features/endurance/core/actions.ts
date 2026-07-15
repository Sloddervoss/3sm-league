import type {
  AvailabilityBlock,
  EnduranceEvent,
  EnduranceNotification,
  EnduranceRegistration,
  EnduranceState,
  EnduranceStint,
  EnduranceTeam,
  PaceEntry,
  PlanningVersion,
  StintConfirmation,
  TeamMember,
} from "./types";
import { canManageEvent, canManageTeam } from "./selectors";
import { enduranceCarsForClass, getEnduranceCar, type EnduranceClassId } from "./carCatalog";
import { isWinningVehicleSelection } from "./vehicleVoting";

export const makeId = (prefix: string) => `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

export type EnduranceAction =
  | { type: "set_active_persona"; personaId: string }
  | { type: "create_event"; event: EnduranceEvent }
  | { type: "update_event"; event: EnduranceEvent }
  | { type: "select_event_vehicle"; eventId: string; classId: EnduranceClassId; carId: string }
  | { type: "upsert_registration"; registration: EnduranceRegistration }
  | { type: "remove_registration"; eventId: string; userId: string }
  | { type: "add_availability"; block: AvailabilityBlock }
  | { type: "update_availability"; block: AvailabilityBlock }
  | { type: "delete_availability"; id: string }
  | { type: "add_pace_entry"; entry: PaceEntry }
  | { type: "create_team"; team: EnduranceTeam }
  | { type: "assign_team_member"; member: TeamMember }
  | { type: "remove_team_member"; teamId: string; userId: string }
  | { type: "replace_team_members"; eventId: string; members: TeamMember[] }
  | { type: "upsert_stint"; stint: EnduranceStint }
  | { type: "delete_stint"; id: string }
  | { type: "replace_team_stints"; eventId: string; teamId: string; stints: EnduranceStint[] }
  | { type: "publish_plan"; version: PlanningVersion; confirmations: StintConfirmation[]; notifications: EnduranceNotification[] }
  | { type: "restore_plan"; versionId: string }
  | { type: "confirm_plan"; eventId: string; versionId: string; userId: string; status: StintConfirmation["status"]; note: string; updatedAt: string }
  | { type: "adjust_future_stints"; eventId: string; teamId: string; fromAt: string; deltaMinutes: number }
  | { type: "complete_stint"; stintId: string; completedAt: string }
  | { type: "add_notification"; notification: EnduranceNotification }
  | { type: "mark_notification_read"; id: string };

export const isEnduranceActionAllowed = (state: EnduranceState, action: EnduranceAction) => {
  const actor = state.personas.find((persona) => persona.id === state.activePersonaId);
  if (!actor) return false;
  const event = (eventId: string) => state.events.find((candidate) => candidate.id === eventId);
  const managesEvent = (eventId: string) => {
    const target = event(eventId);
    return Boolean(target && canManageEvent(target, actor));
  };
  const managesTeam = (teamId: string) => {
    const target = state.teams.find((candidate) => candidate.id === teamId);
    return Boolean(target && canManageTeam(state, target, actor));
  };

  switch (action.type) {
    case "set_active_persona": return state.personas.some((persona) => persona.id === action.personaId);
    case "create_event": return (actor.role === "endurance_admin" || actor.role === "race_manager")
      && action.event.classIds.length > 0
      && action.event.classIds.every((classId) => enduranceCarsForClass(classId).length > 0)
      && (!action.event.selectedCarId || getEnduranceCar(action.event.selectedCarId)?.classId === action.event.selectedClassId);
    case "update_event": {
      const current = event(action.event.id);
      return Boolean(current && managesEvent(action.event.id) && current.selectedClassId === action.event.selectedClassId && current.selectedCarId === action.event.selectedCarId);
    }
    case "select_event_vehicle": {
      const target = event(action.eventId);
      const selectedCar = getEnduranceCar(action.carId);
      return Boolean(target && managesEvent(action.eventId) && target.classIds.includes(action.classId) && selectedCar?.classId === action.classId && isWinningVehicleSelection(state.registrations, action.eventId, action.classId, action.carId));
    }
    case "upsert_registration": return action.registration.userId === actor.id || managesEvent(action.registration.eventId);
    case "remove_registration": return action.userId === actor.id || managesEvent(action.eventId);
    case "add_availability":
    case "update_availability": return action.block.userId === actor.id || managesEvent(action.block.eventId);
    case "delete_availability": {
      const block = state.availability.find((candidate) => candidate.id === action.id);
      return Boolean(block && (block.userId === actor.id || managesEvent(block.eventId)));
    }
    case "add_pace_entry": return action.entry.userId === actor.id || managesEvent(action.entry.eventId);
    case "create_team": return managesEvent(action.team.eventId);
    case "assign_team_member": return managesTeam(action.member.teamId);
    case "remove_team_member": return managesTeam(action.teamId);
    case "replace_team_members": return managesEvent(action.eventId) && action.members.every((member) => state.teams.some((team) => team.id === member.teamId && team.eventId === action.eventId));
    case "upsert_stint": return managesTeam(action.stint.teamId);
    case "delete_stint": {
      const stint = state.stints.find((candidate) => candidate.id === action.id);
      return Boolean(stint && managesTeam(stint.teamId));
    }
    case "replace_team_stints": return managesTeam(action.teamId) && action.stints.every((stint) => stint.eventId === action.eventId && stint.teamId === action.teamId);
    case "publish_plan": return managesTeam(action.version.teamId) && action.version.stints.every((stint) => stint.eventId === action.version.eventId && stint.teamId === action.version.teamId);
    case "restore_plan": {
      const version = state.planningVersions.find((candidate) => candidate.id === action.versionId);
      return Boolean(version && managesTeam(version.teamId));
    }
    case "confirm_plan": return action.userId === actor.id;
    case "adjust_future_stints": return managesTeam(action.teamId) && state.teams.some((team) => team.id === action.teamId && team.eventId === action.eventId);
    case "complete_stint": {
      const stint = state.stints.find((candidate) => candidate.id === action.stintId);
      return Boolean(stint && managesTeam(stint.teamId));
    }
    case "add_notification": return action.notification.userId === actor.id || managesEvent(action.notification.eventId);
    case "mark_notification_read": return state.notifications.some((notification) => notification.id === action.id && notification.userId === actor.id);
    default: return false;
  }
};

const addMinutes = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

const coreReduce = (state: EnduranceState, action: EnduranceAction): EnduranceState => {
  switch (action.type) {
    case "set_active_persona": return { ...state, activePersonaId: action.personaId };
    case "create_event": return { ...state, events: [...state.events, action.event] };
    case "update_event": return { ...state, events: state.events.map((event) => event.id === action.event.id ? action.event : event) };
    case "select_event_vehicle": return {
      ...state,
      events: state.events.map((event) => event.id === action.eventId ? { ...event, selectedClassId: action.classId, selectedCarId: action.carId, updatedAt: new Date().toISOString() } : event),
      teams: state.teams.map((team) => team.eventId === action.eventId ? { ...team, carId: action.carId } : team),
    };
    case "upsert_registration": {
      const exists = state.registrations.some((registration) => registration.eventId === action.registration.eventId && registration.userId === action.registration.userId);
      return { ...state, registrations: exists ? state.registrations.map((registration) => registration.eventId === action.registration.eventId && registration.userId === action.registration.userId ? action.registration : registration) : [...state.registrations, action.registration] };
    }
    case "remove_registration": return {
      ...state,
      registrations: state.registrations.filter((registration) => !(registration.eventId === action.eventId && registration.userId === action.userId)),
      teamMembers: state.teamMembers.filter((member) => {
        if (member.userId !== action.userId) return true;
        const team = state.teams.find((candidate) => candidate.id === member.teamId);
        return team?.eventId !== action.eventId;
      }),
    };
    case "add_availability": return { ...state, availability: [...state.availability, action.block] };
    case "update_availability": return { ...state, availability: state.availability.map((block) => block.id === action.block.id ? action.block : block) };
    case "delete_availability": return { ...state, availability: state.availability.filter((block) => block.id !== action.id) };
    case "add_pace_entry": return { ...state, paceEntries: [...state.paceEntries, action.entry] };
    case "create_team": return { ...state, teams: [...state.teams, action.team] };
    case "assign_team_member": return {
      ...state,
      teamMembers: [...state.teamMembers.filter((member) => member.userId !== action.member.userId || state.teams.find((team) => team.id === member.teamId)?.eventId !== state.teams.find((team) => team.id === action.member.teamId)?.eventId), action.member],
    };
    case "remove_team_member": return { ...state, teamMembers: state.teamMembers.filter((member) => !(member.teamId === action.teamId && member.userId === action.userId)) };
    case "replace_team_members": {
      const eventTeamIds = new Set(state.teams.filter((team) => team.eventId === action.eventId).map((team) => team.id));
      return { ...state, teamMembers: [...state.teamMembers.filter((member) => !eventTeamIds.has(member.teamId)), ...action.members] };
    }
    case "upsert_stint": {
      const exists = state.stints.some((stint) => stint.id === action.stint.id);
      return { ...state, stints: exists ? state.stints.map((stint) => stint.id === action.stint.id ? action.stint : stint) : [...state.stints, action.stint] };
    }
    case "delete_stint": return { ...state, stints: state.stints.filter((stint) => stint.id !== action.id) };
    case "replace_team_stints": return { ...state, stints: [...state.stints.filter((stint) => !(stint.eventId === action.eventId && stint.teamId === action.teamId)), ...action.stints] };
    case "publish_plan": return {
      ...state,
      planningVersions: [...state.planningVersions, action.version],
      confirmations: [...state.confirmations.filter((confirmation) => {
        if (confirmation.eventId !== action.version.eventId) return true;
        const previousVersion = state.planningVersions.find((version) => version.id === confirmation.versionId);
        return previousVersion?.teamId !== action.version.teamId;
      }), ...action.confirmations],
      notifications: [...action.notifications, ...state.notifications],
      stints: state.stints.map((stint) => stint.eventId === action.version.eventId && stint.teamId === action.version.teamId ? { ...stint, status: stint.status === "draft" ? "confirmed" : stint.status } : stint),
    };
    case "restore_plan": {
      const version = state.planningVersions.find((candidate) => candidate.id === action.versionId);
      if (!version) return state;
      return { ...state, stints: [...state.stints.filter((stint) => !(stint.eventId === version.eventId && stint.teamId === version.teamId)), ...version.stints.map((stint) => ({ ...stint }))] };
    }
    case "confirm_plan": {
      const exists = state.confirmations.some((confirmation) => confirmation.eventId === action.eventId && confirmation.versionId === action.versionId && confirmation.userId === action.userId);
      const next: StintConfirmation = { id: exists ? state.confirmations.find((confirmation) => confirmation.eventId === action.eventId && confirmation.versionId === action.versionId && confirmation.userId === action.userId)!.id : makeId("confirm"), eventId: action.eventId, versionId: action.versionId, userId: action.userId, status: action.status, note: action.note, updatedAt: action.updatedAt };
      return { ...state, confirmations: exists ? state.confirmations.map((confirmation) => confirmation.eventId === action.eventId && confirmation.versionId === action.versionId && confirmation.userId === action.userId ? next : confirmation) : [...state.confirmations, next] };
    }
    case "adjust_future_stints": return {
      ...state,
      stints: state.stints.map((stint) => stint.eventId === action.eventId && stint.teamId === action.teamId && new Date(stint.actualStartAt).getTime() >= new Date(action.fromAt).getTime() ? { ...stint, actualStartAt: addMinutes(stint.actualStartAt, action.deltaMinutes), actualEndAt: addMinutes(stint.actualEndAt, action.deltaMinutes) } : stint),
    };
    case "complete_stint": return { ...state, stints: state.stints.map((stint) => stint.id === action.stintId ? { ...stint, actualEndAt: action.completedAt, status: "completed" } : stint) };
    case "add_notification": return { ...state, notifications: [action.notification, ...state.notifications] };
    case "mark_notification_read": return { ...state, notifications: state.notifications.map((notification) => notification.id === action.id ? { ...notification, read: true } : notification) };
    default: return state;
  }
};

const actionMeta = (state: EnduranceState, action: EnduranceAction) => {
  if (action.type === "set_active_persona" || action.type === "mark_notification_read") return null;
  const payload = action as unknown as Record<string, unknown>;
  const entity = (payload.event ?? payload.registration ?? payload.block ?? payload.entry ?? payload.team ?? payload.member ?? payload.stint ?? payload.version ?? payload.notification) as { id?: string; eventId?: string } | undefined;
  return {
    eventId: (payload.eventId as string | undefined) ?? entity?.eventId ?? (entity && "slots" in entity ? entity.id : null) ?? null,
    entityId: entity?.id ?? (payload.id as string | undefined) ?? (payload.stintId as string | undefined) ?? (payload.versionId as string | undefined) ?? null,
    entityType: action.type.split("_").slice(-1)[0],
  };
};

export const reduceEnduranceState = (state: EnduranceState, action: EnduranceAction): EnduranceState => {
  if (!isEnduranceActionAllowed(state, action)) return state;
  const next = coreReduce(state, action);
  if (next === state) return state;
  const meta = actionMeta(state, action);
  if (!meta) return next;
  return {
    ...next,
    auditLog: [{
      id: makeId("audit"),
      eventId: meta.eventId,
      actorId: state.activePersonaId,
      action: action.type,
      entityType: meta.entityType,
      entityId: meta.entityId,
      createdAt: new Date().toISOString(),
      before: null,
      after: action,
    }, ...next.auditLog].slice(0, 500),
  };
};
