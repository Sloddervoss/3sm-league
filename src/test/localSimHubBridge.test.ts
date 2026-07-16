import { describe, expect, it } from "vitest";
import { getSimHubTelemetryState, normalizeLocalBridgeUrl, parseSimHubBridgeResponse } from "@/lib/localSimHubBridge";

const valid = {
  payload: {
    protocolVersion: 1, sequence: 4, capturedAt: "2026-07-16T12:00:00.000Z",
    source: { connectorId: "connector-one", simHubVersion: "9.11.21", game: "IRacing" },
    race: { eventId: "event-one", teamId: "team-one", sessionId: "session-one", driverId: "user-one" },
    telemetry: { connected: true, sessionTimeSeconds: 120, lap: 2, completedLaps: 1, lapTimeSeconds: 128.4, position: 7, classPosition: 3, speedKph: 240, fuelLitres: 81, fuelPerLapLitres: 3, estimatedLapsRemaining: 27, inPitLane: false, pitLimiter: false, stintElapsedSeconds: 120, incidents: 1, flag: "green" },
  },
  receivedAt: "2026-07-16T12:00:00.100Z",
};

describe("local SimHub bridge client", () => {
  it("accepts the versioned telemetry response and rejects unknown fields", () => {
    expect(parseSimHubBridgeResponse(valid).payload.telemetry.fuelLitres).toBe(81);
    expect(() => parseSimHubBridgeResponse({ ...valid, productionToken: "nope" })).toThrow();
  });

  it("distinguishes live, stale and offline heartbeat states", () => {
    const receivedAt = "2026-07-16T12:00:00.000Z";
    const at = (seconds: number) => Date.parse(receivedAt) + seconds * 1_000;
    expect(getSimHubTelemetryState(receivedAt, at(5))).toBe("live");
    expect(getSimHubTelemetryState(receivedAt, at(6))).toBe("stale");
    expect(getSimHubTelemetryState(receivedAt, at(30))).toBe("stale");
    expect(getSimHubTelemetryState(receivedAt, at(31))).toBe("offline");
    expect(getSimHubTelemetryState("geen datum", at(1))).toBe("offline");
  });

  it("only accepts loopback HTTP bridge URLs", () => {
    expect(normalizeLocalBridgeUrl("http://127.0.0.1:8787/path")).toBe("http://127.0.0.1:8787");
    expect(normalizeLocalBridgeUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(() => normalizeLocalBridgeUrl("https://api.3stripemotorsport.cc")).toThrow(/lokale bridge-URL/);
    expect(() => normalizeLocalBridgeUrl("http://192.168.50.104:8787")).toThrow(/lokale bridge-URL/);
  });
});
