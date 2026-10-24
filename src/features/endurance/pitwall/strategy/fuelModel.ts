import type { FuelEstimate } from "./types";

/**
 * Brandstof per ronde.
 *
 * De connector stuurt ook een eigen schatting mee, maar die is niet te
 * controleren en slaat bij een pitstop of een gele vlag volledig op hol. Wij
 * meten daarom zelf: mediaan met een MAD-uitbijtertoets (robuust tegen één
 * verkeerde ronde) en daarna een pessimistische bovengrens.
 *
 * Pessimistisch is bewust: te weinig brandstof kost de race, te veel kost een
 * seconde of twee.
 */

const MAD_SCALE = 1.4826; // MAD -> standaardafwijking bij normaal verdeelde ruis
const MIN_OUTLIER_BAND = 0.05; // liter per ronde; anders keurt MAD rond nul alles goed
const MAX_UPLIFT = 0.25; // nooit meer dan 25% boven de mediaan
const MIN_SAMPLES_MEASURED = 3;

export function median(values: number[]): number | null {
  const bruikbaar = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (bruikbaar.length === 0) return null;
  const midden = Math.floor(bruikbaar.length / 2);
  return bruikbaar.length % 2 === 1
    ? bruikbaar[midden]
    : (bruikbaar[midden - 1] + bruikbaar[midden]) / 2;
}

/** Mediaan absolute afwijking, geschaald naar een standaardafwijking. */
export function madSigma(values: number[]): number | null {
  const med = median(values);
  if (med == null) return null;
  const afwijkingen = values.filter((v) => Number.isFinite(v)).map((v) => Math.abs(v - med));
  const mad = median(afwijkingen);
  return mad == null ? null : mad * MAD_SCALE;
}

export interface FuelOptions {
  /** Rondes onder deze drempel tellen niet mee: te kort voor een betrouwbare meting. */
  minPlausible?: number;
  /** Rondes boven deze drempel zijn een invoerfout of een reset. */
  maxPlausible?: number;
}

export function estimateFuelPerLap(
  samples: number[],
  prior: number | null = null,
  options: FuelOptions = {},
): FuelEstimate {
  const min = options.minPlausible ?? 0.2;
  const max = options.maxPlausible ?? 15;

  const plausibel = samples.filter(
    (v) => Number.isFinite(v) && v >= min && v <= max,
  );

  if (plausibel.length === 0) {
    return {
      perLap: prior,
      sigma: null,
      samples: 0,
      rejected: samples.length,
      source: prior != null ? "prior" : "none",
    };
  }

  const med = median(plausibel)!;
  const sigmaRuw = madSigma(plausibel) ?? 0;
  const band = Math.max(3 * sigmaRuw, MIN_OUTLIER_BAND);
  const behouden = plausibel.filter((v) => Math.abs(v - med) <= band);

  // Als de toets alles weggooit, is de reeks zelf het probleem: dan liever de
  // mediaan van alles dan geen antwoord.
  const basis = behouden.length > 0 ? behouden : plausibel;
  const basisMediaan = median(basis)!;
  const basisSigma = madSigma(basis) ?? 0;

  if (basis.length < MIN_SAMPLES_MEASURED && prior == null) {
    // Te weinig data en geen startpunt: wel een getal, maar zonder vertrouwen.
    return {
      perLap: basisMediaan,
      sigma: basisSigma,
      samples: basis.length,
      rejected: samples.length - basis.length,
      source: "measured",
    };
  }

  const uplift = basisSigma > 0
    ? Math.min((2 * basisSigma) / Math.sqrt(basis.length), basisMediaan * MAX_UPLIFT)
    : 0;

  return {
    perLap: basisMediaan + uplift,
    sigma: basisSigma,
    samples: basis.length,
    rejected: samples.length - basis.length,
    source: "measured",
  };
}

/** Hoeveel hele rondes de huidige tank nog meegaat, na aftrek van de reserve. */
export function lapsOnFuel(
  fuelLitres: number | null,
  perLap: number | null,
  reserveLaps = 0.5,
): number | null {
  if (fuelLitres == null || perLap == null || perLap <= 0) return null;
  const rondes = fuelLitres / perLap - reserveLaps;
  return Math.max(0, Math.floor(rondes));
}

/** Liters die nodig zijn om een aantal rondes te rijden. */
export function fuelForLaps(laps: number, perLap: number | null): number | null {
  if (perLap == null || perLap <= 0 || laps < 0) return null;
  return laps * perLap;
}

/**
 * Liters die bij de volgende stop bij moeten om de finish te halen.
 * Geeft null als de finishafstand onbekend is: bij een tijdrace zonder duur is
 * er geen finish om naartoe te rekenen en dan is elk getal een verzinsel.
 */
export function fuelToAddForFinish(
  lapsToFinish: number | null,
  perLap: number | null,
  fuelLitres: number | null,
  tankCapacityLitres: number | null,
  reserveLaps = 0.5,
): number | null {
  if (lapsToFinish == null || perLap == null || fuelLitres == null) return null;
  const nodig = (lapsToFinish + reserveLaps) * perLap - fuelLitres;
  if (nodig <= 0) return 0;
  if (tankCapacityLitres == null) return nodig;
  return Math.min(nodig, Math.max(0, tankCapacityLitres - fuelLitres));
}
