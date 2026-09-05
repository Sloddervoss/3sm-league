import { describe, expect, it } from "vitest";
import { latestSeen, sitePairing, telemetryValues } from "./connectorState";

describe("connector status and telemetry", () => {
  it("keeps an inactive race binding paired to the site", () => {
    expect(sitePairing({ device_status: "inactive", revoked_at: null })).toBe("Site gekoppeld");
    expect(sitePairing({ device_status: "revoked", revoked_at: "2026-09-05" })).toBe("Ingetrokken");
  });
  it("uses the newest evidence, not an old health heartbeat", () => {
    expect(latestSeen({ health_received_at: "2026-09-01", last_seen_at: "2026-09-04", telemetry_received_at: "2026-09-05" })).toBe("2026-09-05");
  });
  it("reads nested V3 values and preserves zero and false", () => {
    const data = { v3_normalized: { fuel: { fuelLitres: 0 }, timing: { completedLaps: 12 }, track: { onPitRoad: false } } };
    expect(telemetryValues(data)).toMatchObject({ fuel: 0, completedLaps: 12, inPit: false });
    expect(telemetryValues(null).inPit).toBeUndefined();
  });
});
