import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "../core/seed";
import { generateStints } from "./stintGenerator";
import type { EnduranceState } from "../core/types";

// Reageert Vincents klacht: 4 coureurs waarvan 2 op 'max stints achter elkaar = 2'
// en 2 op '= 1'. Toch kreeg iedereen 2 achter elkaar. Dit test of de max=1
// coureurs (Weijts, Steven) NOOIT 2 stints achter elkaar rijden.
const U_RICKY = "3cf38c92-5e18-4e1b-925a-4256f17354ae"; // mgr, max=2
const U_DEVOS = "103daeb3-9f46-4d79-a0a1-c460e43ed3b7"; // max=2
const U_WEIJTS = "f1ed993f-5eaa-4740-818e-18a737bcce9f"; // max=1
const U_STEVEN = "31bae271-ccc3-4012-8f20-534677e724ad"; // max=1

const build = (hours = 24) => {
  const base = createEnduranceSeed();
  const teamId = "team-4drv";
  const event = {
    ...base.events[0],
    startAt: "2026-08-22T07:00:00.000Z",
    endAt: new Date(new Date("2026-08-22T07:00:00.000Z").getTime() + hours * 3600_000).toISOString(),
  };
  const members = [U_RICKY, U_DEVOS, U_WEIJTS, U_STEVEN].map((u) => ({ id: `tm-${u}`, teamId, userId: u, role: "driver" as const }));
  const state: EnduranceState = {
    ...base,
    events: [event],
    teams: [{ id: teamId, eventId: event.id, name: "4 drv", carId: "x", carNumber: "4", managerId: U_RICKY, livery: "x" }],
    teamMembers: members,
    availability: [],
    stints: [],
    registrations: [],
    paceEntries: [],
    planningVersions: [],
    confirmations: [],
  };
  return { state, event };
};

const LIMITS = {
  [U_RICKY]: { maxConsecutiveStints: 2, willingToStart: true },
  [U_DEVOS]: { maxConsecutiveStints: 2 },
  [U_WEIJTS]: { maxConsecutiveStints: 1 },
  [U_STEVEN]: { maxConsecutiveStints: 1 },
};

// Helper: geef elke stint een opeenvolgende 'run-lengte': 1 = solo, 2 = tweede
// achter elkaar, etc. Een run breekt als de coureur wisselt.
function maxRun(stints: { driverId: string }[]) {
  let maxRun = 1;
  let current = 0;
  let prev: string | null = null;
  for (const s of stints) {
    if (s.driverId === prev) {
      current += 1;
      maxRun = Math.max(maxRun, current);
    } else {
      current = 1;
      prev = s.driverId;
    }
  }
  return maxRun;
}

describe("max-achter-elkaar respecteren per coureur (4 rijders, 2x max2 + 2x max1)", () => {
  const { state, event } = build(24);
  const stints = generateStints(state, event, "team-4drv", 90, { mode: "race", driverLimits: LIMITS });
  console.log("totaal:", stints.length, "runs:", JSON.stringify(stints.map((s) => s.driverId.slice(0, 6))));

  it("geeft een geldige planning met alle coureurs", () => {
    expect(stints.length).toBeGreaterThan(0);
    const used = new Set(stints.map((s) => s.driverId));
    expect([...used].sort()).toEqual([U_RICKY, U_DEVOS, U_WEIJTS, U_STEVEN].sort());
  });

  it("Weijts (max=1) rijdt NOOIT 2 stints achter elkaar", () => {
    for (let i = 1; i < stints.length; i++) {
      expect(stints[i].driverId !== U_WEIJTS || stints[i - 1].driverId !== U_WEIJTS).toBe(true);
    }
  });

  it("Steven (max=1) rijdt NOOIT 2 stints achter elkaar", () => {
    for (let i = 1; i < stints.length; i++) {
      expect(stints[i].driverId !== U_STEVEN || stints[i - 1].driverId !== U_STEVEN).toBe(true);
    }
  });

  it("alkort: max-run over het hele schema is precies 2", () => {
    expect(maxRun(stints)).toBe(2);
  });
});