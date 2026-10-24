/**
 * Bandenslijtage uit losse metingen.
 *
 * De server stuurt per ronde vier percentages mee (100 = nieuw, 0 = versleten).
 * Dat is een ander soort meting dan rondetijden: je hoeft er geen
 * brandstofgewicht voor te corrigeren, want de slijtage is de slijtage. Wat je
 * wél moet doen is de ruis eruit halen en een bandenwissel herkennen — anders
 * middelt een nieuwe set de oude trend weg.
 */

export interface TyreSample {
  lap: number;
  /** Rondetijd; mag null zijn als de ronde niet is afgerond. */
  lapTime: number | null;
  /** De vier hoeken, restpercentage (100 = nieuw). */
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

export interface TyreWearRate {
  /** Procentpunten per ronde, positief. Null als het niet te berekenen is. */
  wearPerLap: number | null;
  /** Rondes tot het zwakste wiel op nul staat. */
  lapsRemaining: number | null;
  /** Aantal metingen dat meedeed. */
  samples: number;
  /** True bij genoeg metingen en een monotone reeks. */
  reliable: boolean;
  reasonCode:
    | "ok"
    | "too_few_samples"
    | "tyre_change"
    | "not_wearing"
    | "implausible";
}

/** Een sprong omhoog groter dan dit is een nieuwe set, geen meetruis. */
const TYRE_CHANGE_JUMP = 1.5;
/** Meer dan dit per ronde is geen slijtage maar een verkeerde eenheid. */
const MAX_PLAUSIBLE_WEAR_PER_LAP = 5;

export function tyreWearRate(input: TyreSample[]): TyreWearRate {
  const bruikbaar = input
    .filter((s) => Number.isFinite(s.lap) && [s.fl, s.fr, s.rl, s.rr].every((v) => Number.isFinite(v)))
    .sort((a, b) => a.lap - b.lap);

  const leeg = (reasonCode: TyreWearRate["reasonCode"], samples = bruikbaar.length): TyreWearRate => ({
    wearPerLap: null,
    lapsRemaining: null,
    samples,
    reliable: false,
    reasonCode,
  });

  if (bruikbaar.length < 4) return leeg("too_few_samples");

  // Het zwakste wiel bepaalt hoe lang de set meegaat.
  const rest = bruikbaar.map((s) => ({ lap: s.lap, wear: Math.min(s.fl, s.fr, s.rl, s.rr) }));

  const rates: number[] = [];
  for (let i = 1; i < rest.length; i += 1) {
    const vorige = rest[i - 1];
    const nu = rest[i];
    const deltaLap = nu.lap - vorige.lap;
    if (deltaLap <= 0) continue;

    const deltaWear = vorige.wear - nu.wear;
    // Omhoog = nieuwe banden. Stop daar: alles na een wissel hoort bij een
    // andere set en mag deze trend niet verdunnen.
    if (deltaWear < -TYRE_CHANGE_JUMP) return leeg("tyre_change", rates.length + 1);
    if (deltaWear <= 0) continue;

    rates.push(deltaWear / deltaLap);
  }

  if (rates.length < 3) return leeg("not_wearing", rates.length);

  const mediaan = median(rates);
  if (mediaan <= 0 || mediaan > MAX_PLAUSIBLE_WEAR_PER_LAP) return leeg("implausible", rates.length);

  const laatste = rest[rest.length - 1];
  const lapsRemaining = laatste.wear / mediaan;

  return {
    wearPerLap: round(mediaan, 4),
    lapsRemaining: Math.max(0, Math.floor(lapsRemaining)),
    samples: bruikbaar.length,
    // Vier metingen en een mediaan die niet op één uitschieter rust.
    reliable: bruikbaar.length >= 4 && rates.length >= 3,
    reasonCode: "ok",
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
