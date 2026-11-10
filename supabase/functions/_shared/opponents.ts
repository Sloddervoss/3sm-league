// 0.4.1 additive opponent snapshot — pure, framework-free validation shared by the V3
// ingest normalizer (simhub.ts) and unit tests. No Deno deps so vitest can import it.
export type V3Opponent = {
  id: string;
  carNumber: string | null;
  driverName: string | null;
  /** Additief model (max 120 tekens). Ontbreken of null betekent onbekend. */
  carName: string | null;
  irating?: number | null;
  safetyRating?: number | null;
  licenseClass?: string | null;
  teamName: string | null;
  carClass: string | null;
  carClassId: string | null;
  position: number | null;
  classPosition: number | null;
  lap: number | null;
  lapDistancePct: number | null;
  gapToPlayerSeconds: number | null;
  gapToLeaderSeconds: number | null;
  lastLapSeconds: number | null;
  bestLapSeconds: number | null;
  inPit: boolean | null;
  speedKph: number | null;
  connected: boolean;
  isPlayer: boolean;
};

export const MaxOpponentsPerSnapshot = 40;

/** Like exactKeys but allows extra optional fields (additive opponent support). */
export const exactKeysAllowExtra = (value: Record<string, unknown>, keys: string[], optional: string[], path: string) => {
  const actualKeys = Object.keys(value);
  const required = keys.filter((key) => !optional.includes(key));
  const optionalSet = new Set(optional);
  const unexpected = actualKeys.filter((key) => !required.includes(key) && !optionalSet.has(key));
  if (unexpected.length) throw new Error(`${path} contains unknown fields`);
  for (const key of required) {
    if (!(key in value)) throw new Error(`${path} is missing required field ${key}`);
  }
};

const asRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
};

const text = (value: unknown, path: string, max = 120): string => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${path} is invalid`);
  return value.trim();
};
const nullableText = (value: unknown, path: string): string | null => (value === null ? null : text(value, path));

/** Additief model: de producer mag het veld weglaten (dan null) en mag het bij
 * een vol budget per rij weglaten. De grens is in tekens, zoals de rest van dit
 * bestand; het bytebudget van het frame wordt apart bewaakt. */
export const MaxOpponentCarNameChars = 120;

/**
 * Modelnaam van een tegenstander. Ontbreken of null is de normale standaard voor
 * een oudere connector. Een onbruikbare waarde (geen tekst, leeg of te lang)
 * maakt alleen dit veld leeg en logt de reden: één kapot model kost nooit de rij
 * of het frame. Er wordt niets afgeleid uit carClass, carClassId of driverName —
 * klasse is geen model en een coureursnaam is geen auto.
 */
const opponentCarName = (value: unknown, path: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    console.error("[ingest] tegenstander-carName is geen tekst, veld leeggemaakt", { pad: path, type: Array.isArray(value) ? "array" : typeof value });
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MaxOpponentCarNameChars) {
    console.error("[ingest] tegenstander-carName onbruikbaar, veld leeggemaakt", { pad: path, lengte: trimmed.length });
    return null;
  }
  return trimmed;
};

const v3Number = (value: unknown, path: string, rule: { nullable?: boolean; integer?: boolean; min?: number; max?: number; sentinels?: number[] } = {}): number | null => {
  if (rule.nullable && value === null) return null;
  const min = rule.min ?? 0;
  const max = rule.max ?? Number.MAX_SAFE_INTEGER;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} is invalid`);
  if (rule.integer && !Number.isInteger(value)) throw new Error(`${path} must be an integer`);
  if (rule.sentinels?.includes(value)) return null;
  if (value < min || value > max) throw new Error(`${path} is invalid`);
  return value;
};

/** Gaten zijn verschillen in seconden; buiten ±24 uur is het geen gat maar rommel. */
const SignedGapLimitSeconds = 86400;

/**
 * Een gat is een *verschil* en heeft dus een teken: zit de andere auto vóór de
 * speler, dan is `gapToPlayerSeconds` negatief, en -1 kan een echt gat van één
 * seconde zijn. Daarom hier geen `min: 0` en geen -1-sentinel zoals in `num()`:
 * dat maakte precies de helft van het veld leeg.
 *
 * Alleen ontbreken (null/undefined) of een niet-numerieke waarde levert null op.
 * Buiten ±86400 seconden is het geen meting meer; dat veld wordt leeg en de rij
 * blijft staan — één onbruikbaar getal kost nooit het frame of de tegenstander.
 */
const signedGap = (value: unknown, path: string): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    console.error("[ingest] gat is niet-numeriek, veld leeggemaakt", { pad: path, waarde: String(value) });
    return null;
  }
  if (value < -SignedGapLimitSeconds || value > SignedGapLimitSeconds) {
    console.error("[ingest] gat buiten bereik, veld leeggemaakt", { pad: path, waarde: String(value) });
    return null;
  }
  return value;
};

const v3Bool = (value: unknown, path: string): boolean | null => {
  if (value === null) return null;
  if (typeof value !== "boolean") throw new Error(`${path} is invalid`);
  return value;
};

/**
 * Parse a bounded opponent array. Accepts null/undefined => null (0.3.16/0.4.0 compat).
 * Rejects: non-array, > cap, entries missing `id`, NaN/Infinity/out-of-range numerics.
 */
export const parseOpponents = (value: unknown, path = "opponents"): V3Opponent[] | null => {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) throw new Error(`${path} must be an array or null`);
  if (value.length > MaxOpponentsPerSnapshot) throw new Error(`${path} exceeds cap ${MaxOpponentsPerSnapshot}`);
  return value.flatMap((raw, index) => {
    const o = asRecord(raw, `${path}[${index}]`);
    const id = nullableText(o.id, `${path}[${index}].id`);
    if (!id) {
      console.error("[ingest] tegenstander zonder id overgeslagen", { pad: `${path}[${index}]` });
      return [];
    }
    // Een tegenstander met een onbruikbaar getal mag nooit het hele frame
    // kosten: dat veld wordt leeg en de rest van de rij blijft staan.
    const zacht = (v: unknown, p: string, opties: Parameters<typeof v3Number>[2]): number | null => {
      try {
        return v3Number(v, p, opties);
      } catch {
        console.error("[ingest] tegenstanderveld ongeldig, veld leeggemaakt", { pad: p, waarde: String(v) });
        return null;
      }
    };
    const num = (v: unknown, p: string): number | null => zacht(v, p, { nullable: true, min: 0, max: 86400, sentinels: [-1] });
    const lapNum = (v: unknown, p: string): number | null => zacht(v, p, { nullable: true, integer: true, min: 1, max: 100000, sentinels: [-1, 0] });
    const posNum = (v: unknown, p: string): number | null => zacht(v, p, { nullable: true, integer: true, min: 1, max: 1000, sentinels: [0, -1] });
    const lapDist = (v: unknown, p: string): number | null => zacht(v, p, { nullable: true, min: 0, max: 1, sentinels: [-1] });
    // Gaten hebben een teken (zie signedGap); rondetijden, snelheid en
    // percentages niet, dus die houden hun eigen ondergrens.
    const gat = (v: unknown, p: string): number | null => signedGap(v, p);
    const rij: V3Opponent = {
      id,
      carNumber: nullableText(o.carNumber, `${path}[${index}].carNumber`),
      driverName: nullableText(o.driverName, `${path}[${index}].driverName`),
      carName: opponentCarName(o.carName, `${path}[${index}].carName`),
      // Additive fields: older connectors omit these. Bad rating data never costs a row.
      irating: o.irating == null ? null : zacht(o.irating, `${path}[${index}].irating`, { integer: true, min: 1, max: 100000, sentinels: [0, -1] }),
      safetyRating: o.safetyRating == null ? null : zacht(o.safetyRating, `${path}[${index}].safetyRating`, { min: 0, max: 4.99 }),
      licenseClass: typeof o.licenseClass === "string" && ["R", "D", "C", "B", "A", "Pro", "WC"].includes(o.licenseClass) ? o.licenseClass : null,
      teamName: nullableText(o.teamName, `${path}[${index}].teamName`),
      carClass: nullableText(o.carClass, `${path}[${index}].carClass`),
      carClassId: nullableText(o.carClassId, `${path}[${index}].carClassId`),
      position: posNum(o.position, `${path}[${index}].position`),
      classPosition: posNum(o.classPosition, `${path}[${index}].classPosition`),
      lap: lapNum(o.lap, `${path}[${index}].lap`),
      lapDistancePct: lapDist(o.lapDistancePct, `${path}[${index}].lapDistancePct`),
      gapToPlayerSeconds: gat(o.gapToPlayerSeconds, `${path}[${index}].gapToPlayerSeconds`),
      gapToLeaderSeconds: gat(o.gapToLeaderSeconds, `${path}[${index}].gapToLeaderSeconds`),
      lastLapSeconds: num(o.lastLapSeconds, `${path}[${index}].lastLapSeconds`),
      bestLapSeconds: num(o.bestLapSeconds, `${path}[${index}].bestLapSeconds`),
      inPit: v3Bool(o.inPit, `${path}[${index}].inPit`),
      speedKph: num(o.speedKph, `${path}[${index}].speedKph`),
      connected: o.connected === true,
      isPlayer: o.isPlayer === true,
    };
    return [rij];
  });
};
