/**
 * Optioneel V3 root-blok `tyres` (S1 — contract).
 *
 * Waarom een eigen root-blok en geen uitbreiding van `vehicle`: de validator matcht de
 * keyset van `vehicle` exact, dus elk extra veld daarbinnen is een breekbare wijziging
 * voor een server die nog niet meedoet. `tyres` staat naast `vehicle`, is volledig
 * optioneel en verandert geen bestaand veld. Een 0.6.x-payload blijft byte-voor-byte
 * geldig.
 *
 * Regels die hier worden gehandhaafd (docs: 3sm-bandenplan.md §2, plan-01-plugin.md):
 *  - alles is optioneel en nullable; `null` betekent "de sim/connector leverde het niet",
 *    en is nooit een 0 die als meting doorgaat;
 *  - onbekende (sub)velden worden geweigerd — een typefout in de connector hoort een
 *    422 te zijn, geen stil weggeschreven verkeerd getal;
 *  - een hoek die wél aanwezig is, heeft exact `l`, `m`, `r` (net als een zone-array in
 *    het plugin-ontwerp altijd lengte 3 heeft). Een halve hoek is een zendfout;
 *  - een leeg blok is geen meting: `tyres: {}` wordt geweigerd.
 *
 * Alle foutmeldingen beginnen met `payload.tyres…`, zodat de ingest-route ze als
 * `invalid_payload` (422) kan indelen en niet als interne fout (500).
 */

/** Eén zone-driehoek [left, middle, right] in de volgorde die de sim hanteert. */
export type TyreZone = { l: number | null; m: number | null; r: number | null };
export type TyreCorner = "fl" | "fr" | "rl" | "rr";
export type TyreZones = Record<TyreCorner, TyreZone | null>;

export type TyreSets = {
  used: number | null;
  /** 255 = onbeperkt (iRacing-sentinel). De validator interpreteert niets. */
  available: number | null;
  frontLeft: number | null;
  frontRight: number | null;
  rearLeft: number | null;
  rearRight: number | null;
};

export type TyreEnvironment = {
  trackTempC: number | null;
  airTempC: number | null;
  /** Vrije tekst uit de sessie-YAML ("moderate usage"), geen enum. */
  rubberState: string | null;
};

export type TyrePitEntry = {
  wearPercent: TyreZones;
  carcassTempC: TyreZones;
  capturedAt: string | null;
};

export type TyreTelemetry = {
  wearPercent: TyreZones;
  carcassTempC: TyreZones;
  sets: TyreSets;
  compoundId: number | null;
  environment: TyreEnvironment;
  pitEntry: TyrePitEntry | null;
};

const CORNERS: TyreCorner[] = ["fl", "fr", "rl", "rr"];
const ZONE_KEYS = ["l", "m", "r"];

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${path} must be an object`);
  return value as Record<string, unknown>;
};

/** Alleen deze sleutels toegestaan; ontbrekende sleutels zijn toegestaan (alles is optioneel). */
const allowKeys = (value: Record<string, unknown>, allowed: string[], path: string) => {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw Error(`${path} contains unknown fields`);
};

/** Een blok dat aanwezig is maar niets bevat, is een zendfout — geen lege meting. */
const nonEmpty = (value: Record<string, unknown>, path: string) => {
  if (Object.keys(value).length === 0) throw Error(`${path} must contain at least one field`);
};

const optionalObject = (value: unknown, path: string): Record<string, unknown> | null => {
  if (value === undefined || value === null) return null;
  const r = record(value, path);
  nonEmpty(r, path);
  return r;
};

type NumberRule = { integer?: boolean; min: number; max: number };

const num = (value: unknown, path: string, rule: NumberRule): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw Error(`${path} is invalid`);
  if (rule.integer && !Number.isInteger(value)) throw Error(`${path} must be an integer`);
  if (value < rule.min || value > rule.max) throw Error(`${path} is invalid`);
  return value;
};

const zones = (value: unknown, path: string): TyreZones => {
  const empty = { fl: null, fr: null, rl: null, rr: null } as TyreZones;
  const r = optionalObject(value, path);
  if (!r) return empty;
  allowKeys(r, CORNERS, path);
  const out = { ...empty };
  for (const corner of CORNERS) {
    const raw = r[corner];
    if (raw === undefined || raw === null) continue;
    const zonePath = `${path}.${corner}`;
    const zone = record(raw, zonePath);
    allowKeys(zone, ZONE_KEYS, zonePath);
    for (const key of ZONE_KEYS) {
      if (!(key in zone)) throw Error(`${zonePath} is missing required field ${key}`);
    }
    out[corner] = {
      l: num(zone.l, `${zonePath}.l`, { min: 0, max: 1 }),
      m: num(zone.m, `${zonePath}.m`, { min: 0, max: 1 }),
      r: num(zone.r, `${zonePath}.r`, { min: 0, max: 1 }),
    };
  }
  return out;
};

const carcassZones = (value: unknown, path: string): TyreZones => {
  const empty = { fl: null, fr: null, rl: null, rr: null } as TyreZones;
  const r = optionalObject(value, path);
  if (!r) return empty;
  allowKeys(r, CORNERS, path);
  const out = { ...empty };
  for (const corner of CORNERS) {
    const raw = r[corner];
    if (raw === undefined || raw === null) continue;
    const zonePath = `${path}.${corner}`;
    const zone = record(raw, zonePath);
    allowKeys(zone, ZONE_KEYS, zonePath);
    for (const key of ZONE_KEYS) {
      if (!(key in zone)) throw Error(`${zonePath} is missing required field ${key}`);
    }
    out[corner] = {
      l: num(zone.l, `${zonePath}.l`, { min: -40, max: 300 }),
      m: num(zone.m, `${zonePath}.m`, { min: -40, max: 300 }),
      r: num(zone.r, `${zonePath}.r`, { min: -40, max: 300 }),
    };
  }
  return out;
};

const sets = (value: unknown, path: string): TyreSets => {
  const out: TyreSets = { used: null, available: null, frontLeft: null, frontRight: null, rearLeft: null, rearRight: null };
  const r = optionalObject(value, path);
  if (!r) return out;
  allowKeys(r, ["used", "available", "frontLeft", "frontRight", "rearLeft", "rearRight"], path);
  out.used = num(r.used, `${path}.used`, { integer: true, min: 0, max: 255 });
  out.available = num(r.available, `${path}.available`, { integer: true, min: 0, max: 255 });
  for (const [corner, key] of [["fl", "frontLeft"], ["fr", "frontRight"], ["rl", "rearLeft"], ["rr", "rearRight"]] as const) {
    out[key] = num(r[key], `${path}.${key}`, { integer: true, min: 0, max: 255 });
  }

  return out;
};

const environment = (value: unknown, path: string): TyreEnvironment => {
  const out: TyreEnvironment = { trackTempC: null, airTempC: null, rubberState: null };
  const r = optionalObject(value, path);
  if (!r) return out;
  allowKeys(r, ["trackTempC", "airTempC", "rubberState"], path);
  out.trackTempC = num(r.trackTempC, `${path}.trackTempC`, { min: -40, max: 100 });
  out.airTempC = num(r.airTempC, `${path}.airTempC`, { min: -40, max: 100 });
  const rubber = r.rubberState;
  if (rubber !== undefined && rubber !== null) {
    // Geen vaste lijst: de sim levert vrije tekst uit de sessie-YAML. Een verkeerde
    // enum zou het hele frame laten vallen; lengte + tekenset is genoeg begrenzing.
    if (typeof rubber !== "string" || rubber.length < 1 || rubber.length > 24 || !/^[A-Za-z ]+$/.test(rubber)) {
      throw Error(`${path}.rubberState is invalid`);
    }
    out.rubberState = rubber;
  }
  return out;
};

const capturedAt = (value: unknown, path: string): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw Error(`${path} is invalid`);
  }
  return value;
};

const pitEntry = (value: unknown, path: string): TyrePitEntry | null => {
  const r = optionalObject(value, path);
  if (!r) return null;
  allowKeys(r, ["wearPercent", "carcassTempC", "capturedAt"], path);
  return {
    wearPercent: zones(r.wearPercent, `${path}.wearPercent`),
    carcassTempC: carcassZones(r.carcassTempC, `${path}.carcassTempC`),
    capturedAt: capturedAt(r.capturedAt, `${path}.capturedAt`),
  };
};

export const parseTyreTelemetry = (value: unknown): TyreTelemetry | null => {
  if (value === undefined || value === null) return null;
  const path = "payload.tyres";
  const r = record(value, path);
  nonEmpty(r, path);
  allowKeys(r, ["wearPercent", "carcassTempC", "sets", "compoundId", "environment", "pitEntry"], path);
  return {
    wearPercent: zones(r.wearPercent, `${path}.wearPercent`),
    carcassTempC: carcassZones(r.carcassTempC, `${path}.carcassTempC`),
    sets: sets(r.sets, `${path}.sets`),
    compoundId: num(r.compoundId, `${path}.compoundId`, { integer: true, min: 0, max: 255 }),
    environment: environment(r.environment, `${path}.environment`),
    pitEntry: pitEntry(r.pitEntry, `${path}.pitEntry`),
  };
};
