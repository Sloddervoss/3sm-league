import { estimateFuelToFinish } from "./fuelToFinish";
import {
  estimateFuelPerLap,
  fuelToAddForFinish,
  lapsOnFuel as computeLapsOnFuel,
} from "./fuelModel";
import { computePitLoss } from "./pitLoss";
import { pitBoxRepair } from "./pitService";
import { computePitWindow } from "./pitWindow";
import { clientTyreEstimate, type TyreEstimate } from "./tyreGrade";
import { adviseTyreChange, type TyreAdvice } from "./tyreWear";
import type {
  Advice,
  BindingConstraint,
  Confidence,
  StrategySnapshot,
  TyreFuelComparison,
} from "./types";

/**
 * Het advies.
 *
 * Dit is de enige plek die een beslissing neemt. Alles eronder rekent; hier
 * wordt gekozen, en elke uitkomst draagt een reason_code zodat de UI kan uitleggen
 * waarom. Liever "geen advies" met een oorzaak dan een getal dat niet te
 * onderbouwen is.
 *
 * Er is één grens en die wordt hier één keer getrokken. Banden en tank staan
 * allebei in dezelfde eenheid — rondes tot hun grens — en `lapsUntilPit` is per
 * definitie de kleinste van de twee (`bindingConstraint`). Wie dat getal in de
 * UI opnieuw uitrekent, krijgt twee getallen die het niet eens zijn; dat is de
 * duurste faalvorm van dit paneel.
 */

/** Boven deze leeftijd is de meting te oud om op te sturen. */
const MAX_SAMPLE_AGE_SECONDS = 5;

/**
 * Twee grenzen die minder dan een halve ronde verschillen zijn in hele rondes
 * dezelfde grens. Dan is de eerlijke uitspraak "beide", niet een pijltje dat
 * elke ronde van kant wisselt.
 */
const BINDING_TIE_LAPS = 0.5;

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

export interface BindingInput {
  /** Rondes tot de bandengrens; null als de graad geen getal toelaat (C/D). */
  tyreLaps: number | null;
  /** Rondes tot de tankgrens; null als de tankinhoud onbekend is. */
  fuelLaps: number | null;
}

export interface BindingResult {
  binding: BindingConstraint | null;
  /** De bindende grens; altijd `min(tyreLaps, fuelLaps)` van wat bekend is. */
  laps: number | null;
}

/**
 * De enige selector tussen de twee grenzen.
 *
 * Harde invariant, en de hele reden dat deze functie bestaat:
 * `laps === min(band, tank)`. Onbekend telt niet als oneindig en ook niet als
 * nul — is één van de twee onbekend, dan is de ander de grens en zegt `binding`
 * welke dat is. Zijn ze allebei onbekend, dan is er geen grens en geen advies.
 */
export function bindingConstraint(input: BindingInput): BindingResult {
  const { tyreLaps, fuelLaps } = input;
  if (tyreLaps == null && fuelLaps == null) return { binding: null, laps: null };
  if (tyreLaps == null) return { binding: "fuel", laps: fuelLaps };
  if (fuelLaps == null) return { binding: "tyres", laps: tyreLaps };

  if (Math.abs(tyreLaps - fuelLaps) < BINDING_TIE_LAPS) {
    return { binding: "both", laps: Math.min(tyreLaps, fuelLaps) };
  }
  return tyreLaps < fuelLaps
    ? { binding: "tyres", laps: tyreLaps }
    : { binding: "fuel", laps: fuelLaps };
}

export function advise(snapshot: StrategySnapshot): Advice {
  const reserve = snapshot.reserveLaps ?? 0.5;
  const fuel = estimateFuelPerLap(snapshot.fuelPerLapSamples, snapshot.fuelPerLapPrior);
  const perLap = fuel.perLap;
  const resterend = lapsToFinish(snapshot);
  const voorraad = computeLapsOnFuel(snapshot.fuelLitres, perLap, reserve);
  const tyreSamples = snapshot.tyreSamples ?? [];

  /**
   * Het bandenbeeld: de servermeting als die er is, anders de live reeks met
   * dezelfde vorm en een voorzichtiger graad. Nooit een getal zonder graad.
   */
  const tyreEstimate: TyreEstimate = snapshot.tyreEstimate ?? clientTyreEstimate(tyreSamples);

  /**
   * De reparatiestrook. Alleen bij verse telemetrie: een reparatieverplichting
   * uit een meting van een halve minuut oud is geschiedenis, geen mededeling.
   */
  const inBox =
    snapshot.sampleAgeSeconds > MAX_SAMPLE_AGE_SECONDS
      ? null
      : pitBoxRepair({
          onPitRoad: snapshot.onPitRoad ?? null,
          requiredRepairSeconds: snapshot.requiredRepairSeconds ?? null,
          optionalRepairSeconds: snapshot.optionalRepairSeconds ?? null,
        });

  /**
   * De bandengrens in rondes. Alleen graad A en B mogen een getal leveren; C en
   * D leveren een bereik of een oorzaak, en dan is de tank de enige grens.
   */
  const tyreLapsRaw =
    tyreEstimate.grade === "A" || tyreEstimate.grade === "B" ? tyreEstimate.lapsToThreshold : null;
  const tyreLaps = tyreLapsRaw == null ? null : Math.max(0, Math.floor(tyreLapsRaw));

  // Dezelfde invoer, maar dan in tijd: dit is het getal dat een tijdrace wél
  // kan geven terwijl `session_laps_remaining` leeg blijft.
  // Loopt de race op afstand, dan is de finish het aantal geplande rondes min
  // wat er al gereden is. Anders blijft de klok de bron.
  const rondesTotFinish =
    snapshot.plannedLaps != null && snapshot.lapsCompleted != null
      ? Math.max(0, snapshot.plannedLaps - snapshot.lapsCompleted)
      : null;

  const brandstofTotFinish = estimateFuelToFinish({
    lapsRemaining: rondesTotFinish,
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
    binding: null,
    tyreFuel: null,
    tyreEstimate,
    inBox,
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
    inBox,
  } as const;

  if (voorraad == null) {
    return leeg("no_range", "Brandstofvoorraad in rondes is niet te bepalen.");
  }

  // De tankgrens: één ronde marge op wat de tank meegaat, en nooit negatief.
  const tankLaps = Math.max(0, voorraad - 1);
  const binding = bindingConstraint({ tyreLaps, fuelLaps: tankLaps });

  // Het bereik op de tank: dezelfde σ die de zekerheid bepaalt, in rondes.
  const fuelRange =
    snapshot.fuelLitres != null && fuel.sigma != null && fuel.sigma > 0 && perLap - fuel.sigma > 0
      ? {
          low: Math.max(0, Math.floor(snapshot.fuelLitres / (perLap + fuel.sigma) - reserve)),
          high: Math.max(0, Math.floor(snapshot.fuelLitres / (perLap - fuel.sigma) - reserve)),
        }
      : null;
  const fuelRangeNet =
    fuelRange && fuelRange.high < fuelRange.low
      ? { low: fuelRange.high, high: fuelRange.low }
      : fuelRange;

  const tyreFuel: TyreFuelComparison = {
    tyres: { laps: tyreLaps, range: tyreEstimate.lapsRange, limitPct: tyreEstimate.limitPct },
    fuel: { laps: tankLaps, range: fuelRangeNet, limitPct: 0 },
  };

  // Haalt de tank de finish? Dat is de vraag die het bandenadvies zijn horizon
  // geeft: haalt de tank het, dan moeten de banden dat ook.
  const haaltFinishOpTank = resterend != null && voorraad >= resterend;
  const tyres = adviseTyreChange({
    samples: tyreSamples,
    horizon: haaltFinishOpTank ? "finish" : "planned_stop",
    mustSurviveLaps: haaltFinishOpTank ? resterend : tankLaps,
  });

  const blijftBuiten =
    haaltFinishOpTank && (tyreLaps == null || tyreLaps >= resterend);

  // De finish halen zonder te stoppen. Geen vergelijking nodig: één feit, één regel.
  if (blijftBuiten) {
    return {
      ...basis,
      tyres,
      binding: null,
      tyreFuel,
      tyreEstimate,
      decision: "STAY_OUT",
      lapsUntilPit: null,
      reasonCode: "fuel_to_finish",
      reason: `Deze tank haalt de finish (${resterend} rondes te gaan, ${voorraad} in de tank).`,
    };
  }

  const laps = binding.laps;

  if (laps == null) {
    return leeg("no_range", "Brandstofvoorraad in rondes is niet te bepalen.");
  }

  // De bindende grens is bereikt: nu naar binnen. Welke grens dat is, bepaalt de
  // reden — de tank is pas "kritiek" als de tank het is.
  if (laps <= 0) {
    return {
      ...basis,
      tyres,
      binding: binding.binding,
      tyreFuel,
      tyreEstimate,
      decision: "PIT_THIS_LAP",
      lapsUntilPit: 0,
      reasonCode: binding.binding === "tyres" ? "tyre_life" : "fuel_critical",
      reason:
        binding.binding === "tyres"
          ? bandenZin(tyres, tyreEstimate, 0, binding.binding)
          : `Nog ${voorraad} ronde brandstof; wachten kan niet.`,
    };
  }

  // De band is de grens (of allebei): de stop schuift naar voren.
  if (binding.binding === "tyres" || binding.binding === "both") {
    return {
      ...basis,
      tyres,
      binding: binding.binding,
      tyreFuel,
      tyreEstimate,
      decision: "PIT_IN_LAPS",
      lapsUntilPit: laps,
      reasonCode: "tyre_life",
      reason: bandenZin(tyres, tyreEstimate, laps, binding.binding),
    };
  }

  if (window?.saveRequired) {
    return {
      ...basis,
      tyres,
      binding: binding.binding,
      tyreFuel,
      tyreEstimate,
      decision: "PIT_IN_LAPS",
      lapsUntilPit: laps,
      reasonCode: "fuel_save_required",
      reason: `Om met ${window.stopsRequired} stops te finish te halen moet je ${window.lapsToSave} ${window.lapsToSave === 1 ? "ronde" : "rondes"} sparen, of een extra stop accepteren.`,
    };
  }

  return {
    ...basis,
    tyres,
    binding: binding.binding,
    tyreFuel,
    tyreEstimate,
    decision: "PIT_IN_LAPS",
    lapsUntilPit: laps,
    reasonCode: window ? "in_window" : "fuel_based",
    reason: `Over ${laps} ${laps === 1 ? "ronde" : "rondes"} naar binnen voor brandstof.`,
  };
}

/**
 * De zin bij een bandengrens.
 *
 * Als het bandenadvies zelf al een zin heeft, is dat de zin — één formulering per
 * oorzaak. Anders zegt de motor het hier, met de graad erbij, zodat een A-getal
 * en een B-getal niet als hetzelfde klinken.
 */
function bandenZin(
  tyres: TyreAdvice,
  estimate: TyreEstimate,
  laps: number,
  binding: BindingConstraint,
): string {
  if (binding === "both") {
    return `Banden en tank zijn allebei op hun grens; wissel bij de stop van r${laps}.`;
  }
  if (tyres.action === "CHANGE_BEFORE_PLANNED_STOP") return tyres.reason;

  const grens = estimate.limitPct === 0 ? "kaal" : `${estimate.limitPct ?? 40}%`;
  const schatting = estimate.grade === "A" ? "" : " (geschat)";
  return `Banden zijn over ${laps} ${laps === 1 ? "ronde" : "rondes"} op de grens van ${grens}${schatting}; de band bepaalt de stop.`;
}
