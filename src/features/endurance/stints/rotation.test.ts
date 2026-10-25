import { describe, expect, it } from "vitest";
import { buildRotationOrder, fastestFirstFromPace, rotationCounts, rotationSequence } from "./rotation";
import { generateStints } from "./stintGenerator";
import { createEnduranceSeed } from "../core/seed";
import type { EnduranceState } from "../core/types";

// Drie coureurs, B is de snelste (laagste rondetijd), daarna J, dan V.
const B = "u-b";
const J = "u-j";
const V = "u-v";
const ROSTER = [B, J, V];
const FASTEST_FIRST = [B, J, V];

const buildRace = (hours: number): { state: EnduranceState; event: EnduranceState["events"][0] } => {
  const base = createEnduranceSeed();
  const eventId = base.events[0].id;
  const teamId = "team-rotation";
  const event = {
    ...base.events[0],
    startAt: "2026-08-22T07:00:00.000Z",
    endAt: new Date(new Date("2026-08-22T07:00:00.000Z").getTime() + hours * 3_600_000).toISOString(),
  };
  const lap = { [B]: 128.1, [J]: 128.6, [V]: 129.4 };
  return {
    event,
    state: {
      ...base,
      events: [event],
      teams: [{ id: teamId, eventId, name: "Rotatie", carId: "x", carNumber: "9", managerId: B, livery: "x" }],
      teamMembers: ROSTER.map((userId) => ({ id: `tm-${userId}`, teamId, userId, role: "driver" as const })),
      availability: [],
      stints: [],
      registrations: [],
      paceEntries: ROSTER.map((userId) => ({ ...base.paceEntries[0], id: `pace-${userId}`, eventId, userId, averageLapSeconds: lap[userId] })),
      planningVersions: [],
      confirmations: [],
    },
  };
};

// Zeven stints van een uur: zevende stint is de extra stint.
const generateSevenStints = (startDriver?: string) => {
  const { state, event } = buildRace(7);
  return generateStints(state, event, "team-rotation", 60, startDriver ? { firstStintDriver: startDriver } : {});
};

describe("rotatie — rijvolgorde", () => {
  it("zet de gekozen startcoureur vooraan en laat de rest in teamvolgorde staan", () => {
    expect(buildRotationOrder(ROSTER, J)).toEqual([J, B, V]);
    expect(buildRotationOrder(ROSTER, null)).toEqual(ROSTER);
    // Een startcoureur buiten het team schuift niets: geen spookrijder.
    expect(buildRotationOrder(ROSTER, "u-onbekend")).toEqual(ROSTER);
  });

  it("rangschikt op gemeten pace en zet ongemeten coureurs achteraan", () => {
    expect(fastestFirstFromPace([{ userId: V, averageLapSeconds: 129.4 }, { userId: B, averageLapSeconds: 128.1 }], ROSTER)).toEqual([B, V, J]);
  });
});

describe("rotatie — verdeling van de stints", () => {
  it("geeft iedereen gelijke delen en de extra stint aan de snelste", () => {
    expect(rotationCounts(ROSTER, 7, FASTEST_FIRST)).toEqual({ [B]: 3, [J]: 2, [V]: 2 });
    expect(rotationCounts(ROSTER, 6, FASTEST_FIRST)).toEqual({ [B]: 2, [J]: 2, [V]: 2 });
    // Twee extra stints: de twee snelste coureurs.
    expect(rotationCounts(ROSTER, 8, FASTEST_FIRST)).toEqual({ [B]: 3, [J]: 3, [V]: 2 });
  });

  it("houdt de verdeling gelijk wanneer een andere coureur start", () => {
    const fromB = rotationCounts(buildRotationOrder(ROSTER, B), 7, FASTEST_FIRST);
    const fromV = rotationCounts(buildRotationOrder(ROSTER, V), 7, FASTEST_FIRST);
    expect(fromV).toEqual(fromB);
    expect(fromV[B]).toBe(3);
  });

  it("wisselt strikt af: 7 stints met 3 coureurs is B,J,V,B,J,V,B", () => {
    expect(rotationSequence(ROSTER, 7, FASTEST_FIRST)).toEqual([B, J, V, B, J, V, B]);
  });

  it("laat de reeks doorschuiven bij een andere start en houdt de extra stint bij de snelste", () => {
    const fromV = rotationSequence(buildRotationOrder(ROSTER, V), 7, FASTEST_FIRST);
    expect(fromV[0]).toBe(V);
    expect(fromV.filter((id) => id === B)).toHaveLength(3);
    expect(new Set(fromV)).toEqual(new Set(ROSTER));
    for (let i = 1; i < fromV.length; i += 1) expect(fromV[i]).not.toBe(fromV[i - 1]);
  });

  it("wisselt nooit twee keer dezelfde coureur af, voor elke combinatie van coureurs en stints", () => {
    for (let drivers = 2; drivers <= 6; drivers += 1) {
      const order = ROSTER.concat(["u-x", "u-y", "u-z"]).slice(0, drivers);
      for (let stints = 1; stints <= 20; stints += 1) {
        const sequence = rotationSequence(order, stints, order);
        expect(sequence).toHaveLength(stints);
        expect(sequence[0]).toBe(order[0]);
        // Bij minder stints dan coureurs kan niet iedereen rijden; zodra er
        // genoeg stints zijn, komt iedereen aan de beurt.
        if (stints >= drivers) expect(new Set(sequence)).toEqual(new Set(order));
        for (let i = 1; i < sequence.length; i += 1) expect(sequence[i]).not.toBe(sequence[i - 1]);
      }
    }
  });
});

describe("rotatie in de generator", () => {
  it("plant 7 stints voor 3 coureurs als B,J,V,B,J,V,B", () => {
    const stints = generateSevenStints();
    expect(stints).toHaveLength(7);
    expect(stints.map((stint) => stint.driverId)).toEqual([B, J, V, B, J, V, B]);
    // De snelste coureur heeft de extra stint, niet de toevallig laatste.
    expect(stints.filter((stint) => stint.driverId === B)).toHaveLength(3);
    expect(stints.at(-1)?.actualEndAt).toBe(buildRace(7).event.endAt);
  });

  it("schuift de volgorde door bij een andere startcoureur zonder de verdeling te veranderen", () => {
    const stints = generateSevenStints(V);
    expect(stints).toHaveLength(7);
    expect(stints[0].driverId).toBe(V);
    expect(new Set(stints.map((stint) => stint.driverId))).toEqual(new Set(ROSTER));
    for (let i = 1; i < stints.length; i += 1) expect(stints[i].driverId).not.toBe(stints[i - 1].driverId);
    // Zeven stints, drie coureurs: de extra stint blijft bij de snelste.
    expect(stints.filter((stint) => stint.driverId === B)).toHaveLength(3);
  });

  it("geeft bij een gelijkmatige race iedereen evenveel stints", () => {
    const { state, event } = buildRace(6);
    const stints = generateStints(state, event, "team-rotation", 60);
    expect(stints).toHaveLength(6);
    expect(stints.map((stint) => stint.driverId)).toEqual([B, J, V, B, J, V]);
  });
});
