/**
 * Live standings — herbruikbare widget, nog nergens aangeplant.
 *
 * Bouwt uit de endurance-teams + de nieuwste telemetry per team één klassement:
 * 1 regel per TEAM/auto, gesorteerd op voltooide ronden (o.a. eerst) en dan op
 * algemene positie (a.h.w. eindklassement-proxy). Voor multi-rijdersteams wordt
 * de meest recente snapshot van het team genomen (wie er nu in de auto zit).
 */
export interface LiveStandingsTeamSource {
  id: string;
  name: string;
  carNumber: string | null;
  carId: string | null;
  livery: string | null;
}

export interface LiveTelemetrySource {
  endurance_team_id: string | null;
  received_at: string;
  current_driver_name: string | null;
  car_name: string | null;
  telemetry: unknown;
}

export interface StandingLine {
  rank: number;
  teamId: string;
  teamName: string;
  carNumber: string | null;
  carId: string | null;
  carName: string | null;
  livery: string | null;
  currentDriverName: string | null;
  position: number | null;
  classPosition: number | null;
  completedLaps: number | null;
  lastLapSeconds: number | null;
  inPitLane: boolean | null;
  flag: string | null;
  sessionTimeSeconds: number | null;
  hasLiveData: boolean;
}

const asNum = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const asBool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const asStr = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** Pakt de veilige publieks-velden uit het telemetry-jsonb-object. */
export const publicTelemetry = (telemetry: unknown) => {
  const t = telemetry && typeof telemetry === "object" ? (telemetry as Record<string, unknown>) : {};
  return {
    position: asNum(t.position),
    classPosition: asNum(t.classPosition),
    completedLaps: asNum(t.completedLaps),
    lastLapSeconds: asNum(t.lapTimeSeconds),
    inPitLane: asBool(t.inPitLane),
    pitLimiter: asBool(t.pitLimiter),
    flag: asStr(t.flag) ?? null,
    sessionTimeSeconds: asNum(t.sessionTimeSeconds),
  };
};

const emptyTelemetry = () => ({
  position: null,
  classPosition: null,
  completedLaps: null,
  lastLapSeconds: null,
  inPitLane: null,
  pitLimiter: null,
  flag: null,
  sessionTimeSeconds: null,
});

export const buildStandings = (
  teams: LiveStandingsTeamSource[],
  latestSource: LiveTelemetrySource[],
): StandingLine[] => {
  // Nieuwste snapshot per team.
  const newest = new Map<string, LiveTelemetrySource>();
  for (const row of latestSource) {
    if (!row.endurance_team_id || typeof row.received_at !== "string") continue;
    const current = newest.get(row.endurance_team_id);
    if (!current || Date.parse(row.received_at) > Date.parse(current.received_at)) {
      newest.set(row.endurance_team_id, row);
    }
  }

  const lines: StandingLine[] = teams.map((team) => {
    const live = newest.get(team.id);
    const telemetry = live ? publicTelemetry(live.telemetry) : emptyTelemetry();
    return {
      rank: 0,
      teamId: team.id,
      teamName: team.name,
      carNumber: team.carNumber,
      carId: team.carId,
      carName: live?.car_name ?? null,
      livery: team.livery,
      currentDriverName: live?.current_driver_name ?? null,
      ...telemetry,
      hasLiveData: Boolean(live) && (telemetry.completedLaps != null || telemetry.position != null),
    };
  });

  const sortKey = (line: StandingLine) => [
    line.hasLiveData ? 0 : 1,
    line.completedLaps == null ? Infinity : -line.completedLaps,
    line.position == null ? Infinity : line.position,
    line.teamName.toLocaleLowerCase(),
  ];
  lines.sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    }
    return 0;
  });

  lines.forEach((line, index) => {
    line.rank = index + 1;
  });
  return lines;
};