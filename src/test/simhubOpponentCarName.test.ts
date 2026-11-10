import { describe, expect, it } from "vitest";
import { MaxOpponentsPerSnapshot } from "../../supabase/functions/_shared/opponents";
import { resolveTelemetryContext } from "../../supabase/functions/simhub-ingest-v3/context";

/**
 * `v3_normalized.opponents[].carName` — additief model, afgesproken met de
 * producer (max 120 tekens, nullable, weglaten = null).
 *
 * Deze test loopt het ECHTE Edge-pad: resolveTelemetryContext parseert met de
 * echte parser en geeft 'accepted_device_context' terug, wat simhub-ingest-v3
 * als 202 doorlaat. Zo bewijst de test niet alleen de parser, maar ook dat een
 * oud frame zonder carName en een frame met een kapotte carName geen 422 kosten.
 */

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

const frame = (opponents: Record<string, unknown>[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  protocolVersion: 3,
  sequence: 4711,
  capturedAt: "2026-10-31T10:00:00.000Z",
  transportSessionId: "simhub-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  identity: {
    currentDriverId: "123456",
    currentDriverName: "Vincent",
    carId: "147",
    carName: "Porsche 911 GT3 R",
    trackName: "Spa-Francorchamps",
    trackConfig: "Grand Prix",
  },
  session: {
    isInCar: true,
    sessionTimeSeconds: 1850.5,
    sessionTimeRemainingSeconds: 3600,
    sessionLapsRemaining: 12,
    flags: ["green"],
    sessionState: "racing",
  },
  timing: { currentLapElapsedSeconds: 12.5, lastLapTimeSeconds: 121.25, bestLapTimeSeconds: 120.9, completedLaps: 42 },
  position: { position: 4, classPosition: 2, gapToLeaderSeconds: 1.5 },
  track: { lapDistancePct: 0.25, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 44.8, fuelPct: 0.6 },
  raceState: { incidents: 2 },
  pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: null, optionalRepairSeconds: null },
  opponents,
  ...extra,
});

const device = {
  id: "device", owner_user_id: "owner", connector_id: "connector", device_name: "DESKTOP-E2SEMRP",
  endurance_event_id: null, endurance_team_id: null, device_status: "inactive",
  device_role: null, revoked_at: null, race_id: null,
};

const resolve = async (body: unknown) => {
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: device, error: null }) }) }) }),
    rpc: async () => ({ data: null, error: null }),
  };
  return resolveTelemetryContext("test-token", body, db, async () => "hash");
};

const encoder = new TextEncoder();
const utf8Bytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).byteLength;

describe("Edge-parse van opponent.carName", () => {
  it("laat een oud frame zonder carName exact werken (parity, geen 422)", async () => {
    const legacyRows = [
      tegenstander({ id: "p1", position: 1 }),
      tegenstander({ id: "p2", position: 2 }),
    ];
    const result = await resolve(frame(legacyRows));

    expect(result.result).toBe("accepted_device_context");
    const rows = result.normalized?.opponents;
    expect(rows).toHaveLength(2);
    // Alle bestaande velden houden hun waarde; carName is het enige nieuwe veld
    // en is null zolang de producer het niet stuurt. irating/safetyRating/
    // licenseClass waren al additief en blijven net als voorheen null.
    for (const [index, row] of (rows ?? []).entries()) {
      for (const [key, value] of Object.entries(legacyRows[index])) {
        expect((row as unknown as Record<string, unknown>)[key]).toEqual(value);
      }
      const extra = Object.keys(row).filter((key) => !(key in legacyRows[index])).sort();
      expect(extra).toEqual(["carName", "irating", "licenseClass", "safetyRating"]);
    }
    expect(rows?.map((row) => row.carName)).toEqual([null, null]);
  });

  it("leest en trimt carName en accepteert exact 120 tekens", async () => {
    const max = "P".repeat(120);
    const result = await resolve(frame([
      tegenstander({ id: "p1", carName: "  Porsche 911 GT3 R  " }),
      tegenstander({ id: "p2", carName: max }),
      tegenstander({ id: "p3", carName: null }),
    ]));

    expect(result.result).toBe("accepted_device_context");
    expect(result.normalized?.opponents?.map((row) => row.carName)).toEqual(["Porsche 911 GT3 R", max, null]);
  });

  it("maakt een onbruikbare carName null zonder de rij of het frame te kosten", async () => {
    const result = await resolve(frame([
      tegenstander({ id: "p1", carName: 42 }),
      tegenstander({ id: "p2", carName: "x".repeat(121) }),
      tegenstander({ id: "p3", carName: { model: "GT3" } }),
      tegenstander({ id: "p4" }),
    ]));

    // Geen invalid_payload/422: het veld valt leeg, de vier spelers blijven.
    expect(result.result).toBe("accepted_device_context");
    expect(result.normalized?.opponents?.map((row) => row.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(result.normalized?.opponents?.map((row) => row.carName)).toEqual([null, null, null, null]);
    expect(result.normalized?.timing.completedLaps).toBe(42);
    expect(result.normalized?.opponents?.map((row) => row.position)).toEqual([2, 2, 2, 2]);
  });

  it("verzint geen model uit klasse, carClassId of coureursnaam", async () => {
    const result = await resolve(frame([tegenstander({ carClass: "GT3", carClassId: "17", driverName: "P. Porsche" })]));
    expect(result.result).toBe("accepted_device_context");
    expect(result.normalized?.opponents?.[0]?.carName).toBeNull();
  });

  it("laat de bestaande unknown-rootkey-acceptatie ongemoeid", async () => {
    const accepted = await resolve(frame([tegenstander({ carName: "Ferrari 296 GT3" })], {
      futureBlock: { anything: [1, 2, 3] },
    }));
    expect(accepted.result).toBe("accepted_device_context");
    expect(accepted.normalized?.opponents?.[0]?.carName).toBe("Ferrari 296 GT3");

    // De rem blijft staan: 33 onbekende rootkeys is nog steeds een frame-fout.
    const teVeel: Record<string, unknown> = {};
    for (let i = 0; i < 33; i += 1) teVeel[`extraKey${i}`] = i;
    const rejected = await resolve(frame([tegenstander({ carName: "Ferrari 296 GT3" })], teVeel));
    expect(rejected.result).toBe("invalid_payload");
  });
});

describe("payloadbudget met carName op 40 tegenstanders", () => {
  const rows = (carName: string | undefined) =>
    Array.from({ length: MaxOpponentsPerSnapshot }, (_, index) =>
      tegenstander({ id: `p${index}`, carNumber: String(index + 1), position: index + 1, carName }));

  it("past met 40 modellen van 120 ASCII-tekens binnen 24.576 byte", () => {
    const bytes = utf8Bytes(frame(rows("P".repeat(120))));
    expect(bytes).toBeLessThanOrEqual(24576);
    // Leg de marge vast: het budgetcontract zelf wordt niet gewijzigd.
    expect(bytes).toBeGreaterThan(utf8Bytes(frame(rows(undefined))));
  });

  it("toont het budgetrisico bij 120 multibyte-tekens en bewijst dat weglaten mag", async () => {
    const multibyte = "é".repeat(120);
    const vol = frame(rows(multibyte));
    // 40 × 120 tekens zijn contractueel toegestaan, maar 240 UTF-8-bytes per
    // model duwen het frame over de 24.576-bytegrens. Daarom mag de producer
    // carName per rij weglaten; dat is geen player loss.
    expect(utf8Bytes(vol)).toBeGreaterThan(24576);

    const gesnoeid = frame(rows(multibyte).map((row, index) => {
      if (index >= 2) return row;
      const { carName: _carName, ...zonderModel } = row;
      return zonderModel;
    }));
    expect(utf8Bytes(gesnoeid)).toBeLessThanOrEqual(24576);

    const result = await resolve(gesnoeid);
    expect(result.result).toBe("accepted_device_context");
    expect(result.normalized?.opponents).toHaveLength(MaxOpponentsPerSnapshot);
    expect(result.normalized?.opponents?.map((row) => row.id)).toEqual(
      Array.from({ length: MaxOpponentsPerSnapshot }, (_, index) => `p${index}`),
    );
    expect(result.normalized?.opponents?.slice(0, 2).map((row) => row.carName)).toEqual([null, null]);
    expect(result.normalized?.opponents?.slice(2).every((row) => row.carName === multibyte)).toBe(true);
  });
});
