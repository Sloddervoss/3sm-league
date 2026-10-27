import { describe, expect, it } from "vitest";
import { parseTelemetryV3Envelope } from "../../supabase/functions/_shared/simhub";

/**
 * Connector 0.7.1 vult drie dingen die het V3-contract al kende maar die de plugin nooit
 * verstuurde, en stuurt het bandenblok niet meer elk frame:
 *  - pitService.requiredRepairSeconds / optionalRepairSeconds (iRacing PitRepairLeft/PitOptRepairLeft);
 *  - session.flags met "meatball";
 *  - opponents[].gapToLeaderSeconds;
 *  - tyres mag ontbreken in een frame waarin niets veranderde.
 * Deze test bewijst dat de inname die vorm accepteert en blijft controleren.
 */

const basisPayload = (): Record<string, unknown> => ({
  protocolVersion: 3,
  sequence: 4711,
  capturedAt: "2026-10-27T10:00:00.000Z",
  transportSessionId: "simhub-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  identity: {
    currentDriverId: "123456",
    currentDriverName: "Vincent",
    carId: "147",
    carName: "Porsche 911 GT3 R",
    trackName: "Spa-Francorchamps",
    trackConfig: "Grand Prix",
    trackId: 399,
  },
  session: {
    isInCar: true,
    sessionTimeSeconds: 1850.5,
    sessionTimeRemainingSeconds: 3600,
    sessionLapsRemaining: 12,
    flags: ["green"],
    sessionState: "racing",
  },
  timing: {
    currentLapElapsedSeconds: 12.5,
    lastLapTimeSeconds: 121.25,
    bestLapTimeSeconds: 120.9,
    completedLaps: 42,
  },
  position: { position: 4, classPosition: 2, gapToLeaderSeconds: 1.5 },
  track: { lapDistancePct: 0.25, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 44.8, fuelPct: 0.6 },
  raceState: { incidents: 2 },
  pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: null, optionalRepairSeconds: null },
});

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

describe("V3-telemetrie: reparatietijd, meatball, gap en bandenblok (connector 0.7.1)", () => {
  it("accepteert de reparatietijden en houdt 0 als echte meting", () => {
    const payload = basisPayload();
    payload.pitService = { pitServiceFlagsRaw: 5, requiredRepairSeconds: 7.4, optionalRepairSeconds: 0 };
    const parsed = parseTelemetryV3Envelope(payload);
    expect(parsed.pitService.pitServiceFlagsRaw).toBe(5);
    expect(parsed.pitService.requiredRepairSeconds).toBeCloseTo(7.4, 5);
    expect(parsed.pitService.optionalRepairSeconds).toBe(0);
  });

  it("normaliseert de SDK-sentinel -1 naar null en weigert onmogelijke tijden", () => {
    const sentinel = basisPayload();
    sentinel.pitService = { pitServiceFlagsRaw: null, requiredRepairSeconds: -1, optionalRepairSeconds: -1 };
    const parsed = parseTelemetryV3Envelope(sentinel);
    expect(parsed.pitService.requiredRepairSeconds).toBeNull();
    expect(parsed.pitService.optionalRepairSeconds).toBeNull();

    const onmogelijk = basisPayload();
    onmogelijk.pitService = { pitServiceFlagsRaw: null, requiredRepairSeconds: 90000, optionalRepairSeconds: -2 };
    expect(() => parseTelemetryV3Envelope(onmogelijk)).toThrow(/requiredRepairSeconds/i);
  });

  it("laat meatball door in session.flags en blijft onbekende vlaggen weigeren", () => {
    const metMeatball = basisPayload();
    metMeatball.session = { ...(metMeatball.session as Record<string, unknown>), flags: ["yellow", "meatball"] };
    const parsed = parseTelemetryV3Envelope(metMeatball);
    expect(parsed.session.flags).toEqual(["yellow", "meatball"]);

    const onbekend = basisPayload();
    onbekend.session = { ...(onbekend.session as Record<string, unknown>), flags: ["banana"] };
    expect(() => parseTelemetryV3Envelope(onbekend)).toThrow(/flags/i);
  });

  it("accepteert het gat naar de leider per tegenstander", () => {
    const payload = basisPayload();
    payload.opponents = [
      tegenstander({ id: "p1", position: 1, gapToPlayerSeconds: 0, gapToLeaderSeconds: 0 }),
      tegenstander({ id: "p2", gapToLeaderSeconds: 1.8 }),
      tegenstander({ id: "p3", gapToLeaderSeconds: null }),
    ];
    const parsed = parseTelemetryV3Envelope(payload);
    expect(parsed.opponents?.map((o) => o.gapToLeaderSeconds)).toEqual([0, 1.8, null]);
  });

  it("weigert een negatief gat naar de leider (daarom knijpt de plugin dat naar null)", () => {
    const payload = basisPayload();
    payload.opponents = [tegenstander({ gapToLeaderSeconds: -0.4 })];
    expect(() => parseTelemetryV3Envelope(payload)).toThrow(/gapToLeaderSeconds/i);
  });

  it("weigert ook een negatief gapToPlayerSeconds; dat blokkeert het hele frame", () => {
    // Bestaand gedrag van de validator (min 0), geen 0.7.1-wijziging: de plugin stuurt
    // hier SignedSeconds(opponent.GaptoPlayer) en dat kan negatief zijn. Bewijs dat zo'n
    // frame in zijn geheel wordt geweigerd, zodat dit niet stil blijft liggen.
    const payload = basisPayload();
    payload.opponents = [tegenstander({ gapToPlayerSeconds: -42.8 })];
    expect(() => parseTelemetryV3Envelope(payload)).toThrow(/gapToPlayerSeconds/i);
  });

  it("blijft geldig als het bandenblok in een frame ontbreekt", () => {
    const parsed = parseTelemetryV3Envelope(basisPayload());
    expect(parsed.tyres).toBeNull();
    expect(parsed.session.sessionState).toBe("racing");
  });
});
