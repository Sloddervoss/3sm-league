/**
 * 0.7.4.0 — bewezen (ronde, tijd)-paren.
 *
 * Draai met: deno test --allow-env supabase/functions/_shared/lapTimes_test.ts
 *
 * Wat hier bewezen wordt:
 *  - een frame zonder lapTimes verandert niet;
 *  - een geldige reeks komt er ongewijzigd door;
 *  - een kapotte reeks kost alleen die reeks, niet het frame;
 *  - de grenzen zijn echte grenzen.
 */

import { parseLapTimesNeverFatal } from "./lapTimes.ts";
import { parseTelemetryV3Envelope } from "./simhub.ts";

const frame = () => ({
  protocolVersion: 3,
  sequence: 42,
  capturedAt: "2026-10-31T12:00:00.000Z",
  transportSessionId: "sess-1",
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
});

const lap = (over: Record<string, unknown> = {}) => ({
  carId: "Jaimy Peters",
  sessionKey: "sess-1:1:0",
  lap: 7,
  seconds: 121.456,
  source: "sdk",
  ...over,
});

const expectOk = (name: string, ok: boolean) => {
  if (!ok) throw new Error(`verwachtte geldig: ${name}`);
};
const expectRejected = (name: string, value: unknown) => {
  if (parseLapTimesNeverFatal(value) !== null) throw new Error(`had afgekeurd moeten worden: ${name}`);
};

Deno.test("lapTimes ontbreekt: frame verandert niet", () => {
  const parsed = parseTelemetryV3Envelope(frame());
  if ("lapTimes" in parsed && (parsed as { lapTimes?: unknown }).lapTimes != null) {
    throw new Error("lapTimes hoort leeg te blijven");
  }
});

Deno.test("geldige reeks komt er ongewijzigd door", () => {
  const parsed = parseTelemetryV3Envelope({ ...frame(), lapTimes: [lap(), lap({ lap: 8, seconds: 120.1 })] });
  const rows = (parsed as { lapTimes?: Array<Record<string, unknown>> }).lapTimes ?? [];
  expectOk("twee rijen", rows.length === 2);
  expectOk("ronde", rows[0].lap === 7 && rows[1].lap === 8);
  expectOk("tijd", rows[0].seconds === 121.456);
  expectOk("bron", rows[0].source === "sdk");
});

Deno.test("dezelfde ronde twee keer is één meting", () => {
  const rows = parseLapTimesNeverFatal([lap(), lap({ seconds: 999 })]) ?? [];
  expectOk("één rij", rows.length === 1);
  expectOk("eerste waarde", rows[0].seconds === 121.456);
});

Deno.test("kapotte reeks kost alleen de reeks", () => {
  const parsed = parseTelemetryV3Envelope({
    ...frame(),
    lapTimes: [lap({ seconds: -1 })],
    fuel: { fuelLitres: 12.5, fuelPct: 0.2 },
  });
  const rows = (parsed as { lapTimes?: unknown }).lapTimes;
  if (rows != null) throw new Error("kapotte reeks hoort leeg te blijven");
  expectOk("frame blijft", (parsed as { fuel: { fuelLitres: number } }).fuel.fuelLitres === 12.5);
});

Deno.test("grenzen en verboden waarden", () => {
  expectRejected("geen bron", [lap({ source: "simhub-geraden" })]);
  expectRejected("ronde 0", [lap({ lap: 0 })]);
  expectRejected("tijd 0", [lap({ seconds: 0 })]);
  expectRejected("tijd oneindig", [lap({ seconds: Number.POSITIVE_INFINITY })]);
  expectRejected("onbekend veld", [lap({ confidence: 0.9 })]);
  expectRejected("lege auto", [lap({ carId: "" })]);
  expectRejected("sessiesleutel met spatie", [lap({ sessionKey: "sess 1:1:0" })]);
  expectRejected("te veel rijen", Array.from({ length: 201 }, (_, i) => lap({ lap: i + 1 })));
  expectOk("leeg is null", parseLapTimesNeverFatal([]) === null);
  expectOk("afwezig is null", parseLapTimesNeverFatal(undefined) === null);
});
