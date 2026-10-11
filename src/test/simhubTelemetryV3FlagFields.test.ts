import { describe, expect, it } from "vitest";
import { parseTelemetryV3Envelope } from "../../supabase/functions/_shared/simhub";

/**
 * Connector 0.5.6.0 stuurt extra velden mee (vlaggenmodule + stintberekening).
 * Deze test bewijst twee dingen tegelijk:
 *  - een bestaande connector (zonder die velden) wordt nog exact hetzelfde geaccepteerd;
 *  - de nieuwe velden worden geaccepteerd én gecontroleerd, zodat ze niet stil de inname breken.
 */

const basisPayload = (): Record<string, unknown> => ({
  protocolVersion: 3,
  sequence: 42,
  capturedAt: "2026-10-11T20:00:00.000Z",
  transportSessionId: "simhub-11111111-2222-4333-8444-555555555555",
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
    sessionTimeSeconds: 1200,
    sessionTimeRemainingSeconds: 3600,
    sessionLapsRemaining: 12,
    flags: ["green"],
    sessionState: "racing",
  },
  timing: {
    currentLapElapsedSeconds: 12.5,
    lastLapTimeSeconds: 121.25,
    bestLapTimeSeconds: 120.9,
    completedLaps: 3,
  },
  position: { position: 4, classPosition: 2, gapToLeaderSeconds: 1.5 },
  track: { lapDistancePct: 0.25, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 44.8, fuelPct: 0.6 },
  raceState: { incidents: 2 },
  pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: null, optionalRepairSeconds: null },
});

const metVlaggenmodule = (): Record<string, unknown> => {
  const payload = basisPayload();
  return {
    ...payload,
    session: {
      ...(payload.session as Record<string, unknown>),
      primaryFlag: "yellow",
      flagColour: "#FFDD00",
      flagSeverity: 3,
      startLights: 4,
      pitLaneOpen: false,
      isStartSequence: true,
    },
    fuel: { ...(payload.fuel as Record<string, unknown>), fuelPerLapLitres: 3.24, lapsRemaining: 12.4 },
    raceState: { ...(payload.raceState as Record<string, unknown>), incidentLimit: 17 },
  };
};

describe("V3-telemetrie: vlaggenvelden van connector 0.5.6.0", () => {
  it("accepteert een bestaande connector zonder de nieuwe velden", () => {
    const parsed = parseTelemetryV3Envelope(basisPayload());
    expect(parsed.session.sessionState).toBe("racing");
    expect(parsed.identity.trackId).toBe(399);
    expect(parsed.session.primaryFlag ?? null).toBeNull();
    expect(parsed.fuel.fuelPerLapLitres ?? null).toBeNull();
    expect(parsed.raceState.incidentLimit ?? null).toBeNull();
  });

  it("accepteert de nieuwe vlag-, stint- en incidentvelden", () => {
    const parsed = parseTelemetryV3Envelope(metVlaggenmodule());
    expect(parsed.session.primaryFlag).toBe("yellow");
    expect(parsed.session.flagColour).toBe("#FFDD00");
    expect(parsed.session.flagSeverity).toBe(3);
    expect(parsed.session.startLights).toBe(4);
    expect(parsed.session.pitLaneOpen).toBe(false);
    expect(parsed.session.isStartSequence).toBe(true);
    expect(parsed.fuel.fuelPerLapLitres).toBeCloseTo(3.24, 5);
    expect(parsed.fuel.lapsRemaining).toBeCloseTo(12.4, 5);
    expect(parsed.raceState.incidentLimit).toBe(17);
  });

  it("blijft onbekende velden weigeren", () => {
    const payload = basisPayload();
    payload.session = { ...(payload.session as Record<string, unknown>), onbekendVeld: 1 };
    expect(() => parseTelemetryV3Envelope(payload)).toThrow(/unknown fields/i);
  });

  it("weigert nog steeds een payload zonder verplicht veld", () => {
    const payload = basisPayload();
    const session = { ...(payload.session as Record<string, unknown>) };
    delete session.sessionState;
    payload.session = session;
    expect(() => parseTelemetryV3Envelope(payload)).toThrow(/missing required field/i);
  });

  it("controleert de nieuwe waarden in plaats van ze blind over te nemen", () => {
    const buitenBereik = metVlaggenmodule();
    buitenBereik.session = { ...(buitenBereik.session as Record<string, unknown>), startLights: 99 };
    expect(() => parseTelemetryV3Envelope(buitenBereik)).toThrow(/startLights/i);

    const geenNummer = metVlaggenmodule();
    geenNummer.fuel = { ...(geenNummer.fuel as Record<string, unknown>), fuelPerLapLitres: "veel" };
    expect(() => parseTelemetryV3Envelope(geenNummer)).toThrow(/fuelPerLapLitres/i);
  });
});
