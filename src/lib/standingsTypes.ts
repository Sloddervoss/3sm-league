export type StandingsRaceResult = {
  user_id: string;
  position: number | null;
  points: number | null;
  fastest_lap?: boolean | null;
  race_id: string;
  races: { league_id: string | null } | null;
};

export type StandingsProfile = {
  user_id: string;
  display_name: string | null;
  team_id: string | null;
};

export type StandingTeam = {
  id: string;
  name: string;
  color: string | null;
};

export type StandingRow = {
  user_id: string;
  display_name: string;
  total_points: number;
  wins: number;
  podiums?: number;
  fl?: number;
  team?: { name: string; color: string | null };
};

export type DriverModalProfile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  iracing_id: number | null;
  irating: number | null;
  safety_rating: string | null;
  team_id: string | null;
  avatar_url: string | null;
};
