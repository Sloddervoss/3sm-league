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

export interface TyreBasis {
  carKey: string | null;
  trackKey: string | null;
  trackTempC: number | null;
  rondesInBasis: number | null;
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
    },
    provenance: provenanceOf(get(raw, "provenance"), grade),
    // Alleen A is gemeten; zonder veld is alles daarboven voorlopig.
    voorlopig: typeof voorlopigRuw === "boolean" ? voorlopigRuw : grade !== "A",
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
    basis: { carKey: null, trackKey: null, trackTempC: null, rondesInBasis: null },
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
  const metRondes = grade === "A" || grade === "B";
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
 * een RPC die `jsonb` levert kan ook `{ rows: [...] }` sturen. Beide mogen.
 */
export function parseTyreCoverage(raw: unknown): TyreCoverageRow[] {
  const rijen = Array.isArray(raw) ? raw : get(get(raw, "data") ?? raw, "rows");
  if (!Array.isArray(rijen)) return [];

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
