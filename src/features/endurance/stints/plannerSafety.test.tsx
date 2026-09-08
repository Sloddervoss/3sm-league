import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { generateStints } from "./stintGenerator";
import { runOptimize } from "./jresOptimizer";
import { validatePlan } from "./planValidation";
import { stintEditPayload } from "./stintEdits";
import { StintTimeline } from "./StintTimeline";
import { coversAvailability } from "../core/availabilityCoverage";
import type { EnduranceEvent, EnduranceStint, AvailabilityBlock } from "../core/types";
import type { EnduranceStintRow } from "../repository/stintsRepository";
const event = { id: "race", startAt: "2026-09-08T12:00:00.000Z", endAt: "2026-09-08T14:00:00.000Z" } as EnduranceEvent;
const state = { availability: [] as AvailabilityBlock[], paceEntries: [], teamMembers: ["a","b"].map(userId => ({ id: userId, userId, teamId: "t", role: "driver" as const })) };
const stint = { id: "s", eventId: "race", teamId: "t", driverId: "a", actualStartAt: event.startAt, actualEndAt: "2026-09-08T13:00:00.000Z", status: "draft" } as EnduranceStint;
const block = (type: AvailabilityBlock["type"], startAt=event.startAt, endAt=event.endAt) => ({ id: "av", eventId: "race", userId: "a", type, startAt, endAt, note: "" });
afterEach(cleanup);
describe("planner safety", () => {
 it("preserves all metadata and status in a partial edit", () => {
  const row = { id: "s", event_id: "race", team_id: "t", driver_id: "a", original_start_at: event.startAt, original_end_at: event.endAt, actual_start_at: event.startAt, actual_end_at: event.endAt, expected_laps: 42, fuel_litres: 96, tyre_change: true, double_stint: true, notes: "Keep tyres", status: "confirmed" } as EnduranceStintRow;
  expect(stintEditPayload(row, { driver_id: "b" })).toEqual({ ...row, driver_id: "b" });
 });
 it("requires full availability and gives explicit exclusions priority", () => {
  expect(coversAvailability([block("available", event.startAt, "2026-09-08T12:10:00.000Z")], "a", stint.actualStartAt, stint.actualEndAt)).toBe(false);
  expect(coversAvailability([block("available"), block("unavailable")], "a", stint.actualStartAt, stint.actualEndAt)).toBe(false);
  expect(coversAvailability([], "a", stint.actualStartAt, stint.actualEndAt)).toBe(true);
 });
 it("combines adjacent positive windows", () => {
  expect(coversAvailability([block("available",event.startAt,stint.actualEndAt),block("preferred",stint.actualEndAt,event.endAt)],"a",event.startAt,event.endAt)).toBe(true);
 });
 it("refuses to fabricate a plan when all drivers are unavailable", () => {
  expect(() => generateStints({ ...state, availability: [block("unavailable"), { ...block("unavailable"), userId: "b" }] }, event, "t", 60)).toThrow(/Geen geldige coureur/);
 });
 it("refuses insufficient rest or exhausted total driving limits", () => {
  const race = { ...event, endAt: "2026-09-08T18:00:00.000Z" };
  expect(() => generateStints(state,race,"t",60,{driverLimits:{a:{minRestMinutes:120},b:{minRestMinutes:120}}})).toThrow();
  expect(() => generateStints(state,race,"t",60,{driverLimits:{a:{maxTotalMinutes:60},b:{maxTotalMinutes:60}}})).toThrow();
 });
 it("keeps 45 minute tanks and partial race boundaries exact without calling the hourly solver", async () => {
  const race = { ...event, startAt: "2026-09-08T12:30:00.000Z", endAt: "2026-09-08T14:30:00.000Z" };
  const fetcher = vi.fn();
  const result = await runOptimize(state,race,["a","b"],"t",{tankMinutes:45},fetcher);
  expect(result.ok).toBe(true); expect(fetcher).not.toHaveBeenCalled();
  expect(result.stints[0].actualStartAt).toBe(race.startAt); expect(result.stints.at(-1)?.actualEndAt).toBe(race.endAt);
  for(const s of result.stints) expect((Date.parse(s.actualEndAt)-Date.parse(s.actualStartAt))/60000).toBeLessThanOrEqual(45);
 });
 it("rejects optimizer output with incomplete coverage or invalid drivers", async () => {
  const fetcher = vi.fn(async () => ({status:"ok",output:{schedule:[{ id:1, driver:"unknown",startTime:event.startAt,endTime:stint.actualEndAt }]}}));
  const result = await runOptimize(state,event,["a","b"],"t",{tankMinutes:60},fetcher);
  expect(result.ok).toBe(false); expect(result.stints).toEqual([]);
 });
 it("blocks car overlap, out-of-race times and individual limits", () => {
  const overlapping = [{...stint,actualEndAt:event.endAt},{...stint,id:"s2",driverId:"b",actualEndAt:event.endAt}];
  expect(validatePlan(state,event,overlapping,["a","b"])).toContain("Deze auto heeft overlappende stints.");
  expect(validatePlan(state,event,[{...stint,actualStartAt:"2026-09-08T11:00:00.000Z"}],["a"])).toContain("Stint valt buiten de race of heeft een ongeldige duur.");
  expect(validatePlan(state,event,[{...stint,actualEndAt:event.endAt}],["a"],{a:{maxStintMinutes:45}})).toContain("Een stint overschrijdt de tankduur of rijlimiet.");
 });
 it("keeps a night stint on its chosen date", () => {
  const night = {...stint,actualStartAt:"2026-09-09T01:00:00.000Z",actualEndAt:"2026-09-09T02:00:00.000Z"};
  const onMove = vi.fn();
  render(<StintTimeline event={{...event,endAt:"2026-09-09T12:00:00.000Z"}} stints={[night]} personas={[]} availability={[]} editable snapMinutes={15} onMove={onMove} onResize={vi.fn()} onDelete={vi.fn()} onCopy={vi.fn()} onExtend={vi.fn()} onAssign={vi.fn()} onResizeEdge={vi.fn()} />);
  fireEvent.click(screen.getByRole("button",{name:/a ·/}));
  fireEvent.change(screen.getByLabelText("Stint starttijd"),{target:{value:"2026-09-09T03:15"}});
  expect(onMove).toHaveBeenCalledWith(night,"2026-09-09T01:15:00.000Z");
 });
 it("moves across driver lanes with one combined write", () => {
  const onMove=vi.fn(), onAssign=vi.fn();
  const view=render(<StintTimeline event={event} stints={[stint]} personas={[{id:"a",name:"A",role:"driver",timezone:"Europe/Amsterdam"},{id:"b",name:"B",role:"driver",timezone:"Europe/Amsterdam"}]} availability={[]} editable snapMinutes={15} onMove={onMove} onResize={vi.fn()} onDelete={vi.fn()} onCopy={vi.fn()} onExtend={vi.fn()} onAssign={onAssign} onResizeEdge={vi.fn()} />);
  const lanes=view.container.querySelectorAll('.relative.h-16');
  vi.spyOn(lanes[1],"getBoundingClientRect").mockReturnValue({left:0,width:100} as DOMRect);
  const drop = new MouseEvent("drop", { bubbles:true, clientX:25 });
  Object.defineProperty(drop,"dataTransfer",{value:{getData:()=>"s"}});
  fireEvent(lanes[1],drop);
  expect(onAssign).not.toHaveBeenCalled(); expect(onMove).toHaveBeenCalledTimes(1);
  expect(onMove.mock.calls[0][2]).toBe("b");
 });
});
