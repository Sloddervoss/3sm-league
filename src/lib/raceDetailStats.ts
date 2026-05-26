export type RaceDetailStatsResult = {
  user_id: string;
  position: number | null;
  laps: number | null;
  best_lap: string | null;
  fastest_lap: boolean | null;
  incidents: number | null;
  dnf: boolean | null;
  points: number | null;
  profiles: {
    display_name: string | null;
    iracing_name: string | null;
  } | null;
};

export type RaceDetailDriver = RaceDetailStatsResult & {
  name: string;
};

const driverName = (result: RaceDetailStatsResult) =>
  result.profiles?.display_name || result.profiles?.iracing_name || "Onbekend";

const byPosition = (a: RaceDetailStatsResult, b: RaceDetailStatsResult) =>
  (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);

export const withDriverNames = (results: RaceDetailStatsResult[]): RaceDetailDriver[] =>
  [...results].sort(byPosition).map((result) => ({ ...result, name: driverName(result) }));

export const getRaceDetailStats = (results: RaceDetailStatsResult[]) => {
  const sorted = withDriverNames(results);
  const finishers = sorted.filter((result) => !result.dnf);
  const incidentsKnown = sorted.filter((result) => result.incidents != null);

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
    fastest: sorted.find((result) => result.fastest_lap) ?? null,
    cleanest,
    finishers: finishers.length,
    dnfCount: sorted.filter((result) => result.dnf).length,
    totalIncidents: incidentsKnown.reduce((sum, result) => sum + (result.incidents ?? 0), 0),
    hasIncidentData: incidentsKnown.length > 0,
    totalLaps: sorted.reduce((sum, result) => sum + (result.laps ?? 0), 0),
  };
};
