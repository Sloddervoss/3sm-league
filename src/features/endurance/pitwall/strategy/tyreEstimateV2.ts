/**
 * Het bandenmodel van de server, versie 2 (`pitwall_tyre_estimate_v2`).
 *
 * Waarom er een tweede lezer is naast `parseTyreEstimate`: v1 hing aan een
 * gebonden race (event + team) en gaf een anker met een hoek. v2 hangt aan het
 * apparaat en geeft wat de pitwall écht wil weten — een bereik in rondes, de
 * basis waarop dat bereik rust (auto, circuit, temperatuur, aantal rondes) en de
 * herkomst van het getal. Zolang de RPC nog niet overal is uitgerold, valt deze
 * module terug op v1; de pagina gaat dus nooit stuk op een ontbrekende functie.
 *
 * Twee regels die hier en niet in de UI staan:
 *
 * 1. Een percentage rest is geen antwoord op "hoeveel rondes nog". Zolang
 *    `voorlopig` waar is, toont de UI het bereik in rondes en geen percentage.
 *    Daarom levert deze module helemaal geen restpercentage: wat er niet is, kan
 *    ook niet per ongeluk op het scherm komen.
 * 2. Ontbreekt een veld, dan wordt het `null` — nooit een nul. Alleen `grade` is
 *    verplicht; zonder geldige graad is er geen model en zegt de UI dat.
 * 3. Waar het getal vandaan komt (`basis.bron`) is geen technisch detail maar
 *    een zin voor de lezer: `priorUitleg` zet de bronnen om in gewone taal, met
 *    de meetbasis erbij en zonder jargon. Bij een eigen meting zegt hij niets —
 *    dat is de gewone situatie.
 */

import {
  parseTyreEstimate,
  type LapRange,
  type TyreEstimate,
  type TyreGrade,
} from "./tyreGrade";

/**
 * Waar het getal vandaan komt, in de woorden die de pitwall gebruikt:
 *
 *   measured    gemeten        een anker uit deze run, dus een echte meting
 *   last_known  laatst bekend   de laatste meting is ouder dan dit stint-venster
 *   estimated   geschat         het model rekent, maar zonder eigen meting
 *   none        geen data       er is niets om op te rekenen
 *
 * De RPC stuurt `measured` / `estimated` / `last_known` / `unavailable`; die
 * laatste heet hier `none`, want op het scherm staat "geen data".
 */
export type TyreProvenance = "measured" | "last_known" | "estimated" | "none";

const PROVENANCE_LABEL: Record<TyreProvenance, string> = {
  measured: "gemeten",
  last_known: "laatst bekend",
  estimated: "geschat",
  none: "geen data",
};

/** De woorden die op het scherm staan; één bron, ook voor de tests. */
export function provenanceLabel(provenance: TyreProvenance | null): string {
  return provenance == null ? PROVENANCE_LABEL.none : PROVENANCE_LABEL[provenance];
}

/**
 * Waar de voorkennis vandaan komt — de niveaus die de server kent:
 *
 *   eigen     een eigen stint op deze auto en dit circuit; de gewone situatie
 *   exact     gedeelde stints van anderen met precies deze auto op dit circuit
 *   auto      stints van anderen met deze auto, op andere circuits
 *   circuit   stints van anderen op dit circuit, met andere auto's
 *   algemeen  alles wat er is, ongeacht auto en circuit
 *
 * `exact` staat erbij omdat de migratie hem stuurt: het is de fijnste trap van
 * de prior en dus een eigen geval — wel andermans data, maar voor precies deze
 * combinatie. `eigen` is geen bijzonder geval maar de norm: zodra er één eigen
 * meting is, hoeft de pitwall niets over anderen te zeggen. `null` betekent dat
 * de server niets over de herkomst zei; dan verzinnen we er geen.
 */
export type TyrePriorBron = "eigen" | "exact" | "auto" | "circuit" | "algemeen";

export interface TyreBasis {
  carKey: string | null;
  trackKey: string | null;
  trackTempC: number | null;
  rondesInBasis: number | null;
  /** Waar de voorkennis vandaan komt (`basis.bron`), of null als de server zweeg. */
  bron: TyrePriorBron | null;
  /**
   * De helling uit de voorkennis in procentpunten per ronde, positief = slijt.
   * Wordt bewaard zodat niemand hem opnieuw hoeft te lezen, maar staat niet als
   * eigen getal op het scherm: het bereik in rondes is het antwoord, dit is de
   * rekenondergrond. Twee hellingen naast elkaar is één te veel.
   */
  priorRate: number | null;
  /**
   * `basis.prior_n` is géén aantal stints maar `n_eff`: de meetbasis in rondes
   * die het cijfer draagt (`n/(n+8)` gewogen). Daarom zegt de regel op het
   * scherm "rondes" en nooit "stints" — het aantal stints staat alleen in de
   * leesbare opbouw van de server (`priorBron`).
   */
  priorN: number | null;
  /** De fijnste trap die meedeed (`basis.prior_level`): exact/auto/circuit/algemeen. */
  priorLevel: string | null;
  /**
   * De leesbare opbouw van de prior (`basis.prior_bron`), met aantallen per trap:
   * "algemeen: 12 stints, 40 rondes over alle auto's en circuits · andere auto's
   * op dit circuit: 7 stints, 90 rondes". Te lang voor de regel zelf, dus die
   * staat als detail (titeltip) bij de regel.
   */
  priorBron: string | null;
}

export interface TyreEstimateV2 {
  grade: TyreGrade;
  /** De uitleg van de server bij de graad (`één stint, ruime marge`), of null. */
  gradeLabel: string | null;
  usable: boolean;
  /** Aantal stints in de basis; één stop levert één meting op. */
  stints: number | null;
  /** Slijtage in procentpunten per ronde, zoals de server hem gaf (teken en al). */
  wearPerLapPp: number | null;
  /** Bereik in rondes, naar buiten afgerond; null als de server er geen gaf. */
  rangeLaps: LapRange | null;
  basis: TyreBasis;
  provenance: TyreProvenance;
  /** Zolang dit waar is, is het bereik een schatting en geen belofte. */
  voorlopig: boolean;
  /**
   * De omschrijving van de basis in gewone taal, zoals de server hem meegaf
   * (`model_bron`: `eigen stint`, `Spa + Lamborghini Huracan GT3`, `algemeen
   * beeld`). De migratie van 20261029090000 stuurt die korte vorm nog niet; daar
   * heet de leesbare opbouw `basis.prior_bron` (met aantallen per trap) en die
   * staat in `basis`. null betekent: niets meegestuurd, en dan zwijgt de regel.
   */
  modelBron: string | null;
}

/* ─────────────────────────── lezers ─────────────────────────── */

function get(source: unknown, key: string): unknown {
  return source != null && typeof source === "object" ? (source as Record<string, unknown>)[key] : undefined;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // `bigint`-kolommen komen als string over de wire zodra ze buiten het
  // veilige bereik vallen; een getal in een string is hier nog steeds een getal.
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function gradeOf(value: unknown): TyreGrade | null {
  if (typeof value !== "string") return null;
  const grade = value.trim().toUpperCase();
  return grade === "A" || grade === "B" || grade === "C" || grade === "D" ? grade : null;
}

/**
 * De herkomst, met de tokens die de server mag sturen. Onbekend of ontbrekend?
 * Dan leiden we hem af uit de graad: alleen A rust op twee ankers, en dus alleen
 * A heet "gemeten". Liever een voorzichtige herkomst dan een mooie.
 */
function provenanceOf(value: unknown, grade: TyreGrade): TyreProvenance {
  const token = typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : null;
  switch (token) {
    case "measured":
    case "gemeten":
    case "anchor":
    case "anchored":
      return "measured";
    case "last_known":
    case "laatst_bekend":
    case "last-known":
    case "stale":
    case "carried_over":
      return "last_known";
    case "estimated":
    case "geschat":
    case "estimate":
    case "model":
      return "estimated";
    case "none":
    case "unavailable":
    case "niet_beschikbaar":
    case "geen_data":
    case "geen":
    case "no_data":
    case "missing":
      return "none";
    default:
      return grade === "A" ? "measured" : grade === "D" ? "none" : "estimated";
  }
}

/**
 * De bron van de voorkennis (`basis.bron`). Onbekend of ontbrekend? Dan `null`:
 * "eigen" verzinnen zou de pitwall laten zeggen dat het cijfer van deze auto
 * komt, en dat is precies de bewering die dit veld moet onderbouwen.
 */
function priorBronOf(value: unknown): TyrePriorBron | null {
  const token = typeof value === "string" ? value.trim().toLowerCase() : null;
  switch (token) {
    case "eigen":
      return "eigen";
    case "exact":
      return "exact";
    case "auto":
      return "auto";
    case "circuit":
      return "circuit";
    case "algemeen":
      return "algemeen";
    default:
      return null;
  }
}

/** Een niveau dat de server als tekst óf als getal mag sturen; altijd als tekst. */
function levelOf(value: unknown): string | null {
  const alsTekst = text(value);
  if (alsTekst != null) return alsTekst;
  const alsGetal = num(value);
  return alsGetal == null ? null : String(alsGetal);
}

/** `{low, high}` of `[low, high]`; altijd naar buiten afgerond, nooit negatief. */
function rangeOf(value: unknown): LapRange | null {
  const bron = Array.isArray(value) ? { low: value[0], high: value[1] } : value;
  const low = num(get(bron, "low"));
  const high = num(get(bron, "high"));
  if (low == null && high == null) return null;
  const onder = Math.max(0, Math.floor(low ?? high!));
  const boven = Math.max(onder, Math.ceil(high ?? low!));
  return { low: onder, high: boven };
}

/** Leest het antwoord van `pitwall_tyre_estimate_v2`. Zonder graad: geen model. */
export function parseTyreEstimateV2(raw: unknown): TyreEstimateV2 | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const grade = gradeOf(get(raw, "grade"));
  if (grade == null) return null;

  const basisRuw = get(raw, "basis");
  const voorlopigRuw = get(raw, "voorlopig");
  const usableRuw = get(raw, "usable");

  return {
    grade,
    gradeLabel: text(get(raw, "grade_label")),
    // Ontbreekt `usable`, dan geldt: een D is niet bruikbaar, de rest wel.
    usable: typeof usableRuw === "boolean" ? usableRuw : grade !== "D",
    stints: num(get(raw, "stints")),
    wearPerLapPp: num(get(raw, "wear_per_lap")),
    rangeLaps: rangeOf(get(raw, "range_laps")),
    basis: {
      carKey: text(get(basisRuw, "car_key")),
      trackKey: text(get(basisRuw, "track_key")),
      trackTempC: num(get(basisRuw, "track_temp_c")),
      rondesInBasis: num(get(basisRuw, "rondes_in_basis")),
      bron: priorBronOf(get(basisRuw, "bron")),
      priorRate: num(get(basisRuw, "prior_rate")),
      priorN: num(get(basisRuw, "prior_n")),
      priorLevel: levelOf(get(basisRuw, "prior_level")),
      priorBron: text(get(basisRuw, "prior_bron")),
    },
    provenance: provenanceOf(get(raw, "provenance"), grade),
    // Alleen A is gemeten; zonder veld is alles daarboven voorlopig.
    voorlopig: typeof voorlopigRuw === "boolean" ? voorlopigRuw : grade !== "A",
    // De omschrijving mag naast `basis` staan (zoals de migratie hem stuurt) of
    // erin; beide vormen lezen we, want een gemiste vorm is een lege regel.
    modelBron: text(get(raw, "model_bron")) ?? text(get(basisRuw, "model_bron")),
  };
}

/* ──────────────── waar het getal vandaan komt, in gewone taal ──────────────── */

/**
 * Onder hoeveel stints een voorkennis een grove schatting is. Drie is de grens
 * die het model zelf ook aanhoudt voor graad A; daaronder is één tegenvaller
 * genoeg om het bereik te laten kantelen.
 */
const DUNNE_BASIS = 3;

export interface TyrePriorUitleg {
  /** De regel onder het bereik, of null als er niets extra's te zeggen is. */
  regel: string | null;
  /** De waarschuwing bij een te dunne basis, of null. */
  waarschuwing: string | null;
  /** De opbouw die de server zelf meestuurde, als titeltip onder de regel. */
  detail: string | null;
}

/**
 * Rondes met een decimaal eronder de tien, zonder decimaal erboven: bij een dunne
 * basis doet die ene tiende ertoe, bij veertig rondes is het ruis.
 */
function rondesTekst(value: number): string {
  if (value >= 10) return String(Math.round(value));
  const eenDecimaal = value.toFixed(1).replace(".", ",");
  return eenDecimaal.endsWith(",0") ? String(Math.round(value)) : eenDecimaal;
}

/**
 * De omschrijving die de server meegaf, tenzij hij alleen maar herhaalt wat de
 * regel al zegt (`eigen stint`, `algemeen beeld`).
 */
function modelBronDetail(estimate: TyreEstimateV2): string | null {
  const label = estimate.modelBron?.trim();
  if (label == null || label === "") return null;
  const kaal = label.toLowerCase();
  if (kaal === "eigen stint" || kaal === "algemeen beeld" || kaal === "algemeen") return null;
  return label;
}

/**
 * Eén regel in gewone taal: waar komt dit cijfer vandaan?
 *
 * Bij een eigen meting staat er niets — dat is de gewone situatie en de rest van
 * het paneel zegt daar al alles over. Zodra het getal op andermans stints rust,
 * zegt deze regel dat hardop, met de meetbasis erbij: "nog geen eigen meting op
 * dit circuit — gebaseerd op 41 rondes van andere rijders met deze auto". Geen
 * `prior_n`, geen `basis.bron`, geen Engels: de lezer zit in de pit, niet in de
 * database.
 *
 * Waarom rondes en geen stints: `basis.prior_n` is `n_eff`, de gewogen meetbasis
 * in rondes. Het aantal stints staat alleen in de leesbare opbouw van de server
 * (`basis.prior_bron`), en die is te lang voor deze regel — hij gaat mee als
 * `detail`, als titeltip.
 *
 * De waarschuwing eronder is een tweede zin en geen bijvoeglijk naamwoord in de
 * eerste: onder de drie rondes is het getal een grove schatting, en dat is iets
 * anders dan "gebaseerd op twee rondes".
 */
export function priorUitleg(estimate: TyreEstimateV2): TyrePriorUitleg {
  const { bron, priorN } = estimate.basis;
  if (bron == null || bron === "eigen") return { regel: null, waarschuwing: null, detail: null };

  const rondes = priorN == null ? null : `${rondesTekst(priorN)} ${priorN === 1 ? "ronde" : "rondes"}`;
  const noemer = rondes == null ? "een schatting van andere rijders" : `${rondes} van andere rijders`;

  const zin = {
    exact: `Nog geen eigen meting — gebaseerd op ${noemer} met deze auto op dit circuit`,
    auto: `Nog geen eigen meting op dit circuit — gebaseerd op ${noemer} met deze auto`,
    circuit: `Nog geen eigen meting met deze auto — gebaseerd op ${noemer} op dit circuit`,
    algemeen: `Nog geen eigen meting — gebaseerd op ${noemer}, van andere auto's en circuits`,
  }[bron];

  const dun = priorN != null && priorN < DUNNE_BASIS;

  return {
    regel: zin,
    waarschuwing: dun
      ? "Grove schatting: hier liggen minder dan drie rondes van andere rijders onder. Zie het als een richting, niet als een belofte."
      : null,
    detail: modelBronDetail(estimate) ?? estimate.basis.priorBron,
  };
}

/* ───────────────────── de terugval op v1 ───────────────────── */

/**
 * Hetzelfde beeld uit het v1-antwoord, zodat de rest van de pagina één vorm kent.
 *
 * v1 kent geen basis en geen stints; die blijven leeg. De herkomst volgt uit de
 * graad (zie `provenanceOf`) en `voorlopig` is alles behalve A: v1 had geen veld
 * om dat te zeggen, dus nemen we het voorzichtige antwoord.
 */
export function vanV1(estimate: TyreEstimate): TyreEstimateV2 {
  return {
    grade: estimate.grade,
    gradeLabel: null,
    usable: estimate.grade !== "D",
    stints: null,
    wearPerLapPp: estimate.ratePerLap,
    rangeLaps: estimate.lapsRange,
    basis: {
      carKey: null,
      trackKey: null,
      trackTempC: null,
      rondesInBasis: null,
      bron: null,
      priorRate: null,
      priorN: null,
      priorLevel: null,
      priorBron: null,
    },
    modelBron: null,
    provenance: estimate.grade === "A" ? "measured" : estimate.grade === "D" ? "none" : "estimated",
    voorlopig: estimate.grade !== "A",
  };
}

/**
 * Het v2-model in de vorm die de beslissingsband al kent.
 *
 * Graad C geeft hier bewust `null`: de band zegt bij C "rondes onbekend · wacht
 * op stop", terwijl v2 juist wél een bereik heeft. Twee regels die elkaar
 * tegenspreken is precies wat dit paneel eerder ongeloofwaardig maakte, dus het
 * bereik staat in het modelpaneel en niet in de band. A, B en D gaan wel door:
 * die tonen in de band hetzelfde als hier.
 */
export function naarTyreEstimate(estimate: TyreEstimateV2 | null): TyreEstimate | null {
  if (estimate == null || estimate.grade === "C") return null;
  const { grade } = estimate;
  // Een bereik dat de server zelf onbruikbaar noemt, gaat niet naar de band: de
  // band is het blok dat zegt wat je moet doen, en "295–1181 rondes" is daar een
  // advies dat niemand mag opvolgen. Het modelpaneel toont het getal gedempt.
  const metRondes = (grade === "A" || grade === "B") && estimate.usable;
  return {
    grade,
    source: "server",
    weakest: null,
    restPct: null,
    ratePerLap: metRondes ? estimate.wearPerLapPp : null,
    marginPp: null,
    sigmaLaps: null,
    lapsToThreshold: null,
    lapsRange: metRondes ? estimate.rangeLaps : null,
    pctRange: null,
    cause: null,
    causeLap: null,
    causeLaps: null,
    // De grens is de drempel uit plan-03, niet "kaal": dit getal komt uit een anker.
    limitPct: metRondes ? 40 : null,
    samples: metRondes ? (estimate.stints ?? 1) : 0,
  };
}

/* ─────────────────────── de RPC-aanroepen ─────────────────────── */

/** Het minimum aan client dat deze module nodig heeft; de Supabase-client past erop. */
export interface TyreRpcClient {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

export type TyreModelSource = "v2" | "v1" | "geen";

export interface TyreModelResult {
  estimate: TyreEstimateV2 | null;
  source: TyreModelSource;
  /** Waarom v2 niet gebruikt is; alleen voor de dev-regel op de pagina. */
  v2Error: string | null;
}

function errorText(error: unknown): string | null {
  if (error == null) return null;
  if (typeof error === "string") return error;
  const bericht = get(error, "message");
  const code = get(error, "code");
  if (typeof bericht === "string") return typeof code === "string" ? `${code}: ${bericht}` : bericht;
  return String(error);
}

/**
 * v2 eerst, v1 als v2 er nog niet is (of niets bruikbaars teruggeeft).
 *
 * De terugval is een bewuste keuze, geen verlegenheid: de pagina is een dev-tool
 * die moet blijven werken terwijl de migratie uitgerold wordt. Wat er gebruikt
 * is, staat in `source`, zodat het scherm het kan zeggen in plaats van te doen
 * alsof beide antwoorden hetzelfde zijn.
 */
export async function loadTyreModel(
  client: TyreRpcClient,
  input: { deviceId: string; eventId?: string | null; teamId?: string | null },
): Promise<TyreModelResult> {
  let v2Error: string | null = null;

  try {
    const v2 = await client.rpc("pitwall_tyre_estimate_v2", { p_device_id: input.deviceId });
    if (!v2.error) {
      const parsed = parseTyreEstimateV2(v2.data);
      if (parsed) return { estimate: parsed, source: "v2", v2Error: null };
      v2Error = "leeg antwoord";
    } else {
      v2Error = errorText(v2.error);
    }
  } catch (error) {
    v2Error = errorText(error) ?? "onbekende fout";
  }

  if (input.eventId && input.teamId) {
    try {
      const v1 = await client.rpc("pitwall_tyre_estimate_v1", {
        p_event_id: input.eventId,
        p_team_id: input.teamId,
      });
      if (!v1.error) {
        const parsed = parseTyreEstimate(v1.data);
        if (parsed) return { estimate: vanV1(parsed), source: "v1", v2Error };
      }
    } catch {
      // Ook v1 mag stuk zijn; dan is er geen model en zegt de UI dat.
    }
  }

  return { estimate: null, source: "geen", v2Error };
}

/* ─────────────────────────── dekking ─────────────────────────── */

export interface TyreCoverageRow {
  carKey: string | null;
  trackKey: string | null;
  stints: number;
  wearLabels: number;
  grade: TyreGrade | null;
  /** ISO-tijdstempel van de laatste meting, of null. */
  laatsteMeting: string | null;
}

/**
 * Leest `tyre_coverage`: per auto en circuit hoeveel stints en wear-labels er
 * zijn, met de graad die dat oplevert. PostgREST geeft een set terug als array;
 * een RPC die `jsonb` levert kan ook `{ rows: [...] }` sturen, en de client kan
 * het antwoord als `{ data: [...] }` of `{ data: { rows: [...] } }` inpakken.
 * Alle vier mogen — een vorm die we niet lezen is een dekking die leeg lijkt.
 */
export function parseTyreCoverage(raw: unknown): TyreCoverageRow[] {
  const rijen = coverageRows(raw);
  if (rijen == null) return [];

  return rijen
    .map((rij) => {
      const stints = num(get(rij, "stints"));
      if (stints == null) return null;
      return {
        carKey: text(get(rij, "car_key")),
        trackKey: text(get(rij, "track_key")),
        stints,
        wearLabels: num(get(rij, "wear_labels")) ?? 0,
        grade: gradeOf(get(rij, "grade")),
        laatsteMeting: text(get(rij, "laatste_meting")),
      } satisfies TyreCoverageRow;
    })
    .filter((rij): rij is TyreCoverageRow => rij != null)
    // Meest gemeten eerst: de bovenste regel is de basis die je het vaakst hebt.
    .sort((a, b) => b.stints - a.stints || b.wearLabels - a.wearLabels);
}

/** De vier vormen waarin de dekking kan binnenkomen, of null als het geen lijst is. */
function coverageRows(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  for (const kandidaat of [get(raw, "rows"), get(raw, "data")]) {
    if (Array.isArray(kandidaat)) return kandidaat;
    const genest = get(kandidaat, "rows");
    if (Array.isArray(genest)) return genest;
  }
  return null;
}

export async function loadTyreCoverage(
  client: TyreRpcClient,
  limit = 50,
): Promise<{ rows: TyreCoverageRow[]; error: string | null }> {
  try {
    const { data, error } = await client.rpc("tyre_coverage", { p_limit: limit });
    if (error) return { rows: [], error: errorText(error) ?? "dekking laden mislukt" };
    return { rows: parseTyreCoverage(data), error: null };
  } catch (error) {
    return { rows: [], error: errorText(error) ?? "dekking laden mislukt" };
  }
}
