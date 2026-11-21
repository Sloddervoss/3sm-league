/**
 * Tijdelijke, opt-in diagnostiek voor de sectordoorstroom.
 *
 * Inschakelen: `?pitwallTrace=1` (of `pitwall.sectorTrace=1` in
 * localStorage). Zonder die vlag doet dit bestand niets: geen console, geen
 * buffer, geen meetkosten in productie.
 *
 * Bewust begrensd en zonder persoonsgegevens: alleen korte codes, ronde-
 * nummers, aantallen en een niet-omkeerbare 8-tekens auto-referentie. Geen
 * namen, e-mail, tokens, auth-id's of ruwe telemetrie.
 *
 * Verwijderen na het onderzoek: dit bestand plus de `traceSector(...)`-
 * aanroepen in `useRetainedLapSectors.ts`, `usePitwallData.ts` en
 * `sectorTraceUi.ts`. De UI leest de buffer alleen via
 * `window.__pitwallSectorTrace`.
 */

export type SectorTraceEvent = {
  at: string;
  code: string;
  scope: string;
  car?: string;
  lap?: number | null;
  detail?: Record<string, string | number | boolean | null>;
};

export const SECTOR_TRACE_LIMIT = 200;
const TRACE_FLAG = "pitwall.sectorTrace";

let enabled: boolean | null = null;
let buffer: SectorTraceEvent[] = [];

/** Alleen expliciet aangezet via URL of localStorage. */
export function sectorTraceEnabled(): boolean {
  if (enabled != null) return enabled;
  if (typeof window === "undefined") return (enabled = false);
  try {
    const query = new URLSearchParams(window.location.search);
    enabled = query.get("pitwallTrace") === "1" || query.get("sectorTrace") === "1"
      || window.localStorage.getItem(TRACE_FLAG) === "1";
  } catch {
    enabled = false;
  }
  return enabled;
}

/** Niet-omkeerbare, korte referentie; nooit een auto-id of coureurnaam. */
export function carRef(id: string | null | undefined): string | undefined {
  if (typeof id !== "string" || id.length === 0) return undefined;
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

const TRACE_DETAIL_KEYS = new Set([
  "reason", "cars_before", "had_track", "observed_count", "slots", "count",
  "mixed_laps", "status", "previous_sequence", "next_sequence", "lap",
  "source", "duration_s", "session_phase", "retained",
]);

const cleanDetail = (detail: SectorTraceEvent["detail"]): SectorTraceEvent["detail"] => {
  if (!detail) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  let keys = 0;
  for (const [key, value] of Object.entries(detail)) {
    if (keys >= 12) break;
    if (!TRACE_DETAIL_KEYS.has(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, 24);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean" || value === null) out[key] = value;
    keys += 1;
  }
  return out;
};

function expose() {
  if (typeof window === "undefined") return;
  window.__pitwallSectorTrace = {
    enabled: true,
    dump: () => buffer.slice(),
    clear: () => { buffer = []; },
  };
}

/** Eén gebeurtenis; stil wanneer de vlag uit staat. */
export function traceSector(
  code: string,
  fields: Omit<SectorTraceEvent, "at" | "code"> = { scope: "unknown" },
): void {
  if (!sectorTraceEnabled()) return;
  const event: SectorTraceEvent = {
    at: new Date().toISOString(),
    code: code.slice(0, 40),
    scope: (fields.scope || "unknown").slice(0, 64),
    car: fields.car?.slice(0, 8),
    lap: typeof fields.lap === "number" && Number.isFinite(fields.lap) ? fields.lap : null,
    detail: cleanDetail(fields.detail),
  };
  buffer.push(event);
  if (buffer.length > SECTOR_TRACE_LIMIT) buffer.splice(0, buffer.length - SECTOR_TRACE_LIMIT);
  expose();
  // Eén compacte regel per gebeurtenis; alleen wanneer de diagnostic zelf aan staat.
  try {
    console.debug("[pitwall-sector-trace]", event);
  } catch {
    /* console mag nooit de weergave breken */
  }
}

/** Alleen voor tests: vergeet de eenmalige vlagdetectie en de buffer. */
export function resetSectorTraceForTests(): void {
  enabled = null;
  buffer = [];
  if (typeof window !== "undefined") delete window.__pitwallSectorTrace;
}

declare global {
  interface Window {
    __pitwallSectorTrace?: {
      enabled: true;
      dump: () => SectorTraceEvent[];
      clear: () => void;
    };
  }
}
