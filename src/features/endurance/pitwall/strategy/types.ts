/**
 * Types voor de pitwall-rekenkern.
 *
 * De kern is puur: geen fetch, geen React, geen Supabase. Invoer is een
 * momentopname, uitvoer is een advies met een reason_code. Daardoor is elke
 * regel te testen en kan dezelfde motor later ook in een edge function draaien.
 */

import type { TyreAdvice, TyreSample } from "./tyreWear";
import type { LapRange, TyreEstimate } from "./tyreGrade";

export type Confidence = "high" | "medium" | "low" | "none";

/** De gesloten set adviezen. Er komt niets bij zonder dit type aan te passen. */
export type Decision = "STAY_OUT" | "PIT_THIS_LAP" | "PIT_IN_LAPS" | "NO_ADVICE";

export interface FuelEstimate {
  /** Liter per ronde, pessimistisch (mediaan + 2σ/√n). */
  perLap: number | null;
  /** Onzekerheid op perLap, in liter per ronde. */
  sigma: number | null;
  /** Aantal gebruikte monsters na uitbijterverwijdering. */
  samples: number;
  /** Aantal verworpen monsters. */
  rejected: number;
  source: "measured" | "prior" | "none";
}

export interface PitServiceInput {
  /** Tijd van pit-entry tot pit-exit zonder tanken of banden, in seconden. */
  pitLaneSeconds: number | null;
  /** Liters die getankt moeten worden. */
  fuelLitres: number | null;
  /** Tanktijd per liter, in seconden per liter. */
  secondsPerLitre: number | null;
  /** Tijd voor vier banden, in seconden. */
  tyreSeconds: number | null;
  /** Tijd voor eventuele reparatie, in seconden. */
  repairSeconds?: number | null;
}

export interface PitLossBreakdown {
  total: number | null;
  pitLane: number | null;
  fuel: number | null;
  tyre: number | null;
  repair: number | null;
  /** Welke bewerking de stop bepaalde; de rest valt er in iRacing parallel onder. */
  boundedBy: "pitLane" | "fuel" | "tyre" | "repair" | null;
}

/** Eén gemeten pitstay: van de pit-in-vlag tot de eerstvolgende pit-uit-vlag. */
export interface MeasuredPitStop {
  /** Moment van pit-in (in_pit_lane false -> true). */
  entryAt: string;
  /** Moment van pit-uit; null zolang de auto bij het einde van de data nog binnen staat. */
  exitAt: string | null;
  /** Werkelijk gemeten seconden in de pitstraat; null als de pit-uit ontbreekt. */
  seconds: number | null;
}

/**
 * Wat er aan pitverlies gemeten is.
 *
 * `pitLaneSeconds` is de mediaan van de bruikbare stops, niet een vaste waarde
 * en niet een schatting. Zonder in_pit_lane-vlaggen is er niets gemeten en staat
 * het veld op null; de UI hoort dan "nog niet gemeten" te zeggen.
 */
export interface PitStopMeasurement {
  pitLaneSeconds: number | null;
  /** Aantal stops dat in de mediaan meewoog. */
  sampleCount: number;
  source: "measured" | "none";
  /** Moment van de laatst gemeten pit-uit, indien bekend. */
  lastStopAt: string | null;
  stops: MeasuredPitStop[];
}

export interface PitWindow {
  /** Eerste ronde waarin je mag stoppen; in de praktijk: nu. */
  earliestLap: number;
  /** Laatste ronde waarin de finish nog haalbaar is. */
  latestLap: number;
  /** Aantal stops dat nog nodig is om de finish te halen. */
  stopsRequired: number;
  /** Rondes die de huidige tank meegaat. */
  lapsOnFuel: number;
  /** True als je moet sparen om met dit aantal stops uit te komen. */
  saveRequired: boolean;
  /** Aantal rondes dat je dan zou moeten sparen. */
  lapsToSave: number;
}

export interface TyreEvaluation {
  /** Helling van brandstofgecorrigeerde rondetijd tegen bandleeftijd, s/ronde. */
  slopeSecondsPerLap: number | null;
  /** Halve breedte van het betrouwbaarheidsinterval. */
  halfWidth: number | null;
  /** Aantal rondes dat meewoog. */
  samples: number;
  /** Of de helling betrouwbaar genoeg is om een wissel op te baseren. */
  reliable: boolean;
  reasonCode: string;
}

export interface FuelToFinishInput {
  /** Resterende sessietijd in seconden (de klok, niet de verstreken tijd). */
  remainingSeconds: number | null;
  /** Gemiddelde rondetijd in seconden. */
  averageLapSeconds: number | null;
  /**
   * Resterende afstand in rondes, als de race op afstand loopt in plaats van
   * op tijd. Gaat vóór de klok: bij een wedstrijd over 30 rondes is de finish
   * na 30 rondes, ook als de sessietijd nog uren toelaat.
   */
  lapsRemaining?: number | null;
  /** Verbruik per ronde in liters (pessimistische schatting). */
  fuelPerLap: number | null;
  /** Huidige inhoud van de tank; alleen nodig voor het oordeel "voldoende". */
  fuelLitres?: number | null;
  /** Tankinhoud in liters; bovengrens voor één tankbeurt. */
  tankCapacityLitres?: number | null;
}

export type FuelToFinishReason =
  | "ok"
  | "no_time_remaining"
  | "no_average_lap"
  | "no_consumption";

export interface FuelToFinishEstimate {
  /** Rondes tot de finish, naar boven afgerond (de laatste halve ronde telt). */
  lapsRemaining: number | null;
  /** Liters voor de hele resterende afstand; null als de invoer ontbreekt. */
  litres: number | null;
  /** Liters die in één tank passen (de tank als bovengrens). */
  litresWithinTank: number | null;
  /** Haalt de huidige inhoud de finish? null als inhoud of liters ontbreekt. */
  sufficient: boolean | null;
  reasonCode: FuelToFinishReason;
  /** Eén zin die de UI letterlijk kan tonen. */
  reason: string;
}

export interface StrategySnapshot {
  raceClockSeconds: number;
  lapsCompleted: number;
  currentLapSeconds: number | null;
  /** Resterende sessietijd zoals de connector hem meldt; null als hij ontbreekt. */
  sessionTimeRemainingSeconds?: number | null;
  /**
   * Gemiddelde rondetijd. Bij een tijdrace bepaalt die de resterende afstand;
   * zonder dit getal is er geen brandstof-tot-finish.
   */
  averageLapSeconds?: number | null;
  fuelLitres: number | null;
  tankCapacityLitres: number | null;
  plannedLaps: number | null;
  plannedDurationMinutes: number | null;
  /** Gemeten verbruik per ronde, één waarde per afgeronde ronde. */
  fuelPerLapSamples: number[];
  /** Waarde uit de vorige sessie of het vorige event, als startpunt. */
  fuelPerLapPrior: number | null;
  /** Leeftijd van de laatste telemetrie in seconden. */
  sampleAgeSeconds: number;
  /** Basismeting van het pitverlies, bijvoorbeeld uit eerdere stops. */
  pitLaneSeconds: number | null;
  secondsPerLitre: number | null;
  tyreSeconds: number | null;
  reserveLaps?: number;
  /**
   * Bandenslijtage per ronde, oud naar nieuw. Leeg als er nog geen reeks is:
   * dan is er geen bandenadvies en zegt de band dat ook.
   */
  tyreSamples?: TyreSample[];
  /**
   * Het bandenbeeld uit de pitwall-RPC (`tyre_estimate`, S2). Ontbreekt het —
   * bijvoorbeeld bij een oudere server — dan valt de motor terug op de live
   * reeks, met dezelfde vorm maar een voorzichtiger graad.
   */
  tyreEstimate?: TyreEstimate | null;
}

/** Wie de stop bepaalt: de band, de tank, of geen van beide. */
export type BindingConstraint = "tyres" | "fuel" | "both";

/**
 * Eén grens in dezelfde eenheid als de andere: rondes tot de grens.
 *
 * `range` is de onzekerheid in diezelfde eenheid, niet in procentpunten — anders
 * staan er weer twee eenheden naast elkaar.
 */
export interface TyreFuelRow {
  /** Rondes tot de grens, in hele rondes en naar beneden afgerond. */
  laps: number | null;
  /** Bereik in rondes, als de onzekerheid bekend is. */
  range: LapRange | null;
  /** Waar de grens ligt: 40 (restpercentage) of 0 (kaal). Null als onbekend. */
  limitPct: number | null;
}

/**
 * De twee grenzen naast elkaar. `TyreFuelCompare` rendert dit en rekent niets:
 * de getallen hier zijn exact de getallen waarmee `advise()` beslist.
 */
export interface TyreFuelComparison {
  tyres: TyreFuelRow;
  fuel: TyreFuelRow;
}

export interface Advice {
  decision: Decision;
  /** Rondes tot de stop; 0 bij PIT_THIS_LAP, null als onbekend. */
  lapsUntilPit: number | null;
  /** Liters die bij die stop bij moeten. */
  fuelToAddLitres: number | null;
  confidence: Confidence;
  reasonCode: string;
  /** Eén zin die de UI letterlijk kan tonen. */
  reason: string;
  window: PitWindow | null;
  fuel: FuelEstimate;
  pitLoss: PitLossBreakdown | null;
  /** Rondes die de huidige tank nog meegaat. */
  lapsOnFuel: number | null;
  /** Rondes tot de finish; null als de afstand onbekend is (tijdrace zonder duur). */
  lapsToFinish: number | null;
  /**
   * Brandstof tot de finish uit resterende sessietijd en gemiddelde rondetijd.
   * Ontbreekt een van beide, dan staan de getallen op null en zegt
   * `reasonCode` waarom.
   */
  fuelToFinish?: FuelToFinishEstimate | null;
  /**
   * Het bandenadvies. Altijd gevuld, ook als er niets te adviseren valt — dan
   * staat er een reden in plaats van een getal.
   */
  tyres?: TyreAdvice | null;
  /** Wie de stop bepaalt; de harde invariant is `lapsUntilPit === min(band, tank)`. */
  binding?: BindingConstraint | null;
  /** De twee grenzen in dezelfde eenheid, voor `TyreFuelCompare`. */
  tyreFuel?: TyreFuelComparison | null;
  /** Het bandenbeeld met zijn graad; null als er niets gemeten is. */
  tyreEstimate?: TyreEstimate | null;
}
