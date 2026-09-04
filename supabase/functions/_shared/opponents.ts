// 0.4.1 additive opponent snapshot — pure, framework-free validation shared by the V3
// ingest normalizer (simhub.ts) and unit tests. No Deno deps so vitest can import it.
export type V3Opponent = {
  id: string;
  carNumber: string | null;
  driverName: string | null;
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
  return value.map((raw, index) => {
    const o = asRecord(raw, `${path}[${index}]`);
    const id = nullableText(o.id, `${path}[${index}].id`);
    if (!id) throw new Error(`${path}[${index}].id is invalid`);
    const num = (v: unknown, p: string): number | null => v3Number(v, p, { nullable: true, min: 0, max: 86400, sentinels: [-1] });
    const lapNum = (v: unknown, p: string): number | null => v3Number(v, p, { nullable: true, integer: true, min: 1, max: 100000, sentinels: [-1, 0] });
    const posNum = (v: unknown, p: string): number | null => v3Number(v, p, { nullable: true, integer: true, min: 1, max: 1000, sentinels: [0, -1] });
    const lapDist = (v: unknown, p: string): number | null => v3Number(v, p, { nullable: true, min: 0, max: 1, sentinels: [-1] });
    return {
      id,
      carNumber: nullableText(o.carNumber, `${path}[${index}].carNumber`),
      driverName: nullableText(o.driverName, `${path}[${index}].driverName`),
      teamName: nullableText(o.teamName, `${path}[${index}].teamName`),
      carClass: nullableText(o.carClass, `${path}[${index}].carClass`),
      carClassId: nullableText(o.carClassId, `${path}[${index}].carClassId`),
      position: posNum(o.position, `${path}[${index}].position`),
      classPosition: posNum(o.classPosition, `${path}[${index}].classPosition`),
      lap: lapNum(o.lap, `${path}[${index}].lap`),
      lapDistancePct: lapDist(o.lapDistancePct, `${path}[${index}].lapDistancePct`),
      gapToPlayerSeconds: num(o.gapToPlayerSeconds, `${path}[${index}].gapToPlayerSeconds`),
      gapToLeaderSeconds: num(o.gapToLeaderSeconds, `${path}[${index}].gapToLeaderSeconds`),
      lastLapSeconds: num(o.lastLapSeconds, `${path}[${index}].lastLapSeconds`),
      bestLapSeconds: num(o.bestLapSeconds, `${path}[${index}].bestLapSeconds`),
      inPit: v3Bool(o.inPit, `${path}[${index}].inPit`),
      speedKph: num(o.speedKph, `${path}[${index}].speedKph`),
      connected: o.connected === true,
      isPlayer: o.isPlayer === true,
    };
  });
};