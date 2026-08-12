export type RaceLeagueSummary = {
  id: string;
  name: string;
  car_class: string | null;
  season: string | null;
};

export type RaceWithLeagueSummary = {
  id: string;
  name: string;
  track: string;
  iracing_track_id: number | null;
  race_date: string;
  league_id: string | null;
  status: string | null;
  round: number | null;
  race_type: string | null;
  race_duration: string | null;
  practice_duration: string | null;
  qualifying_duration: string | null;
  start_type: string | null;
  weather: string | null;
  setup: string | null;
  lobby_name: string | null;
  lobby_password: string | null;
  lobby_reveal_minutes: number | null;
  leagues: RaceLeagueSummary | null;
};
