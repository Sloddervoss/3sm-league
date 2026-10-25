import { estimateFuelToFinish } from "./fuelToFinish";
import {
  estimateFuelPerLap,
  fuelToAddForFinish,
  lapsOnFuel as computeLapsOnFuel,
} from "./fuelModel";
import { computePitLoss } from "./pitLoss";
import { computePitWindow } from "./pitWindow";
import { adviseTyreChange, type TyreAdvice } from "./tyreWear";
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

/**
 * Resterende sessietijd in seconden.
 *
 * Eerst de klok die de connector zelf meestuurt. Pas als die ontbreekt, de
 * geplande duur min de verstreken tijd. Zo werkt een tijdrace ook als het event
 * geen duur in de catalogus heeft: `sessionLapsRemaining` is daar leeg, maar de
 * klok is er wel.
 */
export function remainingSessionSeconds(snapshot: StrategySnapshot): number | null {
  const direct = snapshot.sessionTimeRemainingSeconds;
  if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0) return direct;

  const { plannedDurationMinutes, raceClockSeconds } = snapshot;
  if (plannedDurationMinutes != null && plannedDurationMinutes > 0 && Number.isFinite(raceClockSeconds)) {
    const resterend = plannedDurationMinutes * 60 - raceClockSeconds;
    return resterend > 0 ? resterend : 0;
  }
  return null;
}

/** Rondetijd waarmee de resterende tijd naar rondes gaat: gemiddelde, anders de laatste ronde. */
export function referenceLapSeconds(snapshot: StrategySnapshot): number | null {
  const gemiddeld = snapshot.averageLapSeconds;
  if (typeof gemiddeld === "number" && Number.isFinite(gemiddeld) && gemiddeld > 0) return gemiddeld;
  return snapshot.currentLapSeconds != null && snapshot.currentLapSeconds > 0
    ? snapshot.currentLapSeconds
    : null;
}

/** Resterende rondes tot de finish, of null als de afstand onbekend is. */
export function lapsToFinish(snapshot: StrategySnapshot): number | null {
  const { plannedLaps, lapsCompleted } = snapshot;
  if (plannedLaps != null && plannedLaps > 0) {
    return Math.max(0, plannedLaps - lapsCompleted);
  }

  const resterend = remainingSessionSeconds(snapshot);
  const rondetijd = referenceLapSeconds(snapshot);
  if (resterend == null || resterend <= 0 || rondetijd == null) return resterend === 0 ? 0 : null;
  // Naar boven afronden: de laatste halve ronde telt ook.
  return Math.ceil(resterend / rondetijd);
}

export function advise(snapshot: StrategySnapshot): Advice {
  const reserve = snapshot.reserveLaps ?? 0.5;
  const fuel = estimateFuelPerLap(snapshot.fuelPerLapSamples, snapshot.fuelPerLapPrior);
  const perLap = fuel.perLap;
  const resterend = lapsToFinish(snapshot);
  const voorraad = computeLapsOnFuel(snapshot.fuelLitres, perLap, reserve);
  const tyreSamples = snapshot.tyreSamples ?? [];

  // Dezelfde invoer, maar dan in tijd: dit is het getal dat een tijdrace wél
  // kan geven terwijl `session_laps_remaining` leeg blijft.
  const brandstofTotFinish = estimateFuelToFinish({
    remainingSeconds: remainingSessionSeconds(snapshot),
    averageLapSeconds: referenceLapSeconds(snapshot),
    fuelPerLap: perLap,
    fuelLitres: snapshot.fuelLitres,
    tankCapacityLitres: snapshot.tankCapacityLitres,
  });

  /** Geen bandenadvies, met de reden die de band letterlijk toont. */
  const geenBandAdvies = (reasonCode: string, reason: string): TyreAdvice => ({
    action: "NO_ADVICE",
    wearPerLap: null,
    lapsRemaining: null,
    weakestCorner: null,
    mustSurviveLaps: null,
    horizon: "planned_stop",
    reliable: false,
    samples: tyreSamples.length,
    reasonCode,
    reason,
  });

  const leeg = (
    reasonCode: string,
    reason: string,
    confidence: Confidence = "none",
    tyres: TyreAdvice = geenBandAdvies(
      "no_baseline",
      "Geen bandenadvies: zonder brandstof- en afstandsbeeld is niet te bepalen hoever de banden moeten komen.",
    ),
  ): Advice => ({
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
    fuelToFinish: brandstofTotFinish,
    tyres,
  });

  if (snapshot.sampleAgeSeconds > MAX_SAMPLE_AGE_SECONDS) {
    return leeg(
      "stale_telemetry",
      `Telemetrie is ${Math.round(snapshot.sampleAgeSeconds)} s oud; geen advies op verouderde cijfers.`,
      "none",
      geenBandAdvies(
        "stale_telemetry",
        `Geen bandenadvies: de bandenmeting is ${Math.round(snapshot.sampleAgeSeconds)} s oud.`,
      ),
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

  // Een serverzijdig gemeten prior is bruikbaar, maar niet "hoog": het is geen
  // eigen meting van deze stint.
  const ruwe = confidenceFor(snapshot, fuel.samples, fuel.sigma, perLap);
  const confidence = ruwe === "none" && fuel.source === "prior" ? "low" : ruwe;

  const basis = {
    window,
    fuel,
    pitLoss,
    lapsOnFuel: voorraad,
    lapsToFinish: resterend,
    confidence,
    fuelToAddLitres: tanken,
    fuelToFinish: brandstofTotFinish,
  } as const;

  if (voorraad == null) {
    return leeg("no_range", "Brandstofvoorraad in rondes is niet te bepalen.");
  }

  const laatsteMoment = window
    ? window.latestLap - snapshot.lapsCompleted
    : voorraad - 1;

  const totStop = Math.max(0, Math.min(laatsteMoment, voorraad - 1));
  const blijftBuiten = resterend != null && voorraad >= resterend;

  // Het bandenadvies hangt aan dezelfde horizon als het advies zelf: haalt de
  // tank de finish, dan moeten de banden dat ook; anders moeten ze de geplande
  // stop halen en bepaalt de band of die stop naar voren moet.
  const tyres = adviseTyreChange({
    samples: tyreSamples,
    horizon: blijftBuiten ? "finish" : "planned_stop",
    mustSurviveLaps: blijftBuiten ? resterend : totStop,
  });

  // De band is eerder op dan de geplande stop: dan wint de band, want een stop
  // die je te laat plant is een stop die je alsnog moet maken.
  const bandRondes = tyres.action === "CHANGE_BEFORE_PLANNED_STOP" ? tyres.lapsRemaining : null;

  const bandStop = (laps: number) => ({
    ...basis,
    tyres,
    decision: laps <= 0 ? ("PIT_THIS_LAP" as const) : ("PIT_IN_LAPS" as const),
    lapsUntilPit: Math.max(0, laps),
    reasonCode: "tyre_life",
    reason: tyres.reason,
  });

  // De finish halen zonder te stoppen.
  if (blijftBuiten && bandRondes == null) {
    return {
      ...basis,
      tyres,
      decision: "STAY_OUT",
      lapsUntilPit: null,
      reasonCode: "fuel_to_finish",
      reason: `Deze tank haalt de finish (${resterend} rondes te gaan, ${voorraad} in de tank).`,
    };
  }

  if (blijftBuiten && bandRondes != null) {
    return bandStop(bandRondes);
  }

  // Droogvallen: nu naar binnen.
  if (voorraad <= 1) {
    return {
      ...basis,
      tyres,
      decision: "PIT_THIS_LAP",
      lapsUntilPit: 0,
      reasonCode: "fuel_critical",
      reason: `Nog ${voorraad} ronde brandstof; wachten kan niet.`,
    };
  }

  if (bandRondes != null && bandRondes < totStop) {
    return bandStop(bandRondes);
  }

  if (window?.saveRequired) {
    return {
      ...basis,
      tyres,
      decision: totStop === 0 ? "PIT_THIS_LAP" : "PIT_IN_LAPS",
      lapsUntilPit: totStop,
      reasonCode: "fuel_save_required",
      reason: `Om met ${window.stopsRequired} stops te finish te halen moet je ${window.lapsToSave} ${window.lapsToSave === 1 ? "ronde" : "rondes"} sparen, of een extra stop accepteren.`,
    };
  }

  return {
    ...basis,
    tyres,
    decision: totStop === 0 ? "PIT_THIS_LAP" : "PIT_IN_LAPS",
    lapsUntilPit: totStop,
    reasonCode: window ? "in_window" : "fuel_based",
    reason:
      totStop === 0
        ? "Deze ronde is het laatste redelijke moment."
        : `Over ${totStop} ${totStop === 1 ? "ronde" : "rondes"} naar binnen voor brandstof.`,
  };
}
