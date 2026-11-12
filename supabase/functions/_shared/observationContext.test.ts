/**
 * T13-S1 B1 — de echte context-resolver koppelt de observation aan het device
 * uit de token-opzoeking. Een caller-supplied `authenticatedDeviceId` mag dat
 * nooit overschrijven.
 */

// deno-lint-ignore-file no-explicit-any -- synthetische Supabase-stub

import { resolveTelemetryContext } from "../simhub-ingest-v3/context.ts";

const TOKEN_DEVICE = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const ATTACKER = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";

function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function observation(deviceId: string) {
  return {
    version: 1,
    capture: { deviceId },
    interval: {
      firstSampleAt: "2026-11-12T10:00:00.050Z",
      lastSampleAt: "2026-11-12T10:00:19.950Z",
      samples: 41,
      maxGapSeconds: 0.5,
      unknownSeconds: 0.1,
      edgeBeforeSeconds: 0.05,
      edgeAfterSeconds: 0.05,
    },
    pitRoad: { value: true, firstAt: "2026-11-12T10:00:05.000Z" },
  };
}

function body(observationDeviceId: string) {
  return {
    protocolVersion: 3,
    sequence: 1,
    capturedAt: "2026-11-12T10:00:20.000Z",
    transportSessionId: "sess-context",
    identity: {
      currentDriverId: "Driver One",
      currentDriverName: "Driver One",
      carId: "car",
      carName: "Car",
      trackName: "Track",
      trackConfig: "GP",
    },
    session: {
      isInCar: true,
      sessionTimeSeconds: 1000,
      sessionTimeRemainingSeconds: 100,
      sessionLapsRemaining: 5,
      flags: ["green"],
      sessionState: "racing",
    },
    timing: {
      currentLapElapsedSeconds: 40,
      lastLapTimeSeconds: 120.5,
      bestLapTimeSeconds: 120.5,
      completedLaps: 3,
    },
    position: { position: 3, classPosition: 2, gapToLeaderSeconds: 1.5 },
    track: { lapDistancePct: 0.4, trackSurface: "on_track", onPitRoad: false },
    fuel: { fuelLitres: 40.5, fuelPct: 0.5 },
    raceState: { incidents: 0 },
    pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: 0, optionalRepairSeconds: 0 },
    lapSummaries: [{
      summaryUid: TOKEN_DEVICE,
      lapNumber: 1,
      startedAt: "2026-11-12T10:00:00.000Z",
      endedAt: "2026-11-12T10:00:20.000Z",
      observation: observation(observationDeviceId),
    }],
  };
}

function fakeSupabase(row: Record<string, unknown>) {
  let rpcCalls = 0;
  return {
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error: null }),
          }),
        }),
      }),
      rpc: async () => {
        rpcCalls += 1;
        return { data: null, error: null };
      },
    } as any,
    rpcCalls: () => rpcCalls,
  };
}

const deviceRow = {
  id: TOKEN_DEVICE,
  owner_user_id: "00000000-0000-4000-8000-000000000001",
  race_id: null,
  team_id: null,
  endurance_event_id: null,
  endurance_team_id: null,
  device_status: "active_binding",
  device_role: "secondary",
  revoked_at: null,
  connector_id: "connector-1",
  device_name: "Test Device",
};

Deno.test("T13S1-107 context uses the token device and overrides caller auth input", async () => {
  const fake = fakeSupabase(deviceRow);
  const context = await resolveTelemetryContext(
    "x".repeat(64),
    body(TOKEN_DEVICE),
    fake.client,
    async () => "token-hash",
    {
      observationCapture: "on",
      // Een kwaadwillende/verwarde caller mag dit niet kunnen zetten.
      authenticatedDeviceId: ATTACKER,
    } as any,
  );
  assert(context.result === "accepted_device_context", `result ${context.result}`);
  const laps = context.normalized!.measurementReport!.laps;
  assert(laps.rows.length === 1, `accepted rows ${laps.rows.length}`);
  assert(laps.rejected.length === 0, `rejected rows ${laps.rejected.length}`);
  assert(
    laps.rows[0].observation!.capture.deviceId === TOKEN_DEVICE,
    "token device, not caller input, authenticated the row",
  );
  assert(fake.rpcCalls() === 0, "unbound secondary device must not call race-run RPC");
});

Deno.test("T13S1-108 context rejects a payload device that differs from the token device", async () => {
  const fake = fakeSupabase(deviceRow);
  const context = await resolveTelemetryContext(
    "x".repeat(64),
    body(ATTACKER),
    fake.client,
    async () => "token-hash",
    { observationCapture: "on", authenticatedDeviceId: TOKEN_DEVICE } as any,
  );
  assert(context.result === "accepted_device_context", `result ${context.result}`);
  const laps = context.normalized!.measurementReport!.laps;
  assert(laps.rows.length === 0, "foreign device row must not be accepted");
  assert(laps.rejected.length === 1, "foreign device row rejected alone");
  assert(
    laps.rejected[0].reason.includes("observation_device_mismatch"),
    `mismatch reason, got ${laps.rejected[0].reason}`,
  );
});
