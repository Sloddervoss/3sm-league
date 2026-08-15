import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "../core/seed";
import { generateStints } from "./stintGenerator";
import type { EnduranceState, EnduranceStint } from "../core/types";

// Bouw een staat met een team van EXACT 3 coureurs (geen availability-blokken,
// geen limieten) om te controleren dat de generator ALLE drie gebruikt.
const buildThreeDriverState = (): EnduranceState => {
  const base = createEnduranceSeed();
  const { eventId } = base.events[0];
  const teamId = "team-3drv";
  const drivers = ["u-a", "u-b", "u-c"];
  return {
    ...base,
    events: [{ ...base.events[0], startAt: "2026-07-25T10:00:00.000Z", endAt: "2026-07-25T22:00:00.000Z" }],
    teams: [
      { id: teamId, eventId, name: "3-Driver", carId: "porsche-911-gt3-r-992", carNumber: "3", managerId: "u-a", livery: "x" },
    ],
    teamMembers: drivers.map((d) => ({ id: `tm-${d}`, teamId, userId: d, role: "driver" })),
    availability: [],
    stints: [],
    registrations: drivers.map((d) => ({ ...base.registrations[0], id: `reg-${d}`, userId: d })),
    paceEntries: [],
    planningVersions: [],
    confirmations: [],
  };
};

describe("stint generator — 3-man team", () => {
  it("pakt ALLE drie coureurs over een lange race (fair-share rouleert)", () => {
    const state = buildThreeDriverState();
    const stints = generateStints(state, state.events[0], "team-3drv", 90);
    const used = new Set(stints.map((s) => s.driverId));
    expect(stints.length).toBeGreaterThan(0);
    expect([...used].sort()).toEqual(["u-a", "u-b", "u-c"]);
    // voortdurend wisselen: nooit dezelfde coureur in twee opeenvolgende stints.
    for (let i = 1; i < stints.length; i++) {
      expect(stints[i].driverId).not.toBe(stints[i - 1].driverId);
    }
  });
});