/**
 * Bandenslijtage uit losse metingen.
 *
 * De server stuurt per ronde vier percentages mee (100 = nieuw, 0 = versleten).
 * Dat is een ander soort meting dan rondetijden: je hoeft er geen
 * brandstofgewicht voor te corrigeren, want de slijtage is de slijtage. Wat je
 * wél moet doen is de ruis eruit halen en een bandenwissel herkennen — anders
 * middelt een nieuwe set de oude trend weg.
 *
 * En er is een tweede valkuil, uit de race van 24-10: de bron stuurt niet elke
 * ronde een nieuwe waarde. Zeven rondes lang stond het voorwiel exact op 81,3 en
 * daarna sprong het in één keer. Wie daar een snelheid per ronde van maakt,
 * krijgt 0,17 in plaats van 0,45 — een getal dat klopt met de som en niet met de
 * werkelijkheid. Daarom is dit bestand even streng op stilstaande reeksen en
 * sprongen als op te weinig metingen: liever geen advies dan een gok met een
 * komma.
 */

export type TyreCorner = "fl" | "fr" | "rl" | "rr";

/** Namen zoals ze op de pitwall staan, niet zoals ze in de data heten. */
export const TYRE_CORNER_LABELS: Record<TyreCorner, string> = {
  fl: "linksvoor",
  fr: "rechtsvoor",
  rl: "linksachter",
  rr: "rechtsachter",
};

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
  /** True bij genoeg metingen en een reeks die per ronde beweegt. */
  reliable: boolean;
  /** Het wiel dat de levensduur bepaalt; null als er geen meting is. */
  weakestCorner: TyreCorner | null;
  /** Restpercentage van dat wiel bij de laatste meting; null zonder meting. */
  weakestRestPct: number | null;
  /** Langste reeks opeenvolgende metingen met exact dezelfde waarde. */
  stalledLaps: number;
  /**
   * Ronde waarin die stilstaande reeks begon; null als er geen stilstand is.
   * Zonder dit getal kan de UI alleen zeggen "het staat stil", niet sinds wanneer.
   */
  stalledFromLap: number | null;
  /**
   * Onzekerheid van de wear-schatting in procentpunten.
   *
   * Uit de residuen van de reeks tegen de gefitte mediaanhelling, met de vloer
   * uit `plan-03` (`SIGMA_ANKER_4 = 0,30` pp): een resolutie van 0,1 pp plus één
   * ronde transport is de kleinste fout die we durven te claimen. Nooit null
   * zodra er een helling is — een getal zonder die onzekerheid is een belofte.
   */
  sigmaWear: number | null;
  /** Diezelfde onzekerheid in rondes: `sigmaWear / wearPerLap`. */
  sigmaLaps: number | null;
  reasonCode:
    | "ok"
    | "too_few_samples"
    | "tyre_change"
    | "stalled_values"
    | "jump"
    | "not_wearing"
    | "implausible";
}

/** Een sprong omhoog groter dan dit is een nieuwe set, geen meetruis. */
const TYRE_CHANGE_JUMP = 1.5;
/** Een sprong omlaag groter dan dit in één stap is geen slijtage. */
const TYRE_DROP_JUMP = 2;
/** Meer dan dit per ronde is geen slijtage maar een verkeerde eenheid. */
const MAX_PLAUSIBLE_WEAR_PER_LAP = 5;
/**
 * Zoveel opeenvolgende metingen met dezelfde waarde betekent dat de bron niet
 * per ronde ververst. Bij 0,45 punt per ronde kan een waarde met één decimaal
 * hooguit twee keer gelijk blijven; drie keer is stilstand.
 */
const STALLED_RUN = 3;
/** Mediaan absolute afwijking naar standaardafwijking. */
const MAD_SCALE = 1.4826;
/**
 * Kleinste meetfout die we durven te claimen: 0,1 pp resolutie plus één ronde
 * transport. Dit is `SIGMA_ANKER_4` uit plan-03 en de ondergrens van elke
 * bandbreedte — ook als de residuen toevallig nul zijn.
 */
const SIGMA_ANKER_FLOOR_PP = 0.3;

export function tyreWearRate(input: TyreSample[]): TyreWearRate {
  const bruikbaar = dedupeByLap(
    input.filter((s) =>
      Number.isFinite(s.lap) && [s.fl, s.fr, s.rl, s.rr].every((v) => Number.isFinite(v)),
    ),
  ).sort((a, b) => a.lap - b.lap);

  const leeg = (
    reasonCode: TyreWearRate["reasonCode"],
    samples = bruikbaar.length,
    extra: Partial<TyreWearRate> = {},
  ): TyreWearRate => ({
    wearPerLap: null,
    lapsRemaining: null,
    samples,
    reliable: false,
    weakestCorner: null,
    weakestRestPct: null,
    stalledLaps: 0,
    stalledFromLap: null,
    sigmaWear: null,
    sigmaLaps: null,
    reasonCode,
    ...extra,
  });

  if (bruikbaar.length < 4) return leeg("too_few_samples");

  // Een bandenwissel splitst de reeks. Alleen de set die er nu op ligt zegt iets
  // over hoeveel rondes er nog in zitten; de oude set is geschiedenis.
  const laatsteSet = currentSet(bruikbaar);
  const gewisseld = laatsteSet.length < bruikbaar.length;
  if (laatsteSet.length < 4) {
    return leeg(gewisseld ? "tyre_change" : "too_few_samples", laatsteSet.length);
  }

  // Het zwakste wiel bepaalt hoe lang de set meegaat. Niet het gemiddelde van
  // vier: één wiel dat op is, is de band die op is.
  const laatste = laatsteSet[laatsteSet.length - 1];
  const hoek = weakestCorner(laatste);
  const reeks = laatsteSet.map((s) => s[hoek]);

  const stilstaand = longestEqualRun(reeks);
  const stilStart = stilstaand.length >= STALLED_RUN ? laatsteSet[stilstaand.start].lap : null;
  // Een reeks die helemaal niet beweegt is geen kapotte meting maar een band die
  // (nog) niet slijt. Staat de waarde een paar rondes stil en verspringt hij
  // daarna wél, dan ververst de bron niet per ronde — en dan is elke snelheid
  // per ronde een gemiddelde van de update, niet van de slijtage.
  if (stilstaand.length === reeks.length) {
    return leeg("not_wearing", laatsteSet.length, {
      weakestCorner: hoek,
      stalledLaps: stilstaand.length,
      stalledFromLap: laatsteSet[0].lap,
    });
  }
  if (stilstaand.length >= STALLED_RUN) {
    return leeg("stalled_values", laatsteSet.length, {
      weakestCorner: hoek,
      stalledLaps: stilstaand.length,
      stalledFromLap: stilStart,
    });
  }

  const rates: number[] = [];
  for (let i = 1; i < reeks.length; i += 1) {
    const deltaLap = laatsteSet[i].lap - laatsteSet[i - 1].lap;
    if (deltaLap <= 0) continue;

    const deltaWear = reeks[i - 1] - reeks[i];
    if (deltaWear <= 0) continue;

    rates.push(deltaWear / deltaLap);
  }

  if (rates.length < 3) {
    return leeg("not_wearing", laatsteSet.length, { weakestCorner: hoek, stalledLaps: stilstaand.length });
  }

  const mediaan = median(rates);
  if (mediaan <= 0 || mediaan > MAX_PLAUSIBLE_WEAR_PER_LAP) {
    return leeg("implausible", laatsteSet.length, { weakestCorner: hoek, stalledLaps: stilstaand.length });
  }

  // Eén stap die ver uit de pas loopt met de rest is geen slijtage maar een
  // meting die bijwerkt. Systematisch te hard slijten is iets anders en is hier
  // boven al afgevangen: dan is de mediaan zelf onmogelijk.
  const uitschieter = Math.max(TYRE_DROP_JUMP, mediaan * 4);
  if (rates.some((rate) => rate > uitschieter)) {
    return leeg("jump", laatsteSet.length, { weakestCorner: hoek, stalledLaps: stilstaand.length });
  }

  // Hoeveel de meting zelf kan afwijken. De residuen tegen de gefitte lijn zijn
  // de meetruis; de vloer is de resolutie van de bron (0,1 pp) plus één ronde
  // transport, precies de σ_anker uit plan-03. Zonder deze term zou een perfect
  // rechte reeks een band van 0 rondes krijgen en dat is geen meting maar een
  // aanname.
  const sigmaWear = Math.max(SIGMA_ANKER_FLOOR_PP, residualSigma(laatsteSet, reeks, mediaan));

  return {
    wearPerLap: round(mediaan, 4),
    lapsRemaining: Math.max(0, Math.floor(reeks[reeks.length - 1] / mediaan)),
    samples: laatsteSet.length,
    // Vier metingen en een mediaan die niet op één uitschieter rust.
    reliable: laatsteSet.length >= 4 && rates.length >= 3,
    weakestCorner: hoek,
    weakestRestPct: reeks[reeks.length - 1],
    stalledLaps: stilstaand.length,
    stalledFromLap: stilStart,
    sigmaWear: round(sigmaWear, 3),
    sigmaLaps: round(sigmaWear / mediaan, 3),
    reasonCode: "ok",
  };
}

/**
 * Meetruis van de wear-reeks rond de gefitte helling, als MAD.
 *
 * De mediaanhelling is robuust, maar zegt niets over hoe goed de punten op die
 * lijn liggen. Dat is precies wat de graad nodig heeft: twee reeksen met dezelfde
 * helling kunnen een heel verschillende bandbreedte hebben.
 */
function residualSigma(samples: TyreSample[], values: number[], rate: number): number {
  const intercept = median(samples.map((s, i) => values[i] + rate * s.lap));
  const residuen = samples.map((s, i) => Math.abs(values[i] - (intercept - rate * s.lap)));
  return median(residuen) * MAD_SCALE;
}

export type TyreAction = "NO_CHANGE" | "CHANGE_AT_PLANNED_STOP" | "CHANGE_BEFORE_PLANNED_STOP" | "NO_ADVICE";

export interface TyreAdviceInput {
  samples: TyreSample[];
  /**
   * Rondes die de banden nog móeten meegaan: tot de geplande stop, of tot de
   * finish als er geen stop meer komt. Null als geen van beide bekend is.
   */
  mustSurviveLaps: number | null;
  /** Waar die grens vandaan komt; bepaalt hoe het advies leest. */
  horizon: "planned_stop" | "finish";
}

export interface TyreAdvice {
  action: TyreAction;
  wearPerLap: number | null;
  lapsRemaining: number | null;
  weakestCorner: TyreCorner | null;
  mustSurviveLaps: number | null;
  horizon: "planned_stop" | "finish";
  reliable: boolean;
  samples: number;
  reasonCode: string;
  /** Eén zin die de UI letterlijk kan tonen. */
  reason: string;
}

/**
 * Het bandenadvies.
 *
 * De vraag is nooit "hoeveel slijt een band" maar "haalt deze band de volgende
 * gelegenheid om te wisselen". Lukt dat, dan is er niets aan de hand; lukt het
 * niet, dan moet de wissel vóór die stop en schuift de stop mee. En als de
 * slijtagesnelheid niet te meten is, staat er geen getal maar een reden.
 */
export function adviseTyreChange(input: TyreAdviceInput): TyreAdvice {
  const { samples, mustSurviveLaps, horizon } = input;
  const rate = tyreWearRate(samples);

  const basis = {
    wearPerLap: rate.wearPerLap,
    lapsRemaining: rate.lapsRemaining,
    weakestCorner: rate.weakestCorner,
    mustSurviveLaps,
    horizon,
    reliable: rate.reliable,
    samples: rate.samples,
  };

  if (!rate.reliable || rate.lapsRemaining == null || rate.wearPerLap == null) {
    return { ...basis, action: "NO_ADVICE", reasonCode: rate.reasonCode, reason: noAdviceReason(rate) };
  }

  const wiel = rate.weakestCorner ? ` op ${TYRE_CORNER_LABELS[rate.weakestCorner]}` : "";
  const slijt = `${formatNumber(rate.wearPerLap)} punt per ronde`;

  if (mustSurviveLaps == null) {
    return {
      ...basis,
      action: "NO_ADVICE",
      reasonCode: "unknown_horizon",
      reason: `Nog ${rate.lapsRemaining} rondes op deze banden (${slijt}${wiel}), maar het moment van de volgende stop is onbekend.`,
    };
  }

  if (rate.lapsRemaining < mustSurviveLaps) {
    const tekort = mustSurviveLaps - rate.lapsRemaining;
    return {
      ...basis,
      action: "CHANGE_BEFORE_PLANNED_STOP",
      reasonCode: horizon === "finish" ? "tyre_life_before_finish" : "tyre_life_before_stop",
      reason:
        horizon === "finish"
          ? `Banden zijn over ${rate.lapsRemaining} rondes op (${slijt}${wiel}) en de finish is over ${mustSurviveLaps}: zonder wissel haal je het niet.`
          : `Banden zijn over ${rate.lapsRemaining} rondes op (${slijt}${wiel}), ${tekort} ${tekort === 1 ? "ronde" : "rondes"} vóór de geplande stop.`,
    };
  }

  if (horizon === "finish") {
    return {
      ...basis,
      action: "NO_CHANGE",
      reasonCode: "tyres_last_to_finish",
      reason: `Banden gaan nog ${rate.lapsRemaining} rondes mee (${slijt}${wiel}) en de finish is over ${mustSurviveLaps}: geen wissel nodig.`,
    };
  }

  return {
    ...basis,
    action: "CHANGE_AT_PLANNED_STOP",
    reasonCode: "change_at_planned_stop",
    reason: `Banden gaan nog ${rate.lapsRemaining} rondes mee (${slijt}${wiel}); de geplande stop is over ${mustSurviveLaps}, dus wisselen bij die stop.`,
  };
}

function noAdviceReason(rate: TyreWearRate): string {
  switch (rate.reasonCode) {
    case "stalled_values":
      return `Geen bandenadvies: de slijtagewaarde staat ${rate.stalledLaps} rondes stil en verspringt daarna, dus de slijtage per ronde is niet te meten.`;
    case "jump":
      return "Geen bandenadvies: de slijtage verspringt in één ronde met meer dan 2 punten; dat is een meting die bijwerkt, geen slijtage.";
    case "tyre_change":
      return "Geen bandenadvies: er is net gewisseld en er zijn nog te weinig rondes op deze set.";
    case "too_few_samples":
      return "Geen bandenadvies: nog te weinig rondes met een bandenmeting.";
    case "not_wearing":
      return "Geen bandenadvies: over de laatste rondes is geen slijtage gemeten.";
    case "implausible":
      return "Geen bandenadvies: de gemeten slijtage per ronde is onmogelijk hoog.";
    default:
      return "Geen bandenadvies: de bandenslijtage is niet te berekenen.";
  }
}

/**
 * Houdt de reeks per ronde bij vanuit de live stroom.
 *
 * Eén meting per ronde, en de laatste lezing van een ronde wint: de waarde loopt
 * tijdens de ronde op, dus pas aan het eind staat er wat de ronde kostte.
 * Verspringt de rondeteller (nieuwe run, andere auto), dan begint de reeks
 * opnieuw — een oude reeks met een nieuwe teller is geen geschiedenis maar ruis.
 */
export function recordTyreSample(series: TyreSample[], next: TyreSample | null, max = 40): TyreSample[] {
  if (!next || !Number.isFinite(next.lap)) return series;
  if (![next.fl, next.fr, next.rl, next.rr].every((v) => Number.isFinite(v))) return series;

  const laatste = series[series.length - 1];
  if (laatste && next.lap < laatste.lap) return [next];
  if (laatste && next.lap === laatste.lap) return [...series.slice(0, -1), next];
  return [...series, next].slice(-max);
}

/** De metingen sinds de laatste bandenwissel. */
function currentSet(samples: TyreSample[]): TyreSample[] {
  const reeks = samples.map((s) => Math.min(s.fl, s.fr, s.rl, s.rr));
  let start = 0;
  for (let i = 1; i < reeks.length; i += 1) {
    if (reeks[i - 1] - reeks[i] < -TYRE_CHANGE_JUMP) start = i;
  }
  return samples.slice(start);
}

export function weakestCorner(sample: TyreSample): TyreCorner {
  const hoeken: Array<[TyreCorner, number]> = [
    ["fl", sample.fl],
    ["fr", sample.fr],
    ["rl", sample.rl],
    ["rr", sample.rr],
  ];
  return hoeken.reduce((zwak, nu) => (nu[1] < zwak[1] ? nu : zwak))[0];
}

function longestEqualRun(values: number[]): { length: number; start: number } {
  let beste = { length: values.length > 0 ? 1 : 0, start: 0 };
  let lengte = 1;
  let start = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === values[i - 1]) {
      lengte += 1;
    } else {
      lengte = 1;
      start = i;
    }
    if (lengte > beste.length) beste = { length: lengte, start };
  }
  return beste;
}

function dedupeByLap(samples: TyreSample[]): TyreSample[] {
  const perRonde = new Map<number, TyreSample>();
  for (const s of samples) perRonde.set(s.lap, s);
  return [...perRonde.values()];
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

function formatNumber(value: number): string {
  return value.toFixed(2).replace(".", ",");
}
