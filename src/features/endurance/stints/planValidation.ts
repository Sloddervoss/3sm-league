import type { EnduranceEvent, EnduranceStint, StintPlanningState } from "../core/types";
import type { DriverLimits } from "./stintGenerator";
import { planningWarnings } from "../core/selectors";

export function validatePlan(state: Pick<StintPlanningState, "availability">, event: EnduranceEvent, stints: EnduranceStint[], members: string[], limits: Record<string, DriverLimits> = {}, tankMinutes = Infinity): string[] {
  const errors = planningWarnings({ events: [event], availability: state.availability, stints }, event.id).filter(w => w.level === "hard").map(w => w.message);
  if (!stints.length) errors.push("De planning bevat geen stints.");
  const stintCounts: Record<string, number> = {};
  const totals: Record<string, number> = {}, lastEnd: Record<string, number> = {};
  let previous = "", count = 0;
  for (const stint of [...stints].sort((a,b) => Date.parse(a.actualStartAt)-Date.parse(b.actualStartAt))) {
    const id = stint.driverId, l = limits[id] ?? {};
    const start = Date.parse(stint.actualStartAt), end = Date.parse(stint.actualEndAt), minutes = (end-start)/60000;
    if (!members.includes(id)) errors.push("Een stint heeft geen geldige teamcoureur.");
    if (minutes > Math.min(tankMinutes, l.maxStintMinutes ?? Infinity)) errors.push("Een stint overschrijdt de tankduur of rijlimiet.");
    stintCounts[id] = (stintCounts[id] ?? 0) + 1;
    if (stintCounts[id] > (l.maxStints ?? Infinity)) errors.push("Een coureur overschrijdt het maximale aantal stints.");
    totals[id] = (totals[id] ?? 0) + minutes;
    if (totals[id] > (l.maxTotalMinutes ?? Infinity)) errors.push("De totale rijtijd overschrijdt een coureurslimiet.");
    if (previous !== id && lastEnd[id] !== undefined && start - lastEnd[id] < (l.minRestMinutes ?? 0)*60000) errors.push("Een coureur heeft onvoldoende rusttijd.");
    count = previous === id && start === lastEnd[id] ? count + 1 : 1;
    if (count > (l.maxConsecutiveStints ?? Infinity)) errors.push("Een coureur heeft te veel stints achter elkaar.");
    previous = id; lastEnd[id] = end;
  }
  return [...new Set(errors)];
}
