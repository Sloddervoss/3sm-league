import { median } from "./fuelModel";
import type { TyreEvaluation } from "./types";

/**
 * Bandenslijtage.
 *
 * Twee dingen gaan hier bijna altijd mis, en beide zijn te vermijden:
 *
 * 1. Rondetijd tegen bandleeftijd regresseren zonder brandstofcorrectie. De auto
 *    wordt elke ronde lichter en dus sneller, wat de slijtage maskeert. In een
 *    simulatie met 0,050 s/ronde echte degradatie gaf naïeve regressie +0,0065:
 *    een factor acht te laag.
 * 2. De helling als vast getal gebruiken. Zonder betrouwbaarheidsinterval is een
 *    advies op drie rommelige rondes niet te onderscheiden van ruis.
 *
 * Daarom: Theil-Sen (mediaan van paarsgewijze hellingen, robuust tegen één
 * uitschieter), op brandstofgecorrigeerde tijd, met een halfwidth die meetelt in
 * de beslissing.
 */

/** Seconden per kilogram brandstof. Enige bekende waarde uit de literatuur. */
export const DEFAULT_SECONDS_PER_KG = 0.035;
/** Kilogram per liter benzine; iRacing rekent met deze orde van grootte. */
export const DEFAULT_KG_PER_LITRE = 0.75;
/** Onder deze helling is een bandenwissel het extra werk niet waard. */
export const MIN_MEANINGFUL_SLOPE = 0.012;

export interface TheilSenPoint {
  x: number;
  y: number;
}

export interface TheilSenResult {
  slope: number | null;
  intercept: number | null;
  samples: number;
  /** Geschatte standaardfout van de helling via de residuen. */
  standardError: number | null;
}

export function theilSen(points: TheilSenPoint[]): TheilSenResult {
  const punten = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (punten.length < 2) {
    return { slope: punten.length === 1 ? 0 : null, intercept: punten.length === 1 ? punten[0].y : null, samples: punten.length, standardError: null };
  }

  const hellingen: number[] = [];
  for (let i = 0; i < punten.length; i += 1) {
    for (let j = i + 1; j < punten.length; j += 1) {
      const dx = punten[j].x - punten[i].x;
      if (dx === 0) continue;
      hellingen.push((punten[j].y - punten[i].y) / dx);
    }
  }

  const slope = median(hellingen);
  if (slope == null) return { slope: null, intercept: null, samples: punten.length, standardError: null };

  const gemX = punten.reduce((som, p) => som + p.x, 0) / punten.length;
  const gemY = punten.reduce((som, p) => som + p.y, 0) / punten.length;
  const intercept = gemY - slope * gemX;

  // Standaardfout van de helling uit de residuen; bij minder dan drie punten
  // is er niets te schatten en blijft hij null (dus: niet betrouwbaar).
  let standardError: number | null = null;
  if (punten.length >= 3) {
    const sxx = punten.reduce((som, p) => som + (p.x - gemX) ** 2, 0);
    const sse = punten.reduce((som, p) => som + (p.y - (intercept + slope * p.x)) ** 2, 0);
    if (sxx > 0) standardError = Math.sqrt(sse / (punten.length - 2) / sxx);
  }

  return { slope, intercept, samples: punten.length, standardError };
}

export interface TyreLapSample {
  /** Rondes sinds de bandenwissel; 0 = de eerste ronde op deze set. */
  tyreLap: number;
  lapSeconds: number;
  /** Brandstof aan het begin van die ronde, in liters. */
  fuelLitres: number | null;
}

export interface TyreEvaluationInput {
  samples: TyreLapSample[];
  secondsPerKg?: number;
  kgPerLitre?: number;
  /** Aantal rondes tot de finish; bepaalt of de helling ertoe doet. */
  lapsRemaining?: number | null;
}

export function evaluateTyreWear(input: TyreEvaluationInput): TyreEvaluation {
  const k = input.secondsPerKg ?? DEFAULT_SECONDS_PER_KG;
  const dichtheid = input.kgPerLitre ?? DEFAULT_KG_PER_LITRE;

  const bruikbaar = input.samples.filter(
    (s) => Number.isFinite(s.lapSeconds) && s.lapSeconds > 20 && Number.isFinite(s.tyreLap),
  );

  if (bruikbaar.length < 4) {
    return {
      slopeSecondsPerLap: null,
      halfWidth: null,
      samples: bruikbaar.length,
      reliable: false,
      reasonCode: "too_few_laps",
    };
  }

  // Zonder brandstofwaarde per ronde kunnen we niet corrigeren; dan is de
  // helling een mengsel van slijtage en gewicht en dus niet bruikbaar.
  const metBrandstof = bruikbaar.filter((s) => s.fuelLitres != null);
  if (metBrandstof.length < 4) {
    return {
      slopeSecondsPerLap: null,
      halfWidth: null,
      samples: metBrandstof.length,
      reliable: false,
      reasonCode: "no_fuel_correction",
    };
  }

  const punten: TheilSenPoint[] = metBrandstof.map((s) => ({
    x: s.tyreLap,
    y: s.lapSeconds - k * s.fuelLitres! * dichtheid,
  }));

  const fit = theilSen(punten);
  if (fit.slope == null) {
    return {
      slopeSecondsPerLap: null,
      halfWidth: null,
      samples: fit.samples,
      reliable: false,
      reasonCode: "fit_failed",
    };
  }

  const halfWidth = fit.standardError == null ? null : 1.96 * fit.standardError;
  const betrouwbaar =
    halfWidth != null &&
    halfWidth <= 0.02 &&
    fit.samples >= 4;

  return {
    slopeSecondsPerLap: fit.slope,
    halfWidth,
    samples: fit.samples,
    reliable: betrouwbaar,
    reasonCode: betrouwbaar ? "ok" : halfWidth == null ? "too_few_laps" : "too_uncertain",
  };
}

/**
 * Cumulatief tijdverlies van een lineair oplopende rondetijd over n rondes.
 * De som 1+2+...+n, want de laatste ronde is het duurst.
 */
export function cumulativeDegradationLoss(slopePerLap: number, laps: number): number {
  if (laps <= 0) return 0;
  return (slopePerLap * (laps * (laps + 1))) / 2;
}

export interface TyreDecisionInput {
  evaluation: TyreEvaluation;
  /** Wat de bandenwissel extra kost aan de stop, in seconden. */
  extraStopSeconds: number;
  lapsRemaining: number | null;
}

export interface TyreDecision {
  changeTyres: boolean;
  /** Helling waarbij wisselen break-even draait, in s/ronde. */
  breakevenSlope: number | null;
  reasonCode: string;
}

/**
 * Wisselen loont als het verwachte tijdverlies door slijtage groter is dan wat
 * de wissel extra kost. Bij een stop die je toch al maakt is dat bijna niets;
 * een losse stop moet het volledige pitverlies terugverdienen.
 */
export function decideTyreChange(input: TyreDecisionInput): TyreDecision {
  const { evaluation, extraStopSeconds, lapsRemaining } = input;

  if (!evaluation.reliable || evaluation.slopeSecondsPerLap == null) {
    return { changeTyres: false, breakevenSlope: null, reasonCode: evaluation.reasonCode };
  }
  if (lapsRemaining == null || lapsRemaining <= 0) {
    return { changeTyres: false, breakevenSlope: null, reasonCode: "unknown_laps_remaining" };
  }

  const noemer = (lapsRemaining * (lapsRemaining + 1)) / 2;
  const breakeven = Math.max(0, extraStopSeconds) / noemer;

  const ondergrens = Math.max(breakeven, MIN_MEANINGFUL_SLOPE);
  const voorzichtig = evaluation.slopeSecondsPerLap - (evaluation.halfWidth ?? 0);

  return {
    changeTyres: voorzichtig > ondergrens,
    breakevenSlope: ondergrens,
    reasonCode:
      voorzichtig > ondergrens
        ? "tyre_change_pays_off"
        : evaluation.slopeSecondsPerLap < MIN_MEANINGFUL_SLOPE
          ? "wear_too_small"
          : "breakeven_not_reached",
  };
}
