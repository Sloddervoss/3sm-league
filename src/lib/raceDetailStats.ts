export type RaceDetailStatsResult = {
  user_id: string;
  position: number | null;
  start_position: number | null;
  laps: number | null;
  laps_led: number | null;
  best_lap: string | null;
  best_lap_num: number | null;
  avg_lap: string | null;
  fastest_lap: boolean | null;
  incidents: number | null;
  dnf: boolean | null;
  points: number | null;
  gap_to_leader?: string | null;
  car_name?: string | null;
  club_name?: string | null;
  country_code?: string | null;
  reason_out?: string | null;
  profiles: {
    display_name: string | null;
    iracing_name: string | null;
  } | null;
};

export type RaceDetailDriver = RaceDetailStatsResult & {
  name: string;
  positionGain?: number;
};

export type RaceGapLabels = {
  lap: string;
  laps: string;
};

export const formatRaceGapDisplay = (
  result: Pick<RaceDetailStatsResult, "position" | "laps" | "dnf" | "gap_to_leader">,
  leaderLaps: number | null | undefined,
  labels: RaceGapLabels,
) => {
  if (result.dnf) return "DNF";
  if (result.position === 1) return "—";
  if (result.gap_to_leader) return result.gap_to_leader.startsWith("+") ? result.gap_to_leader : `+${result.gap_to_leader}`;

  if (leaderLaps != null && result.laps != null) {
    const lapsBehind = leaderLaps - result.laps;
    if (lapsBehind > 0) return `+${lapsBehind} ${lapsBehind === 1 ? labels.lap : labels.laps}`;
  }

  return "-";
};

const driverName = (result: RaceDetailStatsResult) =>
  result.profiles?.iracing_name || result.profiles?.display_name || "Onbekend";

const byPosition = (a: RaceDetailStatsResult, b: RaceDetailStatsResult) =>
  (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);

export const withDriverNames = (results: RaceDetailStatsResult[]): RaceDetailDriver[] =>
  [...results].sort(byPosition).map((result) => ({ ...result, name: driverName(result) }));

export const getRaceDetailStats = (results: RaceDetailStatsResult[]) => {
  const sorted = withDriverNames(results);
  const finishers = sorted.filter((result) => !result.dnf);
  const incidentsKnown = sorted.filter((result) => result.incidents != null);
  const withStartPositions = sorted.filter((result) => result.start_position != null && result.position != null);

  const biggestMover = withStartPositions.reduce<RaceDetailDriver | null>((best, result) => {
    const gain = (result.start_position ?? 0) - (result.position ?? 0);
    if (gain <= 0) return best;
    if (!best) return { ...result, positionGain: gain };
    const bestGain = best.positionGain ?? ((best.start_position ?? 0) - (best.position ?? 0));
    if (gain > bestGain) return { ...result, positionGain: gain };
    if (gain === bestGain && (result.position ?? 99) < (best.position ?? 99)) return { ...result, positionGain: gain };
    return best;
  }, null);

  const cleanest = finishers
    .filter((result) => result.incidents != null)
    .reduce<RaceDetailDriver | null>((best, result) => {
      if (!best) return result;
      const currentIncidents = result.incidents ?? Number.MAX_SAFE_INTEGER;
      const bestIncidents = best.incidents ?? Number.MAX_SAFE_INTEGER;
      if (currentIncidents < bestIncidents) return result;
      if (currentIncidents === bestIncidents && (result.position ?? 99) < (best.position ?? 99)) return result;
      return best;
    }, null);

  return {
    sorted,
    podium: finishers.slice(0, 3),
    winner: finishers[0] ?? null,
    pole: sorted.find((result) => result.start_position === 1) ?? null,
    fastest: sorted.find((result) => result.fastest_lap) ?? null,
    biggestMover,
    mostLapsLed: sorted.reduce<RaceDetailDriver | null>((best, result) => {
      if (!result.laps_led) return best;
      if (!best || result.laps_led > (best.laps_led ?? 0)) return result;
      if (result.laps_led === best.laps_led && (result.position ?? 99) < (best.position ?? 99)) return result;
      return best;
    }, null),
    cleanest,
    finishers: finishers.length,
    dnfCount: sorted.filter((result) => result.dnf).length,
    totalIncidents: incidentsKnown.reduce((sum, result) => sum + (result.incidents ?? 0), 0),
    hasIncidentData: incidentsKnown.length > 0,
    totalLaps: sorted.reduce((sum, result) => sum + (result.laps ?? 0), 0),
    maxLaps: sorted.reduce((max, result) => Math.max(max, result.laps ?? 0), 0),
  };
};
