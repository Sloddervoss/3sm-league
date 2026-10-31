import { describe, expect, it } from "vitest";
import { resolveTelemetryContext } from "../../supabase/functions/simhub-ingest-v3/context";

/**
 * A (hoog): een gat is een verschil en heeft een teken.
 *
 * Tot 2026-10-31 liep gapToPlayerSeconds door een parser met min: 0 en sentinel
 * -1. Auto's vóór de speler hebben een negatief gat, dus dat veld werd leeg
 * ("de helft van het veld verdwenen") en een echt gat van -1 seconde werd als
 * onbekend gelezen. Deze test loopt het echte Edge-pad: resolveTelemetryContext
 * parseert de payload met de echte parser (geen mock) en geeft
 * 'accepted_device_context' terug, wat simhub-ingest-v3/index.ts als 202
 * doorlaat. Faalt het parsen, dan werd het 'invalid_payload' (422).
 */

const tegenstander = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "9001",
  carNumber: "77",
  driverName: "R. Godefrooij",
  teamName: "Naober Racing",
  carClass: "GT3",
  carClassId: "17",
  position: 2,
  classPosition: 1,
  lap: 42,
  lapDistancePct: 0.31,
  gapToPlayerSeconds: 12.3,
  gapToLeaderSeconds: 1.8,
  lastLapSeconds: 121.8,
  bestLapSeconds: 120.4,
  inPit: false,
  speedKph: 212.4,
  connected: true,
  isPlayer: false,
  ...overrides,
});

const frame = (opponents: Record<string, unknown>[], gapToLeaderSeconds: unknown = 1.5): Record<string, unknown> => ({
  protocolVersion: 3,
  sequence: 4711,
  capturedAt: "2026-10-31T10:00:00.000Z",
  transportSessionId: "simhub-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  identity: {
    currentDriverId: "123456",
    currentDriverName: "Vincent",
    carId: "147",
    carName: "Porsche 911 GT3 R",
    trackName: "Spa-Francorchamps",
    trackConfig: "Grand Prix",
  },
  session: {
    isInCar: true,
    sessionTimeSeconds: 1850.5,
    sessionTimeRemainingSeconds: 3600,
    sessionLapsRemaining: 12,
    flags: ["green"],
    sessionState: "racing",
  },
  timing: { currentLapElapsedSeconds: 12.5, lastLapTimeSeconds: 121.25, bestLapTimeSeconds: 120.9, completedLaps: 42 },
  position: { position: 4, classPosition: 2, gapToLeaderSeconds },
  track: { lapDistancePct: 0.25, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 44.8, fuelPct: 0.6 },
  raceState: { incidents: 2 },
  pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: null, optionalRepairSeconds: null },
  opponents,
});

const device = {
  id: "device", owner_user_id: "owner", connector_id: "connector", device_name: "DESKTOP-E2SEMRP",
  endurance_event_id: null, endurance_team_id: null, device_status: "inactive",
  device_role: null, revoked_at: null, race_id: null,
};

const resolve = async (body: unknown) => {
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: device, error: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  };
  return resolveTelemetryContext("test-token", body, db, async () => "hash");
};

describe("signed gaten in het V3-ingestpad (202, geen 422)", () => {
  it("accepteert een frame met auto's vóór de speler en houdt het teken", async () => {
    const result = await resolve(frame([
      tegenstander({ id: "p1", position: 1, gapToPlayerSeconds: -42.8, gapToLeaderSeconds: 0 }),
      tegenstander({ id: "p2", position: 2, gapToPlayerSeconds: -2, gapToLeaderSeconds: 1.8 }),
      tegenstander({ id: "p3", position: 3, gapToPlayerSeconds: -1, gapToLeaderSeconds: 2.4 }),
      tegenstander({ id: "p7", position: 7, gapToPlayerSeconds: 2.1, gapToLeaderSeconds: 15 }),
    ]));

    expect(result.result).toBe("accepted_device_context");
    const gaten = result.normalized?.opponents?.map((o) => o.gapToPlayerSeconds);
    expect(gaten).toEqual([-42.8, -2, -1, 2.1]);
    expect(result.normalized?.opponents?.map((o) => o.gapToLeaderSeconds)).toEqual([0, 1.8, 2.4, 15]);
  });

  it("houdt 0 als echte meting en maakt een ontbrekend gat null", async () => {
    const result = await resolve(frame([
      tegenstander({ id: "p1", gapToPlayerSeconds: 0, gapToLeaderSeconds: 0 }),
      tegenstander({ id: "p2", gapToPlayerSeconds: undefined, gapToLeaderSeconds: null }),
    ]));

    expect(result.result).toBe("accepted_device_context");
    expect(result.normalized?.opponents?.[0]?.gapToPlayerSeconds).toBe(0);
    expect(result.normalized?.opponents?.[1]?.gapToPlayerSeconds).toBeNull();
    expect(result.normalized?.opponents?.[1]?.gapToLeaderSeconds).toBeNull();
  });

  it("accepteert het eigen (negatieve) gat naar de leider", async () => {
    const result = await resolve(frame([tegenstander()], -1));

    expect(result.result).toBe("accepted_device_context");
    expect(result.normalized?.position.gapToLeaderSeconds).toBe(-1);
  });

  it("laat een onbruikbaar gat het frame niet kosten", async () => {
    const result = await resolve(frame([tegenstander({ gapToPlayerSeconds: 999_999 })], "geen getal"));

    // Het veld wordt leeg, het frame komt door — geen 422.
    expect(result.result).toBe("accepted_device_context");
    expect(result.normalized?.opponents?.[0]?.gapToPlayerSeconds).toBeNull();
    expect(result.normalized?.position.gapToLeaderSeconds).toBeNull();
  });
});
