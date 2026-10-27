/**
 * Optioneel V3-blok `vehicle` — inclusief de kanalen van de directe iRacing-SDK-lezer.
 *
 * Twee soorten velden staan hier naast elkaar:
 *  - de oorspronkelijke SimHub-kanalen (speedKph, pedalen, rpm, versnelling, sectoren,
 *    bandentemperaturen). Die zijn verplicht zodra `vehicle` aanwezig is;
 *  - de directe-SDK-kanalen (0.8.x): wielsnelheid en remleidingdruk per hoek, plus
 *    stuurwielhoek en langs-/dwarsversnelling. Die zijn optioneel en nullable.
 *
 * Waarom optioneel en niet verplicht: de plugin rolt later uit dan de server. Een
 * connector zonder directe-SDK-lezer moet byte-voor-byte dezelfde payload kunnen
 * blijven sturen, dus bij ontbreken wordt elk nieuw veld `null` — nooit een 0 die
 * als meting doorgaat.
 *
 * Eenheid zit in de veldnaam (Kph, Bar, Deg, G). Dat is bewust: de server hoeft dan
 * geen eenheid te raden, en een connector die m/s of kPa stuurt valt op als waarde
 * buiten bereik in plaats van als een plausibel maar fout getal. De bereiken zijn
 * ruim genoeg voor elke auto in iRacing en krap genoeg om een eenheidfout te vangen:
 *  - wheelSpeedKph 0-600 (een m/s-zender geeft ~40-90 en blijft dus binnen bereik;
 *    daarom leunt de controle op het bereik, niet op een cross-check met speedKph —
 *    een geblokkeerd wiel is een echte 0 en mag nooit een frame kosten);
 *  - brakeLinePressureBar 0-250 (kPa of psi geeft 1000+, dat is een 422);
 *  - steeringWheelAngleDeg -900..900 (een radiaal-zender blijft binnen bereik; de
 *    hoek is vooral een kwaliteitsmeter, geen eenheidscontrole);
 *  - latAccelG / longAccelG -10..10 (m/s² levert 20-50 en wordt dus geweigerd).
 *
 * De hoeken mogen zowel `frontLeft…` als `fl…` heten, net als in `tyres` en `brakes`,
 * zodat de connector niet per blok een andere namingregel hoeft te kennen. Een hoek
 * is een bare getal (de eenheid staat al in de bovenliggende sleutel), geen object.
 *
 * Onbekende (sub)velden worden geweigerd — een typefout hoort een 422 te zijn, geen
 * stil weggeschreven verkeerd getal. `vehicle` is (anders dan `tyres`/`brakes`) wél
 * fataal: een half voertuigblok levert onbruikbare rondesamenvattingen op.
 *
 * Let op bij uitrollen: een server van vóór deze uitbreiding weigert een `vehicle`
 * met de nieuwe sleutels (de keyset was exact). Server eerst, plugin daarna.
 */

export type TyreReading = {
  wearPercent: number | null;
  temperature: number | null;
  pressure: number | null;
};

/** Eén waarde per hoek, altijd met de korte hoeknaam als sleutel. */
export type CornerValues = {
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
};

export type VehicleTelemetry = {
  speedKph: number | null;
  throttlePct: number | null;
  brakePct: number | null;
  rpm: number | null;
  gear: string | null;
  sector1Seconds: number | null;
  sector2Seconds: number | null;
  sector3Seconds: number | null;
  tyreDataMode: 'last_available';
  pressureUnit: 'psi' | 'kPa' | 'bar' | null;
  temperatureUnit: 'C' | 'F' | null;
  frontLeft: TyreReading | null;
  frontRight: TyreReading | null;
  rearLeft: TyreReading | null;
  rearRight: TyreReading | null;
  /** Additief (directe SDK): wielsnelheid per hoek in km/h. Ontbreekt het blok, dan alles null. */
  wheelSpeedKph?: CornerValues | null;
  /** Additief (directe SDK): remleidingdruk per hoek in bar. */
  brakeLinePressureBar?: CornerValues | null;
  /** Additief (directe SDK): stuurwielhoek in graden; teken volgt de sim. */
  steeringWheelAngleDeg?: number | null;
  /** Additief (directe SDK): dwarsversnelling in g. */
  latAccelG?: number | null;
  /** Additief (directe SDK): langsversnelling in g. */
  longAccelG?: number | null;
};

const REQUIRED_KEYS = [
  'speedKph', 'throttlePct', 'brakePct', 'rpm', 'gear',
  'sector1Seconds', 'sector2Seconds', 'sector3Seconds',
  'tyreDataMode', 'pressureUnit', 'temperatureUnit',
  'frontLeft', 'frontRight', 'rearLeft', 'rearRight',
];
const OPTIONAL_KEYS = [
  'wheelSpeedKph', 'brakeLinePressureBar', 'steeringWheelAngleDeg', 'latAccelG', 'longAccelG',
];

const CORNER_ALIASES = [
  ['frontLeft', 'fl'],
  ['frontRight', 'fr'],
  ['rearLeft', 'rl'],
  ['rearRight', 'rr'],
] as const;
const SHORT_CORNER_ALIASES = [['fl', 'fl'], ['fr', 'fr'], ['rl', 'rl'], ['rr', 'rr']] as const;
const CORNER_KEYS = [...CORNER_ALIASES.map(([long]) => long), ...SHORT_CORNER_ALIASES.map(([short]) => short)];

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${path} must be an object`);
  return value as Record<string, unknown>;
};

/** Verplichte sleutels moeten aanwezig zijn; extra sleutels alleen uit de allowlist. */
const keysAllowExtra = (value: Record<string, unknown>, required: string[], optional: string[], path: string) => {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw Error(`${path} contains unknown fields`);
  const missing = required.filter((key) => !(key in value));
  if (missing.length) throw Error(`${path} is missing required field ${missing[0]}`);
};

const num = (value: unknown, path: string, min: number, max: number): number | null => {
  // undefined en null betekenen allebei "niet geleverd"; aanwezigheid van verplichte
  // velden is al door keysAllowExtra gecontroleerd.
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw Error(`${path} is invalid`);
  return value;
};

const unit = <T extends string>(value: unknown, allowed: T[], path: string): T | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw Error(`${path} is invalid`);
  return value as T;
};

/** Per-hoek blok: bare getallen, lange én korte hoeknamen, ontbreken = null. */
const cornerValues = (value: unknown, path: string, min: number, max: number): CornerValues => {
  const out: CornerValues = { fl: null, fr: null, rl: null, rr: null };
  if (value === undefined || value === null) return out;
  const r = record(value, path);
  if (Object.keys(r).length === 0) throw Error(`${path} must contain at least one field`);
  keysAllowExtra(r, [], CORNER_KEYS, path);
  for (const [key, corner] of [...CORNER_ALIASES, ...SHORT_CORNER_ALIASES]) {
    // Ontbrekende alias overslaan: anders wist de korte hoeknaam de lange.
    if (r[key] === undefined) continue;
    out[corner] = num(r[key], `${path}.${key}`, min, max);
  }
  return out;
};

const tyre = (value: unknown, path: string): TyreReading | null => {
  if (value === undefined || value === null) return null;
  const r = record(value, path);
  keysAllowExtra(r, ['wearPercent', 'temperature', 'pressure'], [], path);
  return {
    wearPercent: num(r.wearPercent, `${path}.wearPercent`, 0, 100),
    temperature: num(r.temperature, `${path}.temperature`, -100, 1000),
    pressure: num(r.pressure, `${path}.pressure`, 0, 2000),
  };
};

export const parseVehicleTelemetry = (value: unknown): VehicleTelemetry | null => {
  if (value === undefined || value === null) return null;
  const path = 'payload.vehicle';
  const r = record(value, path);
  keysAllowExtra(r, REQUIRED_KEYS, OPTIONAL_KEYS, path);
  if (r.tyreDataMode !== 'last_available') throw Error(`${path}.tyreDataMode makes an unjustified freshness claim`);
  if (r.gear !== null && r.gear !== undefined && (typeof r.gear !== 'string' || !/^(R|N|[0-9]{1,2})$/.test(r.gear))) {
    throw Error(`${path}.gear is invalid`);
  }
  return {
    speedKph: num(r.speedKph, `${path}.speedKph`, 0, 600),
    throttlePct: num(r.throttlePct, `${path}.throttlePct`, 0, 100),
    brakePct: num(r.brakePct, `${path}.brakePct`, 0, 100),
    rpm: num(r.rpm, `${path}.rpm`, 0, 30000),
    gear: (r.gear ?? null) as string | null,
    sector1Seconds: num(r.sector1Seconds, `${path}.sector1Seconds`, 0.001, 86400),
    sector2Seconds: num(r.sector2Seconds, `${path}.sector2Seconds`, 0.001, 86400),
    sector3Seconds: num(r.sector3Seconds, `${path}.sector3Seconds`, 0.001, 86400),
    tyreDataMode: 'last_available',
    pressureUnit: unit(r.pressureUnit, ['psi', 'kPa', 'bar'] as const, `${path}.pressureUnit`),
    temperatureUnit: unit(r.temperatureUnit, ['C', 'F'] as const, `${path}.temperatureUnit`),
    frontLeft: tyre(r.frontLeft, `${path}.frontLeft`),
    frontRight: tyre(r.frontRight, `${path}.frontRight`),
    rearLeft: tyre(r.rearLeft, `${path}.rearLeft`),
    rearRight: tyre(r.rearRight, `${path}.rearRight`),
    // Directe SDK: altijd aanwezig in het resultaat, null als de connector ze niet levert.
    wheelSpeedKph: cornerValues(r.wheelSpeedKph, `${path}.wheelSpeedKph`, 0, 600),
    brakeLinePressureBar: cornerValues(r.brakeLinePressureBar, `${path}.brakeLinePressureBar`, 0, 250),
    steeringWheelAngleDeg: num(r.steeringWheelAngleDeg, `${path}.steeringWheelAngleDeg`, -900, 900),
    latAccelG: num(r.latAccelG, `${path}.latAccelG`, -10, 10),
    longAccelG: num(r.longAccelG, `${path}.longAccelG`, -10, 10),
  };
};
