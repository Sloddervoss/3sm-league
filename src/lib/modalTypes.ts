export type MembershipProfile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  irating: number | null;
  safety_rating: string | null;
};

export type MembershipWithProfile = {
  id: string;
  team_id: string;
  user_id: string;
  role: string | null;
  profiles: MembershipProfile | null;
};

export type RaceRef = {
  name: string;
  track: string;
  race_date: string;
  leagues: { name: string } | null;
};

export type ResultWithRace = {
  id: string;
  user_id: string;
  race_id: string;
  position: number | null;
  points: number | null;
  races: RaceRef | null;
};
