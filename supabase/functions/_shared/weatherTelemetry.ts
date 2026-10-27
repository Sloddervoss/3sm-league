/**
 * Optioneel V3 root-blok `weather` — baanvocht, regen en luchtdruk.
 *
 * Net als `tyres` en `brakes` staat dit blok naast de bevroren V3-velden: het is
 * volledig optioneel, raakt geen bestaand veld en een payload zonder `weather`
 * blijft geldig. De waarden zijn nodig om te leren hoe banden zich onder natte
 * omstandigheden gedragen; zonder dit blok is nat weer niet van droog te
 * onderscheiden in de steekproef.
 *
 * Regels:
 *  - alles optioneel en nullable; `null` = "niet geleverd", nooit een 0;
 *  - `trackWetnessPct` is een percentage (0 = kurkdroog, 100 = staand water),
 *    niet de iRacing-enum. De connector rekent de enum om; anders moet elke
 *    lezer dezelfde tabel nog eens meenemen;
 *  - `airPressureHpa` is luchtdruk in hPa (numeriek gelijk aan mbar), 800-1100.
 *    Een waarde in inch Hg (29,9) of psi valt daarmee op als zendfout;
 *  - onbekende velden worden geweigerd en een leeg blok is geen meting.
 *
 * Alle foutmeldingen beginnen met `payload.weather…`.
 */

export type WeatherTelemetry = {
  trackWetnessPct: number | null;
  isRaining: boolean | null;
  /** Regenintensiteit 0-100; los van `isRaining`, want motregen en buien verschillen. */
  rainPct: number | null;
  airPressureHpa: number | null;
};

const KEYS = ["trackWetnessPct", "isRaining", "rainPct", "airPressureHpa"];

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error(`${path} must be an object`);
  return value as Record<string, unknown>;
};

const num = (value: unknown, path: string, min: number, max: number): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw Error(`${path} is invalid`);
  if (value < min || value > max) throw Error(`${path} is invalid`);
  return value;
};

const bool = (value: unknown, path: string): boolean | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw Error(`${path} is invalid`);
  return value;
};

export const parseWeatherTelemetry = (value: unknown): WeatherTelemetry | null => {
  if (value === undefined || value === null) return null;
  const path = "payload.weather";
  const r = record(value, path);
  if (Object.keys(r).length === 0) throw Error(`${path} must contain at least one field`);
  const unexpected = Object.keys(r).filter((key) => !KEYS.includes(key));
  if (unexpected.length) throw Error(`${path} contains unknown fields`);
  return {
    trackWetnessPct: num(r.trackWetnessPct, `${path}.trackWetnessPct`, 0, 100),
    isRaining: bool(r.isRaining, `${path}.isRaining`),
    rainPct: num(r.rainPct, `${path}.rainPct`, 0, 100),
    airPressureHpa: num(r.airPressureHpa, `${path}.airPressureHpa`, 800, 1100),
  };
};
