/**
 * Alle Nederlandse teksten van het bandenblok op één plek.
 *
 * Waarom een apart bestand: de tests eisen de letterlijke regel, en als dezelfde
 * zin in drie componenten staat, verandert er op een dag één van de drie. Hier
 * is er één formule per zin, en de drempel is een parameter — nooit het cijfer
 * 40 in een string.
 *
 * Regel die boven alles staat (plan-04 §8): de bandenstrook toont een bereik in
 * rondes, geen percentage. Een percentage rest zegt niets over hoeveel rondes je
 * er nog mee doet, en dat is de enige vraag die een pitwall stelt. Het woord
 * erboven zegt waar dat bereik vandaan komt: gemeten, voorlopig, schatting of
 * plan. Geen tempo bij graad C of D, geen `±` naast een bereik, en geen streepje
 * waar een getal hoort behalve bij graad D.
 */

import {
  formatDecimal,
  formatLapsRange,
  TYRE_CHANGE_THRESHOLD_PCT,
  type LapRange,
  type TyreCause,
  type TyreEstimate,
  type TyreGrade,
} from "./strategy/tyreGrade";
import {
  bandmetingStale,
  VERSE_METING_MAX_MIN,
  type TyreEstimateV2,
  type TyreReden,
} from "./strategy/tyreEstimateV2";

/**
 * `A · sterk`: de letter alleen is nooit genoeg, het woord doet het werk.
 *
 * Vier graden, vier woorden, en ze zijn niet inwisselbaar:
 *
 *   A  sterk   drie of meer gemeten stints: een smalle band
 *   B  matig   twee gemeten stints: een bredere band, nog geen belofte
 *   C  zwak    één gemeten stint: alleen een bereik, geen tempo
 *   D  plan    geen bandenmeting; de stop komt uit het plan (tank/afstand)
 *
 * Het graadwoord zegt hoe sterk de basis is, niet waar het getal vandaan komt.
 * Die herkomst heeft zijn eigen vier woorden (`provenanceLabel` in
 * `tyreEstimateV2`: gemeten, laatst bekend, geschat, geen data). De twee
 * woordensets delen daarom bewust geen enkel woord: een badge "A · gemeten"
 * naast de herkomst "geschat" zei twee keer iets anders over hetzelfde getal,
 * en de lezer moest raden welke van de twee won. Nu wint de herkomst — die
 * staat er altijd bij — en zegt de graad alleen nog hoe sterk hij is.
 */
export function gradeWord(grade: TyreGrade): string {
  switch (grade) {
    case "A":
      return "sterk";
    case "B":
      return "matig";
    case "C":
      return "zwak";
    default:
      return "plan";
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
 * Het bereik in rondes, in de vorm die de strook nodig heeft.
 *
 * `rangeText` is `11–14` als er een echte band is, `12` als alleen het puntgetal
 * bekend is, en null als er geen rondes te noemen zijn. `limit` zegt waar de
 * grens ligt (`tot 40%` of `tot kaal`) — dat is geen percentage rest, het is de
 * naam van de drempel.
 */
export interface TyreLapsAdvice {
  rangeText: string | null;
  /** Alleen gevuld bij een echt bereik; een puntgetal is geen band. */
  range: LapRange | null;
  limit: string | null;
}

export function lapsAdvice(estimate: TyreEstimate): TyreLapsAdvice {
  const bereik = estimate.lapsRange;
  // Zonder σ in rondes blijft het puntgetal staan: één getal is eerlijker dan
  // een bereik dat we zelf zouden verbreden.
  const punt =
    bereik == null && estimate.lapsToThreshold != null
      ? Math.max(0, Math.floor(estimate.lapsToThreshold))
      : null;

  return {
    rangeText: bereik != null ? formatLapsRange(bereik) : punt == null ? null : `${punt}`,
    range: bereik != null && bereik.low !== bereik.high ? bereik : null,
    limit: limitLabel(estimate.limitPct, true),
  };
}

/**
 * De regel onder de hoekgrid. Vier graden, vier vormen — en de functie gooit
 * niets weg: wat ontbreekt wordt "rondes onbekend", niet een nul.
 *
 * De vorm is overal dezelfde: een bereik in rondes, eventueel met de grens
 * erachter. Het graadwoord (sterk/matig/zwak/plan) staat in het label erboven,
 * zodat dezelfde mededeling niet twee keer in hetzelfde blok staat.
 */
export function adviceLine(estimate: TyreEstimate): string {
  switch (estimate.grade) {
    case "A":
    case "B": {
      const { rangeText, limit } = lapsAdvice(estimate);
      if (rangeText == null) return limit == null ? "rondes onbekend" : `rondes onbekend ${limit}`;
      return limit == null ? `${rangeText} rondes` : `${rangeText} rondes ${limit}`;
    }
    case "C":
      return "rondes onbekend · wacht op stop";
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

/* ═══════════════ gedeeld én eigen: het eerlijke bandenverhaal ═══════════════ */

/**
 * De teksten van het nieuwe contract (31-10) staan hier en niet in het paneel.
 *
 * De aanleiding is één fout die de review van 31-10 vond: zodra `basis.bron`
 * "eigen" was, zweeg het paneel over de pool — ook als de voorspelling met die
 * pool was geblend. Een rijder zag dan een getal zonder te weten dat het deels
 * van anderen kwam. Daarom staan hier nu twee regels naast elkaar, allebei met
 * de combinatie erbij: wat andere rijders op deze auto en dit circuit meten, en
 * wat je zelf meet. Ze zeggen hetzelfde soort ding in dezelfde vorm, zodat de
 * lezer ze kan vergelijken in plaats van te raden welke de waarheid is.
 *
 * De tweede fout was een belofte die de server niet waarmaakt: "elke stop maakt
 * de band smaller". Dat geldt alleen zolang eigen meting en prior elkaar niet
 * tegenspreken; lopen ze uiteen, dan verbreedt de server de band juist. Daarom
 * zegt `uiteenloopRegel` het omgekeerde als het nodig is, met de twee hellingen
 * erbij — de lezer kan dan zelf zien waaróm.
 */

/**
 * Vanaf welk relatief verschil twee hellingen "uiteenlopen".
 *
 * Dit is een weergavedrempel, geen modelgrens: de server rekent de breedte zelf
 * uit de spreiding tussen stints. Een kwart verschil is hier de grens omdat de
 * meetruis op één stint al snel die orde van grootte heeft — bij minder verschil
 * durven we te zeggen dat een volgende stint de band smaller maakt, daarboven
 * niet. Liever één keer te voorzichtig dan een belofte die de server niet houdt.
 */
export const BAND_VERBREDING_MARGE = 0.25;

/** `2 stints` / `1 stint`; dezelfde enkelvoudregel als elders in dit bestand. */
function stints(n: number): string {
  const aantal = String(Math.round(n));
  return aantal === "1" ? "1 stint" : `${aantal} stints`;
}

/** De combinatie in gewone taal: `bmw_m4_gt3 op spa`. Onbekend? Dan niets. */
export function combinatie(carKey: string | null, trackKey: string | null): string | null {
  if (carKey != null && trackKey != null) return `${carKey} op ${trackKey}`;
  return carKey ?? trackKey ?? null;
}

/** `1 rijder` / `3 rijders`; nooit een naam, alleen een aantal. */
function rijders(n: number): string {
  const aantal = String(Math.round(n));
  return aantal === "1" ? "1 rijder" : `${aantal} rijders`;
}

/** `1,9% per ronde`; zonder helling niets, want nul is geen meting. */
function helling(rate: number | null): string | null {
  const waarde = decimal(rate);
  return waarde == null ? null : `${waarde}% per ronde`;
}

/**
 * De gedeelde verwachting voor deze combinatie (`basis.gedeeld`).
 *
 * "Gedeeld voor bmw_m4_gt3 op spa: 2,1% per ronde, uit 41 rondes van 3 rijders."
 *
 * Alleen rondes en rijders zonder helling mag: een pool met een meetbasis maar
 * zonder bruikbare helling is nog steeds iets dat de lezer hoort te weten (het
 * zegt namelijk dat er wél gereden is). Een lege pool levert null op — dan is er
 * niets gedeeld en dus ook geen regel.
 */
export function gedeeldRegel(estimate: TyreEstimateV2): string | null {
  const { gedeeld, carKey, trackKey } = estimate.basis;
  if (gedeeld == null) return null;

  const delen: string[] = [];
  const rate = helling(gedeeld.rate);
  if (rate != null) delen.push(rate);

  const basis =
    gedeeld.rondes != null && gedeeld.rondes > 0
      ? `uit ${rondes(Math.round(gedeeld.rondes))}`
      : gedeeld.stints != null && gedeeld.stints > 0
        ? `uit ${stints(gedeeld.stints)}`
        : null;
  if (basis != null) {
    const wie =
      gedeeld.accounts != null && gedeeld.accounts > 0
        ? ` van ${rijders(gedeeld.accounts)}`
        : " van andere rijders";
    delen.push(`${basis}${wie}`);
  }

  if (delen.length === 0) return null;
  const voor = combinatie(carKey, trackKey);
  return `Gedeeld${voor == null ? "" : ` voor ${voor}`}: ${delen.join(", ")}.`;
}

/**
 * De eigen meting op deze set (`basis.eigen`).
 *
 * "Eigen voor bmw_m4_gt3 op spa: 1,9% per ronde, uit 2 stints en 18 rondes."
 *
 * Nul eigen stints is een geldig antwoord en geen lege regel: dan zegt de regel
 * dat er nog niets eigens is. Dat is precies de eerlijkheid die ontbrak — het
 * getal rustte wél op de pool, maar zei dat niet.
 */
export function eigenRegel(estimate: TyreEstimateV2): string | null {
  const { eigen, carKey, trackKey } = estimate.basis;
  if (eigen == null) return null;

  const voor = combinatie(carKey, trackKey);
  const kop = `Eigen${voor == null ? "" : ` voor ${voor}`}`;

  if (eigen.stints != null && eigen.stints <= 0) {
    return `${kop}: nog geen eigen meting op deze combinatie.`;
  }

  const delen: string[] = [];
  const rate = helling(eigen.rate);
  if (rate != null) delen.push(rate);

  const stuks: string[] = [];
  if (eigen.stints != null && eigen.stints > 0) stuks.push(stints(eigen.stints));
  if (eigen.rondes != null && eigen.rondes > 0) stuks.push(rondes(Math.round(eigen.rondes)));
  if (stuks.length > 0) delen.push(`uit ${stuks.join(" en ")}`);

  if (delen.length === 0) return null;
  return `${kop}: ${delen.join(", ")}.`;
}

/** Lopen de eigen helling en de gedeelde ver genoeg uiteen om te waarschuwen? */
export function hellingenUiteen(eigen: number | null, gedeeld: number | null): boolean {
  if (eigen == null || gedeeld == null) return false;
  const noemer = Math.max(Math.abs(eigen), Math.abs(gedeeld));
  if (noemer <= 0) return false;
  return Math.abs(eigen - gedeeld) / noemer > BAND_VERBREDING_MARGE;
}

/**
 * De waarschuwing dat de band breder kan worden in plaats van smaller.
 *
 * Dit is de correctie op "elke stop maakt de band smaller". De server verbreedt
 * de band zodra de eigen meting en de prior niet meer bij elkaar passen; dat
 * gebeurt hier, en de regel zegt het met de twee hellingen erbij zodat de lezer
 * ziet waaróm. Geen getallen verzinnen: alleen wat de server zelf stuurde.
 */
export function uiteenloopRegel(estimate: TyreEstimateV2): string | null {
  const eigen = estimate.basis.eigen?.rate ?? null;
  const gedeeld = estimate.basis.gedeeld?.rate ?? null;
  if (!hellingenUiteen(eigen, gedeeld)) return null;
  const eigenTekst = decimal(eigen);
  const gedeeldTekst = decimal(gedeeld);
  if (eigenTekst == null || gedeeldTekst == null) return null;
  return (
    `Je eigen slijtage (${eigenTekst}% per ronde) en de gedeelde (${gedeeldTekst}% per ronde) ` +
    "lopen uiteen: een volgende stint kan de band breder maken in plaats van smaller."
  );
}

/**
 * De teller die "nog geen tweede meting" vervangt.
 *
 * `Nog 2 stints op deze combinatie tot graad B; elke stint met hetzelfde beeld
 * maakt de band smaller.`
 *
 * De oude regel was onwaar zodra een apparaat zestien stints had: er wás allang
 * een tweede meting, en de band werd niet smaller van elke stop. Deze teller
 * telt de eigen stints die er écht zijn, noemt de eerstvolgende graad, en
 * belooft alleen iets als de eigen meting en de gedeelde elkaar niet tegenspreken.
 *
 * Geen teller bij een niet-verse stand (dan weten we de huidige staat niet), bij
 * een helling die te klein is om te meten (meer stints meet dan niets bij), of
 * als de eigen stints ontbreken.
 */
export function stapRegel(estimate: TyreEstimateV2): string | null {
  const { eigen, redenen } = estimate.basis;
  const aantal = eigen?.stints ?? null;
  if (aantal == null || aantal <= 0) return null;
  if (bandmetingStale(estimate)) return null;
  if (redenen.includes("zero_slope")) return null;

  const uiteen = uiteenloopRegel(estimate) != null;
  const smaller = uiteen ? "" : "; elke stint met hetzelfde beeld maakt de band smaller";

  if (aantal >= 3) {
    return `Graad A: op deze combinatie is de band zo smal als deze metingen toelaten${uiteen ? "" : "; meer stints veranderen de graad niet"}.`;
  }

  const totA = 3 - aantal;
  const totB = 2 - aantal;
  if (totB <= 0) {
    return `Nog ${stints(totA)} op deze combinatie tot graad A${smaller}.`;
  }
  return `Nog ${stints(totB)} op deze combinatie tot graad B${smaller}.`;
}

/** `47 minuten`, `1 minuut`, `minder dan een minuut`. */
function ouderdom(minuten: number): string {
  const m = Math.round(minuten);
  if (m < 1) return "minder dan een minuut";
  return m === 1 ? "1 minuut" : `${m} minuten`;
}

/**
 * "Geen actuele bandmeting", met de leeftijd erbij en zonder rondes-getal.
 *
 * De server zet bij een niet-verse stand `usable = false` en `range_laps = null`;
 * deze regel legt uit waaróm er geen rondes staan in plaats van de lezer met
 * "rondes onbekend" achter te laten. De leeftijd is het eerlijkste getal dat we
 * hebben, en het is met opzet het enige getal in deze regel: een aantal rondes
 * zou hier suggereren dat we de huidige band kennen.
 *
 * Is de meting wel jong maar hoort hij bij een andere set of sessie, dan is de
 * leeftijd niet de reden en zegt de regel dat in plaats daarvan.
 */
export function staleRegel(estimate: TyreEstimateV2): string | null {
  if (!bandmetingStale(estimate)) return null;

  const { wearOuderheidMin, sessieMatch, setMatch } = estimate.basis.actualiteit ?? {
    wearOuderheidMin: null,
    sessieMatch: null,
    setMatch: null,
  };

  const versGenoeg = wearOuderheidMin != null && wearOuderheidMin > VERSE_METING_MAX_MIN;
  let reden: string;
  if (versGenoeg) {
    reden = `de laatste meting is ${ouderdom(wearOuderheidMin)} oud`;
  } else if (setMatch === false) {
    reden = "de laatste meting hoort bij een andere set";
  } else if (sessieMatch === false) {
    reden = "de laatste meting komt uit een andere sessie";
  } else if (wearOuderheidMin != null) {
    reden = `de laatste meting is ${ouderdom(wearOuderheidMin)} oud`;
  } else {
    reden = "de meting is niet vers";
  }

  return `Geen actuele bandmeting: ${reden}. Daarom geen rondes tot de grens.`;
}

/**
 * De vaste regel per reden-code. Eén code, één zin — de UI verzint er zelf geen.
 *
 * `stale_state` staat er niet in: die heeft zijn eigen regel met de leeftijd
 * (`staleRegel`), en twee zinnen over hetzelfde feit is er één te veel.
 */
export function redenRegel(code: TyreReden): string | null {
  switch (code) {
    case "short_basis":
      return "Minder dan 8 rondes eigen basis op deze combinatie: één rondje meer of minder kan het beeld laten kantelen.";
    case "inferred_boundary":
      return "De setgrens komt uit een sprong in de wear-stand, niet uit de bandenteller: het aantal rondes op deze set is een schatting.";
    case "context_mismatch":
      return "De gedeelde verwachting komt uit een andere auto of een ander circuit: voor deze combinatie zegt hij minder.";
    case "thin_pool":
      return "Nog te weinig rijders op deze combinatie: er zijn minstens twee rijders nodig voor een gedeelde verwachting.";
    case "zero_slope":
      return "Geen meetbare slijtage op deze combinatie: de bandenstand verandert te weinig om een tempo te meten.";
    default:
      return null;
  }
}

/** De codes waar een waarschuwing bij hoort; de rest is een voorbehoud. */
export function redenIsWaarschuwing(code: TyreReden): boolean {
  return code === "context_mismatch" || code === "thin_pool" || code === "zero_slope";
}

/**
 * De regel onder een voorlopig bereik, voor een antwoord zonder de nieuwe velden.
 *
 * De oude tekst ("Nog geen tweede meting: dit bereik is voorlopig. Elke stop die
 * erbij komt, maakt de band smaller.") was op twee punten onwaar: bij zestien
 * stints was er allang een tweede meting, en de band wordt niet van elke stop
 * smaller. Deze regel telt wat er wél staat en belooft alleen een smaller wordende
 * band bij een stint die hetzelfde beeld laat zien.
 */
export function voorlopigRegel(estimate: TyreEstimateV2): string | null {
  const aantal = estimate.stints;
  if (aantal == null || aantal <= 0) {
    return "Dit bereik is voorlopig: er is nog te weinig gemeten om de band smaller te maken.";
  }
  if (aantal < 2) {
    return "Eén stint is nog geen band: dit bereik is voorlopig. Een tweede stint met hetzelfde beeld maakt de band smaller.";
  }
  return `Dit bereik is voorlopig: het rust op ${stints(aantal)}. Een nieuwe stint met hetzelfde beeld maakt de band smaller.`;
}
