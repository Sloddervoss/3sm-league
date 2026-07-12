export type RegistrationWindowRace = {
  race_date: string;
  status: string | null;
};

/**
 * The only public registration window: a race must be explicitly upcoming and
 * still be in the future. Keep this separate from display/live-race logic.
 */
export function isRaceRegistrationOpen(
  race: RegistrationWindowRace,
  now: Date = new Date(),
): boolean {
  return race.status === "upcoming" && new Date(race.race_date).getTime() > now.getTime();
}

export function isActiveRaceRegistration(status: string | null | undefined): boolean {
  return status !== "withdrawn";
}
