/**
 * Coureurswissel.
 *
 * Twee fouten zijn hier duur:
 *
 * 1. Alleen naar pace kijken. De snelste coureur in de verkeerde stint kost meer
 *    dan de langzaamste op het juiste moment, en een wissel die niet samenvalt
 *    met een tankstop kost een extra stop.
 * 2. De iRacing-regel negeren: elke coureur moet minstens 25% van zijn gelijke
 *    deel rijden. Wie dat niet haalt, wordt gediskwalificeerd. Eerlijkheid is dus
 *    geen wens maar een harde randvoorwaarde.
 */

export interface RotationDriver {
  id: string;
  name: string;
  /** Rondetijd in seconden, of null als er nog geen pace is. */
  lapSeconds: number | null;
  /** Beschikbaar vanaf deze minuut in de race. */
  availableFromMinute?: number;
  /** Beschikbaar tot deze minuut; daarna niet meer inzetbaar. */
  availableUntilMinute?: number;
  /** Maximale stintlengte in minuten, bijvoorbeeld door een teamafspraak. */
  maxStintMinutes?: number;
}

export interface RotationInput {
  totalMinutes: number;
  /** Rondes die een volle tank meegaat, omgezet naar minuten. */
  stintMinutes: number;
  /** Tijd die een coureurswissel kost bovenop de tankstop, in seconden. */
  driverChangeSeconds?: number;
  /** Referentierondetijd van het team; nodig om pace in tijd om te rekenen. */
  referenceLapSeconds: number;
  /** Minimumdeel van het gelijke deel dat iRacing eist (0.25). */
  fairShareFraction?: number;
  drivers: RotationDriver[];
}

export interface PlannedStint {
  index: number;
  driverId: string;
  driverName: string;
  startMinute: number;
  endMinute: number;
  /** Duur in minuten. */
  minutes: number;
  /** True als er bij de start van deze stint een coureurswissel is. */
  driverChange: boolean;
}

export interface RotationPlan {
  stints: PlannedStint[];
  /** Rijtijd per coureur in minuten. */
  minutesPerDriver: Record<string, number>;
  /** Gelijke deling in minuten. */
  equalShareMinutes: number;
  /** Wat iRacing minimaal eist per coureur. */
  minimumMinutes: number;
  /** True als elke coureur aan de minimumdeel-regel voldoet. */
  fairShareSatisfied: boolean;
  /** Geschat tijdsverlies door paceverschil en wissels, in seconden. */
  estimatedCostSeconds: number;
  reasonCode: string;
}

/**
 * Bouwt een stintplanning. Deterministisch: bij gelijke kosten wint de coureur
 * die het minst heeft gereden, daarna de snelste, daarna de id.
 */
export function planRotation(input: RotationInput): RotationPlan {
  const {
    totalMinutes,
    stintMinutes,
    referenceLapSeconds,
    drivers,
    driverChangeSeconds = 0,
    fairShareFraction = 0.25,
  } = input;

  const leeg = (reasonCode: string): RotationPlan => ({
    stints: [],
    minutesPerDriver: {},
    equalShareMinutes: 0,
    minimumMinutes: 0,
    fairShareSatisfied: false,
    estimatedCostSeconds: 0,
    reasonCode,
  });

  if (drivers.length === 0) return leeg("no_drivers");
  if (totalMinutes <= 0) return leeg("no_duration");
  if (stintMinutes <= 0) return leeg("no_stint_capacity");

  const equalShare = totalMinutes / drivers.length;
  const minimum = equalShare * fairShareFraction;

  const gereden: Record<string, number> = {};
  for (const d of drivers) gereden[d.id] = 0;

  const stints: PlannedStint[] = [];
  let klok = 0;
  let index = 0;

  while (klok < totalMinutes - 0.01 && index < 96) {
    const beschikbaar = drivers.filter((d) => {
      const vanaf = d.availableFromMinute ?? 0;
      const tot = d.availableUntilMinute ?? Number.POSITIVE_INFINITY;
      const max = d.maxStintMinutes ?? Number.POSITIVE_INFINITY;
      const magNog = gereden[d.id] < max;
      return klok >= vanaf && klok < tot && magNog;
    });

    if (beschikbaar.length === 0) return leeg("no_available_driver");

    // Wie nog onder zijn minimumdeel zit, gaat voor; anders is de race ongeldig.
    const onderMinimum = beschikbaar.filter((d) => gereden[d.id] < minimum);
    const kandidaten = onderMinimum.length > 0 ? onderMinimum : beschikbaar;

    const gekozen = [...kandidaten].sort((a, b) => {
      const verschil = gereden[a.id] - gereden[b.id];
      if (Math.abs(verschil) > 0.01) return verschil;
      const paceA = a.lapSeconds ?? referenceLapSeconds;
      const paceB = b.lapSeconds ?? referenceLapSeconds;
      if (paceA !== paceB) return paceA - paceB;
      return a.id.localeCompare(b.id);
    })[0];

    const nogTeGaan = totalMinutes - klok;
    const maxRest = gekozen.maxStintMinutes ?? Number.POSITIVE_INFINITY;
    const totBeschikbaar = (gekozen.availableUntilMinute ?? Number.POSITIVE_INFINITY) - klok;
    const lengte = Math.max(
      0,
      Math.min(stintMinutes, nogTeGaan, maxRest, totBeschikbaar),
    );

    if (lengte < 0.01) return leeg("stint_constraint_conflict");

    stints.push({
      index,
      driverId: gekozen.id,
      driverName: gekozen.name,
      startMinute: round1(klok),
      endMinute: round1(klok + lengte),
      minutes: round1(lengte),
      driverChange: index > 0,
    });

    gereden[gekozen.id] += lengte;
    klok += lengte;
    index += 1;
  }

  // Tijdsverlies: paceverschil per stint plus de wisseltijd.
  let verlies = 0;
  for (const stint of stints) {
    const coureur = drivers.find((d) => d.id === stint.driverId)!;
    const pace = coureur.lapSeconds ?? referenceLapSeconds;
    const rondes = (stint.minutes * 60) / referenceLapSeconds;
    verlies += Math.max(0, pace - referenceLapSeconds) * rondes;
  }
  verlies += Math.max(0, stints.length - 1) * driverChangeSeconds;

  const eerlijk = drivers.every((d) => gereden[d.id] + 1e-9 >= minimum);

  return {
    stints,
    minutesPerDriver: Object.fromEntries(
      Object.entries(gereden).map(([id, m]) => [id, round1(m)]),
    ),
    equalShareMinutes: round1(equalShare),
    minimumMinutes: round1(minimum),
    fairShareSatisfied: eerlijk,
    estimatedCostSeconds: Math.round(verlies),
    reasonCode: eerlijk ? "ok" : "fair_share_violated",
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
