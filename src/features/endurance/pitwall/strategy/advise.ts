import {
  estimateFuelPerLap,
  fuelToAddForFinish,
  lapsOnFuel as computeLapsOnFuel,
} from "./fuelModel";
import { computePitLoss } from "./pitLoss";
import { computePitWindow } from "./pitWindow";
import type { Advice, Confidence, StrategySnapshot } from "./types";

/**
 * Het advies.
 *
 * Dit is de enige plek die een beslissing neemt. Alles eronder rekent; hier
 * wordt gekozen, en elke uitkomst draagt een reason_code zodat de UI kan uitleggen
 * waarom. Liever "geen advies" met een oorzaak dan een getal dat niet te
 * onderbouwen is.
 */

/** Boven deze leeftijd is de meting te oud om op te sturen. */
const MAX_SAMPLE_AGE_SECONDS = 5;

function confidenceFor(snapshot: StrategySnapshot, samples: number, sigma: number | null, perLap: number | null): Confidence {
  if (snapshot.sampleAgeSeconds > MAX_SAMPLE_AGE_SECONDS) return "none";
  if (perLap == null || perLap <= 0) return "none";
  const ruis = sigma == null ? 0 : sigma / perLap;
  if (samples >= 8 && ruis <= 0.05) return "high";
  if (samples >= 4) return "medium";
  if (samples >= 1) return "low";
  return "none";
}

/** Resterende rondes tot de finish, of null als de afstand onbekend is. */
export function lapsToFinish(snapshot: StrategySnapshot): number | null {
  const { plannedLaps, lapsCompleted } = snapshot;
  if (plannedLaps != null && plannedLaps > 0) {
    return Math.max(0, plannedLaps - lapsCompleted);
  }
  const { plannedDurationMinutes, raceClockSeconds, currentLapSeconds } = snapshot;
  if (plannedDurationMinutes != null && plannedDurationMinutes > 0 && currentLapSeconds != null && currentLapSeconds > 0) {
    const resterend = plannedDurationMinutes * 60 - raceClockSeconds;
    if (resterend <= 0) return 0;
    // Naar boven afronden: de laatste halve ronde telt ook.
    return Math.ceil(resterend / currentLapSeconds);
  }
  return null;
}

export function advise(snapshot: StrategySnapshot): Advice {
  const reserve = snapshot.reserveLaps ?? 0.5;
  const fuel = estimateFuelPerLap(snapshot.fuelPerLapSamples, snapshot.fuelPerLapPrior);
  const perLap = fuel.perLap;
  const resterend = lapsToFinish(snapshot);
  const voorraad = computeLapsOnFuel(snapshot.fuelLitres, perLap, reserve);

  const leeg = (reasonCode: string, reason: string, confidence: Confidence = "none"): Advice => ({
    decision: "NO_ADVICE",
    lapsUntilPit: null,
    fuelToAddLitres: null,
    confidence,
    reasonCode,
    reason,
    window: null,
    fuel,
    pitLoss: null,
    lapsOnFuel: voorraad,
    lapsToFinish: resterend,
  });

  if (snapshot.sampleAgeSeconds > MAX_SAMPLE_AGE_SECONDS) {
    return leeg(
      "stale_telemetry",
      `Telemetrie is ${Math.round(snapshot.sampleAgeSeconds)} s oud; geen advies op verouderde cijfers.`,
    );
  }

  if (snapshot.fuelLitres == null) {
    return leeg("no_fuel_reading", "De auto meldt geen brandstofniveau.");
  }

  if (perLap == null || perLap <= 0) {
    return leeg("no_consumption", "Nog geen betrouwbaar verbruik per ronde gemeten.");
  }

  const stintCapaciteit =
    snapshot.tankCapacityLitres != null && perLap > 0
      ? Math.floor(snapshot.tankCapacityLitres / perLap)
      : null;

  const window = computePitWindow({
    lapsToFinish: resterend,
    lapsOnFuel: voorraad,
    stintCapacityLaps: stintCapaciteit,
    lapsCompleted: snapshot.lapsCompleted,
  });

  const tanken =
    resterend != null
      ? fuelToAddForFinish(resterend, perLap, snapshot.fuelLitres, snapshot.tankCapacityLitres, reserve)
      : snapshot.tankCapacityLitres != null
        ? Math.max(0, snapshot.tankCapacityLitres - snapshot.fuelLitres)
        : null;

  const pitLoss = computePitLoss({
    pitLaneSeconds: snapshot.pitLaneSeconds,
    fuelLitres: tanken,
    secondsPerLitre: snapshot.secondsPerLitre,
    tyreSeconds: snapshot.tyreSeconds,
  });

  const confidence = confidenceFor(snapshot, fuel.samples, fuel.sigma, perLap);

  const basis = {
    window,
    fuel,
    pitLoss,
    lapsOnFuel: voorraad,
    lapsToFinish: resterend,
    confidence,
    fuelToAddLitres: tanken,
  } as const;

  if (voorraad == null) {
    return leeg("no_range", "Brandstofvoorraad in rondes is niet te bepalen.");
  }

  // De finish halen zonder te stoppen.
  if (resterend != null && voorraad >= resterend) {
    return {
      ...basis,
      decision: "STAY_OUT",
      lapsUntilPit: null,
      reasonCode: "fuel_to_finish",
      reason: `Deze tank haalt de finish (${resterend} rondes te gaan, ${voorraad} in de tank).`,
    };
  }

  // Droogvallen: nu naar binnen.
  if (voorraad <= 1) {
    return {
      ...basis,
      decision: "PIT_THIS_LAP",
      lapsUntilPit: 0,
      reasonCode: "fuel_critical",
      reason: `Nog ${voorraad} ronde brandstof; wachten kan niet.`,
    };
  }

  const laatsteMoment = window
    ? window.latestLap - snapshot.lapsCompleted
    : voorraad - 1;

  const totStop = Math.max(0, Math.min(laatsteMoment, voorraad - 1));

  if (window?.saveRequired) {
    return {
      ...basis,
      decision: totStop === 0 ? "PIT_THIS_LAP" : "PIT_IN_LAPS",
      lapsUntilPit: totStop,
      reasonCode: "fuel_save_required",
      reason: `Om met ${window.stopsRequired} stops te finish te halen moet je ${window.lapsToSave} ${window.lapsToSave === 1 ? "ronde" : "rondes"} sparen, of een extra stop accepteren.`,
    };
  }

  return {
    ...basis,
    decision: totStop === 0 ? "PIT_THIS_LAP" : "PIT_IN_LAPS",
    lapsUntilPit: totStop,
    reasonCode: window ? "in_window" : "fuel_based",
    reason:
      totStop === 0
        ? "Deze ronde is het laatste redelijke moment."
        : `Over ${totStop} ${totStop === 1 ? "ronde" : "rondes"} naar binnen voor brandstof.`,
  };
}
