import { describe, expect, it } from "vitest";
import { parseTelemetryV3Envelope } from "../../supabase/functions/_shared/simhub";
import { parseBrakesTelemetry } from "../../supabase/functions/_shared/brakesTelemetry";
import { parseWeatherTelemetry } from "../../supabase/functions/_shared/weatherTelemetry";
import { parseTyreTelemetry } from "../../supabase/functions/_shared/tyreTelemetry";

/**
 * Nieuwe kanalen, additief op V3: pitService-uitbreiding (gevraagde reparatie en
 * fast repair), `brakes` (remdruk per hoek), `weather` (baanvocht, regen,
 * luchtdruk), `tyres.pressuresBar` en sectorsnelheden in `timing`.
 *
 * De eis is tweeledig en wordt hier per kanaal bewezen:
 *  1. een payload zonder het nieuwe veld verandert niet — oude zenders blijven geldig;
 *  2. een payload mét het nieuwe veld wordt gecontroleerd, en een fout in een
 *     optioneel meetblok kost alleen dat blok (nooit het hele frame).
 */

/** Minimale geldige V3-envelope, precies zoals 0.7.x hem stuurt. */
const envelope = () => ({
  protocolVersion: 3,
  sequence: 7,
  capturedAt: "2026-10-27T18:00:00Z",
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
  timing: { currentLapElapsedSeconds: 42.1, lastLapTimeSeconds: null, bestLapTimeSeconds: null, completedLaps: 3 },
  position: { position: 2, classPosition: 2, gapToLeaderSeconds: 4.5 },
  track: { lapDistancePct: 0.25, trackSurface: "on_track", onPitRoad: false },
  fuel: { fuelLitres: 48.2, fuelPct: 0.62 },
  raceState: { incidents: 1 },
  pitService: { pitServiceFlagsRaw: 0, requiredRepairSeconds: null, optionalRepairSeconds: null },
});

const met = (extra: Record<string, unknown>) => ({ ...envelope(), ...extra });

describe("bestaande payload blijft ongewijzigd", () => {
  it("levert dezelfde waarden als vóór de uitbreiding", () => {
    const parsed = parseTelemetryV3Envelope(envelope());
    expect(parsed.sequence).toBe(7);
    expect(parsed.timing.completedLaps).toBe(3);
    expect(parsed.fuel.fuelLitres).toBe(48.2);
    // Nieuwe sleutels zijn er wel, maar leeg: geen nieuwe verplichte velden.
    expect(parsed.timing.sector1Seconds).toBeNull();
    expect(parsed.pitService.repairSecondsRequested).toBeNull();
    expect(parsed.pitService.fastRepairAvailable).toBeNull();
    expect(parsed.brakes).toBeNull();
    expect(parsed.weather).toBeNull();
    expect(parsed.tyres).toBeNull();
  });
});

describe("pitService-uitbreiding: gevraagde reparatie en fast repair", () => {
  it("neemt de gevraagde reparatie en de fast-repair-teller over", () => {
    const parsed = parseTelemetryV3Envelope(met({
      pitService: {
        ...envelope().pitService,
        requiredRepairSeconds: 42.5,
        repairSecondsRequested: 31.2,
        optionalRepairSecondsRequested: 12,
        fastRepairAvailable: 1,
        fastRepairUsed: 2,
      },
    }));
    expect(parsed.pitService.repairSecondsRequested).toBe(31.2);
    expect(parsed.pitService.optionalRepairSecondsRequested).toBe(12);
    expect(parsed.pitService.fastRepairAvailable).toBe(1);
    expect(parsed.pitService.fastRepairUsed).toBe(2);
    // De bestaande velden blijven exact zoals ze waren.
    expect(parsed.pitService.requiredRepairSeconds).toBe(42.5);
  });

  it("maakt van de iRacing-sentinel -1 geen -1", () => {
    const parsed = parseTelemetryV3Envelope(met({
      pitService: { ...envelope().pitService, repairSecondsRequested: -1, fastRepairUsed: -1 },
    }));
    expect(parsed.pitService.repairSecondsRequested).toBeNull();
    expect(parsed.pitService.fastRepairUsed).toBeNull();
  });

  it("weigert een onbekend veld in pitService (dat blok is niet optioneel)", () => {
    expect(() => parseTelemetryV3Envelope(met({
      pitService: { ...envelope().pitService, repairCrew: "snel" },
    }))).toThrow(/unknown fields/);
  });

  it("weigert een fractionele fast-repair-teller", () => {
    expect(() => parseTelemetryV3Envelope(met({
      pitService: { ...envelope().pitService, fastRepairAvailable: 1.5 },
    }))).toThrow(/integer/);
  });
});

describe("timing: sectorsnelheden", () => {
  it("neemt sector1-3 over als ze er zijn", () => {
    const parsed = parseTelemetryV3Envelope(met({
      timing: { ...envelope().timing, sector1Seconds: 31.4, sector2Seconds: 40.05, sector3Seconds: 28.9 },
    }));
    expect(parsed.timing.sector1Seconds).toBe(31.4);
    expect(parsed.timing.sector2Seconds).toBe(40.05);
    expect(parsed.timing.sector3Seconds).toBe(28.9);
    expect(parsed.timing.lastLapTimeSeconds).toBeNull();
  });

  it("laat een sectorsentinel vallen en niet als 0 staan", () => {
    const parsed = parseTelemetryV3Envelope(met({
      timing: { ...envelope().timing, sector1Seconds: 0, sector2Seconds: -1 },
    }));
    expect(parsed.timing.sector1Seconds).toBeNull();
    expect(parsed.timing.sector2Seconds).toBeNull();
  });

  it("weigert een string als sectortijd", () => {
    expect(() => parseTelemetryV3Envelope(met({
      timing: { ...envelope().timing, sector1Seconds: "31.4" },
    }))).toThrow(/invalid/);
  });

  it("weigert een onbekend veld in timing", () => {
    expect(() => parseTelemetryV3Envelope(met({
      timing: { ...envelope().timing, sector4Seconds: 12 },
    }))).toThrow(/unknown fields/);
  });
});

describe("brakes: remdruk per hoek", () => {
  const vol = {
    frontLeft: { pressureBar: 62.5 },
    frontRight: { pressureBar: 61.8 },
    rearLeft: { pressureBar: 44.1 },
    rearRight: { pressureBar: 43.7 },
  };

  it("neemt een volledig blok over", () => {
    const parsed = parseTelemetryV3Envelope(met({ brakes: vol }));
    expect(parsed.brakes!.fl!.pressureBar).toBe(62.5);
    expect(parsed.brakes!.rr!.pressureBar).toBe(43.7);
  });

  it("accepteert de korte hoeknamen en een gedeeltelijk blok", () => {
    const parsed = parseBrakesTelemetry({ fl: { pressureBar: 50 }, rr: { pressureBar: null } })!;
    expect(parsed.fl!.pressureBar).toBe(50);
    expect(parsed.fr).toBeNull();
    expect(parsed.rr!.pressureBar).toBeNull();
  });

  it("houdt null null en maakt er geen 0 van", () => {
    const parsed = parseBrakesTelemetry({ frontLeft: { pressureBar: null } })!;
    expect(parsed.fl!.pressureBar).toBeNull();
  });

  it.each([
    ["leeg blok", {}],
    ["bare getal in plaats van object", { frontLeft: 62.5 }],
    ["onbekend veld", { frontLeft: { pressureBar: 60, temperature: 400 } }],
    ["onbekende hoek", { frontCenter: { pressureBar: 60 } }],
    ["druk in psi", { frontLeft: { pressureBar: 900 } }],
    ["tekst als druk", { frontLeft: { pressureBar: "60" } }],
  ])("weigert %s", (_naam, brakes) => {
    expect(() => parseBrakesTelemetry(brakes)).toThrow();
  });

  it("is nooit fataal: een fout blok laat het frame staan", () => {
    const parsed = parseTelemetryV3Envelope(met({ brakes: { frontLeft: { pressureBar: 900 } } }));
    expect(parsed.brakes).toBeNull();
    expect(parsed.timing.completedLaps).toBe(3);
    expect(parsed.position.position).toBe(2);
  });

  it("accepteert brakes: null", () => {
    expect(parseTelemetryV3Envelope(met({ brakes: null })).brakes).toBeNull();
    expect(parseBrakesTelemetry(null)).toBeNull();
  });
});

describe("weather: baanvocht, regen en luchtdruk", () => {
  it("neemt een volledig blok over", () => {
    const parsed = parseTelemetryV3Envelope(met({
      weather: { trackWetnessPct: 62, isRaining: true, rainPct: 35, airPressureHpa: 1013.2 },
    }));
    expect(parsed.weather).toEqual({ trackWetnessPct: 62, isRaining: true, rainPct: 35, airPressureHpa: 1013.2 });
  });

  it("accepteert een gedeeltelijk blok en laat null staan", () => {
    const parsed = parseWeatherTelemetry({ trackWetnessPct: 0 })!;
    expect(parsed.trackWetnessPct).toBe(0); // kurkdroog is een echte 0
    expect(parsed.isRaining).toBeNull();
    expect(parsed.rainPct).toBeNull();
    expect(parsed.airPressureHpa).toBeNull();
  });

  it.each([
    ["leeg blok", {}],
    ["onbekend veld", { humidityPct: 40 }],
    ["natheid boven 100", { trackWetnessPct: 140 }],
    ["luchtdruk in inch Hg", { airPressureHpa: 29.92 }],
    ["regen als tekst", { isRaining: "ja" }],
    ["tekst als percentage", { rainPct: "35" }],
  ])("weigert %s", (_naam, weather) => {
    expect(() => parseWeatherTelemetry(weather)).toThrow();
  });

  it("is nooit fataal: een fout blok laat het frame staan", () => {
    const parsed = parseTelemetryV3Envelope(met({ weather: { airPressureHpa: 29.92 } }));
    expect(parsed.weather).toBeNull();
    expect(parsed.fuel.fuelLitres).toBe(48.2);
  });
});

describe("tyres.pressuresBar", () => {
  it("neemt de spanning per hoek over, ook met korte hoeknamen", () => {
    const volledig = parseTyreTelemetry({
      pressuresBar: { frontLeft: 1.72, frontRight: 1.74, rearLeft: 1.68, rearRight: 1.69 },
    })!;
    expect(volledig.pressuresBar).toEqual({ fl: 1.72, fr: 1.74, rl: 1.68, rr: 1.69 });

    const kort = parseTyreTelemetry({ pressuresBar: { fl: 1.8, rr: null } })!;
    expect(kort.pressuresBar.fl).toBe(1.8);
    expect(kort.pressuresBar.rr).toBeNull();
    expect(kort.pressuresBar.fr).toBeNull();
  });

  it("laat het blok leeg als het ontbreekt", () => {
    expect(parseTyreTelemetry({ compoundId: 0 })!.pressuresBar).toEqual({ fl: null, fr: null, rl: null, rr: null });
  });

  it("weigert eenheidfouten en onbekende hoeken", () => {
    expect(() => parseTyreTelemetry({ pressuresBar: { fl: 180 } })).toThrow(/invalid/); // kPa
    expect(() => parseTyreTelemetry({ pressuresBar: { fl: 26 } })).toThrow(/invalid/); // psi
    expect(() => parseTyreTelemetry({ pressuresBar: { frontCenter: 1.7 } })).toThrow(/unknown fields/);
    expect(() => parseTyreTelemetry({ pressuresBar: {} })).toThrow(/at least one field/);
    expect(() => parseTyreTelemetry({ pressuresBar: { fl: { bar: 1.7 } } })).toThrow(/invalid/);
  });

  it("kost bij een fout alleen het bandenblok, niet het frame", () => {
    const parsed = parseTelemetryV3Envelope(met({
      tyres: { wearPercent: { fl: [90, 90, 90] }, pressuresBar: { fl: 180 } },
    }));
    expect(parsed.tyres).toBeNull();
    expect(parsed.identity.carId).toBe("mclaren720sgt3");
  });
});
