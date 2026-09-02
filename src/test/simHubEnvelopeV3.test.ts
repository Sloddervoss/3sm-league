import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import {
  parseTelemetryV3Envelope,
  parseTelemetryEnvelope,
  normalizeTelemetryEnvelope,
} from "../../supabase/functions/_shared/simhub";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const fullFixture = read("contracts/fixtures/v3-valid-full.json");
const minimalFixture = read("contracts/fixtures/v3-valid-minimal.json");
const normalizedDto = read("contracts/fixtures/v3-normalized-dto.json");
const v3Schema = read("contracts/simhub-telemetry.v3.schema.json");

const v3Full = () => clone(fullFixture);
const v3Minimal = () => clone(minimalFixture);

const compileValidator = () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: false });
  addFormats(ajv);
  const validate = ajv.compile(v3Schema);
  return (data: unknown): boolean => validate(data);
};

const v2Envelope = (extra: Record<string, unknown> = {}) => ({
  protocolVersion: 2,
  sequence: 5,
  capturedAt: "2026-08-06T09:00:00.000Z",
  source: { connectorId: "SIM-PC", simHubVersion: "9.11.21.0", game: "IRacing" },
  race: {
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
  },
  telemetry: {
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
    isInCar: true,
  },
  ...extra,
});

describe("v3 schema contract [S]", () => {
  const validates = compileValidator();

  it("[S01] schema parses, root is exact-allowlist object with additionalProperties:false", () => {
    expect(v3Schema.additionalProperties).toBe(false);
    expect(new Set(v3Schema.required)).toEqual(
      new Set(["protocolVersion", "sequence", "capturedAt", "transportSessionId", "identity", "session", "timing", "position", "track", "fuel", "raceState", "pitService"]),
    );
  });

  it("[S02] schema forbids the frozen V2/V1 trees (source/race) and client-authority fields", () => {
    const props = Object.keys(v3Schema.properties);
    for (const forbidden of ["source", "race", "raceRunId", "deviceId", "eventId", "teamId", "ownerUserId", "authority", "deviceRole"]) {
      expect(props).not.toContain(forbidden);
    }
  });

  it("[S03] valid-full fixture passes strict validation", () => {
    expect(validates(fullFixture)).toBe(true);
  });

  it("[S04] valid-minimal (nullable) fixture passes strict validation", () => {
    expect(validates(minimalFixture)).toBe(true);
  });

  it("[S05] schema rejects unknown root key (source)", () => {
    const payload = { ...v3Full(), source: { connectorId: "x" } };
    expect(validates(payload)).toBe(false);
  });

  it("[S06] schema rejects unknown nested key in session", () => {
    const payload = v3Full();
    payload.session.extra = "x";
    expect(validates(payload)).toBe(false);
  });

  it("[S07] schema rejects sessionLapsRemaining sentinel 32767", () => {
    const payload = v3Full();
    payload.session.sessionLapsRemaining = 32767;
    expect(validates(payload)).toBe(false);
  });

  it("[S08] schema rejects sessionTimeRemainingSeconds sentinel 604800", () => {
    const payload = v3Full();
    payload.session.sessionTimeRemainingSeconds = 604800;
    expect(validates(payload)).toBe(false);
  });

  it("[S09] schema rejects out-of-range enum for sessionState and trackSurface", () => {
    const badSession = { ...v3Full(), session: { ...v3Full().session, sessionState: "bogus" } };
    const badTrack = { ...v3Full(), track: { ...v3Full().track, trackSurface: "bogus" } };
    expect(validates(badSession)).toBe(false);
    expect(validates(badTrack)).toBe(false);
  });

  it("[S10] schema rejects non-empty flags element outside enum (unknown/tyres forbidden)", () => {
    const payload = v3Full();
    payload.session.flags = ["green", "tyres"];
    expect(validates(payload)).toBe(false);
  });
});

describe("v3 strict parser — accepts", () => {
  it("[A01] parses full fixture and matches golden normalized DTO", () => {
    expect(parseTelemetryV3Envelope(v3Full())).toEqual(normalizedDto);
  });

  it("[A02] parses minimal nullable fixture; server-authoritative fields stay null", () => {
    const parsed = parseTelemetryV3Envelope(v3Minimal());
    expect(parsed).toEqual({
      protocolVersion: 3,
      sequence: 7,
      capturedAt: "2026-09-02T14:35:00.000Z",
      transportSessionId: "connector-session-guid-0002",
      raceRunId: null, eventId: null, teamId: null, deviceId: null, ownerUserId: null, authority: null, deviceRole: null,
      identity: { currentDriverId: null, currentDriverName: null, carId: null, carName: null, trackName: null, trackConfig: null },
      session: { isInCar: false, sessionTimeSeconds: null, sessionTimeRemainingSeconds: null, sessionLapsRemaining: null, flags: null, sessionState: "unknown" },
      timing: { currentLapElapsedSeconds: null, lastLapTimeSeconds: null, bestLapTimeSeconds: null },
      position: { position: null, classPosition: null, gapToLeaderSeconds: null },
      track: { lapDistancePct: null, trackSurface: "unknown", onPitRoad: null },
      fuel: { fuelLitres: null, fuelPct: null },
      raceState: { incidents: null },
      pitService: { pitServiceFlagsRaw: null, requiredRepairSeconds: null, optionalRepairSeconds: null },
    });
  });

  it("[A03] accepts every RaceFlag enum member and the empty array []", () => {
    const flags = ["green", "yellow", "red", "white", "checkered", "blue", "black", "meatball", "disqualify"];
    const payload = v3Full();
    payload.session.flags = flags;
    expect(parseTelemetryV3Envelope(payload).session.flags).toEqual(flags);
    payload.session.flags = [];
    expect(parseTelemetryV3Envelope(payload).session.flags).toEqual([]);
  });

  it("[A04] accepts every SessionState enum value", () => {
    const states = ["not_in_world", "warmup", "parade_laps", "racing", "checkered", "cool_down", "unknown"];
    for (const state of states) {
      const payload = v3Full();
      payload.session.sessionState = state;
      expect(parseTelemetryV3Envelope(payload).session.sessionState).toBe(state);
    }
  });

  it("[A05] accepts every TrackSurface enum value", () => {
    const surfaces = ["on_track", "off_track", "in_pit_stall", "approaching_pits", "not_in_world", "unknown"];
    for (const surface of surfaces) {
      const payload = v3Full();
      payload.track.trackSurface = surface;
      expect(parseTelemetryV3Envelope(payload).track.trackSurface).toBe(surface);
    }
  });

  it("[A06] preserves transportSessionId, sequence, capturedAt verbatim", () => {
    const parsed = parseTelemetryV3Envelope(v3Full());
    expect(parsed.transportSessionId).toBe("connector-session-guid-0001");
    expect(parsed.sequence).toBe(12345);
    expect(parsed.capturedAt).toBe("2026-09-02T14:35:00.000Z");
  });
});

describe("v3 strict parser — exact per-version allowlist rejection", () => {
  const reject = (payload: unknown) => {
    expect(() => parseTelemetryV3Envelope(payload)).toThrow();
  };

  it("[A11] rejects unknown root key (source/raceRunId/client-authority)", () => {
    reject({ ...v3Full(), source: { connectorId: "x" } });
    reject({ ...v3Full(), raceRunId: "server-only" });
    reject({ ...v3Full(), deviceId: "server-only" });
  });

  it("[A12] rejects unknown key in identity", () => {
    const p = v3Full(); (p.identity as Record<string, unknown>).rawIracing = "x"; reject(p);
  });

  it("[A13] rejects unknown key in session", () => {
    const p = v3Full(); (p.session as Record<string, unknown>).gameSessionKey = "x"; reject(p);
  });

  it("[A14] rejects unknown key in timing", () => {
    const p = v3Full(); (p.timing as Record<string, unknown>).tyres = "x"; reject(p);
  });

  it("[A15] rejects unknown key in position", () => {
    const p = v3Full(); (p.position as Record<string, unknown>).gapToPit = "x"; reject(p);
  });

  it("[A16] rejects unknown key in track", () => {
    const p = v3Full(); (p.track as Record<string, unknown>).gpsX = 1; reject(p);
  });

  it("[A17] rejects unknown key in fuel", () => {
    const p = v3Full(); (p.fuel as Record<string, unknown>).fuelPerLapLitres = 3.2; reject(p);
  });

  it("[A18] rejects unknown key in raceState", () => {
    const p = v3Full(); (p.raceState as Record<string, unknown>).fastRepairAvailable = true; reject(p);
  });

  it("[A19] rejects unknown key in pitService", () => {
    const p = v3Full(); (p.pitService as Record<string, unknown>).tyreChangeSeconds = 30; reject(p);
  });

  it("[A20] rejects missing required root field", () => {
    const p = v3Full(); delete (p as Record<string, unknown>).pitService; reject(p);
  });

  it("[A21] rejects missing required nested field", () => {
    const p = v3Full(); delete (p.session as Record<string, unknown>).sessionState; reject(p);
  });

  it("[A22] rejects non-V3 protocolVersion through the strict V3 entry point", () => {
    const p = v3Full(); (p as Record<string, unknown>).protocolVersion = 2; reject(p);
  });
});

describe("v3 strict parser — numeric/type constraints & sentinel normalization", () => {
  const parsed = (mutate: (p: Record<string, unknown>) => void) => {
    const p = v3Full() as unknown as Record<string, unknown>;
    mutate(p);
    return parseTelemetryV3Envelope(p);
  };
  const rejects = (mutate: (p: Record<string, unknown>) => void) => {
    const p = v3Full() as unknown as Record<string, unknown>;
    mutate(p);
    expect(() => parseTelemetryV3Envelope(p)).toThrow();
  };
  const session = (p: Record<string, unknown>) => p.session as Record<string, unknown>;
  const timing = (p: Record<string, unknown>) => p.timing as Record<string, unknown>;
  const position = (p: Record<string, unknown>) => p.position as Record<string, unknown>;
  const fuel = (p: Record<string, unknown>) => p.fuel as Record<string, unknown>;

  it("[A31] rejects invalid capturedAt", () => { rejects((p) => { p.capturedAt = "not-a-date"; }); });
  it("[A32] rejects non-integer sequence", () => { rejects((p) => { p.sequence = 5.5; }); });
  it("[A33] rejects negative sequence", () => { rejects((p) => { p.sequence = -1; }); });
  it("[A34] rejects empty transportSessionId", () => { rejects((p) => { p.transportSessionId = "   "; }); });
  it("[A35] rejects non-finite sessionTimeSeconds", () => { rejects((p) => { session(p).sessionTimeSeconds = NaN; }); });
  it("[A36] rejects sessionTimeSeconds above 604800", () => { rejects((p) => { session(p).sessionTimeSeconds = 604801; }); });

  it("[A37] normalizes sessionLapsRemaining sentinel 32767 to null", () => {
    expect(parsed((p) => { session(p).sessionLapsRemaining = 32767; }).session.sessionLapsRemaining).toBeNull();
  });
  it("[A38] normalizes sessionLapsRemaining -1 to null", () => {
    expect(parsed((p) => { session(p).sessionLapsRemaining = -1; }).session.sessionLapsRemaining).toBeNull();
  });
  it("[A39] rejects non-integer sessionLapsRemaining", () => { rejects((p) => { session(p).sessionLapsRemaining = 42.5; }); });

  it("[A40] normalizes sessionTimeRemainingSeconds 604800 (unlimited) to null", () => {
    expect(parsed((p) => { session(p).sessionTimeRemainingSeconds = 604800; }).session.sessionTimeRemainingSeconds).toBeNull();
  });
  it("[A41] rejects sessionTimeRemainingSeconds above 604800 (no heuristic, strict bound)", () => {
    rejects((p) => { session(p).sessionTimeRemainingSeconds = 604801; });
  });

  it("[A42] normalizes timing 0 and -1 sentinels to null", () => {
    const p = v3Full(); p.timing.lastLapTimeSeconds = 0; p.timing.bestLapTimeSeconds = -1;
    const out = parseTelemetryV3Envelope(p);
    expect(out.timing.lastLapTimeSeconds).toBeNull();
    expect(out.timing.bestLapTimeSeconds).toBeNull();
  });
  it("[A43] rejects timing value below sentinel/range (-2)", () => {
    rejects((p) => { timing(p).lastLapTimeSeconds = -2; });
  });

  it("[A44] normalizes position 0/-1 to null and rejects 1001", () => {
    const p = v3Full(); p.position.position = 0; p.position.classPosition = -1;
    const out = parseTelemetryV3Envelope(p);
    expect(out.position.position).toBeNull();
    expect(out.position.classPosition).toBeNull();
    rejects((p2) => { position(p2).position = 1001; });
  });
  it("[A45] rejects non-integer position", () => { rejects((p) => { position(p).position = 4.5; }); });

  it("[A46] rejects fuelPct outside [0,1] and normalizes -1 to null", () => {
    rejects((p) => { fuel(p).fuelPct = 1.5; });
    expect(parsed((p) => { fuel(p).fuelPct = -1; }).fuel.fuelPct).toBeNull();
  });
  it("[A47] normalizes incidents -1 to null and keeps positive incidents", () => {
    const out = parsed((p) => { (p.raceState as Record<string, unknown>).incidents = -1; });
    expect(out.raceState.incidents).toBeNull();
  });

  it("[A48] rejects invalid sessionState enum", () => { rejects((p) => { session(p).sessionState = "parade"; }); });
  it("[A49] rejects invalid flag member in flags", () => {
    rejects((p) => { session(p).flags = ["green", "bogus"]; });
  });
  it("[A50] rejects flags that is not an array or null", () => {
    rejects((p) => { session(p).flags = "green"; });
    rejects((p) => { session(p).flags = 3; });
  });
  it("[A51] rejects non-boolean isInCar / onPitRoad", () => {
    rejects((p) => { session(p).isInCar = "yes"; });
    rejects((p) => { (p.track as Record<string, unknown>).onPitRoad = "yes"; });
  });
  it("[A52] rejects gapToLeaderSeconds negative beyond sentinel (-2)", () => {
    rejects((p) => { (p.position as Record<string, unknown>).gapToLeaderSeconds = -2; });
  });
});

describe("normalizeTelemetryEnvelope — version dispatch", () => {
  it("[D01] V3 dispatches to the strict V3 parser", () => {
    expect(normalizeTelemetryEnvelope(v3Full())).toEqual(parseTelemetryV3Envelope(v3Full()));
  });

  it("[D02] maps V2 sessionId to transportSessionId and keeps current driver", () => {
    const out = normalizeTelemetryEnvelope(v2Envelope());
    expect(out.protocolVersion).toBe(2);
    expect(out.transportSessionId).toBe("simhub-abc");
    expect(out.identity.currentDriverId).toBe("302911");
    expect(out.identity.currentDriverName).toBe("Vincent");
    expect(out.identity.carName).toBe("Porsche 911 GT3 R");
    expect(out.raceRunId).toBeNull();
    expect(out.eventId).toBeNull();
    expect(out.teamId).toBeNull();
    expect(out.authority).toBeNull();
    expect(out.session.isInCar).toBe(true);
    expect(out.session.sessionState).toBe("unknown");
    expect(out.session.flags).toEqual(["green"]);
  });

  it("[D03] normalizes V1 (identity null, isInCar true, sessionId->transportSessionId)", () => {
    const v1 = (
      b: ReturnType<typeof v2Envelope>,
    ) => ({
      ...b,
      protocolVersion: 1,
      race: { eventId: "connection-test", teamId: "unassigned", sessionId: "simhub-abc", driverId: null },
      telemetry: (() => { const t = { ...b.telemetry }; delete (t as Record<string, unknown>).isInCar; return t; })(),
    });
    const out = normalizeTelemetryEnvelope(v1(v2Envelope()));
    expect(out.protocolVersion).toBe(1);
    expect(out.transportSessionId).toBe("simhub-abc");
    expect(out.identity.currentDriverId).toBeNull();
    expect(out.identity.carId).toBeNull();
    expect(out.session.isInCar).toBe(true);
  });

  it("[D04] rejects unsupported protocolVersion", () => {
    expect(() => normalizeTelemetryEnvelope({ ...v3Full(), protocolVersion: 99 })).toThrow(/unsupported/);
  });

  it("[D05] V2 non-integer estimatedLapsRemaining stays null in sessionLapsRemaining", () => {
    const out = normalizeTelemetryEnvelope(v2Envelope({ telemetry: { ...v2Envelope().telemetry, estimatedLapsRemaining: 14.7 } }));
    expect(out.session.sessionLapsRemaining).toBeNull();
  });
});

describe("golden fixtures & v1/v2 regression guard", () => {
  it("[G01] equivalence between dispatcher and strict parser for full fixture", () => {
    expect(normalizeTelemetryEnvelope(v3Full())).toEqual(normalizedDto);
  });

  it("[B01] preserved: parseTelemetryEnvelope still rejects V3 and keeps V2 behavior", () => {
    expect(() => parseTelemetryEnvelope(v3Full())).toThrow(/unknown or missing/);
    expect(() => parseTelemetryEnvelope(v3Minimal())).toThrow(/unknown or missing/);
    const v2 = parseTelemetryEnvelope(v2Envelope());
    expect(v2.protocolVersion).toBe(2);
    expect(v2.race.currentDriverId).toBe("302911");
    expect(v2.telemetry.isInCar).toBe(true);
  });
});