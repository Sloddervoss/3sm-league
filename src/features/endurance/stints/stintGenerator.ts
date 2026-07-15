import { makeId } from "../core/actions";
import type { EnduranceEvent, EnduranceState, EnduranceStint } from "../core/types";
import { rangesOverlap } from "../core/selectors";

export const generateStints = (state: EnduranceState, event: EnduranceEvent, teamId: string, tankMinutes: number): EnduranceStint[] => {
  const members = state.teamMembers.filter((member) => member.teamId === teamId && member.role !== "reserve").map((member) => member.userId);
  if (!members.length || tankMinutes < 5) return [];
  const result: EnduranceStint[] = [];
  let cursor = new Date(event.startAt).getTime(); const end = new Date(event.endAt).getTime(); let index = 0;
  while (cursor < end) {
    const stintEnd = Math.min(end, cursor + tankMinutes * 60_000);
    const candidates = members.filter((userId) => state.availability.some((block) => block.eventId === event.id && block.userId === userId && ["available", "preferred"].includes(block.type) && rangesOverlap(block.startAt, block.endAt, new Date(cursor).toISOString(), new Date(stintEnd).toISOString())));
    const driverId = candidates[index % Math.max(1, candidates.length)] ?? members[index % members.length];
    const pace = state.paceEntries.find((entry) => entry.eventId === event.id && entry.userId === driverId)?.averageLapSeconds ?? 130;
    const startAt = new Date(cursor).toISOString(); const endAt = new Date(stintEnd).toISOString();
    result.push({ id: makeId("stint"), eventId: event.id, teamId, driverId, originalStartAt: startAt, originalEndAt: endAt, actualStartAt: startAt, actualEndAt: endAt, expectedLaps: Math.max(1, Math.floor((stintEnd - cursor) / 1000 / pace)), fuelLitres: 102, tyreChange: index % 2 === 1, doubleStint: tankMinutes >= 80, notes: "Automatisch voorstel", status: "draft" });
    cursor = stintEnd; index += 1;
  }
  return result;
};
