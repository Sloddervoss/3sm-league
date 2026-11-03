/**
 * 0.7.4.0 — bewezen rondetijden uit de connector.
 *
 * De connector stuurt alleen paren die hij kan bewijzen: een ronde die hij zag
 * afsluiten en een tijd die daarna binnenkwam. De server voegt niets samen en
 * gokt niets: wat hier binnenkomt is wat er in de database komt.
 *
 * Nooit fataal. Een ongeldige reeks kost alleen deze reeks, niet het frame met
 * ronde, brandstof en positie.
 */

export type LapTimeEntry = {
  /** De auto waar de tijd bij hoort, zoals de connector hem kent. */
  carId: string;
  /** Sessiesleutel waaronder de ronde is verreden: transport:sessionNum:uniqueId. */
  sessionKey: string;
  lap: number;
  seconds: number;
  source: "sdk";
};

export const LapTimeLimits = {
  entries: 200,
  carIdLength: 64,
  sessionKeyLength: 96,
} as const;

const carIdPattern = /^[A-Za-z0-9 ._\-]{1,64}$/;
const sessionKeyPattern = /^[A-Za-z0-9:._\-]{1,96}$/;

const object = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw Error("lap_times_object");
  return x as Record<string, unknown>;
};

const allowedKeys = ["carId", "sessionKey", "lap", "seconds", "source"];

const keys = (r: Record<string, unknown>) => {
  for (const key of Object.keys(r)) if (!allowedKeys.includes(key)) throw Error("lap_times_keys");
};

const required = (r: Record<string, unknown>, key: string) => {
  if (!(key in r) || r[key] === null || r[key] === undefined) throw Error(`lap_times_missing_${key}`);
  return r[key];
};

export const parseLapTimes = (value: unknown): LapTimeEntry[] | null => {
  if (value === undefined || value === null) return null;
  const list = Array.isArray(value) ? value : (() => { throw Error("lap_times_list"); })();
  if (list.length > LapTimeLimits.entries) throw Error("lap_times_count");

  const seen = new Set<string>();
  const rows: LapTimeEntry[] = [];

  for (const raw of list) {
    const r = object(raw);
    keys(r);

    const carId = required(r, "carId");
    if (typeof carId !== "string" || !carIdPattern.test(carId)) throw Error("lap_times_car");

    const sessionKey = required(r, "sessionKey");
    if (typeof sessionKey !== "string" || !sessionKeyPattern.test(sessionKey)) throw Error("lap_times_session");

    const lap = required(r, "lap");
    if (typeof lap !== "number" || !Number.isInteger(lap) || lap < 1 || lap > 100000) throw Error("lap_times_lap");

    const seconds = required(r, "seconds");
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) {
      throw Error("lap_times_seconds");
    }

    // Alleen de gemeten bron. Een waarde zonder rondebewijs hoort hier niet.
    if (required(r, "source") !== "sdk") throw Error("lap_times_source");

    // Dezelfde ronde twee keer in één frame is geen tweede meting.
    const id = `${carId}\u0000${sessionKey}\u0000${lap}`;
    if (seen.has(id)) continue;
    seen.add(id);

    rows.push({ carId, sessionKey, lap, seconds, source: "sdk" });
  }

  return rows.length ? rows : null;
};

/** Zelfde afspraak als de meetblokken: een fout kost alleen dit blok. */
export const parseLapTimesNeverFatal = (value: unknown): LapTimeEntry[] | null => {
  try {
    return parseLapTimes(value);
  } catch (error) {
    console.warn("[ingest] lapTimes-reeks afgekeurd:", error instanceof Error ? error.message : error);
    return null;
  }
};
