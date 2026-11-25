/**
 * Live sectorklok uit het frame.
 *
 * De connector leidt deze tijd af uit baanpositie: de SDK levert een sectortijd
 * pas als de sector voorbij is, dus binnen de sector is dit de enige lopende
 * meting. Daarom heet het ook geen sectortijd maar de klok van de huidige sector.
 * Zonder geldige waarden tonen we niets — geen klok die op nul blijft staan.
 */

export interface SectorClock {
  index: number;
  count: number;
  elapsedSeconds: number;
  progressPct: number;
  learned: boolean;
}

const int = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function mapSectorClock(raw: unknown): SectorClock | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const index = int(record.index);
  const count = int(record.count);
  const elapsedSeconds = num(record.elapsedSeconds);
  const progressPct = num(record.progressPct);
  if (index === null || count === null || elapsedSeconds === null || progressPct === null) return null;
  if (count < 2 || count > 12 || index < 1 || index > count) return null;
  if (elapsedSeconds < 0 || elapsedSeconds > 3600) return null;
  if (progressPct < 0 || progressPct > 100) return null;
  return {
    index,
    count,
    elapsedSeconds,
    progressPct,
    learned: record.learned === true,
  };
}
