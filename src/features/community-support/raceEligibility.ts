export type RaceCostEligibilityInput = {
  raceScope?: "season" | "standalone";
  leagueId?: string | null;
  leagueName?: string | null;
  raceName?: string | null;
  raceFormat?: string | null;
};

const SUPPORTED_RACE_FORMATS = new Set(["feature", "sprint"]);
const ENDURANCE_SIGNAL = /endurance/i;

/**
 * Fail-closed eligibility for the Community Support prototype.
 *
 * Existing standalone races created before race_type became mandatory are the
 * only supported untyped records. Every named format must be explicitly
 * allowlisted, and any endurance signal wins over the allowlist.
 */
export const isSupportedCommunitySupportRace = (race: RaceCostEligibilityInput) => {
  if (!race.raceScope || !race.raceName?.trim()) return false;
  if (ENDURANCE_SIGNAL.test(`${race.raceFormat ?? ""} ${race.leagueName ?? ""} ${race.raceName}`)) return false;

  const format = race.raceFormat?.trim().toLowerCase() ?? "";
  if (format) return SUPPORTED_RACE_FORMATS.has(format);

  return race.raceScope === "standalone" && !race.leagueId;
};
