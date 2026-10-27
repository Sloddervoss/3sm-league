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
 * Additief sinds 0.7.x: `pressuresBar` (bar per hoek, één getal per hoek). Het is
 * optioneel en verandert geen bestaand veld; een payload zonder druk blijft geldig.
 *
 * Alle foutmeldingen beginnen met `payload.tyres…`, zodat de reden herkenbaar is in
 * het log. Het frame zelf gaat door: simhub.ts vangt een fout in dit blok af en laat
 * alleen `tyres` leeg (zie parseTyresNeverFatal daar).
 */

/** Eén zone-driehoek [left, middle, right] in de volgorde die de sim hanteert. */
export type TyreZone = { l: number | null; m: number | null; r: number | null };
export type TyreCorner = "fl" | "fr" | "rl" | "rr";
export type TyreZones = Record<TyreCorner, TyreZone | null>;
/**
 * Bandenspanning per hoek, in bar. Eén getal per hoek: de sim levert geen
 * binnen/midden/buiten-verdeling voor druk, dus geen zones hier.
 */
export type TyrePressuresBar = Record<TyreCorner, number | null>;

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
  /** Additief (0.7.x): spanning per hoek in bar. Ontbreekt het blok, dan is alles null. */
  pressuresBar: TyrePressuresBar;
};

const CORNERS: TyreCorner[] = ["fl", "fr", "rl", "rr"];
const ZONE_CORNERS = [["frontLeft", "fl"], ["frontRight", "fr"], ["rearLeft", "rl"], ["rearRight", "rr"]] as const;
const LEGACY_CORNERS = [["fl", "fl"], ["fr", "fr"], ["rl", "rl"], ["rr", "rr"]] as const;
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
  const out = { fl: null, fr: null, rl: null, rr: null } as TyreZones;
  const r = optionalObject(value, path);
  if (!r) return out;
  allowKeys(r, [...ZONE_CORNERS.map((c) => c[0]), ...LEGACY_CORNERS.map((c) => c[0])], path);
  for (const [key, corner] of [...ZONE_CORNERS, ...LEGACY_CORNERS]) {
    const raw = r[key];
    if (raw === undefined || raw === null) continue;
    const zonePath = `${path}.${key}`;
    // De plugin stuurt per hoek een array van drie zones: [links, midden, rechts].
    if (Array.isArray(raw)) {
      if (raw.length !== 3) throw Error(`${zonePath} must have exactly 3 zones`);
      out[corner] = {
        l: num(raw[0], `${zonePath}[0]`, { min: 0, max: 100 }),
        m: num(raw[1], `${zonePath}[1]`, { min: 0, max: 100 }),
        r: num(raw[2], `${zonePath}[2]`, { min: 0, max: 100 }),
      };
      continue;
    }
    const zone = raw as Record<string, unknown>;
    out[corner] = {
      l: num(zone.l, `${zonePath}.l`, { min: 0, max: 100 }),
      m: num(zone.m, `${zonePath}.m`, { min: 0, max: 100 }),
      r: num(zone.r, `${zonePath}.r`, { min: 0, max: 100 }),
    };
  }
  return out;
};


const carcassZones = (value: unknown, path: string): TyreZones => {
  const out = { fl: null, fr: null, rl: null, rr: null } as TyreZones;
  const r = optionalObject(value, path);
  if (!r) return out;
  allowKeys(r, [...ZONE_CORNERS.map((c) => c[0]), ...LEGACY_CORNERS.map((c) => c[0])], path);
  for (const [key, corner] of [...ZONE_CORNERS, ...LEGACY_CORNERS]) {
    const raw = r[key];
    if (raw === undefined || raw === null) continue;
    const zonePath = `${path}.${key}`;
    // De plugin stuurt per hoek een array van drie zones: [links, midden, rechts].
    if (Array.isArray(raw)) {
      if (raw.length !== 3) throw Error(`${zonePath} must have exactly 3 zones`);
      out[corner] = {
        l: num(raw[0], `${zonePath}[0]`, { min: -40, max: 300 }),
        m: num(raw[1], `${zonePath}[1]`, { min: -40, max: 300 }),
        r: num(raw[2], `${zonePath}[2]`, { min: -40, max: 300 }),
      };
      continue;
    }
    const zone = raw as Record<string, unknown>;
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

const pressuresBar = (value: unknown, path: string): TyrePressuresBar => {
  const out = { fl: null, fr: null, rl: null, rr: null } as TyrePressuresBar;
  const r = optionalObject(value, path);
  if (!r) return out;
  allowKeys(r, [...ZONE_CORNERS.map((c) => c[0]), ...LEGACY_CORNERS.map((c) => c[0])], path);
  for (const [key, corner] of [...ZONE_CORNERS, ...LEGACY_CORNERS]) {
    // Ontbrekende alias overslaan: anders wist de korte hoeknaam de lange.
    if (r[key] === undefined) continue;
    // Bar, niet psi of kPa: 1,2-2,5 is een koude/harde slickspanning. De marge is
    // bewust ruim (0,3-5,0) zodat een hete band of een luchtdruksensor niet wegvalt,
    // maar een eenheidfout (180 kPa) nog steeds een 422 oplevert.
    out[corner] = num(r[key], `${path}.${key}`, { min: 0.3, max: 5 });
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
  allowKeys(r, ["observedAt", "sessionTimeSeconds", "lap", "setsUsed", "wearPercent", "carcassTempC", "capturedAt"], path);
  return {
    wearPercent: zones(r.wearPercent, `${path}.wearPercent`),
    carcassTempC: carcassZones(r.carcassTempC, `${path}.carcassTempC`),
    capturedAt: capturedAt(r.capturedAt ?? r.observedAt, `${path}.capturedAt`),
  };
};

export const parseTyreTelemetry = (value: unknown): TyreTelemetry | null => {
  if (value === undefined || value === null) return null;
  const path = "payload.tyres";
  const r = record(value, path);
  nonEmpty(r, path);
  allowKeys(r, ["observedAt", "sessionTimeSeconds", "lap", "trigger", "wearPercent", "carcassTempC", "sets", "compoundId", "environment", "pitEntry", "pressuresBar"], path);
  return {
    wearPercent: zones(r.wearPercent, `${path}.wearPercent`),
    carcassTempC: carcassZones(r.carcassTempC, `${path}.carcassTempC`),
    sets: sets(r.sets, `${path}.sets`),
    compoundId: num(r.compoundId, `${path}.compoundId`, { integer: true, min: 0, max: 255 }),
    environment: environment(r.environment, `${path}.environment`),
    pitEntry: pitEntry(r.pitEntry, `${path}.pitEntry`),
    pressuresBar: pressuresBar(r.pressuresBar, `${path}.pressuresBar`),
  };
};
