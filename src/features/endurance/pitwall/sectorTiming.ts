/**
 * Live per-sector timing uit het persistente PACE-contract.
 *
 * Dit is géén tweede rondevalidatie: de server bewaart per auto het laatste
 * resultaat per sectorIndex en de geverifieerde compacte sectorBests. Deze
 * helper leest die stand los van de 5-seconden `freshMetrics`-poort, isoleert
 * misvormde entries en presenteert nooit een mengeling van ronden als één
 * bewezen volledige ronde.
 *
 * De legacy volledige-rondecontrole (`rowSectors`/`validatedSectors`) blijft
 * ongewijzigd en apart vallen wanneer dit contract voor een auto ontbreekt.
 */
import type {
  PaceCar,
  PaceHistory,
  PaceSectorBest,
  PaceSectorUpdate,
} from "../../../../supabase/functions/_shared/paceCapture";

export const SECTOR_MAX_COUNT = 16;
export const SECTOR_MAX_UPDATES = 16;

export type SectorStatus = PaceSectorUpdate["status"];

export interface SectorSlot {
  sectorIndex: number;
  lap: number;
  status: SectorStatus;
  /** null bij invalidated. */
  seconds: number | null;
  referenceSeconds: number | null;
  /** seconden - bevroren vorige persoonlijke beste; negatief = sneller. */
  deltaSeconds: number | null;
  isPersonalBest: boolean;
  /** Alleen waar wanneer dit een geverifieerde sectorBests-waarde uit beeld is. */
  isSessionBest: boolean;
  /** Ouder dan de nieuwste lap in deze auto; nooit als hele ronde presenteren. */
  isPreviousLap: boolean;
  revision: number;
}

export interface CarSectorTiming {
  carId: string;
  sectorCount: number;
  /** Nieuwste lap die in de slots voorkomt. */
  lap: number;
  /** Meerdere lapwaarden in de slots: geen complete ronde. */
  mixedLaps: boolean;
  slots: Array<SectorSlot | null>;
  status: "provisional" | "verified" | "mixed" | "invalidated" | "missing";
}

export interface SectorViewCar {
  id: string;
  /** Huidige (lopende) ronde van de auto, voor de future-lap-guard. */
  currentLap?: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteBetween = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

const isIntegerBetween = (value: unknown, min: number, max: number): value is number =>
  isFiniteBetween(value, min, max) && Number.isInteger(value);

const isStatus = (value: unknown): value is SectorStatus =>
  value === "provisional" || value === "verified" || value === "invalidated";

const isReference = (value: unknown): value is number | null =>
  value == null || isFiniteBetween(value, Number.MIN_VALUE, 86400);

/**
 * Eén entry uit het bevroren contract. Onbekende extra velden worden genegeerd;
 * een misvormde entry levert null op en raakt de andere sectoren niet.
 */
export function parseSectorUpdate(value: unknown, carId: string): PaceSectorUpdate | null {
  if (!isRecord(value)) return null;
  if (typeof carId !== "string" || carId.length < 1 || carId.length > 64) return null;
  const id = value.id;
  const lap = value.lap;
  const sectorIndex = value.sectorIndex;
  const sectorCount = value.sectorCount;
  const seconds = value.seconds;
  const completed = value.completedSessionTimeSeconds;
  const observed = value.observedSessionTimeSeconds;
  const revision = value.revision;
  const status = value.status;
  const referenceSeconds = value.referenceSeconds;

  if (id !== carId) return null;
  if (!isIntegerBetween(lap, 1, 100000)) return null;
  if (!isIntegerBetween(sectorIndex, 0, SECTOR_MAX_COUNT - 1)) return null;
  if (!isIntegerBetween(sectorCount, 1, SECTOR_MAX_COUNT)) return null;
  if (sectorIndex >= sectorCount) return null;
  if (!isIntegerBetween(revision, 1, Number.MAX_SAFE_INTEGER)) return null;
  if (!isFiniteBetween(completed, 0, 86400)) return null;
  if (!isFiniteBetween(observed, 0, 86400)) return null;
  if (observed + 1e-9 < completed) return null;
  if (!isReference(referenceSeconds)) return null;
  if (!isStatus(status)) return null;

  let normalizedSeconds: number | null = null;
  if (status === "invalidated") {
    if (seconds !== null) return null;
  } else {
    if (!isFiniteBetween(seconds, Number.MIN_VALUE, 86400)) return null;
    normalizedSeconds = seconds;
  }

  return {
    id: carId,
    lap,
    sectorIndex,
    sectorCount,
    seconds: normalizedSeconds,
    completedSessionTimeSeconds: completed,
    observedSessionTimeSeconds: observed,
    revision,
    status,
    referenceSeconds,
  };
}

/** Nieuwste identiteit wint: lap eerst, daarna revision (contractorde). */
const newer = (candidate: PaceSectorUpdate, current: PaceSectorUpdate): boolean =>
  candidate.lap > current.lap ||
  (candidate.lap === current.lap && candidate.revision > current.revision);

/**
 * Laatste stand per sectorIndex voor één auto. Een afwijkende sectorCount is
 * een andere layout en wordt niet door de nieuwste layout heen gemengd.
 */
function readCar(car: PaceCar | null | undefined, currentLap?: number | null): {
  count: number;
  entries: PaceSectorUpdate[];
} | null {
  if (!car || typeof car.id !== "string" || car.id.length < 1 || car.id.length > 64) return null;
  if (!Array.isArray(car.sectors) || car.sectors.length === 0 || car.sectors.length > SECTOR_MAX_UPDATES) return null;

  const guard = isIntegerBetween(currentLap, 1, 100000) ? currentLap : null;
  const valid: PaceSectorUpdate[] = [];
  for (const raw of car.sectors) {
    const entry = parseSectorUpdate(raw, car.id);
    if (!entry) continue;
    // Future-lap-guard: één frame voorsprong op de opponentensnapshot is
    // toegestaan, een sprong van meerdere ronden is geen live resultaat.
    if (guard != null && entry.lap > guard + 1) continue;
    valid.push(entry);
  }
  if (valid.length === 0) return null;

  const newest = valid.reduce((best, entry) => (newer(entry, best) ? entry : best));
  const count = newest.sectorCount;
  const latest = new Map<number, PaceSectorUpdate>();
  for (const entry of valid) {
    if (entry.sectorCount !== count) continue;
    const previous = latest.get(entry.sectorIndex);
    if (!previous || newer(entry, previous)) latest.set(entry.sectorIndex, entry);
  }
  if (latest.size === 0) return null;
  return { count, entries: [...latest.values()].sort((a, b) => a.sectorIndex - b.sectorIndex) };
}

/** Geldige sectorBests per auto; ongeldige entries worden geïsoleerd. */
function readBests(car: PaceCar, sectorCount: number): Map<number, PaceSectorBest> {
  const bests = new Map<number, PaceSectorBest>();
  if (!Array.isArray(car.sectorBests) || car.sectorBests.length > SECTOR_MAX_UPDATES) return bests;
  for (const raw of car.sectorBests) {
    if (!isRecord(raw)) continue;
    const sectorIndex = raw.sectorIndex;
    const lap = raw.lap;
    const seconds = raw.seconds;
    if (!isIntegerBetween(sectorIndex, 0, SECTOR_MAX_COUNT - 1)) continue;
    if (sectorIndex >= sectorCount) continue;
    if (!isIntegerBetween(lap, 1, 100000)) continue;
    if (!isFiniteBetween(seconds, Number.MIN_VALUE, 86400)) continue;
    const previous = bests.get(sectorIndex);
    if (!previous || seconds < previous.seconds) {
      bests.set(sectorIndex, { sectorIndex, lap, seconds });
    }
  }
  return bests;
}

export function statusLabel(status: SectorStatus): string {
  if (status === "provisional") return "Voorlopig";
  if (status === "verified") return "Geverifieerd";
  return "Ongeldig";
}

export function formatSectorSeconds(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value.toFixed(3) : "—";
}

/** Altijd een expliciet teken voor een verschil; 0 blijft neutraal. */
export function formatSectorDelta(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value === 0) return "0.000";
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(3)}`;
}

export function sectorDeltaTone(value: number | null | undefined): "negative" | "positive" | "neutral" {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "neutral";
  return value < 0 ? "negative" : "positive";
}

/** Korte, volledige uitleg voor title/aria; geen status verzinnen. */
export function describeSectorSlot(slot: SectorSlot | null): string | null {
  if (!slot) return null;
  const parts = [`Ronde ${slot.lap}`, statusLabel(slot.status)];
  if (slot.seconds != null) parts.push(formatSectorSeconds(slot.seconds));
  const delta = formatSectorDelta(slot.deltaSeconds);
  if (delta != null) parts.push(`${delta} t.o.v. persoonlijk record`);
  if (slot.isSessionBest) parts.push("snelste geverifieerde sector in beeld");
  if (slot.isPreviousLap) parts.push("vorige ronde");
  return parts.join(" · ");
}

/**
 * Bouwt de weergavestand voor alle opgegeven auto's.
 *
 * `viewCars` is de daadwerkelijke leesweergave: alleen geverifieerde
 * sectorBests van deze auto's kunnen paars maken. Ontbreekt een auto in de
 * map, dan valt de consument terug op de bestaande legacy volledige ronde.
 */
export function buildSectorTimingIndex(
  history: PaceHistory | null | undefined,
  viewCars: ReadonlyArray<SectorViewCar>,
): Map<string, CarSectorTiming> {
  const result = new Map<string, CarSectorTiming>();
  if (!history || history.schemaRevision !== 1 || !Array.isArray(history.cars)) return result;

  const viewIds = new Set(viewCars.map((car) => car.id).filter((id) => typeof id === "string"));
  const read = new Map<string, { count: number; entries: PaceSectorUpdate[]; car: PaceCar }>();
  for (const car of history.cars) {
    if (!car || !viewIds.has(car.id)) continue;
    const viewCar = viewCars.find((candidate) => candidate.id === car.id);
    const parsed = readCar(car, viewCar?.currentLap);
    if (parsed) read.set(car.id, { ...parsed, car });
  }
  if (read.size === 0) return result;

  // Geverifieerde persoonlijke sectorBests per auto, daarna het minimum per
  // index over uitsluitend de auto's in deze leesweergave. Ook een auto zonder
  // huidige sectorrijen kan een geverifieerde best hebben; die mag een ander
  // niet ten onrechte paars maken.
  const carBests = new Map<string, Map<number, PaceSectorBest>>();
  const fieldBests = new Map<number, number>();
  for (const car of history.cars) {
    if (!car || !viewIds.has(car.id)) continue;
    const bests = readBests(car, read.get(car.id)?.count ?? SECTOR_MAX_COUNT);
    carBests.set(car.id, bests);
    for (const best of bests.values()) {
      const current = fieldBests.get(best.sectorIndex);
      if (current == null || best.seconds < current) fieldBests.set(best.sectorIndex, best.seconds);
    }
  }

  for (const [carId, { count, entries }] of read) {
    const maxLap = entries.reduce((max, entry) => Math.max(max, entry.lap), 0);
    const laps = new Set(entries.map((entry) => entry.lap));
    const ownBests = carBests.get(carId);
    const slots: Array<SectorSlot | null> = Array.from({ length: count }, () => null);
    const statuses = new Set<SectorStatus>();

    for (const entry of entries) {
      statuses.add(entry.status);
      const delta = entry.seconds != null && entry.referenceSeconds != null
        ? Math.round((entry.seconds - entry.referenceSeconds) * 1000) / 1000
        : null;
      const ownBest = ownBests?.get(entry.sectorIndex) ?? null;
      const fieldBest = fieldBests.get(entry.sectorIndex);
      const sessionBest =
        entry.status === "verified" &&
        entry.seconds != null &&
        ownBest != null &&
        fieldBest != null &&
        ownBest.lap <= entry.lap &&
        Math.abs(ownBest.seconds - entry.seconds) <= 0.0005 &&
        Math.abs(fieldBest - entry.seconds) <= 0.0005;

      slots[entry.sectorIndex] = {
        sectorIndex: entry.sectorIndex,
        lap: entry.lap,
        status: entry.status,
        seconds: entry.seconds,
        referenceSeconds: entry.referenceSeconds,
        deltaSeconds: delta,
        isPersonalBest: delta != null && delta < 0,
        isSessionBest: sessionBest,
        isPreviousLap: entry.lap < maxLap,
        revision: entry.revision,
      };
    }

    const status: CarSectorTiming["status"] = statuses.size === 0
      ? "missing"
      : statuses.size > 1
        ? "mixed"
        : statuses.has("provisional")
          ? "provisional"
          : statuses.has("verified")
            ? "verified"
            : "invalidated";

    result.set(carId, {
      carId,
      sectorCount: count,
      lap: maxLap,
      mixedLaps: laps.size > 1,
      slots,
      status,
    });
  }

  return result;
}

/** Uniek resetdomein; een nieuwe waarde mag nooit oude resultaten dragen. */
export function sectorNamespace(history: PaceHistory | null | undefined): string | null {
  if (!history || history.schemaRevision !== 1) return null;
  const { transportSessionId, observedSessionId, segmentId } = history;
  for (const value of [transportSessionId, observedSessionId, segmentId]) {
    if (typeof value !== "string" || value.length === 0) return null;
  }
  return `${transportSessionId}\u0000${observedSessionId}\u0000${segmentId}`;
}

/** Layoutmeting onafhankelijk van de 5-seconden metriekpoort. */
export function sectorCountFromHistory(history: PaceHistory | null | undefined): number {
  if (!history || history.schemaRevision !== 1 || !Array.isArray(history.cars)) return 0;
  const counts = new Set<number>();
  for (const car of history.cars) {
    if (!car || !Array.isArray(car.sectors) || car.sectors.length === 0 || car.sectors.length > SECTOR_MAX_UPDATES) continue;
    const parsed = readCar(car);
    if (parsed) counts.add(parsed.count);
  }
  return counts.size === 1 ? [...counts][0] : 0;
}

/**
 * Mag deze live sectorstand een bewezen volledige ronde vervangen?
 *
 * Alleen wanneer alle kolommen van dezelfde layout én dezelfde ronde een
 * geldige tijd hebben. Eén ontbrekende of ongeldige sector is een gedeeltelijke
 * stand: die mag de vorige complete ronde niet per kolom overschrijven, want
 * dan zouden oude en nieuwe rondes in één rij terechtkomen. Een mengeling van
 * ronden is om dezelfde reden nooit een vervanger.
 */
export function isCompleteLiveTiming(
  timing: CarSectorTiming | null | undefined,
  sectorCount: number,
): boolean {
  if (!timing || timing.mixedLaps) return false;
  if (!Number.isInteger(sectorCount) || sectorCount < 1 || sectorCount > SECTOR_MAX_COUNT) return false;
  if (timing.sectorCount !== sectorCount || timing.slots.length !== sectorCount) return false;
  return timing.slots.every((slot) =>
    slot != null
    && slot.status !== "invalidated"
    && slot.seconds != null
    && Number.isFinite(slot.seconds)
    && slot.seconds > 0
  );
}

/** Eén weergegeven sectorcel: nieuwste live slot of een oudere bewezen cel. */
export type ComposedSectorCell =
  | { kind: "live"; slot: SectorSlot; lap: number; previous: boolean }
  | { kind: "retained"; seconds: number; lap: number | null; previous: boolean }
  | { kind: "missing" };

export interface RetainedSectorLap {
  seconds: number[];
  lap: number | null;
}

/**
 * Stelt per sectorIndex de nieuwste bruikbare cel samen.
 *
 * Een geverifieerde S1 van de nieuwe ronde mag direct verschijnen terwijl S2
 * en S3 nog van de vorige ronde zijn. Elke cel draagt zijn eigen ronde; de
 * oudere cellen krijgen `previous: true` en blijven met R-label zichtbaar.
 * Er wordt nooit een complete ronde geclaimd als de rondes verschillen.
 *
 * Een live slot dat ouder is dan de bewaarde bewezen ronde verliest: een late
 * of omgekeerde poll mag een nieuwere meting niet terugzetten.
 */
export function composeSectorCells(
  timing: CarSectorTiming | null | undefined,
  retained: RetainedSectorLap | null | undefined,
  sectorCount: number,
  invalidatedCells?: ReadonlySet<string> | null,
): ComposedSectorCell[] {
  const count = Number.isInteger(sectorCount) && sectorCount >= 1 && sectorCount <= SECTOR_MAX_COUNT ? sectorCount : 0;
  if (count === 0) return [];
  const live = timing && timing.sectorCount === count && timing.slots.length === count ? timing : null;
  const cells: ComposedSectorCell[] = [];
  for (let index = 0; index < count; index += 1) {
    const slot = live?.slots[index] ?? null;
    const retainedSeconds = retained?.seconds[index];
    const retainedLap = retained?.lap ?? null;
    const liveUsable = slot != null && slot.status !== "invalidated" && slot.seconds != null && slot.seconds > 0;
    const retainedUsable = typeof retainedSeconds === "number" && Number.isFinite(retainedSeconds) && retainedSeconds > 0;
    const slotInvalidated = slot?.status === "invalidated"
      || (slot != null && invalidatedCells?.has(`${slot.lap}:${index}`) === true);
    if (slotInvalidated && slot != null) {
      // Een bevestigde ongeldigheid is een uitspraak over deze sector. Hij mag
      // niet alsnog uit een oudere bewaarde ronde worden gevuld, en een latere
      // "geldige" kopie van dezelfde ronde maakt hem niet opnieuw geldig.
      cells.push({ kind: "live", slot: { ...slot, status: "invalidated", seconds: null }, lap: slot.lap, previous: false });
    } else if (liveUsable && (!retainedUsable || retainedLap == null || slot.lap >= retainedLap)) {
      cells.push({ kind: "live", slot, lap: slot.lap, previous: false });
    } else if (retainedUsable) {
      cells.push({ kind: "retained", seconds: retainedSeconds, lap: retainedLap, previous: false });
    } else {
      cells.push({ kind: "missing" });
    }
  }
  const newest = cells.reduce((max, cell) => (cell.kind !== "missing" && cell.lap != null ? Math.max(max, cell.lap) : max), 0);
  return cells.map((cell) => (
    cell.kind !== "missing" && cell.lap != null && newest > 0 && cell.lap < newest
      ? { ...cell, previous: true }
      : cell
  ));
}

/** Hoogste ronde in een samengestelde rij, of null als er geen cel is. */
export function composedLap(cells: ReadonlyArray<ComposedSectorCell>): number | null {
  let lap: number | null = null;
  for (const cell of cells) {
    if (cell.kind === "missing" || cell.lap == null) continue;
    if (lap == null || cell.lap > lap) lap = cell.lap;
  }
  return lap;
}

/** Zijn de cellen van meer dan één ronde? Dan is dit geen complete ronde. */
export function isMixedComposedRow(cells: ReadonlyArray<ComposedSectorCell>): boolean {
  const laps = new Set<number>();
  for (const cell of cells) if (cell.kind !== "missing" && cell.lap != null) laps.add(cell.lap);
  return laps.size > 1;
}
