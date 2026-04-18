export type ImportRow = {
  position: number;
  display_name: string;
  laps: number;
  best_lap: string;
  incidents: number;
  fastest_lap: boolean;
  iracing_cust_id?: string;
  new_irating?: number;
  new_license_level?: number;
  new_license_sub_level?: number;
  car_name?: string;
  dnf?: boolean;
};

export type ProfileRow = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  iracing_id: string | number | null;
};

export type RaceOption = {
  id: string;
  name: string;
  track: string;
  race_date: string;
  league_id: string | null;
};

export type IRacingJsonResult = {
  finish_position: number;
  display_name: string;
  cust_id: number;
  laps_complete: number;
  best_lap_time: number;
  incidents: number;
  newi_rating?: number;
  new_license_level?: number;
  new_sub_level?: number;
  car_name?: string;
  livery?: { car_name?: string };
  reason_out_id?: number;
  reason_out?: string;
};

export type IRacingJsonSession = {
  simsession_type?: number;
  simsession_type_name?: string;
  simsession_number?: number;
  results?: IRacingJsonResult[];
};

export function parseLapMs(s: string): number {
  const m = s.match(/^(\d+):(\d+)[.,](\d+)$/);
  if (!m) return Infinity;
  return parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000 + parseInt(m[3].padEnd(3, "0").slice(0, 3));
}

export function formatIRacingLapTime(us: number): string {
  if (!us || us < 0) return "";
  const totalMs = Math.round(us / 10);
  const mins = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${mins}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function matchProfileForImportRow(
  row: ImportRow,
  profiles: ProfileRow[]
): ProfileRow | undefined {
  return profiles.find(
    (p) =>
      (row.iracing_cust_id && String(p.iracing_id) === String(row.iracing_cust_id)) ||
      (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
      (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
  );
}
