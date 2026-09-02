import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import {
  parseTelemetryV3Envelope,
  parseTelemetryEnvelope,
  normalizeTelemetryEnvelope,
} from "../../supabase/functions/_shared/simhub";

// Phase C cross-language contract: these fixtures are the JSON that a
// DataContractJsonSerializer run over the C# TelemetryEnvelopeV3 types emits.
// The C# serializer cannot run on this server (no .NET), so we validate the
// golden fixtures against the Phase A schema + TS parser instead. Every emitted
// snapshot always carries sessionState/trackSurface "unknown" (Phase C defers
// the SDK -> enum mapping) and has already been sentinel-normalized connector-side.

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const fixturesDir = "contracts/fixtures";

const serializerFixtures = readdirSync(fixturesDir)
  .filter((f) => /^v3-serializer-c\d{2}\.json$/.test(f))
  .sort((a, b) => a.localeCompare(b))
  .map((f) => ({ name: f.replace(/^v3-serializer-(c\d{2})\.json$/, "$1"), data: read(`${fixturesDir}/${f}`) }));

const byName = (name: string) => {
  const hit = serializerFixtures.find((f) => f.name === name);
  if (!hit) throw new Error(`missing fixture ${name}`);
  return hit.data as Record<string, any>;
};

const v3Schema = read("contracts/simhub-telemetry.v3.schema.json");
const normalizedDto = read("contracts/fixtures/v3-normalized-dto.json");

const compileValidator = () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: false });
  addFormats(ajv);
  const validate = ajv.compile(v3Schema);
  return (data: unknown): boolean => validate(data);
};
const validates = compileValidator();

const normalize = (name: string) => normalizeTelemetryEnvelope(byName(name));

describe("V3 serializer golden fixtures — C01..C25 (schema + parser + dispatcher)", () => {
  it.each(serializerFixtures)("[%s] fixtures validate against the V3 schema", ({ name, data }) => {
    expect(name).toMatch(/^c\d{2}$/);
    expect(serializerFixtures.length).toBe(25);
    expect(validates(data)).toBe(true);
  });

  it.each(serializerFixtures)("[%s] parses via strict parseTelemetryV3Envelope", ({ name, data }) => {
    const parsed = parseTelemetryV3Envelope(JSON.parse(JSON.stringify(data)));
    expect(parsed.protocolVersion).toBe(3);
  });

  it.each(serializerFixtures)("[%s] normalizes via normalizeTelemetryEnvelope", ({ name }) => {
    expect(() => normalize(name)).not.toThrow();
  });

  it("[C01] full snapshot preserves identity/session/timing/position values and Phase C unknown state", () => {
    const n = normalize("c01");
    expect(n.sequence).toBe(12345);
    expect(n.transportSessionId).toBe("connector-session-guid-0001");
    expect(n.identity).toEqual({
      currentDriverId: "302911", currentDriverName: "Vincent", carId: "GT3-911",
      carName: "Porsche 911 GT3 R", trackName: "Zandvoort", trackConfig: "Grand Prix",
    });
    expect(n.session).toMatchObject({
      isInCar: true, sessionTimeSeconds: 1234.56, sessionTimeRemainingSeconds: 3600,
      sessionLapsRemaining: 42, flags: ["green", "yellow"], sessionState: "unknown",
    });
    expect(n.timing).toMatchObject({ currentLapElapsedSeconds: 45.12, lastLapTimeSeconds: 121.25, bestLapTimeSeconds: 120.98 });
    expect(n.position).toMatchObject({ position: 4, classPosition: 2, gapToLeaderSeconds: 3.75 });
    expect(n.track).toMatchObject({ lapDistancePct: 0.375, trackSurface: "unknown", onPitRoad: false });
    expect(n.fuel).toMatchObject({ fuelLitres: 52.67, fuelPct: 0.48 });
    expect(n.raceState.incidents).toBe(6);
    expect(n.pitService).toMatchObject({ pitServiceFlagsRaw: 0, requiredRepairSeconds: 12.5, optionalRepairSeconds: null });
  });

  it("[C02] minimal all-null snapshot keeps server-authoritative fields null", () => {
    const n = normalize("c02");
    expect(n).toMatchObject({
      sequence: 7, transportSessionId: "connector-session-guid-0002",
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

  it("[C05] sessionTimeRemainingSeconds 604800 (unlimited) is already null connector-side", () => {
    expect(normalize("c05").session.sessionTimeRemainingSeconds).toBeNull();
    expect((byName("c05").session as Record<string, any>).sessionTimeRemainingSeconds).toBeNull();
  });

  it("[C06] sessionLapsRemaining 32767 sentinel is already null connector-side", () => {
    expect(normalize("c06").session.sessionLapsRemaining).toBeNull();
  });
  it("[C07] sessionLapsRemaining -1 is already null connector-side", () => {
    expect(normalize("c07").session.sessionLapsRemaining).toBeNull();
  });

  it("[C08] currentLapElapsedSeconds 0 sentinel is already null connector-side", () => {
    expect(normalize("c08").timing.currentLapElapsedSeconds).toBeNull();
  });
  it("[C09] timing -1/0 sentinels are already null connector-side", () => {
    const n = normalize("c09");
    expect(n.timing.lastLapTimeSeconds).toBeNull();
    expect(n.timing.bestLapTimeSeconds).toBeNull();
  });

  it("[C10] position 0 sentinel is already null; classPosition kept", () => {
    const n = normalize("c10");
    expect(n.position.position).toBeNull();
    expect(n.position.classPosition).toBe(2);
  });
  it("[C11] position 0 / classPosition -1 are already null; gap kept", () => {
    const n = normalize("c11");
    expect(n.position.position).toBeNull();
    expect(n.position.classPosition).toBeNull();
    expect(n.position.gapToLeaderSeconds).toBe(3.75);
  });

  it("[C12] negative fuelLitres is already null; fuelPct kept", () => {
    const n = normalize("c12");
    expect(n.fuel.fuelLitres).toBeNull();
    expect(n.fuel.fuelPct).toBe(0.48);
  });
  it("[C13] fuelPct >1 is already null; fuelLitres kept", () => {
    const n = normalize("c13");
    expect(n.fuel.fuelPct).toBeNull();
    expect(n.fuel.fuelLitres).toBe(52.67);
  });

  it("[C14] lapDistancePct out of [0,1] is already null", () => {
    expect(normalize("c14").track.lapDistancePct).toBeNull();
  });

  it("[C15] negative incidents are already null", () => {
    expect(normalize("c15").raceState.incidents).toBeNull();
  });
  it("[C16] negative requiredRepairSeconds is already null; optional kept", () => {
    const n = normalize("c16");
    expect(n.pitService.requiredRepairSeconds).toBeNull();
    expect(n.pitService.optionalRepairSeconds).toBe(12.5);
  });

  it("[C17] flags are deduplicated allowlisted strings", () => {
    expect(normalize("c17").session.flags).toEqual(["green", "yellow"]);
  });
  it("[C18] single flag emitted", () => {
    expect(normalize("c18").session.flags).toEqual(["checkered"]);
  });
  it("[C19] no flag -> null", () => {
    expect(normalize("c19").session.flags).toBeNull();
  });
  it("[C20] all nine allowlisted flags emitted", () => {
    expect(normalize("c20").session.flags).toEqual(
      ["green", "yellow", "red", "white", "checkered", "blue", "black", "meatball", "disqualify"],
    );
  });

  it("[C21] non-zero pitServiceFlagsRaw and both repairs kept", () => {
    const n = normalize("c21");
    expect(n.pitService.pitServiceFlagsRaw).toBe(16384);
    expect(n.pitService.requiredRepairSeconds).toBe(12.5);
    expect(n.pitService.optionalRepairSeconds).toBe(20.0);
  });

  it("[C22] first capture at sequence 0 is valid", () => {
    const n = normalize("c22");
    expect(n.sequence).toBe(0);
    expect(n.session.isInCar).toBe(false);
  });

  it("[C23] near-bound currentLapElapsedSeconds passes", () => {
    expect(normalize("c23").timing.currentLapElapsedSeconds).toBe(86100);
  });
  it("[C24] large gapToLeaderSeconds passes", () => {
    expect(normalize("c24").position.gapToLeaderSeconds).toBe(54000);
  });
  it("[C25] pit-stop snapshot keeps onPitRoad, low fuel, both repairs", () => {
    const n = normalize("c25");
    expect(n.track.onPitRoad).toBe(true);
    expect(n.fuel.fuelLitres).toBe(4.2);
    expect(n.pitService.requiredRepairSeconds).toBe(45.0);
    expect(n.pitService.optionalRepairSeconds).toBe(20.0);
  });
});

describe("V3 serializer fixture regression — C26..C40", () => {
  it("[C26] every serializer fixture passes strict Ajv validation", () => {
    for (const f of serializerFixtures) expect(validates(f.data)).toBe(true);
  });
  it("[C27] every serializer fixture parses via parseTelemetryV3Envelope", () => {
    for (const f of serializerFixtures) expect(parseTelemetryV3Envelope(JSON.parse(JSON.stringify(f.data))).protocolVersion).toBe(3);
  });
  it("[C28] every serializer fixture normalizes via normalizeTelemetryEnvelope", () => {
    for (const f of serializerFixtures) expect(() => normalizeTelemetryEnvelope(f.data)).not.toThrow();
  });
  it("[C29] every fixture carries protocolVersion 3 and a sequence >= 0", () => {
    for (const f of serializerFixtures) {
      expect((f.data as Record<string, any>).protocolVersion).toBe(3);
      expect((f.data as Record<string, any>).sequence).toBeGreaterThanOrEqual(0);
    }
  });
  it("[C30] no forbidden root keys anywhere (source/race/raceRunId/client-authority)", () => {
    const forbidden = ["source", "race", "raceRunId", "deviceId", "eventId", "teamId", "authority", "ownerUserId", "deviceRole"];
    for (const f of serializerFixtures) for (const key of forbidden) expect(f.data).not.toHaveProperty(key);
  });
  it("[C31] no forbidden nested keys (tyres/fastRepair/gameSessionKey/strategy/fuelPerLap/estimatedLaps)", () => {
    const forbidden = ["tyres", "fastRepairAvailable", "gameSessionKey", "strategy", "fuelPerLapLitres", "estimatedLapsRemaining"];
    for (const f of serializerFixtures) {
      const walk = (node: unknown, path: string): void => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
        const rec = node as Record<string, unknown>;
        for (const key of Object.keys(rec)) {
          expect(forbidden).not.toContain(key);
          walk(rec[key], `${path}.${key}`);
        }
      };
      walk(f.data, "root");
    }
  });
  it("[C32] sessionState and trackSurface are always the allowlisted 'unknown' string", () => {
    for (const f of serializerFixtures) {
      expect((f.data as Record<string, any>).session.sessionState).toBe("unknown");
      expect((f.data as Record<string, any>).track.trackSurface).toBe("unknown");
    }
  });
  it("[C33] every flag member is allowlisted (never unknown/tyres/raw)", () => {
    const allow = new Set(["green", "yellow", "red", "white", "checkered", "blue", "black", "meatball", "disqualify"]);
    for (const f of serializerFixtures) {
      const flags = (f.data as Record<string, any>).session.flags;
      if (flags === null) continue;
      for (const flag of flags) expect(allow.has(flag)).toBe(true);
    }
  });
  it("[C34] no raw SDK sentinels remain in any fixture (32767/604800/-1 as values)", () => {
    for (const f of serializerFixtures) {
      const json = JSON.stringify(f.data);
      for (const sentinel of [32767, 604800, -1]) expect(json.includes(JSON.stringify(sentinel))).toBe(false);
    }
  });
  it("[C35] C01 normalized DTO agrees with the Phase A golden full fixture modulo deferred 'unknown' state", () => {
    const n = normalize("c01");
    const golden = normalizedDto;
    expect(n.identity).toEqual(golden.identity);
    expect(n.session).toMatchObject({
      isInCar: golden.session.isInCar, sessionTimeSeconds: golden.session.sessionTimeSeconds,
      sessionTimeRemainingSeconds: golden.session.sessionTimeRemainingSeconds,
      sessionLapsRemaining: golden.session.sessionLapsRemaining, flags: golden.session.flags,
    });
    expect(n.session.sessionState).toBe("unknown"); // Update() defers the SDK mapping
    expect(n.timing).toEqual(golden.timing);
    expect(n.position).toEqual(golden.position);
    expect(n.track.trackSurface).toBe("unknown"); // Update() defers the SDK mapping
    expect(n.track).toMatchObject({ lapDistancePct: golden.track.lapDistancePct, onPitRoad: golden.track.onPitRoad });
    expect(n.fuel).toEqual(golden.fuel);
    expect(n.raceState).toEqual(golden.raceState);
    expect(n.pitService).toEqual(golden.pitService);
  });
  it("[C36] isInCar and onPitRoad are boolean or null in every fixture", () => {
    for (const f of serializerFixtures) {
      expect([true, false, null]).toContain((f.data as Record<string, any>).session.isInCar);
      expect([true, false, null]).toContain((f.data as Record<string, any>).track.onPitRoad);
    }
  });
  it("[C37] V2 parse entry point still rejects V3 serializer fixtures (V2 path unchanged)", () => {
    for (const f of serializerFixtures) expect(() => parseTelemetryEnvelope(f.data)).toThrow(/unknown or missing/);
  });
  it("[C38] every fixture has the exact V3 root allowlist (parse-level exactKeys)", () => {
    const expected = ["protocolVersion", "sequence", "capturedAt", "transportSessionId", "identity", "session", "timing", "position", "track", "fuel", "raceState", "pitService"];
    for (const f of serializerFixtures) expect(Object.keys(f.data).sort()).toEqual([...expected].sort());
  });
  it("[C39] sentinel-normalized timing/position fixtures yield null in the normalized DTO", () => {
    expect(normalize("c08").timing.currentLapElapsedSeconds).toBeNull();
    expect(normalize("c09").timing.lastLapTimeSeconds).toBeNull();
    expect(normalize("c10").position.position).toBeNull();
    expect(normalize("c11").position.classPosition).toBeNull();
  });
  it("[C40] pitService scalar ranges stay within schema bounds with -1 normalized to null", () => {
    for (const f of serializerFixtures) {
      const ps = (f.data as Record<string, any>).pitService;
      for (const [key, max] of [["requiredRepairSeconds", 86400], ["optionalRepairSeconds", 86400]] as const) {
        const v = ps[key];
        if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
        if (v !== null) expect(v).toBeLessThanOrEqual(max);
      }
      if (ps.pitServiceFlagsRaw !== null) expect(ps.pitServiceFlagsRaw).toBeGreaterThanOrEqual(0);
    }
  });
});