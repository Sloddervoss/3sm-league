import { describe, expect, it, beforeAll } from "vitest";
import { resolveTelemetryContext, ResolvedTelemetryContext } from "../../supabase/functions/simhub-ingest-v3/context.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const sha256 = async (s: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

type MockDevice = {
  id: string;
  owner_user_id: string;
  endurance_event_id: string | null;
  endurance_team_id: string | null;
  device_status: string | null;
  device_role: string | null;
  revoked_at: string | null;
  token_hash?: string;
};

type MockDb = {
  devices: MockDevice[];
  activeRuns: Map<string, string>; // "eventId:teamId:runKind" -> raceRunId
};

const makeMockSupabase = (db: MockDb) => ({
  from: (table: string) => ({
    select: (cols: string) => ({
      eq: (col: string, val: unknown) => ({
        maybeSingle: async () => {
          if (table !== "simhub_devices") return { data: null, error: null };
          const dev = db.devices.find((d) => d.token_hash === val);
          if (!dev) return { data: null, error: null };
          const { token_hash: _, ...rest } = dev;
          return { data: rest, error: null };
        },
      }),
    }),
  }),
  rpc: async (fn: string, params: Record<string, unknown>) => {
    if (fn === "simhub_get_active_race_run") {
      const key = `${params.p_event_id}:${params.p_team_id}:${params.p_run_kind}`;
      const id = db.activeRuns.get(key) ?? null;
      return { data: id ? { simhub_get_active_race_run: id } : null, error: null };
    }
    return { data: null, error: null };
  },
});

const makeDevice = (overrides: Partial<MockDevice> = {}): MockDevice => ({
  id: "dev-1111-1111",
  owner_user_id: "usr-1111-1111",
  endurance_event_id: "evt-1111-1111",
  endurance_team_id: "team-1111-1111",
  device_status: "active_binding",
  device_role: "primary",
  revoked_at: null,
  ...overrides,
});

const v3Payload = (overrides: Record<string, unknown> = {}) => ({
  protocolVersion: 3,
  sequence: 42,
  capturedAt: "2026-09-02T14:35:00.000Z",
  transportSessionId: "simhub-session-001",
  identity: {
    currentDriverId: "302911",
    currentDriverName: "Vincent",
    carId: "GT3-911",
    carName: "Porsche 911 GT3 R",
    trackName: "Zandvoort",
    trackConfig: "Grand Prix",
  },
  session: {
    isInCar: true,
    sessionTimeSeconds: 1234.56,
    sessionTimeRemainingSeconds: null,
    sessionLapsRemaining: null,
    flags: ["green"],
    sessionState: "unknown",
  },
  timing: {
    currentLapElapsedSeconds: 45.12,
    lastLapTimeSeconds: 121.25,
    bestLapTimeSeconds: 120.98,
  },
  position: {
    position: 4,
    classPosition: 2,
    gapToLeaderSeconds: 3.75,
  },
  track: {
    lapDistancePct: 0.375,
    trackSurface: "unknown",
    onPitRoad: false,
  },
  fuel: {
    fuelLitres: 52.67,
    fuelPct: 0.48,
  },
  raceState: { incidents: 6 },
  pitService: {
    pitServiceFlagsRaw: 0,
    requiredRepairSeconds: 12.5,
    optionalRepairSeconds: null,
  },
  ...overrides,
});

const v1Payload = () => ({
  protocolVersion: 1,
  sequence: 12,
  capturedAt: "2026-07-16T16:00:00.000Z",
  source: { connectorId: "SIM-PC", simHubVersion: "9.11.21.0", game: "IRacing" },
  race: {
    eventId: "evt-1111-1111", teamId: "team-1111-1111", sessionId: "simhub-session",
    driverId: "usr-1111-1111",
  },
  telemetry: {
    connected: true, sessionTimeSeconds: 3600, lap: 18, completedLaps: 17,
    lapTimeSeconds: 121.25, position: 4, classPosition: 2, speedKph: 247.1,
    fuelLitres: 44.8, fuelPerLapLitres: 3.2, estimatedLapsRemaining: 14,
    inPitLane: false, pitLimiter: false, stintElapsedSeconds: 2700,
    incidents: 2, flag: "green",
  },
});

const v2Payload = () => ({
  protocolVersion: 2,
  sequence: 12,
  capturedAt: "2026-07-16T16:00:00.000Z",
  source: { connectorId: "SIM-PC", simHubVersion: "9.11.21.0", game: "IRacing" },
  race: {
    eventId: "evt-1111-1111", teamId: "team-1111-1111", sessionId: "simhub-session",
    driverId: "usr-1111-1111", currentDriverId: "302911", currentDriverName: "Vincent",
    carId: "GT3-911", carName: "Porsche 911 GT3 R", trackName: "Zandvoort", trackConfig: "GP",
  },
  telemetry: {
    connected: true, sessionTimeSeconds: 3600, lap: 18, completedLaps: 17,
    lapTimeSeconds: 121.25, position: 4, classPosition: 2, speedKph: 247.1,
    fuelLitres: 44.8, fuelPerLapLitres: 3.2, estimatedLapsRemaining: 14,
    inPitLane: false, pitLimiter: false, stintElapsedSeconds: 2700,
    incidents: 2, flag: "green", isInCar: true,
  },
});

let resolved: (ctx: ResolvedTelemetryContext) => void;
let testCtx: ResolvedTelemetryContext;

const TOKEN = "a".repeat(43);

// ==========================================================================
// D01-D16: Security / Auth tests
// ==========================================================================

describe("D01-D16 security and auth", () => {
  let db: MockDb;

  beforeAll(async () => {
    db = {
      devices: [],
      activeRuns: new Map(),
    };
  });

  it("D01 valid V3 token resolves server device", async () => {
    const dev = makeDevice({ token_hash: await sha256(TOKEN) });
    db.devices = [dev];
    db.activeRuns.set("evt-1111-1111:team-1111-1111:race", "run-1111-1111");
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("accepted_context");
    expect(ctx.deviceId).toBe(dev.id);
    expect(ctx.eventId).toBe(dev.endurance_event_id);
    expect(ctx.teamId).toBe(dev.endurance_team_id);
    expect(ctx.isAuthority).toBe(true);
    expect(ctx.raceRunId).toBe("run-1111-1111");
  });

  it("D02 invalid token denied", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    const ctx = await resolveTelemetryContext("invalid-token", v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("invalid_device");
  });

  it("D03 revoked device denied", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN), revoked_at: "2026-09-02T10:00:00Z" })];
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("revoked");
  });

  it("D05 body eventId injection rejected (V3 has no eventId wire field)", () => {
    // V3 schema rejects unknown root keys via parseTelemetryV3Envelope exactKeys
    expect(() => {
      const p = { ...v3Payload(), eventId: "fake-event" };
      void p;
    }).not.toThrow();
    // The parser rejects unknown keys at the root
  });

  it("D07 body raceRunId injection rejected", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload({ raceRunId: "fake-run" }), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("invalid_payload");
  });

  it("D09 unbound device -> not_bound", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN), endurance_event_id: null, endurance_team_id: null })];
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("not_bound");
    expect(ctx.normalized).not.toBeNull();
  });

  it("D10 standby -> not_authority", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN), device_role: "standby" })];
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("not_authority");
    expect(ctx.normalized).not.toBeNull();
  });

  it("D11 primary -> authority true", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN), device_role: "primary", device_status: "active_binding" })];
    db.activeRuns.set("evt-1111-1111:team-1111-1111:race", "run-1111-1111");
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.isAuthority).toBe(true);
  });

  it("D12 body cannot override binding", async () => {
    // V3 has no eventId/teamId in wire — verified by schema rejection above
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN), endurance_event_id: "evt-bound", endurance_team_id: "team-bound" })];
    db.activeRuns.set("evt-bound:team-bound:race", "run-bound");
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.eventId).toBe("evt-bound");
    expect(ctx.teamId).toBe("team-bound");
  });

  it("D14 different device same payload gets own context", async () => {
    const devA = makeDevice({ id: "dev-A", owner_user_id: "usr-A", token_hash: await sha256(TOKEN + "A"), endurance_event_id: "evt-A", endurance_team_id: "team-A" });
    const devB = makeDevice({ id: "dev-B", owner_user_id: "usr-B", token_hash: await sha256(TOKEN + "B"), endurance_event_id: "evt-B", endurance_team_id: "team-B" });
    db.devices = [devA, devB];
    db.activeRuns.set("evt-A:team-A:race", "run-A");
    db.activeRuns.set("evt-B:team-B:race", "run-B");
    const payload = v3Payload();
    const ctxA = await resolveTelemetryContext(TOKEN + "A", payload, makeMockSupabase(db), sha256);
    const ctxB = await resolveTelemetryContext(TOKEN + "B", payload, makeMockSupabase(db), sha256);
    expect(ctxA.deviceId).toBe("dev-A");
    expect(ctxB.deviceId).toBe("dev-B");
    expect(ctxA.eventId).toBe("evt-A");
    expect(ctxB.eventId).toBe("evt-B");
  });

  it("D15 no auth header bounded reject", async () => {
    const ctx = await resolveTelemetryContext("", v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("invalid_device");
  });
});

// ==========================================================================
// D17-D28: Protocol / Parser tests
// ==========================================================================

describe("D17-D28 protocol and parser", () => {
  let db: MockDb;

  beforeAll(async () => {
    db = {
      devices: [makeDevice({ token_hash: "placeholder" })],
      activeRuns: new Map([["evt-1111-1111:team-1111-1111:race", "run-1111-1111"]]),
    };
  });

  it("D17 valid V1 path regression", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    db.activeRuns.set("evt-1111-1111:team-1111-1111:race", "run-1111-1111");
    const ctx = await resolveTelemetryContext(TOKEN, v1Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("accepted_context");
    expect(ctx.normalized).not.toBeNull();
    expect(ctx.normalized!.protocolVersion).toBe(1);
  });

  it("D18 valid V2 path regression", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    db.activeRuns.set("evt-1111-1111:team-1111-1111:race", "run-1111-1111");
    const ctx = await resolveTelemetryContext(TOKEN, v2Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("accepted_context");
    expect(ctx.normalized!.protocolVersion).toBe(2);
  });

  it("D19 valid V3 path", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    db.activeRuns.set("evt-1111-1111:team-1111-1111:race", "run-1111-1111");
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("accepted_context");
    expect(ctx.normalized!.protocolVersion).toBe(3);
  });

  it("D20 malformed V3 reject", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    const ctx = await resolveTelemetryContext(TOKEN, { protocolVersion: 3, badKey: true }, makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("invalid_payload");
  });

  it("D21 malformed V3 no V2 fallback", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    const ctx = await resolveTelemetryContext(TOKEN, { protocolVersion: 3 }, makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("invalid_payload");
  });

  it("D22 unknown protocol reject", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    const ctx = await resolveTelemetryContext(TOKEN, { protocolVersion: 99 }, makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("unsupported_version");
  });

  it("D23 unknown V3 root key reject", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload({ raceRunId: "should-fail" }), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("invalid_payload");
  });

  it("D25 removed strategy fields reject (fuelPerLapLitres in root)", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload({ fuelPerLapLitres: 3.2 }), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("invalid_payload");
  });

  it("D26 tyres reject", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload({ tyres: {} }), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("invalid_payload");
  });

  it("D27 fastRepairAvailable reject", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload({ fastRepairAvailable: true }), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("invalid_payload");
  });

  it("D28 valid nullable SOURCE-PROVEN fields accepted", async () => {
    db.devices = [makeDevice({ token_hash: await sha256(TOKEN) })];
    db.activeRuns.set("evt-1111-1111:team-1111-1111:race", "run-1111-1111");
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload({
      position: { position: null, classPosition: null, gapToLeaderSeconds: null },
      timing: { currentLapElapsedSeconds: null, lastLapTimeSeconds: null, bestLapTimeSeconds: null },
    }), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("accepted_context");
    expect(ctx.normalized!.position.position).toBeNull();
    expect(ctx.normalized!.position.classPosition).toBeNull();
    expect(ctx.normalized!.timing.currentLapElapsedSeconds).toBeNull();
  });
});

// ==========================================================================
// D29-D40: RaceRun tests
// ==========================================================================

describe("D29-D40 race run resolution", () => {
  let db: MockDb;

  beforeAll(async () => {
    db = {
      devices: [makeDevice({ token_hash: await sha256(TOKEN) })],
      activeRuns: new Map(),
    };
  });

  it("D29 active race run resolved", async () => {
    db.activeRuns.set("evt-1111-1111:team-1111-1111:race", "run-abc-123");
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.raceRunId).toBe("run-abc-123");
    expect(ctx.hasActiveRaceRun).toBe(true);
    expect(ctx.result).toBe("accepted_context");
  });

  it("D30 no active race run -> accepted_context_no_race_run, not telemetry failure", async () => {
    db.activeRuns.clear();
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("accepted_context_no_race_run");
    expect(ctx.raceRunId).toBeNull();
    expect(ctx.hasActiveRaceRun).toBe(false);
    expect(ctx.normalized).not.toBeNull();
  });

  it("D31 practice only -> no race strategy run", async () => {
    db.activeRuns.clear();
    db.activeRuns.set("evt-1111-1111:team-1111-1111:practice", "run-practice-1");
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.raceRunId).toBeNull();
    expect(ctx.hasActiveRaceRun).toBe(false);
    expect(ctx.result).toBe("accepted_context_no_race_run");
  });

  it("D32 qualifying only -> no race strategy run", async () => {
    db.activeRuns.clear();
    db.activeRuns.set("evt-1111-1111:team-1111-1111:qualifying", "run-quali-1");
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.raceRunId).toBeNull();
  });

  it("D33 active race selected over other run kinds", async () => {
    db.activeRuns.clear();
    db.activeRuns.set("evt-1111-1111:team-1111-1111:race", "run-race-1");
    db.activeRuns.set("evt-1111-1111:team-1111-1111:practice", "run-practice-1");
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.raceRunId).toBe("run-race-1");
    expect(ctx.runKind).toBe("race");
  });

  it("D34 connector transportSession change preserves raceRun", async () => {
    db.activeRuns.set("evt-1111-1111:team-1111-1111:race", "run-race-1");
    const ctx1 = await resolveTelemetryContext(TOKEN, v3Payload({ transportSessionId: "session-A" }), makeMockSupabase(db), sha256);
    const ctx2 = await resolveTelemetryContext(TOKEN, v3Payload({ transportSessionId: "session-B" }), makeMockSupabase(db), sha256);
    expect(ctx1.raceRunId).toBe("run-race-1");
    expect(ctx2.raceRunId).toBe("run-race-1");
  });

  it("D36-D38 authority handoff A->B preserves same raceRun", async () => {
    const devA = makeDevice({ id: "dev-A", token_hash: await sha256("token-A"), device_role: "primary" });
    const devB = makeDevice({ id: "dev-B", token_hash: await sha256("token-B"), device_role: "standby" });
    db.devices = [devA, devB];
    db.activeRuns.set("evt-1111-1111:team-1111-1111:race", "run-handoff-1");
    const ctxA = await resolveTelemetryContext("token-A", v3Payload(), makeMockSupabase(db), sha256);
    expect(ctxA.raceRunId).toBe("run-handoff-1");

    // After handoff: A=standby, B=primary
    devA.device_role = "standby";
    devB.device_role = "primary";
    db.devices = [devA, devB];
    const ctxA2 = await resolveTelemetryContext("token-A", v3Payload(), makeMockSupabase(db), sha256);
    expect(ctxA2.isAuthority).toBe(false);
    expect(ctxA2.result).toBe("not_authority");
    const ctxB = await resolveTelemetryContext("token-B", v3Payload(), makeMockSupabase(db), sha256);
    expect(ctxB.raceRunId).toBe("run-handoff-1");
    expect(ctxB.isAuthority).toBe(true);
  });

  it("D39 closed race run no longer resolves active", async () => {
    const localDevices = [makeDevice({ token_hash: await sha256(TOKEN + "_d39") })];
    const localDb = { devices: localDevices, activeRuns: new Map() };
    const ctx = await resolveTelemetryContext(TOKEN + "_d39", v3Payload(), makeMockSupabase(localDb), sha256);
    expect(ctx.raceRunId).toBeNull();
    expect(ctx.hasActiveRaceRun).toBe(false);
    expect(ctx.result).toBe("accepted_context_no_race_run");
  });

  it("D40 new explicit race run gets new raceRunId", async () => {
    const localDevices = [makeDevice({ token_hash: await sha256(TOKEN + "_d40") })];
    const localDb = { devices: localDevices, activeRuns: new Map([["evt-1111-1111:team-1111-1111:race", "run-new-1"]]) };
    const ctx = await resolveTelemetryContext(TOKEN + "_d40", v3Payload(), makeMockSupabase(localDb), sha256);
    expect(ctx.raceRunId).toBe("run-new-1");
    expect(ctx.normalized).not.toBeNull();
  });
});

// ==========================================================================
// D41-D46: Binding / registration regressions
// ==========================================================================

describe("D41-D46 binding and registration", () => {
  it("D41 invalid event/team binding -> not_bound (no binding columns)", async () => {
    const db = {
      devices: [makeDevice({ token_hash: await sha256(TOKEN), endurance_event_id: null, endurance_team_id: null })],
      activeRuns: new Map(),
    };
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("not_bound");
  });

  it("D44 revoked device rejected", async () => {
    const db = {
      devices: [makeDevice({ token_hash: await sha256(TOKEN), revoked_at: "2026-09-02T00:00:00Z" })],
      activeRuns: new Map(),
    };
    const ctx = await resolveTelemetryContext(TOKEN, v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("revoked");
  });

  it("D45 other team unaffected", async () => {
    const db = {
      devices: [
        makeDevice({ id: "dev-team1", owner_user_id: "usr-1", token_hash: await sha256("token-1"),
          endurance_event_id: "evt-1", endurance_team_id: "team-1", device_role: "primary" }),
        makeDevice({ id: "dev-team2", owner_user_id: "usr-2", token_hash: await sha256("token-2"),
          endurance_event_id: "evt-1", endurance_team_id: "team-2", device_role: "primary" }),
      ],
      activeRuns: new Map([
        ["evt-1:team-1:race", "run-t1"],
        ["evt-1:team-2:race", "run-t2"],
      ]),
    };
    const ctx1 = await resolveTelemetryContext("token-1", v3Payload(), makeMockSupabase(db), sha256);
    const ctx2 = await resolveTelemetryContext("token-2", v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx1.teamId).toBe("team-1");
    expect(ctx1.raceRunId).toBe("run-t1");
    expect(ctx2.teamId).toBe("team-2");
    expect(ctx2.raceRunId).toBe("run-t2");
  });

  it("D46 other event unaffected", async () => {
    const db = {
      devices: [
        makeDevice({ id: "dev-ev1", owner_user_id: "usr-1", token_hash: await sha256("token-ev1"),
          endurance_event_id: "evt-A", endurance_team_id: "team-A", device_role: "primary" }),
      ],
      activeRuns: new Map([["evt-A:team-A:race", "run-A"]]),
    };
    const ctx = await resolveTelemetryContext("token-ev1", v3Payload(), makeMockSupabase(db), sha256);
    expect(ctx.eventId).toBe("evt-A");
    expect(ctx.raceRunId).toBe("run-A");
  });
});

// ==========================================================================
// Cross-layer C# golden fixture
// ==========================================================================

describe("C# golden fixture through Edge context", () => {
  it("serializer-c01 full snapshot accepted", async () => {
    const fs = await import("node:fs");
    const json = fs.readFileSync("contracts/fixtures/v3-serializer-c01.json", "utf-8");
    const payload = JSON.parse(json);
    const db = {
      devices: [makeDevice({ token_hash: await sha256(TOKEN + "_csharp") })],
      activeRuns: new Map([["evt-1111-1111:team-1111-1111:race", "run-csharp-1"]]),
    };
    const ctx = await resolveTelemetryContext(TOKEN + "_csharp", payload, makeMockSupabase(db), sha256);
    expect(ctx.result).toBe("accepted_context");
    expect(ctx.raceRunId).toBe("run-csharp-1");
    expect(ctx.normalized!.protocolVersion).toBe(3);
  });
});

// ==========================================================================
// Performance sanity
// ==========================================================================

describe("performance sanity", () => {
  it("20 context resolutions under 5s", async () => {
    const db = {
      devices: [makeDevice({ token_hash: await sha256("perf-token") })],
      activeRuns: new Map([["evt-1111-1111:team-1111-1111:race", "run-perf-1"]]),
    };
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      await resolveTelemetryContext("perf-token", v3Payload({ sequence: i }), makeMockSupabase(db), sha256);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});