import { describe, expect, it } from "vitest";
import { normalizeTelemetryEnvelope, parseTelemetryV3Envelope } from "../../supabase/functions/_shared/simhub";
import { parseVehicleTelemetry } from "../../supabase/functions/_shared/vehicleTelemetry";
import { resolveTelemetryContext } from "../../supabase/functions/simhub-ingest-v3/context";

/**
 * Directe iRacing-SDK-kanalen in het optionele `vehicle`-blok.
 *
 * De plugin krijgt een eigen SDK-lezer die vijf kanalen kan toevoegen:
 *   wheelSpeedKph (per hoek), brakeLinePressureBar (per hoek),
 *   steeringWheelAngleDeg, latAccelG en longAccelG.
 *
 * De eis is additief en achterwaarts compatibel:
 *  1. een frame zonder die velden blijft ongewijzigd geldig (202);
 *  2. een frame mét de velden wordt geaccepteerd en één-op-één doorgegeven;
 *  3. een foute waarde of eenheid is een 422 — geen stil weggeschreven getal;
 *  4. ontbreken betekent null, nooit een 0 die als meting doorgaat.
 *
 * De 202/422-toets loopt via de echte ingest-context (`resolveTelemetryContext`):
 * die geeft `accepted_device_context` (de tak die in simhub-ingest-v3/index.ts met
 * 202 antwoordt) of `invalid_payload` (422). `vehicle` is — anders dan `tyres` en
 * `brakes` — bewust fataal: een half voertuigblok maakt de rondesamenvatting
 * onbruikbaar, dus een fout hier hoort het frame te kosten.
 */

/** Minimale geldige V3-envelope zoals 0.7.x hem stuurt. */
const envelope = () => ({
  protocolVersion: 3,
  sequence: 12,
  capturedAt: "2026-10-27T20:00:00Z",
  transportSessionId: "test-sessie",
  identity: {
    currentDriverId: "Vincent deVos",
    currentDriverName: "Vincent deVos",
    carId: "mclaren720sgt3",
    carName: "McLaren 720S GT3 EVO",
    trackName: "spa 2022 fullcourse",
    trackConfig: "Grand Prix",
  },
  session: {
    isInCar: true,
    sessionTimeSeconds: 120,
    sessionTimeRemainingSeconds: 3600,
    sessionLapsRemaining: 20,
    flags: ["green"],
    sessionState: "racing",
  },
  timing: { currentLapElapsedSeconds: 42.1, lastLapTimeSeconds: 138.42, bestLapTimeSeconds: null, completedLaps: 3 },
  position: { position: 2, classPosition: 2, gapToLeaderSeconds: 4.5 },
  track: { lapDistancePct: 0.25, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 48.2, fuelPct: 0.62 },
  raceState: { incidents: 1 },
  pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: null, optionalRepairSeconds: null },
});

/** vehicle zoals de connector hem tot 0.7.x stuurde: zonder SDK-kanalen. */
const legacyVehicle = () => ({
  speedKph: 212.4,
  throttlePct: 88,
  brakePct: 0,
  rpm: 7350,
  gear: "5",
  sector1Seconds: 44.2,
  sector2Seconds: 51.8,
  sector3Seconds: 42.4,
  tyreDataMode: "last_available",
  pressureUnit: "psi",
  temperatureUnit: "C",
  frontLeft: { wearPercent: 93, temperature: 83.2, pressure: 26.1 },
  frontRight: { wearPercent: 92, temperature: 84.0, pressure: 26.3 },
  rearLeft: { wearPercent: 95, temperature: 78.4, pressure: 25.8 },
  rearRight: { wearPercent: 94, temperature: 79.1, pressure: 25.9 },
});

/** Dezelfde meting, nu met de directe-SDK-kanalen erbij (lange hoeknamen). */
const sdkVehicle = () => ({
  ...legacyVehicle(),
  wheelSpeedKph: { frontLeft: 208.6, frontRight: 209.1, rearLeft: 212.4, rearRight: 212.2 },
  brakeLinePressureBar: { frontLeft: 0, frontRight: 0, rearLeft: 0, rearRight: 0 },
  steeringWheelAngleDeg: -12.4,
  latAccelG: 1.42,
  longAccelG: -0.08,
});

const metVehicle = (vehicle: unknown) => ({ ...envelope(), vehicle });

const allNullCorners = { fl: null, fr: null, rl: null, rr: null };

/** Antwoord van de echte ingest-context; 202-tak of 422-tak. */
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

describe("vehicle: bestaand frame zonder SDK-velden blijft 202", () => {
  it("accepteert het oude frame en vult de nieuwe velden met null", async () => {
    const context = await resolve(metVehicle(legacyVehicle()));
    expect(context.result).toBe("accepted_device_context");

    const vehicle = context.normalized!.vehicle!;
    expect(vehicle.speedKph).toBe(212.4);
    expect(vehicle.gear).toBe("5");
    expect(vehicle.frontLeft!.wearPercent).toBe(93);
    // Ontbreken = null, geen 0.
    expect(vehicle.wheelSpeedKph).toEqual(allNullCorners);
    expect(vehicle.brakeLinePressureBar).toEqual(allNullCorners);
    expect(vehicle.steeringWheelAngleDeg).toBeNull();
    expect(vehicle.latAccelG).toBeNull();
    expect(vehicle.longAccelG).toBeNull();
  });

  it("laat een frame zonder vehicle-blok helemaal ongemoeid", async () => {
    const context = await resolve(envelope());
    expect(context.result).toBe("accepted_device_context");
    expect(context.normalized!.vehicle).toBeNull();
  });

  it("houdt de bestaande verplichte vehicle-velden verplicht", async () => {
    const zonderRpm: Record<string, unknown> = legacyVehicle();
    delete zonderRpm.rpm;
    const context = await resolve(metVehicle(zonderRpm));
    expect(context.result).toBe("invalid_payload");
    expect(context.normalized).toBeNull();
  });
});

describe("vehicle: frame met SDK-velden wordt geaccepteerd", () => {
  it("geeft de waarden één-op-één terug via de ingest-parser", async () => {
    const context = await resolve(metVehicle(sdkVehicle()));
    expect(context.result).toBe("accepted_device_context");

    const vehicle = context.normalized!.vehicle!;
    expect(vehicle.wheelSpeedKph).toEqual({ fl: 208.6, fr: 209.1, rl: 212.4, rr: 212.2 });
    expect(vehicle.brakeLinePressureBar).toEqual({ fl: 0, fr: 0, rl: 0, rr: 0 });
    expect(vehicle.steeringWheelAngleDeg).toBe(-12.4);
    expect(vehicle.latAccelG).toBe(1.42);
    expect(vehicle.longAccelG).toBe(-0.08);
  });

  it("houdt de oude velden identiek aan een frame zonder SDK-velden", () => {
    const oud = parseTelemetryV3Envelope(metVehicle(legacyVehicle())).vehicle!;
    const nieuw = parseTelemetryV3Envelope(metVehicle(sdkVehicle())).vehicle!;
    const zonderSdk = (v: Record<string, unknown>) => {
      const kopie = { ...v };
      for (const sleutel of ["wheelSpeedKph", "brakeLinePressureBar", "steeringWheelAngleDeg", "latAccelG", "longAccelG"]) {
        delete kopie[sleutel];
      }
      return kopie;
    };
    expect(zonderSdk(nieuw)).toEqual(zonderSdk(oud));
  });

  it("accepteert korte hoeknamen net als in tyres en brakes", () => {
    const vehicle = parseVehicleTelemetry({
      ...legacyVehicle(),
      wheelSpeedKph: { fl: 100.1, fr: 101.2, rl: 102.3, rr: 103.4 },
      brakeLinePressureBar: { fl: 0, fr: 12.5, rl: 0, rr: 0 },
    })!;
    expect(vehicle.wheelSpeedKph).toEqual({ fl: 100.1, fr: 101.2, rl: 102.3, rr: 103.4 });
    expect(vehicle.brakeLinePressureBar).toEqual({ fl: 0, fr: 12.5, rl: 0, rr: 0 });
  });

  it("accepteert stilstaande wielen (0) als echte meting", () => {
    const vehicle = parseVehicleTelemetry({
      ...legacyVehicle(),
      speedKph: 0,
      wheelSpeedKph: { fl: 0, fr: 0, rl: 0, rr: 0 },
      brakeLinePressureBar: { fl: 0, fr: 0, rl: 0, rr: 0 },
      steeringWheelAngleDeg: 0,
      latAccelG: 0,
      longAccelG: 0,
    })!;
    expect(vehicle.wheelSpeedKph!.fl).toBe(0);
    expect(vehicle.brakeLinePressureBar!.fl).toBe(0);
    expect(vehicle.steeringWheelAngleDeg).toBe(0);
    expect(vehicle.latAccelG).toBe(0);
  });

  it("accepteert een half gevulde hoek en een lege hoek (null)", () => {
    const vehicle = parseVehicleTelemetry({
      ...legacyVehicle(),
      wheelSpeedKph: { fl: 150.5, fr: null, rl: undefined, rr: 0 },
    })!;
    expect(vehicle.wheelSpeedKph).toEqual({ fl: 150.5, fr: null, rl: null, rr: 0 });
  });

  it("geeft de velden door aan de genormaliseerde envelope die in v3_normalized belandt", () => {
    const normalized = normalizeTelemetryEnvelope(metVehicle(sdkVehicle()));
    expect(normalized.vehicle!.wheelSpeedKph).toEqual({ fl: 208.6, fr: 209.1, rl: 212.4, rr: 212.2 });
    expect(normalized.vehicle!.latAccelG).toBe(1.42);
  });
});

describe("vehicle: foute waarden en eenheden worden geweigerd", () => {
  const kapot = (extra: Record<string, unknown>) => ({ ...legacyVehicle(), ...extra });

  it.each([
    ["wielsnelheid boven het fysieke bereik (mph of schaalfout)", { wheelSpeedKph: { fl: 700 } }],
    ["wielsnelheid als tekst", { wheelSpeedKph: { fl: "208.6" } }],
    ["wielsnelheid NaN", { wheelSpeedKph: { fl: NaN } }],
    ["wielsnelheid Infinity", { wheelSpeedKph: { fr: Infinity } }],
    ["negatieve wielsnelheid", { wheelSpeedKph: { rl: -1 } }],
    ["onbekende hoek in het wielsnelheidsblok", { wheelSpeedKph: { fl: 200, midden: 200 } }],
    ["leeg wielsnelheidsblok", { wheelSpeedKph: {} }],
    ["wielsnelheidsblok als array", { wheelSpeedKph: [200, 200, 200, 200] }],
    ["remdruk in kPa in plaats van bar", { brakeLinePressureBar: { fl: 6500 } }],
    ["remdruk in psi in plaats van bar", { brakeLinePressureBar: { fr: 1500 } }],
    ["negatieve remdruk", { brakeLinePressureBar: { rl: -2 } }],
    ["remdruk als object in plaats van getal", { brakeLinePressureBar: { fl: { pressureBar: 12 } } }],
    ["stuurwielhoek als tekst", { steeringWheelAngleDeg: "-12.4" }],
    ["stuurwielhoek buiten bereik", { steeringWheelAngleDeg: 1800 }],
    ["dwarsversnelling in m/s² in plaats van g", { latAccelG: 25 }],
    ["langsversnelling in m/s² in plaats van g", { longAccelG: -32 }],
    ["dwarsversnelling buiten bereik", { latAccelG: -40 }],
    ["onbekend extra veld in vehicle", { gearRatio: 3.2 }],
  ])("weigert %s", (_naam, extra) => {
    expect(() => parseVehicleTelemetry(kapot(extra))).toThrow();
  });

  it("geeft 422 via de ingest-context, niet 202", async () => {
    const context = await resolve(metVehicle(kapot({ brakeLinePressureBar: { fl: 6500 } })));
    expect(context.result).toBe("invalid_payload");
    expect(context.normalized).toBeNull();
  });

  it("laat een fout in het voertuigblok het hele frame kosten (vehicle is fataal)", () => {
    // Anders dan tyres/brakes wordt vehicle niet ingeslikt: zonder betrouwbaar
    // voertuigblok is de rondesamenvatting onbruikbaar.
    expect(() => parseTelemetryV3Envelope(metVehicle(kapot({ latAccelG: 25 })))).toThrow(/payload\.vehicle/);
  });

  it("noemt het pad van het geweigerde veld in de foutmelding", () => {
    expect(() => parseVehicleTelemetry(kapot({ wheelSpeedKph: { fl: 700 } }))).toThrow(/payload\.vehicle\.wheelSpeedKph\.fl/);
    expect(() => parseVehicleTelemetry(kapot({ brakeLinePressureBar: { rr: 6500 } }))).toThrow(/payload\.vehicle\.brakeLinePressureBar\.rr/);
  });
});
