export type StandingsLeague = {
  id: string;
};

/** Embedded PostgREST-aggregaat: `race_results(count)`. */
export type StandingsResultCount = { count: number }[] | null;

export type StandingsSeasonRace = {
  league_id: string | null;
  race_date: string;
  status: string;
  /** Aantal uitslagrijen van deze race (embedded count). */
  race_results?: StandingsResultCount;
};

const isTerminalRace = (status: string) => status === "completed" || status === "cancelled";

/** Aantal uitslagrijen van een race; 0 als de telling ontbreekt. */
export const resultRowCount = (race: StandingsSeasonRace): number => {
  const count = race.race_results?.[0]?.count;
  return typeof count === "number" && count > 0 ? count : 0;
};

/**
 * Kiest de league die standaard open moet op /standings/.
 *
 * Volgorde:
 *  1. De league van de meest recente race die al uitslagen heeft. Dat is het
 *     seizoen dat daadwerkelijk loopt. Een net gestart seizoen zonder
 *     uitslagen wint hier niet van een seizoen waar al gereden is — anders
 *     opent de pagina leeg zodra er een nieuwe kalender klaarstaat.
 *  2. Nog nergens uitslagen? Dan de league van de eerstvolgende race.
 *  3. Anders de league van de laatst afgeronde race.
 *  4. Anders de eerste league.
 */
export const selectDefaultStandingsLeagueId = (
  leagues: StandingsLeague[],
  races: StandingsSeasonRace[],
): string | null => {
  if (!leagues.length) return null;

  const leagueIds = new Set(leagues.map((league) => league.id));
  const leagueRaces = races.filter((race) => race.league_id && leagueIds.has(race.league_id));

  const latestRaceWithResults = leagueRaces
    .filter((race) => resultRowCount(race) > 0)
    .sort((a, b) => new Date(b.race_date).getTime() - new Date(a.race_date).getTime())[0];
  if (latestRaceWithResults?.league_id) return latestRaceWithResults.league_id;

  const nextActiveRace = leagueRaces
    .filter((race) => !isTerminalRace(race.status))
    .sort((a, b) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime())[0];
  if (nextActiveRace?.league_id) return nextActiveRace.league_id;

  const latestFinishedRace = leagueRaces
    .filter((race) => isTerminalRace(race.status))
    .sort((a, b) => new Date(b.race_date).getTime() - new Date(a.race_date).getTime())[0];

  return latestFinishedRace?.league_id || leagues[0].id;
};
