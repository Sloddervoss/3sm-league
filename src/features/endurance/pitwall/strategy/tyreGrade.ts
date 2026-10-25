/**
 * De graden A–D van het bandenbeeld, en de ene drempel waarop gepland wordt.
 *
 * Dit bestand is de hele vertaling van "hoeveel weten we" naar "wat mag er op
 * het scherm". De drempels komen letterlijk uit `plan-03` (F13 en F14); er staat
 * hier geen tweede mening over. De vier graden zijn geen kleuren maar vier
 * vormen:
 *
 *   A  puntgetal + helling + rondes       twee ankers, σ_laps ≤ 1,5
 *   B  getal ± marge, rondes als bereik   σ_laps ≤ 3,0
 *   C  bereik, geen tempo, geen rondes    < 4 rondes sinds het anker, of σ te groot
 *   D  alleen een oorzaakregel            geen anker of onbetrouwbaar
 *
 * De drempel `TYRE_CHANGE_THRESHOLD_PCT = 40` is één constante. De copy is een
 * template op die constante, zodat er nooit "tot 40%" op het scherm staat
 * terwijl de motor naar 0 of 30 rekent. `lapsRemaining` (naar nul) bestaat
 * daarom niet meer als naam voor deze grens: het heet `lapsToThreshold`.
 */

import { tyreWearRate, type TyreCorner, type TyreSample, type TyreWearRate } from "./tyreWear";

/** Restpercentage waarbij de band als "op" geldt (plan-03: `W_THR = 40,0`). */
export const TYRE_CHANGE_THRESHOLD_PCT = 40.0;
/** Graad A: σ_laps onder deze waarde (`GRADE_A_MAX`). */
export const GRADE_A_MAX_SIGMA_LAPS = 1.5;
/** Graad B: σ_laps onder deze waarde (`GRADE_B_MAX`). */
export const GRADE_B_MAX_SIGMA_LAPS = 3.0;
/** Minder dan vier rondes sinds een anker is nooit beter dan C (`LAPS_MIN_GRADE`). */
export const LAPS_MIN_GRADE = 4;
/** Bovengrens aan een plausibele slijtagesnelheid (`MAX_RATE`, pp per ronde). Poort op een ankerpaar, niet op de weergave. */
export const MAX_RATE_PP_PER_LAP = 1.5;

export type TyreGrade = "A" | "B" | "C" | "D";

/**
 * De gesloten set oorzaken. De eerste groep is de meetoorzaak uit `plan-04` §3a,
 * de tweede de modeloorzaak uit `plan-03` F13. De UI vertaalt ze allebei naar
 * precies één regel; ze mag er zelf geen bij verzinnen.
 */
export type TyreCause =
  | "stalled_values"
  | "jump"
  | "tyre_change"
  | "too_few_samples"
  | "not_wearing"
  | "implausible"
  | "unknown_horizon"
  | "stale_telemetry"
  | "no_baseline"
  | "no_anchor"
  | "stale_wear"
  | "wet"
  | "wear_source_missing"
  | "series_break"
  | "in_pit_stall"
  | "too_few_laps";

export interface LapRange {
  low: number;
  high: number;
}

export interface TyreEstimate {
  grade: TyreGrade;
  /** Waar dit beeld vandaan komt: de RPC (`server`), de live reeks (`client`) of niets. */
  source: "server" | "client" | "none";
  /** Zwakste hoek; null als er geen meting is. */
  weakest: TyreCorner | null;
  /** Restpercentage van die hoek; null bij graad C zonder waarde en bij D. */
  restPct: number | null;
  /** Slijtage in procentpunten per ronde, positief; alleen bij A en B. */
  ratePerLap: number | null;
  /** Onzekerheid in procentpunten (`1,96 σ_u`), voor de `±` bij graad B. */
  marginPp: number | null;
  /** Onzekerheid in rondes; bron van het bereik bij graad B. */
  sigmaLaps: number | null;
  /** Rondes tot de grens; alleen bij A en B. */
  lapsToThreshold: number | null;
  /** Bereik in rondes; alleen bij graad B. */
  lapsRange: LapRange | null;
  /** Bereik in procentpunten; alleen bij graad C. */
  pctRange: LapRange | null;
  /** Eén oorzaak bij graad D; null als er niets te klagen is. */
  cause: TyreCause | null;
  /** Laatst gemeten ronde, voor de oorzaakregel ("sinds r7"). */
  causeLap: number | null;
  /** Rondes sinds die meting, voor de oorzaakregel. */
  causeLaps: number | null;
  /** Waar de grens ligt: 40 (drempel) of 0 (kaal). Null als onbekend. */
  limitPct: number | null;
  /** Aantal meetpunten waarop dit rust. */
  samples: number;
}

export interface GradeInput {
  /** Aantal bruikbare ankers: 0, 1 of 2. */
  anchors: number;
  sigmaLaps: number | null;
  /** Rondes sinds het dichtstbijzijnde anker. */
  lapsSinceAnchor?: number | null;
  /** Een run-einde is geen pitmeting en plafonneert op C. */
  anchorSource?: "pit" | "run_end" | "session_start" | null;
  /** Twee hoeken even zwak: dan is de binding een gok en maximaal B. */
  bindingAmbiguous?: boolean;
  /** Een expliciete D-oorzaak wint van elke graad. */
  cause?: TyreCause | null;
}

/**
 * De beslisLADDER uit `plan-03` F13, eerste match wint. Geen enkele graad valt
 * tussen twee treden, en de graad volgt uit σ_laps — niet uit "we hebben een
 * anker".
 */
export function gradeFromSigma(input: GradeInput): TyreGrade {
  const { anchors, sigmaLaps } = input;
  if (input.cause != null) return "D";
  if (anchors <= 0 || sigmaLaps == null || !Number.isFinite(sigmaLaps)) return "D";
  if (input.lapsSinceAnchor != null && input.lapsSinceAnchor < LAPS_MIN_GRADE) return "C";
  if (input.anchorSource === "run_end" || input.anchorSource === "session_start") return "C";
  if (anchors >= 2 && sigmaLaps <= GRADE_A_MAX_SIGMA_LAPS && !input.bindingAmbiguous) return "A";
  if (sigmaLaps <= GRADE_B_MAX_SIGMA_LAPS) return "B";
  return "C";
}

export type LapsReason = "ok" | "at_threshold" | "no_degradation" | "no_measurement";

/**
 * Rondes tot de grens — de enige levensduur die dit paneel kent.
 *
 * `restPct` is de bron (100 = nieuw) en de drempel is een restwaarde, dus
 * `(w − drempel) / r̂`. Rekenen naar 0% is iets anders en heet hier ook anders:
 * dat is `lapsUntilBald`, en alleen de client-reeks gebruikt die grens.
 */
export function lapsToThreshold(input: {
  restPct: number | null;
  ratePerLap: number | null;
  thresholdPct?: number;
}): { laps: number | null; reason: LapsReason } {
  const { restPct, ratePerLap } = input;
  const threshold = input.thresholdPct ?? TYRE_CHANGE_THRESHOLD_PCT;
  if (restPct == null || ratePerLap == null || !Number.isFinite(restPct) || !Number.isFinite(ratePerLap)) {
    return { laps: null, reason: "no_measurement" };
  }
  if (ratePerLap <= 0) return { laps: null, reason: "no_degradation" };
  // `MAX_RATE` is een poort op een ankerpaar (plan-03 F9), geen grens op de
  // weergave: T14 rekent nota bene met 1,8 pp/ronde. Wat hier binnenkomt is al
  // door de graad goedgekeurd.
  if (restPct <= threshold) return { laps: 0, reason: "at_threshold" };
  return { laps: (restPct - threshold) / ratePerLap, reason: "ok" };
}

/** Rondes tot kaal: dezelfde formule met de drempel op 0%. */
export function lapsUntilBald(restPct: number | null, ratePerLap: number | null): number | null {
  return lapsToThreshold({ restPct, ratePerLap, thresholdPct: 0 }).laps;
}

/**
 * Bereik in rondes, naar buiten afgerond: onderkant naar beneden, bovenkant naar
 * boven (plan-03 §6). 11,11–13,33 wordt `11–14`, nooit `11–13`: een bereik dat
 * smaller lijkt dan het is, is een belofte.
 */
export function lapsRange(laps: number | null, sigmaLaps: number | null): LapRange | null {
  if (laps == null || sigmaLaps == null || !Number.isFinite(laps) || !Number.isFinite(sigmaLaps)) return null;
  const low = Math.max(0, Math.floor(laps - sigmaLaps));
  const high = Math.max(low, Math.ceil(laps + sigmaLaps));
  return { low, high };
}

/** Bereik in procentpunten, ook naar buiten afgerond en geclamped op 0–100. */
export function pctRange(restPct: number | null, marginPp: number | null): LapRange | null {
  if (restPct == null || marginPp == null) return null;
  const low = Math.min(100, Math.max(0, Math.floor(restPct - marginPp)));
  const high = Math.min(100, Math.max(low, Math.ceil(restPct + marginPp)));
  return { low, high };
}

/** `11–14` met een en dash: een koppelstreep leest als minteken. */
export function formatLapsRange(range: LapRange | null): string | null {
  return range == null ? null : `${range.low}–${range.high}`;
}

/** `55–70%` met dezelfde en dash. */
export function formatPctRange(range: LapRange | null): string | null {
  return range == null ? null : `${range.low}–${range.high}%`;
}

/** `62` — hele procenten, naar beneden: nooit optimistischer dan de meting. */
export function formatPct(pct: number | null): string | null {
  return pct == null ? null : `${Math.floor(pct)}`;
}

/** `−1,8/r` met een echt minteken en een decimale komma (nl-NL). */
export function formatRate(ratePerLap: number | null): string | null {
  if (ratePerLap == null || !Number.isFinite(ratePerLap)) return null;
  const waarde = Math.abs(ratePerLap).toFixed(1).replace(".", ",");
  return `−${waarde}/r`;
}

/** `1,8` — een getal met één decimaal, voor in een zin. */
export function formatDecimal(value: number | null): string | null {
  return value == null || !Number.isFinite(value) ? null : value.toFixed(1).replace(".", ",");
}

const CORNERS: TyreCorner[] = ["fl", "fr", "rl", "rr"];

const CAUSE_BY_REASON: Record<string, TyreCause> = {
  no_anchor: "no_anchor",
  no_data: "wear_source_missing",
  frozen: "stale_wear",
  too_few_laps: "too_few_laps",
};

function get(source: unknown, key: string): unknown {
  return source != null && typeof source === "object" ? (source as Record<string, unknown>)[key] : undefined;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function corner(value: unknown): TyreCorner | null {
  return typeof value === "string" && (CORNERS as string[]).includes(value) ? (value as TyreCorner) : null;
}

/**
 * Leest `tyre_estimate` uit de pitwall-RPC (`pitwall_tyre_estimate_v1`, S2).
 *
 * De vorm staat in `plan-02` §5b. Wat er niet in staat wordt niet verzonnen: een
 * ontbrekend veld wordt `null` en de graad blijft wat de server zegt. Alleen als
 * de server geen geldige graad meestuurt, is er geen schatting — dan valt de
 * aanroeper terug op de live reeks (`clientTyreEstimate`) en anders op D.
 */
export function parseTyreEstimate(raw: unknown): TyreEstimate | null {
  if (raw == null || typeof raw !== "object") return null;

  const gradeRuw = get(raw, "grade");
  const grade = typeof gradeRuw === "string" ? (gradeRuw.toUpperCase() as TyreGrade) : null;
  if (grade !== "A" && grade !== "B" && grade !== "C" && grade !== "D") return null;

  const estimate = get(raw, "estimate");
  const anchor = get(raw, "anchor");
  const weakest = corner(get(estimate, "weakest")) ?? weakestFromWear(get(anchor, "wear"));
  const perCorner = get(estimate, "per_corner");
  const hoek = weakest != null ? get(perCorner, weakest) : null;

  const restPct = num(get(hoek, "value"));
  const rawRate = num(get(hoek, "rate_per_lap"));
  const ratePerLap = rawRate != null ? Math.abs(rawRate) : null;
  const sigmaPp = num(get(hoek, "sigma"));
  const marginPp = sigmaPp != null ? 1.96 * sigmaPp : null;
  const sigmaLaps = num(get(raw, "sigma_laps"));
  const threshold = num(get(estimate, "threshold_pct")) ?? TYRE_CHANGE_THRESHOLD_PCT;
  const serverLaps = num(get(hoek, "laps_to_threshold"));

  const reason = get(raw, "reason");
  const cause =
    grade === "D"
      ? (typeof reason === "string" ? CAUSE_BY_REASON[reason] ?? null : null)
      : null;

  // De server rekent de rondes zelf uit; alleen als hij ze niet meestuurt doen
  // wij het, met dezelfde formule en dezelfde drempel.
  const laps =
    serverLaps != null
      ? serverLaps
      : grade === "A" || grade === "B"
        ? lapsToThreshold({ restPct, ratePerLap, thresholdPct: threshold }).laps
        : null;

  const limitPct = grade === "A" || grade === "B" ? threshold : null;

  return {
    grade,
    source: "server",
    weakest,
    restPct: grade === "D" ? null : restPct,
    ratePerLap: grade === "A" || grade === "B" ? ratePerLap : null,
    marginPp: grade === "B" ? marginPp : null,
    sigmaLaps,
    lapsToThreshold: grade === "A" || grade === "B" ? laps : null,
    lapsRange: grade === "B" ? lapsRange(laps, sigmaLaps) : null,
    pctRange: grade === "C" ? pctRange(restPct, marginPp) : null,
    cause,
    causeLap: num(get(anchor, "lap")),
    causeLaps: num(get(anchor, "laps_since")),
    limitPct,
    samples: grade === "D" ? 0 : 1,
  };
}

function weakestFromWear(wear: unknown): TyreCorner | null {
  let zwakst: TyreCorner | null = null;
  let laagst = Number.POSITIVE_INFINITY;
  for (const hoekNaam of CORNERS) {
    const waarde = num(get(wear, hoekNaam));
    if (waarde != null && waarde < laagst) {
      laagst = waarde;
      zwakst = hoekNaam;
    }
  }
  return zwakst;
}

const CAUSE_BY_WEAR: Record<TyreWearRate["reasonCode"], TyreCause> = {
  ok: "no_anchor",
  too_few_samples: "too_few_samples",
  tyre_change: "tyre_change",
  stalled_values: "stalled_values",
  jump: "jump",
  not_wearing: "not_wearing",
  implausible: "implausible",
};

/**
 * Hetzelfde beeld, maar dan uit de live reeks in plaats van uit een anker.
 *
 * Dit is de eerlijke tussenstand van `plan-04` §9: de vorm is gelijk, de graad
 * is voorzichtiger. Twee pit-geverifieerde ankers bestaan hier niet, dus A is
 * onbereikbaar — de graad plafonneert op B, en alleen als de residuen dat
 * toelaten. De grens is hier 0% (kaal), niet 40%: deze reeks meet geen anker en
 * dus ook geen drempel, en `limitPct` zegt dat er letterlijk bij.
 */
export function clientTyreEstimate(samples: TyreSample[]): TyreEstimate {
  const rate = tyreWearRate(samples);
  const leeg: TyreEstimate = {
    grade: "D",
    source: samples.length > 0 ? "client" : "none",
    weakest: rate.weakestCorner,
    restPct: null,
    ratePerLap: null,
    marginPp: null,
    sigmaLaps: null,
    lapsToThreshold: null,
    lapsRange: null,
    pctRange: null,
    cause: null,
    causeLap: rate.stalledFromLap,
    causeLaps: rate.samples,
    limitPct: null,
    samples: rate.samples,
  };

  if (rate.reasonCode !== "ok" || rate.wearPerLap == null || rate.lapsRemaining == null) {
    return {
      ...leeg,
      cause: CAUSE_BY_WEAR[rate.reasonCode],
      causeLap: rate.stalledFromLap,
    };
  }

  const grade = gradeFromSigma({
    anchors: 1,
    sigmaLaps: rate.sigmaLaps,
    lapsSinceAnchor: rate.samples,
  });
  const marginPp = rate.sigmaWear != null ? 1.96 * rate.sigmaWear : null;
  const restPct = rate.weakestRestPct;

  return {
    ...leeg,
    grade: grade === "A" ? "B" : grade,
    restPct,
    ratePerLap: grade === "C" ? null : rate.wearPerLap,
    marginPp: grade === "C" ? null : marginPp,
    sigmaLaps: rate.sigmaLaps,
    lapsToThreshold: grade === "C" ? null : rate.lapsRemaining,
    lapsRange: grade === "C" ? null : lapsRange(rate.lapsRemaining, rate.sigmaLaps),
    pctRange: grade === "C" ? pctRange(restPct, marginPp) : null,
    cause: null,
    causeLap: null,
    causeLaps: rate.samples,
    limitPct: grade === "C" ? null : 0,
  };
}
