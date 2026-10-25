import type { MeasuredPitStop, PitStopMeasurement } from "./types";

/**
 * Pitverlies meten uit de vlaggen die er wél zijn.
 *
 * Er bestaat geen pit-event met een duur: alleen `in_pit_lane` per waarneming.
 * Een overgang false -> true is pit-in, true -> false is pit-uit, en het verschil
 * in tijd is de tijd in de pitstraat. Meer is het niet, en dat is precies genoeg
 * om `pitLaneSeconds` te vullen in plaats van te gokken.
 *
 * Wat deze functie bewust niet doet:
 *   * Geen pit-in verzinnen als de eerste waarneming al "in de pit" is. Zonder
 *     voorafgaande false weet je niet wanneer de auto naar binnen ging.
 *   * Geen stop afronden zonder pit-uit. Die blijft open met seconds = null.
 *   * Geen duur buiten 5..900 s als meting tellen: korter is een flikkering,
 *     langer is een onderbreking (rode vlag, sessiewissel), geen stop.
 *   * Niets teruggeven als er geen enkele vlag gevuld is. Dan is het antwoord
 *     null, geen schatting.
 */

/** Korter dan dit is geen pitstraat maar een flikkering in de vlag. */
export const MIN_PIT_LANE_SECONDS = 5;
/** Langer dan dit is een onderbreking, geen pitstop. */
export const MAX_PIT_LANE_SECONDS = 900;

export interface PitFlagSample {
  captured_at: string;
  in_pit_lane: boolean | null;
}

const secondsBetween = (van: number, tot: number): number => (tot - van) / 1000;

const round1 = (waarde: number): number => Math.round(waarde * 10) / 10;

export const isPlausiblePitLaneSeconds = (seconden: number | null | undefined): seconden is number =>
  typeof seconden === "number" &&
  Number.isFinite(seconden) &&
  seconden >= MIN_PIT_LANE_SECONDS &&
  seconden <= MAX_PIT_LANE_SECONDS;

/**
 * Leidt de pitstops af uit losse vlagwaarnemingen.
 *
 * Rijen zonder bruikbare tijd of zonder vlag vallen weg; ze onderbreken de
 * reeks niet, want een gemiste waarneming zegt niets over de vlag.
 */
export function derivePitStops(samples: readonly PitFlagSample[]): MeasuredPitStop[] {
  const rijen = samples
    .map((sample, index) => ({
      ts: Date.parse(sample.captured_at),
      vlag: sample.in_pit_lane,
      index,
    }))
    .filter((rij) => Number.isFinite(rij.ts) && typeof rij.vlag === "boolean")
    .sort((a, b) => a.ts - b.ts || a.index - b.index);

  const stops: MeasuredPitStop[] = [];
  let entry: number | null = null;
  let vorigeVlag: boolean | null = null;

  for (const rij of rijen) {
    if (vorigeVlag === false && rij.vlag === true) {
      // pit-in
      entry = rij.ts;
    } else if (vorigeVlag === true && rij.vlag === false) {
      // pit-uit; alleen een stop als we de pit-in gezien hebben
      if (entry != null) {
        const seconden = secondsBetween(entry, rij.ts);
        stops.push({
          entryAt: new Date(entry).toISOString(),
          exitAt: new Date(rij.ts).toISOString(),
          seconds: isPlausiblePitLaneSeconds(seconden) ? round1(seconden) : null,
        });
        entry = null;
      }
    }
    vorigeVlag = rij.vlag;
  }

  if (entry != null) {
    stops.push({
      entryAt: new Date(entry).toISOString(),
      exitAt: null,
      seconds: null,
    });
  }

  return stops;
}

/** Mediaan van de bruikbare stops, of null als er geen bruikbare is. */
export function medianPitLaneSeconds(stops: readonly MeasuredPitStop[]): number | null {
  const waarden = stops
    .map((stop) => stop.seconds)
    .filter(isPlausiblePitLaneSeconds)
    .sort((a, b) => a - b);

  if (waarden.length === 0) return null;

  const midden = Math.floor(waarden.length / 2);
  const mediaan =
    waarden.length % 2 === 1
      ? waarden[midden]
      : (waarden[midden - 1] + waarden[midden]) / 2;

  return round1(mediaan);
}

export function derivePitStopMeasurement(samples: readonly PitFlagSample[]): PitStopMeasurement {
  const stops = derivePitStops(samples);
  const pitLaneSeconds = medianPitLaneSeconds(stops);
  const bruikbaar = stops.filter((stop) => isPlausiblePitLaneSeconds(stop.seconds));
  const exits = stops
    .map((stop) => stop.exitAt)
    .filter((exitAt): exitAt is string => typeof exitAt === "string")
    .sort();

  return {
    pitLaneSeconds,
    sampleCount: bruikbaar.length,
    source: pitLaneSeconds == null ? "none" : "measured",
    lastStopAt: exits.length > 0 ? exits[exits.length - 1] : null,
    stops,
  };
}

/** Wat de RPC teruggeeft; alleen de velden die deze module leest. */
export interface PitwallPitLossPayload {
  pit_loss?: unknown;
  pit_lane_seconds?: unknown;
  timeline?: unknown;
}

const alsObject = (waarde: unknown): Record<string, unknown> | null =>
  typeof waarde === "object" && waarde !== null && !Array.isArray(waarde)
    ? (waarde as Record<string, unknown>)
    : null;

const alsGetal = (waarde: unknown): number | null => {
  const getal = typeof waarde === "string" ? Number(waarde) : waarde;
  return typeof getal === "number" && Number.isFinite(getal) ? getal : null;
};

/**
 * De server meten is de bron: die ziet ook de samples die de tijdlijn niet haalt.
 * Alleen als de server geen waarde heeft, leiden we het hier uit de tijdlijn af
 * (oudere functieversie of een nog niet gevulde tabel). Beide volgen dezelfde
 * regels; zonder vlaggen is de uitkomst in beide gevallen null.
 */
export function resolvePitStopMeasurement(
  payload: PitwallPitLossPayload | null | undefined,
): PitStopMeasurement {
  const server = serverMeasurement(payload);
  if (server?.pitLaneSeconds != null) return server;

  const uitTijdlijn = derivePitStopMeasurement(timelineSamples(payload));
  if (uitTijdlijn.pitLaneSeconds != null) return uitTijdlijn;

  return server ?? uitTijdlijn;
}

function serverMeasurement(payload: PitwallPitLossPayload | null | undefined): PitStopMeasurement | null {
  const blok = alsObject(payload?.pit_loss);
  const los = alsGetal(payload?.pit_lane_seconds);

  if (!blok && los == null) return null;

  const pitLaneSeconds = alsGetal(blok?.pitLaneSeconds) ?? los;
  const sampleCount = alsGetal(blok?.sampleCount);
  const lastStopAt = typeof blok?.lastStopAt === "string" ? blok.lastStopAt : null;

  return {
    pitLaneSeconds,
    sampleCount: sampleCount == null ? 0 : Math.trunc(sampleCount),
    source: pitLaneSeconds == null ? "none" : "measured",
    lastStopAt,
    stops: [],
  };
}

function timelineSamples(payload: PitwallPitLossPayload | null | undefined): PitFlagSample[] {
  if (!Array.isArray(payload?.timeline)) return [];

  return payload.timeline.flatMap((rij) => {
    const event = alsObject(rij);
    if (!event || typeof event.captured_at !== "string") return [];
    const vlag = event.in_pit_lane;
    return [{ captured_at: event.captured_at, in_pit_lane: typeof vlag === "boolean" ? vlag : null }];
  });
}
