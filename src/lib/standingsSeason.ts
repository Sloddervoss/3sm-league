export type StandingsLeague = {
  id: string;
};

export type StandingsSeasonRace = {
  league_id: string | null;
  race_date: string;
  status: string;
};

const isTerminalRace = (status: string) => status === "completed" || status === "cancelled";

export const selectDefaultStandingsLeagueId = (
  leagues: StandingsLeague[],
  races: StandingsSeasonRace[],
): string | null => {
  if (!leagues.length) return null;

  const leagueIds = new Set(leagues.map((league) => league.id));
  const leagueRaces = races.filter((race) => race.league_id && leagueIds.has(race.league_id));

  const nextActiveRace = leagueRaces
    .filter((race) => !isTerminalRace(race.status))
    .sort((a, b) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime())[0];
  if (nextActiveRace?.league_id) return nextActiveRace.league_id;

  const latestFinishedRace = leagueRaces
    .filter((race) => isTerminalRace(race.status))
    .sort((a, b) => new Date(b.race_date).getTime() - new Date(a.race_date).getTime())[0];

  return latestFinishedRace?.league_id || leagues[0].id;
};
