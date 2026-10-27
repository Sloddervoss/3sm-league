/**
 * Optioneel V3 root-blok `brakes` — remdruk per hoek.
 *
 * Waarom een eigen root-blok: `vehicle` matcht zijn keyset exact, dus een extra
 * veld daarbinnen is een breekbare wijziging voor elke server die nog niet
 * meedoet. `brakes` staat ernaast, is volledig optioneel en raakt geen bestaand
 * veld. Een 0.7.x-payload zonder `brakes` blijft byte-voor-byte geldig.
 *
 * Regels:
 *  - alles is optioneel en nullable; `null` betekent "de sim leverde het niet",
 *    nooit een 0 die als meting doorgaat;
 *  - onbekende (sub)velden worden geweigerd, zodat een typefout in de connector
 *    een 422 is en geen stil weggeschreven verkeerd getal;
 *  - een hoek is een object met exact `pressureBar`; een bare getal wordt
 *    geweigerd, want dan is de eenheid niet te controleren;
 *  - de hoeken mogen zowel `frontLeft…` als `fl…` heten (zelfde afspraak als in
 *    het bandenblok), zodat de connector niet twee namingregels hoeft te kennen;
 *  - een leeg blok is geen meting: `brakes: {}` wordt geweigerd.
 *
 * Alle foutmeldingen beginnen met `payload.brakes…`, zodat de ingest-route ze als
 * `invalid_payload` (422) kan indelen en niet als interne fout (500).
 */

export type BrakeCorner = "fl" | "fr" | "rl" | "rr";

export type BrakePressure = {
  /** Remleidingdruk in bar. */
  pressureBar: number | null;
};

export type BrakesTelemetry = Record<BrakeCorner, BrakePressure | null>;

const CORNER_ALIASES = [
  ["frontLeft", "fl"],
  ["frontRight", "fr"],
  ["rearLeft", "rl"],
  ["rearRight", "rr"],
] as const;
const LEGACY_ALIASES = [["fl", "fl"], ["fr", "fr"], ["rl", "rl"], ["rr", "rr"]] as const;

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${path} must be an object`);
  return value as Record<string, unknown>;
};

const allowKeys = (value: Record<string, unknown>, allowed: string[], path: string) => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw Error(`${path} contains unknown fields`);
};

const num = (value: unknown, path: string, min: number, max: number): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw Error(`${path} is invalid`);
  if (value < min || value > max) throw Error(`${path} is invalid`);
  return value;
};

const corner = (value: unknown, path: string): BrakePressure | null => {
  if (value === undefined || value === null) return null;
  const r = record(value, path);
  allowKeys(r, ["pressureBar"], path);
  return {
    // 0-250 bar dekt straat- en racewagens; een sensor die in psi of kPa zendt
    // (1000+) valt hiermee op als zendfout in plaats van als 1000 bar.
    pressureBar: num(r.pressureBar, `${path}.pressureBar`, 0, 250),
  };
};

export const parseBrakesTelemetry = (value: unknown): BrakesTelemetry | null => {
  if (value === undefined || value === null) return null;
  const path = "payload.brakes";
  const r = record(value, path);
  if (Object.keys(r).length === 0) throw Error(`${path} must contain at least one field`);
  allowKeys(r, [...CORNER_ALIASES.map(([long]) => long), ...LEGACY_ALIASES.map(([short]) => short)], path);
  const out = { fl: null, fr: null, rl: null, rr: null } as BrakesTelemetry;
  for (const [key, side] of [...CORNER_ALIASES, ...LEGACY_ALIASES]) {
    // Ontbrekende alias overslaan: anders wist de korte hoeknaam de lange.
    if (r[key] === undefined) continue;
    out[side] = corner(r[key], `${path}.${key}`);
  }
  return out;
};
