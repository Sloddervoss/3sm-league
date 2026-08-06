import { describe, expect, it } from "vitest";
import { parseSimHubBridgeResponse } from "@/lib/localSimHubBridge";
import { parseTelemetryEnvelope } from "../../supabase/functions/_shared/simhub";

const v1Telemetry = {
  connected: true,
  sessionTimeSeconds: 3600,
  lap: 18,
  completedLaps: 17,
  lapTimeSeconds: 121.25,
  position: 4,
  classPosition: 2,
  speedKph: 247.1,
  fuelLitres: 44.8,
  fuelPerLapLitres: 3.2,
  estimatedLapsRemaining: 14,
  inPitLane: false,
  pitLimiter: false,
  stintElapsedSeconds: 2700,
  incidents: 2,
  flag: "green",
};

const v2Race = {
  eventId: "connection-test",
  teamId: "unassigned",
  sessionId: "simhub-abc",
  driverId: null,
  currentDriverId: "302911",
  currentDriverName: "Vincent",
  carId: "GT3-911",
  carName: "Porsche 911 GT3 R",
  trackName: "Zandvoort",
  trackConfig: "Grand Prix",
};

const v2Telemetry = { ...v1Telemetry, isInCar: true };
const baseEnvelope = (extra: Record<string, unknown>) => ({
  protocolVersion: 2,
  sequence: 5,
  capturedAt: "2026-08-06T09:00:00.000Z",
  source: { connectorId: "SIM-PC", simHubVersion: "9.11.21.0", game: "IRacing" },
  ...extra,
});

describe("SimHub telemetry envelope v2", () => {
  it("browser parser accepts v2 race identity and isInCar", () => {
    const parsed = parseSimHubBridgeResponse({
      receivedAt: "2026-08-06T09:00:01.000Z",
      payload: baseEnvelope({ race: v2Race, telemetry: v2Telemetry }),
    });
    expect(parsed.payload.protocolVersion).toBe(2);
    expect(parsed.payload.race.currentDriverId).toBe("302911");
    expect(parsed.payload.race.currentDriverName).toBe("Vincent");
    expect(parsed.payload.race.carName).toBe("Porsche 911 GT3 R");
    expect(parsed.payload.race.trackName).toBe("Zandvoort");
    expect(parsed.payload.telemetry.isInCar).toBe(true);
  });

  it("browser parser normalizes v1 payloads (new fields null, isInCar true)", () => {
    const parsed = parseSimHubBridgeResponse({
      receivedAt: "2026-08-06T09:00:01.000Z",
      payload: baseEnvelope({
        protocolVersion: 1,
        race: { eventId: "connection-test", teamId: "unassigned", sessionId: "simhub-abc", driverId: null },
        telemetry: v1Telemetry,
      }),
    });
    expect(parsed.payload.protocolVersion).toBe(1);
    expect(parsed.payload.race.currentDriverId).toBeNull();
    expect(parsed.payload.race.carId).toBeNull();
    expect(parsed.payload.telemetry.isInCar).toBe(true);
  });

  it("browser parser rejects unknown v2 fields", () => {
    expect(() => parseSimHubBridgeResponse({
      receivedAt: "2026-08-06T09:00:01.000Z",
      payload: baseEnvelope({ race: { ...v2Race, rawIracingData: "x" }, telemetry: v2Telemetry }),
    })).toThrow(/onbekende|ontbrekende/);
  });

  it("server parser accepts v2 and normalizes v1 identically", () => {
    const serverV2 = parseTelemetryEnvelope(baseEnvelope({ race: v2Race, telemetry: v2Telemetry }));
    expect(serverV2.protocolVersion).toBe(2);
    expect(serverV2.race.currentDriverId).toBe("302911");
    expect(serverV2.race.trackName).toBe("Zandvoort");
    expect(serverV2.telemetry.isInCar).toBe(true);

    const serverV1 = parseTelemetryEnvelope(baseEnvelope({
      protocolVersion: 1,
      race: { eventId: "connection-test", teamId: "unassigned", sessionId: "simhub-abc", driverId: null },
      telemetry: v1Telemetry,
    }));
    expect(serverV1.protocolVersion).toBe(1);
    expect(serverV1.race.currentDriverId).toBeNull();
    expect(serverV1.telemetry.isInCar).toBe(true);
  });

  it("server parser rejects v3 and unknown v2 fields", () => {
    expect(() => parseTelemetryEnvelope(baseEnvelope({ protocolVersion: 3, race: v2Race, telemetry: v2Telemetry }))).toThrow(/unsupported protocolVersion/);
    expect(() => parseTelemetryEnvelope(baseEnvelope({ race: v2Race, telemetry: { ...v2Telemetry, extra: 1 } }))).toThrow(/unknown or missing/);
  });
});
