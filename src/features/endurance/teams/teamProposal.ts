import type { AvailabilityBlock, EnduranceEvent } from "../core/types";
import { getEnduranceCar } from "../core/carCatalog";
import { coversAvailability } from "../core/availabilityCoverage";
import type { EnduranceRegistrationRow } from "../repository/registrationsRepository";
import type { EndurancePaceRow } from "../repository/paceRepository";
import { generateStints, type DriverLimits } from "../stints/stintGenerator";
import { validatePlan } from "../stints/planValidation";

export type TeamApproach = "competitive" | "fun" | "either";
export const approachLabels: Record<TeamApproach, string> = { competitive: "Competitief", fun: "Fun", either: "Maakt mij niet uit" };
export type TeamDraft = { name: string; capacity: number; approach: TeamApproach; userIds: string[] };
export type PaceSample = { seconds: number; laps: number; source: string; recordedAt: string };

/** One representative, comparable run per driver. Never add cumulative practice snapshots. */
export function comparablePace(event: EnduranceEvent, rows: EndurancePaceRow[], conditions = "dry", minLaps = 10): Map<string, PaceSample> {
  const car = getEnduranceCar(event.selectedCarId);
  const result = new Map<string, PaceSample>();
  if (!event.selectedCarId) return result;
  const eligible = rows.filter(p => p.event_id === event.id && p.circuit === event.circuit && p.configuration === event.configuration
    && [event.selectedCarId, car?.name].includes(p.car) && p.conditions === conditions
    && Number.isFinite(p.average_lap_seconds) && (p.average_lap_seconds ?? 0) > 0 && (p.valid_laps ?? 0) >= minLaps);
  // Prefer recorded practice; use the latest eligible run within each source.
  eligible.sort((a, b) => Number(b.source === "practice") - Number(a.source === "practice") || Date.parse(b.recorded_at) - Date.parse(a.recorded_at) || a.id.localeCompare(b.id));
  for (const p of eligible) if (!result.has(p.user_id)) result.set(p.user_id, { seconds: p.average_lap_seconds!, laps: p.valid_laps!, source: p.source, recordedAt: p.recorded_at });
  return result;
}

export function registrationLimits(registrations: EnduranceRegistrationRow[]): Record<string, DriverLimits> {
  return Object.fromEntries(registrations.map(r => [r.user_id, {
    maxStints: r.max_stints, maxStintMinutes: r.max_stint_minutes, maxTotalMinutes: r.max_total_minutes,
    maxConsecutiveStints: r.max_consecutive_stints, minRestMinutes: r.min_rest_minutes, willingToStart: r.willing_to_start,
  }]));
}

export function assessTeam(event: EnduranceEvent, ids: string[], registrations: EnduranceRegistrationRow[], availability: AvailabilityBlock[], tankMinutes = 90) {
  const missingAvailability = ids.filter(id => !availability.some(a => a.userId === id));
  const missingRegistration = ids.filter(id => !registrations.some(r => r.user_id === id && ["provisional", "confirmed"].includes(r.status)));
  const duration = (Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000;
  const limits = registrationLimits(registrations);
  const capacityMinutes = ids.reduce((sum, id) => sum + Math.min(duration, limits[id]?.maxTotalMinutes ?? duration,
    (limits[id]?.maxStints ?? Infinity) * Math.min(tankMinutes, limits[id]?.maxStintMinutes ?? tankMinutes)), 0);
  const boundaries = [...new Set([Date.parse(event.startAt), Date.parse(event.endAt), ...availability.filter(a => ids.includes(a.userId)).flatMap(a => [Date.parse(a.startAt), Date.parse(a.endAt)])])]
    .filter(t => t >= Date.parse(event.startAt) && t <= Date.parse(event.endAt)).sort((a,b) => a-b);
  let uncoveredMinutes = 0;
  for (let i = 1; i < boundaries.length; i++) {
    if (!ids.some(id => coversAvailability(availability, id, new Date(boundaries[i-1]).toISOString(), new Date(boundaries[i]).toISOString()))) uncoveredMinutes += (boundaries[i]-boundaries[i-1])/60000;
  }
  let planningIssue = "";
  if (ids.length && !missingRegistration.length) {
    try {
      const state = { availability, paceEntries: [], teamMembers: ids.map(id => ({ id, userId: id, teamId: "preview", role: "driver" as const })) };
      const stints = generateStints(state, event, "preview", tankMinutes, { mode: "comfort", driverLimits: limits });
      planningIssue = validatePlan(state, event, stints, ids, limits, tankMinutes).join(" ");
    } catch { planningIssue = "Nog geen sluitend stintvoorstel gevonden. Controleer beschikbaarheid en rij- en rustlimieten."; }
  }
  const issues: string[] = [];
  if (!ids.length) issues.push("Voeg coureurs toe aan dit team.");
  if (missingRegistration.length) issues.push(`${missingRegistration.length} coureur(s) zonder actieve deelname.`);
  if (capacityMinutes < duration) issues.push(`${Math.ceil((duration-capacityMinutes)/60 * 10)/10} uur rijcapaciteit tekort.`);
  if (uncoveredMinutes > 0) issues.push(`${Math.ceil(uncoveredMinutes/60 * 10)/10} uur zonder beschikbare coureur.`);
  if (planningIssue && !issues.length) issues.push(planningIssue);
  if (missingAvailability.length) issues.push(`${missingAvailability.length} coureur(s) hebben hun beschikbaarheid nog niet ingevuld.`);
  return { issues, missingAvailability, capacityMinutes, uncoveredMinutes, ready: issues.length === 0 };
}

/** Adjacent pace groups, balanced remainders, explicit preferences retained. Existing crews stay untouched. */
export function proposeTeams(event: EnduranceEvent, registrations: EnduranceRegistrationRow[], pace: Map<string, PaceSample>, assignedIds: Set<string>, defaultSize: number, availability: AvailabilityBlock[] = []): { teams: TeamDraft[]; pendingIds: string[] } {
  const size = Math.max(1, Math.min(event.maxDriversPerCar, Math.floor(defaultSize)));
  const eligible = registrations.filter(r => ["provisional", "confirmed"].includes(r.status) && !assignedIds.has(r.user_id));
  const pendingIds = eligible.filter(r => !pace.has(r.user_id)).map(r => r.user_id);
  const groups = new Map<string, EnduranceRegistrationRow[]>();
  for (const r of eligible.filter(r => pace.has(r.user_id))) {
    const preferred = r.preferred_team_size ?? size;
    if (preferred > event.maxDriversPerCar) { pendingIds.push(r.user_id); continue; }
    const key = `${r.team_approach ?? "either"}:${preferred}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const teams: TeamDraft[] = [];
  for (const [key, drivers] of groups) {
    const [approach, capacityText] = key.split(":");
    const capacity = Number(capacityText);
    drivers.sort((a,b) => pace.get(a.user_id)!.seconds - pace.get(b.user_id)!.seconds || a.user_id.localeCompare(b.user_id));
    const count = Math.ceil(drivers.length / capacity), base = Math.floor(drivers.length/count), remainder = drivers.length % count;
    let offset = 0;
    for (let i=0; i<count; i++) {
      const length = base + Number(i < remainder);
      teams.push({ name: `Team ${teams.length+1}`, capacity, approach: approach as TeamApproach, userIds: drivers.slice(offset, offset+length).map(r => r.user_id) });
      offset += length;
    }
  }
  // Bounded local improvement: exchange similarly paced drivers only when it
  // improves available driving hours/coverage. Never trade away a preference.
  const duration = (Date.parse(event.endAt)-Date.parse(event.startAt))/60000;
  const cost = (ids:string[]) => {
    const a = assessTeam(event,ids,registrations,availability);
    return Math.max(0,duration-a.capacityMinutes) + a.uncoveredMinutes + (a.issues.length ? 1 : 0);
  };
  let attempts = 0;
  for (let i=0;i<teams.length;i++) for(let j=i+1;j<teams.length;j++) {
    const a=teams[i], b=teams[j];
    if(a.approach!==b.approach || a.capacity!==b.capacity) continue;
    let current=cost(a.userIds)+cost(b.userIds);
    for(let x=0;x<a.userIds.length;x++) for(let y=0;y<b.userIds.length;y++) {
      if (++attempts>200) return {teams,pendingIds};
      if(Math.abs(pace.get(a.userIds[x])!.seconds-pace.get(b.userIds[y])!.seconds)>0.5) continue;
      const nextA=[...a.userIds],nextB=[...b.userIds];
      [nextA[x],nextB[y]]=[nextB[y],nextA[x]];
      const nextCost=cost(nextA)+cost(nextB);
      if(nextCost<current) {a.userIds=nextA;b.userIds=nextB;current=nextCost;}
    }
  }
  return { teams, pendingIds };
}
