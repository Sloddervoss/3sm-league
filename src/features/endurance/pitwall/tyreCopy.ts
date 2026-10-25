/**
 * Alle Nederlandse teksten van het bandenblok op één plek.
 *
 * Waarom een apart bestand: de tests eisen de letterlijke regel ("nog 12 rondes
 * tot 40%"), en als dezelfde zin in drie componenten staat, verandert er op een
 * dag één van de drie. Hier is er één formule per zin, en de drempel is een
 * parameter — nooit het cijfer 40 in een string.
 *
 * Regel die boven alles staat (plan-04 §8): geen tempo bij graad C of D, geen
 * getal zonder graad, geen bereik met een `±` erop, en geen streepje waar een
 * getal hoort behalve bij graad D.
 */

import {
  formatDecimal,
  formatLapsRange,
  formatPct,
  formatPctRange,
  formatRate,
  TYRE_CHANGE_THRESHOLD_PCT,
  type TyreCause,
  type TyreEstimate,
  type TyreGrade,
} from "./strategy/tyreGrade";

/** `A · gemeten`: de letter alleen is nooit genoeg, het woord doet het werk. */
export function gradeWord(grade: TyreGrade): string {
  switch (grade) {
    case "A":
      return "gemeten";
    case "B":
      return "geschat";
    case "C":
      return "alleen bereik";
    default:
      return "geen meting";
  }
}

export function gradeLabel(grade: TyreGrade): string {
  return `${grade} · ${gradeWord(grade)}`;
}

/**
 * Waar de bandengrens ligt, in woorden.
 *
 * Twee grenzen bestaan er: de beslis-drempel van 40% rest (uit een anker) en
 * "kaal" (0%, uit de live reeks). Ze zijn niet inwisselbaar en de tekst zegt dus
 * welke van de twee dit getal is.
 */
export function limitLabel(limitPct: number | null, metTot = false): string | null {
  if (limitPct == null) return null;
  const waarde = limitPct === TYRE_CHANGE_THRESHOLD_PCT ? `${TYRE_CHANGE_THRESHOLD_PCT}%` : "kaal";
  return metTot ? `tot ${waarde}` : waarde;
}

function rondes(n: number): string {
  return n === 1 ? "1 ronde" : `${n} rondes`;
}

/**
 * De regel onder de hoekgrid. Vier graden, vier vormen — en de functie gooit
 * niets weg: wat ontbreekt wordt een streepje, niet een nul.
 */
export function adviceLine(estimate: TyreEstimate): string {
  const pct = formatPct(estimate.restPct);

  switch (estimate.grade) {
    case "A": {
      const rate = formatRate(estimate.ratePerLap);
      const laps = estimate.lapsToThreshold == null ? null : Math.floor(estimate.lapsToThreshold);
      const grens = limitLabel(estimate.limitPct) ?? `${TYRE_CHANGE_THRESHOLD_PCT}%`;
      if (pct == null || rate == null) return "— · geen bandenmeting sinds de vorige stop";
      if (laps == null) return `${pct}% · ${rate} · grens onbekend`;
      return `${pct}% · ${rate} · nog ${rondes(laps)} tot ${grens}`;
    }
    case "B": {
      const marge = estimate.marginPp == null ? null : Math.round(estimate.marginPp);
      const bereik = formatLapsRange(estimate.lapsRange);
      const getal = pct == null ? "—" : marge == null ? `${pct}%` : `${pct}% ±${marge}`;
      if (bereik == null) return `${getal} · rondes onbekend (geschat)`;
      return `${getal} · ${bereik} rondes (geschat)`;
    }
    case "C": {
      const bereik = formatPctRange(estimate.pctRange);
      return `${bereik ?? "—"} · geschat · wacht op stop`;
    }
    default:
      return `— · ${causeLine(estimate)}`;
  }
}

/**
 * Eén oorzaakregel, letterlijk uit de vaste lijst van plan-04 §3a.
 *
 * Nooit twee oorzaken en nooit een zin die de UI zelf bedenkt: dezelfde oorzaak
 * mag op twee plekken staan, maar dan met dezelfde woorden.
 */
export function causeLine(estimate: TyreEstimate): string {
  const oorzaak = estimate.cause;
  if (oorzaak == null) return "geen bandenmeting sinds de vorige stop";

  switch (oorzaak) {
    case "stalled_values":
      return estimate.causeLap == null
        ? "waarde staat stil"
        : `waarde staat stil sinds r${estimate.causeLap}`;
    case "jump":
      return "waarde versprong in één ronde";
    case "tyre_change":
      return estimate.causeLap == null
        ? "gewisseld"
        : `gewisseld bij r${estimate.causeLap} · ${rondes(estimate.causeLaps ?? 0)} op deze set`;
    case "too_few_samples":
      return estimate.causeLaps == null
        ? "te weinig metingen op deze set"
        : `${rondes(estimate.causeLaps)} op deze set`;
    case "not_wearing":
      return "geen slijtage gemeten";
    case "implausible":
      return "slijtage per ronde onmogelijk hoog";
    case "unknown_horizon":
      return "volgende stop onbekend";
    case "stale_telemetry":
      return estimate.causeLaps == null ? "meting is te oud" : `meting ${estimate.causeLaps} s oud`;
    case "no_baseline":
      return "afstand tot de finish onbekend";
    case "no_anchor":
      return "geen anker sinds de vorige stop";
    case "stale_wear":
      return estimate.causeLap == null
        ? "waarde verandert niet meer"
        : `waarde verandert niet meer sinds r${estimate.causeLap}`;
    case "wet":
      return "nat wegdek — geen droogmodel";
    case "wear_source_missing":
      return "geen bandenmeting sinds de vorige stop";
    case "series_break":
      return "reeksbreuk in de bandenmeting";
    case "in_pit_stall":
      return "in de pitstraat — geen schatting";
    case "too_few_laps":
      return estimate.causeLaps == null
        ? "te weinig rondes sinds de stop"
        : `${rondes(estimate.causeLaps)} sinds de stop`;
    default:
      return "geen bandenmeting sinds de vorige stop";
  }
}

/**
 * Wat je doet als er geen bandenadvies is. Hangt aan de oorzaak, niet aan de
 * vrije hand: elke meetoorzaak leidt tot plannen op de tank, een onbekende
 * horizon tot wachten, een oude meting tot wachten op een nieuwe.
 */
export function whatToDo(cause: TyreCause | null): string {
  switch (cause) {
    case "unknown_horizon":
      return "wacht op de volgende stop";
    case "stale_telemetry":
      return "wacht op een nieuwe meting";
    case "no_baseline":
      return "geen uitspraak";
    default:
      return "plan op de tank";
  }
}

/** Het label boven de vergelijking: één kop, twee eenheden die hetzelfde zijn. */
export function bindingHeading(): string {
  return "de grens ligt bij";
}

export function bindingSentence(input: {
  binding: "tyres" | "fuel" | "both" | null;
  laps: number | null;
  tyreLaps: number | null;
  fuelLaps: number | null;
}): string {
  const { binding, laps, tyreLaps, fuelLaps } = input;
  const stop = laps == null ? null : `wissel bij de stop van r${laps}`;

  switch (binding) {
    case "tyres":
      return stop == null ? "banden zijn de grens" : `banden zijn de grens; ${stop}`;
    case "both":
      return stop == null ? "beide op dezelfde ronde" : `beide op dezelfde ronde; ${stop}`;
    case "fuel": {
      if (tyreLaps == null || fuelLaps == null) return "tank is de grens; banden onbekend";
      const marge = tyreLaps - fuelLaps;
      return marge <= 0
        ? "tank is de grens"
        : `tank is de grens; banden gaan nog ${rondes(marge)} langer mee`;
    }
    default:
      return "geen grens bekend";
  }
}

/**
 * Bij STAY_OUT is er geen vergelijking maar één feit: het haalt de finish.
 *
 * Twee rijen die allebei "haal de finish" zeggen is dezelfde mededeling twee
 * keer, en dan gaat de engineer zoeken naar het verschil dat er niet is.
 */
export function stayOutLine(input: {
  restPct: number | null;
  fuelLaps: number | null;
  lapsToFinish: number | null;
}): string {
  const { restPct, fuelLaps, lapsToFinish } = input;
  const banden = restPct == null ? null : `banden ${Math.floor(restPct)}%`;
  const tank = fuelLaps == null ? null : `tank ${rondes(fuelLaps)}`;
  const samen = banden != null && fuelLaps != null;
  const finish =
    lapsToFinish == null
      ? null
      : `${samen ? "beide halen" : "haalt"} de finish (${rondes(lapsToFinish)})`;
  const delen = [banden, tank, finish].filter((deel): deel is string => deel != null);
  return delen.length > 0 ? delen.join(" · ") : "de finish is zonder stop haalbaar";
}

/** `nog 12 rondes` — de waarde in de vergelijkingsrij, altijd in hele rondes. */
export function lapsLabel(laps: number | null): string {
  return laps == null ? "onbekend" : `nog ${rondes(laps)}`;
}

/** `(11–14)` achter de waarde, of niets als er geen bandbreedte is. */
export function rangeSuffix(range: { low: number; high: number } | null): string | null {
  const tekst = formatLapsRange(range);
  return tekst == null ? null : `(${tekst})`;
}

/** `plus of min 4 procent` voor de voorlezer; een ± wordt anders niet gelezen. */
export function marginAria(marge: number | null): string | null {
  return marge == null ? null : `plus of min ${marge} procent`;
}

/** `10 tot 14 rondes` voor de voorlezer; een en dash wordt soms als "en" gelezen. */
export function rangeAria(range: { low: number; high: number } | null): string | null {
  return range == null ? null : `${range.low} tot ${range.high} rondes`;
}

/** `1,8` met komma; gebruikt in zinnen die geen eenheid zijn. */
export function decimal(value: number | null): string | null {
  return formatDecimal(value);
}
