export type SpProfile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
};

export type SpPenalty = {
  id: string;
  user_id: string;
  race_id: string;
  league_id: string | null;
  penalty_sp: number | null;
  penalty_type: string | null;
  penalty_category: string | null;
  reason: string | null;
  created_at: string;
  races: {
    id: string;
    name: string;
    race_date: string;
    league_id: string | null;
    leagues: { name: string; season: string | number | null } | null;
  } | null;
  profile: SpProfile | null;
};

export type SpRaceHistory = {
  user_id: string;
  race_id: string;
  races: { id: string; race_date: string; league_id: string | null } | null;
};

export type DriverSpOverviewEntry = {
  userId: string;
  leagueId: string | null;
  leagueName: string | null;
  profile: SpProfile | null;
  totalSp: number;
  activePenalties: SpPenalty[];
  racesUntilExpiry: number;
};

/**
 * Legacy steward policy: penalty points expire after the driver's next six
 * results in the same league context. Unknown/missing history stays active so
 * a driver never loses a penalty merely because their result history is late.
 */
export function calculateActiveSpOverview(penalties: SpPenalty[], raceHistory: SpRaceHistory[]): DriverSpOverviewEntry[] {
  if (!penalties.length) return [];

  const racesByContext = new Map<string, { race_id: string; race_date: string }[]>();
  for (const result of raceHistory) {
    const leagueId = result.races?.league_id ?? null;
    const key = `${result.user_id}__${leagueId}`;
    const contextRaces = racesByContext.get(key) || [];
    contextRaces.push({ race_id: result.race_id, race_date: result.races?.race_date ?? "" });
    racesByContext.set(key, contextRaces);
  }
  racesByContext.forEach((contextRaces) => contextRaces.sort((a, b) => new Date(b.race_date).getTime() - new Date(a.race_date).getTime()));

  const grouped = new Map<string, { userId: string; leagueId: string | null; leagueName: string | null; penalties: SpPenalty[]; profile: SpProfile | null }>();
  for (const penalty of penalties) {
    const leagueId = penalty.races?.league_id ?? null;
    const league = penalty.races?.leagues;
    const leagueName = league ? `${league.name}${league.season ? ` S${league.season}` : ""}` : null;
    const key = `${penalty.user_id}__${leagueId}`;
    const entry = grouped.get(key) || { userId: penalty.user_id, leagueId, leagueName, penalties: [], profile: penalty.profile };
    entry.penalties.push(penalty);
    grouped.set(key, entry);
  }

  const overview: DriverSpOverviewEntry[] = [];
  for (const [key, entry] of grouped) {
    const last6 = (racesByContext.get(key) || []).slice(0, 6);
    const contextRaceIds = last6.map((race) => race.race_id);
    const activePenalties = entry.penalties.filter((penalty) => {
      if (contextRaceIds.length === 0 || contextRaceIds.includes(penalty.race_id)) return true;
      const penaltyDate = penalty.races?.race_date;
      if (!penaltyDate) return true;
      const cutoffDate = last6.length === 6 ? last6[5].race_date : null;
      return !cutoffDate || penaltyDate >= cutoffDate;
    });
    const totalSp = activePenalties.reduce((sum, penalty) => sum + (penalty.penalty_sp || 0), 0);
    if (totalSp <= 0) continue;

    const oldestPenaltyRaceId = activePenalties[activePenalties.length - 1]?.race_id;
    const oldestIndex = contextRaceIds.indexOf(oldestPenaltyRaceId);
    overview.push({
      userId: entry.userId,
      leagueId: entry.leagueId,
      leagueName: entry.leagueName,
      profile: entry.profile,
      totalSp,
      activePenalties,
      racesUntilExpiry: oldestIndex >= 0 ? oldestIndex + 1 : 1,
    });
  }

  return overview.sort((a, b) => b.totalSp - a.totalSp);
}
