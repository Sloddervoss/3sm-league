import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTelemetryV3Envelope } from "../../supabase/functions/_shared/simhub";
import { parseTyreTelemetry } from "../../supabase/functions/_shared/tyreTelemetry";
import { resolveTelemetryContext } from "../../supabase/functions/simhub-ingest-v3/context";

/**
 * S1 — contract voor het optionele root-blok `tyres`.
 *
 * Twee dingen worden hier bewezen:
 *  1. een bestaande payload (zonder `tyres`) verandert niet — de harde eis uit
 *     3sm-bandenplan.md §2, want de plugin rolt later uit dan de server;
 *  2. een payload mét `tyres` wordt gecontroleerd en levert bij een verkeerd type een
 *     422 op, geen 500 en geen stil weggeschreven half blok.
 *
 * De 202/422-toets loopt via de echte ingest-context (`resolveTelemetryContext`), niet
 * via een nagebouwde regex: zonder `tyres` komt er `accepted_device_context` uit (de tak
 * die in `simhub-ingest-v3/index.ts` met 202 antwoordt), met een verkeerd type
 * `invalid_payload` (die tak antwoordt 422).
 */

const volTyreBlok = () => ({
  wearPercent: {
    fl: { l: 0.9624, m: 0.9581, r: 0.9407 },
    fr: { l: 0.9702, m: 0.9655, r: 0.9532 },
    rl: { l: 0.9811, m: 0.9784, r: 0.969 },
    rr: { l: 0.984, m: 0.9802, r: 0.9755 },
  },
  carcassTempC: {
    fl: { l: 78.4, m: 80.1, r: 82 },
    fr: { l: 76.9, m: 79.4, r: 81.6 },
    rl: { l: 71.2, m: 73.8, r: 76.1 },
    rr: { l: 70.4, m: 72.9, r: 75.3 },
  },
  sets: { used: 3, available: 255, frontLeft: 1, frontRight: 1, rearLeft: 1, rearRight: 1 },
  compoundId: 0,
  environment: { trackTempC: 31.4, airTempC: 22.1, rubberState: "moderate usage" },
  pitEntry: {
    wearPercent: {
      fl: { l: 0.891, m: 0.9002, r: 0.9155 },
      fr: { l: 0.8801, m: 0.8894, r: 0.9021 },
      rl: { l: 0.9102, m: 0.9188, r: 0.9301 },
      rr: { l: 0.9044, m: 0.9126, r: 0.9255 },
    },
    carcassTempC: {
      fl: { l: 88.2, m: 90.4, r: 92.1 },
      fr: { l: 87.1, m: 89.6, r: 91.4 },
      rl: { l: 81.3, m: 83.9, r: 86.2 },
      rr: { l: 80.5, m: 82.7, r: 85.1 },
    },
    capturedAt: "2026-10-25T20:44:12.002Z",
  },
});

/** Minimale geldige V3-envelope; verder niets aan veranderen (legacy-compatibiliteit). */
const envelope = () => ({
  protocolVersion: 3,
  sequence: 1,
  capturedAt: "2026-10-25T12:00:00Z",
  transportSessionId: "test-session",
  identity: {
    currentDriverId: null,
    currentDriverName: "Vincent",
    carId: null,
    carName: null,
    trackName: "Spa-Francorchamps",
    trackConfig: "Grand Prix",
  },
  session: {
    isInCar: true,
    sessionTimeSeconds: 10,
    sessionTimeRemainingSeconds: 100,
    sessionLapsRemaining: null,
    flags: ["green"],
    sessionState: "racing",
  },
  timing: { currentLapElapsedSeconds: 10, lastLapTimeSeconds: null, bestLapTimeSeconds: null, completedLaps: 0 },
  position: { position: null, classPosition: null, gapToLeaderSeconds: null },
  track: { lapDistancePct: 0, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 50, fuelPct: null },
  raceState: { incidents: 0 },
  pitService: { pitServiceFlagsRaw: null, requiredRepairSeconds: null, optionalRepairSeconds: null },
});

const metTyres = (tyres: unknown) => ({ ...envelope(), tyres });

describe("V3-rootblok tyres: additief contract", () => {
  it("laat een bestaande payload zonder tyres exact zoals hij was", () => {
    const parsed = parseTelemetryV3Envelope(envelope());
    expect(parsed.tyres).toBeNull();
    expect(parsed.identity.currentDriverName).toBe("Vincent");
    expect(parsed.track.trackSurface).toBe("on_track");
    // Geen enkele bestaande sleutel verandert van vorm of waarde.
    const met = parseTelemetryV3Envelope({ ...envelope(), tyres: volTyreBlok() });
    const zonder = { ...parsed, tyres: undefined };
    expect({ ...met, tyres: undefined }).toEqual(zonder);
  });

  it("accepteert een volledig tyres-blok en geeft de waarden één-op-één terug", () => {
    expect(parseTelemetryV3Envelope(metTyres(volTyreBlok())).tyres).toEqual(volTyreBlok());
  });

  it("accepteert tyres: null en een leeggelaten onderdeel", () => {
    expect(parseTelemetryV3Envelope(metTyres(null)).tyres).toBeNull();
    const alleenCompound = parseTelemetryV3Envelope(metTyres({ compoundId: 1 }))!.tyres;
    expect(alleenCompound!.compoundId).toBe(1);
    expect(alleenCompound!.wearPercent).toEqual({ fl: null, fr: null, rl: null, rr: null });
    expect(alleenCompound!.pitEntry).toBeNull();
  });

  it("houdt null null en maakt er geen 0 van", () => {
    const tyres = {
      wearPercent: { fl: { l: null, m: null, r: null }, fr: null, rl: { l: 0, m: null, r: null }, rr: null },
      carcassTempC: { fl: null, fr: null, rl: null, rr: null },
      sets: { used: null, available: 255, frontLeft: null, frontRight: null, rearLeft: null, rearRight: null },
      compoundId: null,
      environment: { trackTempC: null, airTempC: null, rubberState: null },
      pitEntry: null,
    };
    const parsed = parseTyreTelemetry(tyres)!;
    expect(parsed.wearPercent.fl).toEqual({ l: null, m: null, r: null });
    expect(parsed.wearPercent.rl!.l).toBe(0); // een echte 0 blijft 0
    expect(parsed.wearPercent.rl!.m).toBeNull();
    expect(parsed.sets.used).toBeNull();
    expect(parsed.sets.available).toBe(255); // 255 = onbeperkt, geen "255 sets over"
    expect(parsed.compoundId).toBeNull();
    expect(parsed.environment.rubberState).toBeNull();
  });

  it("neemt rubberState als vrije tekst uit de sessie-YAML over", () => {
    for (const rubberState of ["moderate usage", "high usage", "carry over"]) {
      expect(parseTyreTelemetry({ environment: { rubberState } })!.environment.rubberState).toBe(rubberState);
    }
  });
});

describe("V3-rootblok tyres: onbekende velden en verkeerde types", () => {
  it("weigert een onbekend veld op elk niveau", () => {
    const gevallen = [
      { ...volTyreBlok(), observedAt: "2026-10-25T20:00:00Z" },
      { ...volTyreBlok(), wearPercent: { ...volTyreBlok().wearPercent, fm: { l: 1, m: 1, r: 1 } } },
      { ...volTyreBlok(), wearPercent: { ...volTyreBlok().wearPercent, fl: { l: 1, m: 1, r: 1, x: 1 } } },
      { ...volTyreBlok(), sets: { ...volTyreBlok().sets, tyresChanged: true } },
      { ...volTyreBlok(), sets: { used: 3, available: 255, frontLeft: 1, frontRight: 1, rearLeft: 1, rearRight: 1, extra: 1 } },
      { ...volTyreBlok(), environment: { trackTempC: 30, airTempC: 20, rubberState: "high usage", humidityPct: 40 } },
      { ...volTyreBlok(), pitEntry: { ...volTyreBlok().pitEntry, sessionTimeSeconds: 6501.7 } },
      // Het generieke `vehicle`-veld mag niet als achterdeur werken.
      { ...volTyreBlok(), frontLeft: { wearPercent: 90 } },
    ];
    for (const tyres of gevallen) expect(() => parseTyreTelemetry(tyres)).toThrow();
  });

  it("weigert een halve hoek (l/m/r zijn samen één meting)", () => {
    expect(() => parseTyreTelemetry({ wearPercent: { fl: { l: 0.9, m: 0.9 } } })).toThrow(/missing required field r/);
    expect(() => parseTyreTelemetry({ carcassTempC: { rr: { l: 80 } } })).toThrow();
  });

  it.each([
    ["string in plaats van getal", { wearPercent: { fl: { l: "0.9", m: 0.9, r: 0.9 } } }],
    ["getal als string", { compoundId: "0" }],
    ["boolean", { sets: { used: true } }],
    ["array in plaats van object", { wearPercent: [0.9, 0.9, 0.9] }],
    ["number waar tekst hoort", { environment: { trackTempC: 0, airTempC: 0, rubberState: 5 } }],
    ["tijd als getal", { pitEntry: { wearPercent: null, carcassTempC: null, capturedAt: 1761422000 } }],
    ["ongeldige tijd", { pitEntry: { wearPercent: null, carcassTempC: null, capturedAt: "gisteren" } }],
    ["fractionele set-teller", { sets: { used: 2.5 } }],
  ])("weigert %s", (_naam, tyres) => {
    expect(() => parseTelemetryV3Envelope(metTyres(tyres))).toThrow();
  });

  it("weigert NaN en Infinity als wear-waarde", () => {
    expect(() => parseTyreTelemetry({ wearPercent: { fl: { l: NaN, m: 0.9, r: 0.9 } } })).toThrow();
    expect(() => parseTyreTelemetry({ wearPercent: { fl: { l: Infinity, m: 0.9, r: 0.9 } } })).toThrow();
  });

  it("weigert waarden buiten het fysieke bereik", () => {
    expect(() => parseTyreTelemetry({ wearPercent: { fl: { l: 1.01, m: 0.9, r: 0.9 } } })).toThrow();
    expect(() => parseTyreTelemetry({ wearPercent: { fl: { l: -0.01, m: 0.9, r: 0.9 } } })).toThrow();
    expect(() => parseTyreTelemetry({ carcassTempC: { fl: { l: 301, m: 80, r: 80 } } })).toThrow();
    expect(() => parseTyreTelemetry({ sets: { available: 256 } })).toThrow();
    expect(() => parseTyreTelemetry({ compoundId: -1 })).toThrow();
    expect(() => parseTyreTelemetry({ environment: { trackTempC: 400 } })).toThrow();
    expect(() => parseTyreTelemetry({ environment: { rubberState: "high-usage" } })).toThrow(); // geen leestekens: de sim levert letters en spaties
    expect(() => parseTyreTelemetry({ environment: { rubberState: "" } })).toThrow();
  });

  it("weigert een leeg of niet-object tyres-blok", () => {
    expect(() => parseTelemetryV3Envelope(metTyres({}))).toThrow(/at least one field/);
    expect(() => parseTelemetryV3Envelope(metTyres([]))).toThrow(/must be an object/);
    expect(() => parseTelemetryV3Envelope(metTyres("tyres"))).toThrow(/must be an object/);
    expect(() => parseTyreTelemetry({ sets: {} })).toThrow(/at least one field/);
  });
});

describe("ingest-poort: 202 zonder tyres, 422 bij een verkeerd type", () => {
  const deviceRow = {
    id: "device-1",
    owner_user_id: "user-1",
    race_id: null,
    team_id: null,
    endurance_event_id: null,
    endurance_team_id: null,
    device_status: null,
    device_role: null,
    revoked_at: null,
    connector_id: null,
    device_name: null,
  };
  const fakeClient = {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _value: unknown) => ({
          maybeSingle: async () => ({ data: deviceRow as unknown, error: null as unknown }),
        }),
      }),
    }),
    rpc: async (_fn: string, _params: Record<string, unknown>) => ({ data: null as unknown, error: null as unknown }),
  };
  const resolve = (payload: unknown) =>
    resolveTelemetryContext("t".repeat(48), payload, fakeClient, async () => "token-hash");

  it("houdt 202 voor een payload zonder tyres (0.6.x-connector)", async () => {
    const context = await resolve(envelope());
    expect(context.result).toBe("accepted_device_context");
    expect(context.normalized!.tyres).toBeNull();
  });

  it("geeft 422 voor een payload met een verkeerd type in tyres", async () => {
    const context = await resolve(metTyres({ wearPercent: { fl: { l: "0.9", m: 0.9, r: 0.9 } } }));
    expect(context.result).toBe("invalid_payload");
    expect(context.normalized).toBeNull();
  });

  it("geeft 422 voor een onbekend veld in tyres", async () => {
    const context = await resolve(metTyres({ ...volTyreBlok(), pitExit: {} }));
    expect(context.result).toBe("invalid_payload");
  });

  it("houdt de 202/422-takken in de edge-functie vast", () => {
    const bron = readFileSync("supabase/functions/simhub-ingest-v3/index.ts", "utf8");
    expect(bron).toContain('if (context.result === "invalid_payload") return jsonResponse(request, { error: "invalid_payload" }, 422);');
    expect(bron).toContain("return jsonResponse(request, { accepted: true, receivedAt: row.received_at }, 202);");
    expect(bron).toContain('if (result !== "accepted") return jsonResponse(request, { error: "internal_error" }, 500);');
  });
});
