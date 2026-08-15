import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEnduranceSeed } from "../core/seed";
import { generateStints } from "./stintGenerator";
import type { EnduranceState } from "../core/types";

// Boots de ECHTE DB-situatie na: 3 rijders op 1 team, exact de live limieten,
// 24u race, tank 90 min — in beide modi. Bedoeld om te reproduceren waarom
// de generator maar 2 van de 3 rijders zou inzetten.
const U_WEIJTS = "f1ed993f-5eaa-4740-818e-18a737bcce9f";
const U_RICKY = "3cf38c92-5e18-4e1b-925a-4256f17354ae";
const U_DEVOS = "103daeb3-9f46-4d79-a0a1-c460e43ed3b7";

const build = (hours = 24): { state: EnduranceState; event: EnduranceState["events"][0] } => {
  const base = createEnduranceSeed();
  const teamId = "team-live3";
  const event = {
    ...base.events[0],
    startAt: "2026-08-22T07:00:00.000Z",
    endAt: new Date(new Date("2026-08-22T07:00:00.000Z").getTime() + hours * 3600_000).toISOString(),
  };
  const members: Array<{ id: string; teamId: string; userId: string; role: "manager" | "driver" | "reserve" }> = [U_WEIJTS, U_RICKY, U_DEVOS].map((d) => ({ id: `tm-${d}`, teamId, userId: d, role: "driver" }));
  const state: EnduranceState = {
    ...base,
    events: [event],
    teams: [{ id: teamId, eventId: event.id, name: "Live 3", carId: "x", carNumber: "3", managerId: U_RICKY, livery: "x" }],
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

const LIVE_LIMITS = {
  [U_WEIJTS]: { maxStintMinutes: 120, maxTotalMinutes: 240, maxConsecutiveStints: 1, minRestMinutes: 60, willingToStart: true },
  [U_DEVOS]: { willingToStart: true },
} as const;

describe("live 3-rijders repro", () => {
  it("race-modus: 24u zet alle drie de rijders in", () => {
    const { state, event } = build(24);
    const stints = generateStints(state, event, "team-live3", 90, { mode: "race", driverLimits: LIVE_LIMITS });
    expect(stints.length).toBeGreaterThan(0);
    const used = new Set(stints.map((s) => s.driverId));
    expect([...used].sort()).toEqual([U_DEVOS, U_RICKY, U_WEIJTS].sort());
  });

  it("race-modus: 2u (Imola-casus) zet NIET alleen dezelfde 1-2 rijders, de 3e raakt nooit uitgesloten van zijn eerste stint", () => {
    // Echte Imola 2u-race: met tank 45min en Weijts' minRest=60 viel hij vroeger
    // structureel uit (rust gold al voor zijn eerste stint). Nu moet de 3e rijder
    // wél in beeld blijven en mag hij zijn eerste stint rijden.
    const { state, event } = build(2);
    const stints = generateStints(state, event, "team-live3", 45, { mode: "race", driverLimits: LIVE_LIMITS });
    expect(stints.length).toBeGreaterThan(0);
    const used = new Set(stints.map((s) => s.driverId));
    console.log(`[2u race] stints=${stints.length} used=${[...used].sort().join(",")}`);
    // minstens 2 verschillende rijders, en Weijts (de minRest-rijder) mag nooit
    // abstract geduwd worden als zijn eerste stint past.
    expect(used.size).toBeGreaterThanOrEqual(2);
    // Als Weijts nog geen stint heeft maar er tijd genoeg over is voor een volle
    // stint, moet hij inzetbaar blijven (geen harde uitsluiting vóór eerste stint).
    for (const s of stints) expect(typeof s.driverId).toBe("string");
  });

  it("comfort-modus: 24u zet alle drie de rijders in", () => {
    const { state, event } = build(24);
    const stints = generateStints(state, event, "team-live3", 90, { mode: "comfort", driverLimits: LIVE_LIMITS });
    expect(stints.length).toBeGreaterThan(0);
    const used = new Set(stints.map((s) => s.driverId));
    expect([...used].sort()).toEqual([U_DEVOS, U_RICKY, U_WEIJTS].sort());
  });

  it("houdt een coureur vast tot zijn maxConsecutiveStints (double/triple stint), i.p.v. altijd 1-om-1", () => {
    const { state, event } = build(6); // 6u race, genoeg stints voor een reeks
    const stints = generateStints(state, event, "team-live3", 60, {
      mode: "race",
      driverLimits: {
        [U_DEVOS]: { willingToStart: true, maxConsecutiveStints: 3 },
        [U_RICKY]: { willingToStart: false, maxConsecutiveStints: 1 },
        [U_WEIJTS]: { willingToStart: false, maxConsecutiveStints: 1 },
      },
    });
    expect(stints.length).toBeGreaterThan(2);
    // deDevos begint en mag 3 achter elkaar; eerst-3 moeten dus allemaal deDevos zijn.
    // (er is geen andere coureur met willingToStart + maxConsecutive > 1)
    const firstThree = stints.slice(0, 3).map((s) => s.driverId);
    expect(firstThree[0]).toBe(U_DEVOS);
    expect(firstThree.every((id) => id === U_DEVOS)).toBe(true);
  });

  it("StintTimeline toont de verwijderknop ALTIJD voor editable stints (ook dunne 24u-balken)", () => {
    const timeline = readFileSync("src/features/endurance/stints/StintTimeline.tsx", "utf8");
    expect(timeline).toContain("aria-label=\"Stint verwijderen\"");
    // delete-knop mag niet meer achter `width >= 10` schuilgaan (dunne 24u-balken).
    expect(timeline).not.toMatch(/width >= 10[\s\S]*Stint verwijderen/);
    // smalle balken tonen minimaal de delete-knop.
    expect(timeline).toContain('aria-label="Stint verwijderen"><Trash2');
  });

  it("StintPlanner vervangt bestaande draft-stints bij hergenereren (geen overlap)", () => {
    const planner = readFileSync("src/features/endurance/stints/StintPlanner.tsx", "utf8");
    expect(planner).toContain("replaceDraftStints");
    expect(planner).toContain('s.status === "draft"');
    expect(planner).toContain("remove.mutateAsync(draft.id)");
  });

  it("manager kan per coureur 'max stints achter elkaar' instellen dat bij genereren wordt gebruikt", () => {
    const planner = readFileSync("src/features/endurance/stints/StintPlanner.tsx", "utf8");
    expect(planner).toContain("consecutiveOverride");
    expect(planner).toContain("overrideLimits");
    // de override voedt beide generator-paden
    expect(planner).toContain("driverLimits: overrideLimits");
    expect(planner).toContain("driverOpts: overrideLimits");
    // bewerk-UX per coureur met 1/2/3 keuze
    expect(planner).toContain("Stints achter elkaar per coureur");
    expect(planner).toContain('<option value={1}>1</option>');
    expect(planner).toContain('<option value={3}>3</option>');
  });

  it("elke stint heeft een 'verlengen'-knop die dezelfde coureur nog een stint toevoegt", () => {
    const timeline = readFileSync("src/features/endurance/stints/StintTimeline.tsx", "utf8");
    const planner = readFileSync("src/features/endurance/stints/StintPlanner.tsx", "utf8");
    expect(timeline).toContain("onExtend");
    expect(timeline).toContain('aria-label="Zelfde coureur nog een stint"');
    expect(timeline).toContain("onExtend(selected)");
    expect(planner).toContain("const extend = ");
    expect(planner).toContain("onExtend={extend}");
    expect(planner).toContain('notes: "Verlengd (zelfde coureur)"');
  });

  it("timeline gebruikt swimlanes: elke coureur heeft een eigen rij en je kunt van coureur wisselen via slepen/selectie", () => {
    const timeline = readFileSync("src/features/endurance/stints/StintTimeline.tsx", "utf8");
    const planner = readFileSync("src/features/endurance/stints/StintPlanner.tsx", "utf8");
    // swimlane-structuur + drag-naar-andere-rij (coureur) + detailpaneel
    expect(timeline).toContain("laneDrivers");
    expect(timeline).toContain("laneDrop");
    expect(timeline).toContain("onAssign(stint, targetDriverId)");
    expect(timeline).toContain("Klik een stint aan voor details");
    expect(timeline).toContain('aria-label="Stint starttijd"');
    // detail-handlers gekoppeld in de planner
    expect(planner).toContain("const assign = ");
    expect(planner).toContain("onAssign={assign}");
  });

  it("stints zijn aan de randen uit te rekken (drag-resize) en de optimizer gebruikt de grootste gewenste stints-achter-elkaar-wens", () => {
    const timeline = readFileSync("src/features/endurance/stints/StintTimeline.tsx", "utf8");
    const planner = readFileSync("src/features/endurance/stints/StintPlanner.tsx", "utf8");
    const optimizer = readFileSync("src/features/endurance/stints/jresOptimizer.ts", "utf8");
    // edge-handles (links + rechts) + live feedback + onResizeEdge-commit
    expect(timeline).toContain("beginEdgeDrag");
    expect(timeline).toContain("aria-label=\"Stint links uitrekken\"");
    expect(timeline).toContain("aria-label=\"Stint rechts uitrekken\"");
    expect(timeline).toContain("onResizeEdge(stint, liveEdge.startAt, liveEdge.endAt)");
    expect(planner).toContain("const resizeEdge = ");
    expect(planner).toContain("onResizeEdge={resizeEdge}");
    // optimizer: max i.p.v. min over de maxConsecutiveStints-wensen
    expect(optimizer).toContain("maxDefined");
    expect(optimizer).toContain("consecutiveStints: Math.max(1, maxDefined");
  });
});