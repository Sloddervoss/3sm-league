import type { EnduranceArchiveTeam } from "../repository/archiveRepository";
import type { EnduranceStintRow } from "../repository/stintsRepository";

/**
 * Rekenwerk voor de archiefdetailpagina (/endurance/archief/:eventId).
 *
 * De pagina zelf is presentatie; alles wat met getallen, volgorde en
 * stintverdeling te maken heeft staat hier, zodat het los van React te testen
 * is. De bronnen zijn de bestaande RPC `get_endurance_archive_summary` (per team
 * rondes, snelste ronde, stops en coureurs) en de bestaande stints-tabel
 * (`endurance_stints`).
 */

/** Vaste kleurenreeks voor de stintbalk; per coureur binnen een team toegewezen. */
export const STINT_COLORS = ["#f97316", "#38bdf8", "#a78bfa", "#34d399", "#fb7185", "#facc15"];

/** Rondetijd als m:ss.hh. Geen meting (null, 0 of onzin) wordt een streepje. */
export const formatLapTime = (seconds: number | null | undefined): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
};

/** Duur in hele minuten als "1 u 12 min" / "48 min". */
export const formatStintDuration = (minutes: number | null | undefined): string => {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "—";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} u` : `${hours} u ${rest} min`;
};

export type ArchiveStanding = {
  teamId: string;
  teamName: string;
  carNumber: string | null;
  laps: number;
  bestLapSeconds: number | null;
  stops: number;
  /** Alleen gevuld als er ook echt telemetrie voor dit team is. */
  position: number | null;
  /** Aantal unieke coureurs dat volgens de RPC in deze auto reed. */
  drivers: string[];
};

/**
 * Uitslagvolgorde: rondes aflopend, dan snelste ronde, dan naam. Teams zonder
 * enige telemetrie krijgen géén positie — een verzonnen klassering zou het
 * archief onwaar maken.
 */
export const rankArchiveTeams = (teams: EnduranceArchiveTeam[]): ArchiveStanding[] => {
  const hasData = (team: EnduranceArchiveTeam) =>
    team.laps > 0 || team.stops > 0 || (team.best_lap_seconds ?? 0) > 0;
  const sorted = [...teams].sort((a, b) => {
    if (b.laps !== a.laps) return b.laps - a.laps;
    const bestA = a.best_lap_seconds ?? Number.POSITIVE_INFINITY;
    const bestB = b.best_lap_seconds ?? Number.POSITIVE_INFINITY;
    if (bestA !== bestB) return bestA - bestB;
    return a.team_name.localeCompare(b.team_name, "nl");
  });
  let position = 0;
  return sorted.map((team) => ({
    teamId: team.team_id,
    teamName: team.team_name,
    carNumber: team.car_number ?? null,
    laps: team.laps ?? 0,
    bestLapSeconds: team.best_lap_seconds ?? null,
    stops: team.stops ?? 0,
    position: hasData(team) ? ++position : null,
    drivers: (team.drivers ?? []).filter((name): name is string => typeof name === "string" && name.length > 0),
  }));
};

export type ArchiveTotals = {
  teams: number;
  laps: number;
  stops: number;
  fastestLapSeconds: number | null;
  drivers: number;
};

/** Totalen over de hele race, voor de statistiekenstrook bovenaan. */
export const archiveTotals = (standings: ArchiveStanding[]): ArchiveTotals => {
  const laps = standings.reduce((sum, team) => sum + team.laps, 0);
  const stops = standings.reduce((sum, team) => sum + team.stops, 0);
  const fastest = standings.reduce<number | null>((best, team) => {
    const lap = team.bestLapSeconds;
    if (lap == null || !Number.isFinite(lap) || lap <= 0) return best;
    return best == null || lap < best ? lap : best;
  }, null);
  const driverNames = new Set<string>();
  for (const team of standings) for (const name of team.drivers) driverNames.add(name);
  return { teams: standings.length, laps, stops, fastestLapSeconds: fastest, drivers: driverNames.size };
};

/** Een stint zoals hij in de race echt gereden is. */
export type DrivenStint = {
  id: string;
  teamId: string;
  driverId: string | null;
  startAt: string;
  endAt: string;
  minutes: number;
  status: EnduranceStintRow["status"];
};

/**
 * Stints die daadwerkelijk op de baan waren: `expired` is een planning die nooit
 * is gaan lopen, dus die hoort niet in een uitslag van een afgeronde race.
 */
export const drivenStints = (rows: EnduranceStintRow[]): DrivenStint[] =>
  rows
    .filter((row) => row.status !== "expired")
    .map((row) => {
      const startAt = row.actual_start_at ?? row.original_start_at;
      const endAt = row.actual_end_at ?? row.original_end_at;
      const minutes = (Date.parse(endAt) - Date.parse(startAt)) / 60_000;
      return {
        id: row.id,
        teamId: row.team_id,
        driverId: row.driver_id,
        startAt,
        endAt,
        minutes,
        status: row.status,
      };
    })
    .filter((stint) => Number.isFinite(stint.minutes) && stint.minutes > 0)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || Date.parse(a.endAt) - Date.parse(b.endAt));

/** Stints per team, in racetijd gesorteerd. */
export const groupStintsByTeam = (stints: DrivenStint[]): Map<string, DrivenStint[]> => {
  const grouped = new Map<string, DrivenStint[]>();
  for (const stint of stints) {
    const list = grouped.get(stint.teamId);
    if (list) list.push(stint);
    else grouped.set(stint.teamId, [stint]);
  }
  return grouped;
};

export const unknownDriverLabel = "Onbekende coureur";

/** Naam van een coureur, met een eerlijke terugval als het profiel ontbreekt. */
export const driverLabel = (driverId: string | null, nameOf: (id: string) => string | undefined): string => {
  if (!driverId) return "Geen coureur";
  const name = nameOf(driverId)?.trim();
  return name ? name : unknownDriverLabel;
};

export type StintSegment = DrivenStint & {
  driverName: string;
  color: string;
  /** Positie en breedte op de balk, in procenten van het racevenster. */
  leftPct: number;
  widthPct: number;
};

export type RaceWindow = { startAt: string; endAt: string };

/**
 * Verdeelt de stints van één team over een balk. De balk loopt over het
 * racevenster (start–einde van het event), zodat gaten tussen stints zichtbaar
 * blijven; alleen als dat venster ontbreekt valt hij terug op de stints zelf.
 */
export const buildStintSegments = (
  stints: DrivenStint[],
  window: RaceWindow,
  nameOf: (id: string) => string | undefined,
): StintSegment[] => {
  if (!stints.length) return [];
  const start = Date.parse(window.startAt);
  const end = Date.parse(window.endAt);
  const firstStint = Date.parse(stints[0].startAt);
  const lastStint = Math.max(...stints.map((stint) => Date.parse(stint.endAt)));
  const span = end > start ? end - start : lastStint - firstStint;
  const origin = end > start ? start : firstStint;
  const colorByDriver = new Map<string, string>();

  return stints.map((stint) => {
    const key = stint.driverId ?? "";
    if (!colorByDriver.has(key)) colorByDriver.set(key, STINT_COLORS[colorByDriver.size % STINT_COLORS.length]);
    const from = Date.parse(stint.startAt);
    const to = Date.parse(stint.endAt);
    const left = span > 0 ? ((from - origin) / span) * 100 : 0;
    const width = span > 0 ? ((to - from) / span) * 100 : 100;
    return {
      ...stint,
      driverName: driverLabel(stint.driverId, nameOf),
      color: colorByDriver.get(key) as string,
      leftPct: Math.min(100, Math.max(0, left)),
      widthPct: Math.min(100, Math.max(1, width)),
    };
  });
};

export type DriverStintTotal = {
  driverId: string | null;
  driverName: string;
  color: string;
  stints: number;
  minutes: number;
};

/** Rijtijd per coureur binnen één team, aflopend op tijd. */
export const driverStintTotals = (segments: StintSegment[]): DriverStintTotal[] => {
  const totals = new Map<string, DriverStintTotal>();
  for (const segment of segments) {
    const key = segment.driverId ?? "";
    const existing = totals.get(key);
    if (existing) {
      existing.stints += 1;
      existing.minutes += segment.minutes;
    } else {
      totals.set(key, {
        driverId: segment.driverId,
        driverName: segment.driverName,
        color: segment.color,
        stints: 1,
        minutes: segment.minutes,
      });
    }
  }
  return [...totals.values()].sort((a, b) => b.minutes - a.minutes);
};
