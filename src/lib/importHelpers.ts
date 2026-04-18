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

export type ParseImportResult =
  | { rows: ImportRow[]; error?: undefined }
  | { rows?: undefined; error: string };

export function parseCsvRows(text: string): ParseImportResult {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { error: "CSV lijkt leeg" };

  let headerLineIdx = 0;
  for (let li = 0; li < Math.min(lines.length, 5); li++) {
    const l = lines[li].toLowerCase();
    if (l.includes("fin pos") || l.includes("finpos") || l.startsWith('"fin pos"')) {
      headerLineIdx = li;
      break;
    }
  }
  const header = lines[headerLineIdx].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
  const finPosIdx      = header.findIndex(h => h === "fin pos" || h === "finpos" || h === "pos" || h === "finish");
  const custIdIdx      = header.findIndex(h => h === "cust id" || h.includes("custid") || h.includes("customerid"));
  const nameIdx        = header.findIndex(h => h === "name" || h.includes("display name") || h.includes("driver"));
  const lapsIdx        = header.findIndex(h => h === "laps comp" || h === "laps" || h === "laps completed");
  const bestLapIdx     = header.findIndex(h => h === "fastest lap time" || h.includes("best lap") || h.includes("bestlap") || h.includes("fastest lap"));
  const incIdx         = header.findIndex(h => h === "inc" || h.includes("incident"));
  const newIRatingIdx  = header.findIndex(h => h === "new irating");
  const newLicLevelIdx = header.findIndex(h => h === "new license level");
  const newLicSubIdx   = header.findIndex(h => h === "new license sub-level");

  const rows = lines.slice(headerLineIdx + 1).map((line, i) => {
    const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
    if (cols.length < 3) return null;
    return {
      position:            finPosIdx >= 0      ? parseInt(cols[finPosIdx]) || i + 1     : i + 1,
      display_name:        nameIdx >= 0        ? cols[nameIdx]                           : `Driver ${i + 1}`,
      laps:                lapsIdx >= 0        ? parseInt(cols[lapsIdx]) || 0            : 0,
      best_lap:            bestLapIdx >= 0     ? cols[bestLapIdx]                        : "",
      incidents:           incIdx >= 0         ? parseInt(cols[incIdx]) || 0             : 0,
      fastest_lap:         false,
      iracing_cust_id:     custIdIdx >= 0      ? cols[custIdIdx]                         : undefined,
      new_irating:         newIRatingIdx >= 0 && cols[newIRatingIdx]              ? parseInt(cols[newIRatingIdx])  : undefined,
      new_license_level:   newLicLevelIdx >= 0 && cols[newLicLevelIdx]            ? parseInt(cols[newLicLevelIdx]) : undefined,
      new_license_sub_level: newLicSubIdx >= 0 && cols[newLicSubIdx] !== ""       ? parseInt(cols[newLicSubIdx])   : undefined,
    } satisfies ImportRow;
  }).filter((r): r is ImportRow => !!r && !!r.display_name && !isNaN(r.position));

  const withLaps = rows.filter(r => r.best_lap && parseLapMs(r.best_lap) < Infinity);
  if (withLaps.length) {
    const fastest = withLaps.reduce((a, b) => parseLapMs(a.best_lap) < parseLapMs(b.best_lap) ? a : b);
    fastest.fastest_lap = true;
  }

  if (rows.length === 0) return { error: "Geen geldige rijen gevonden in CSV" };
  return { rows };
}

export function parseIRacingJsonRows(jsonText: string): ParseImportResult {
  try {
    const json = JSON.parse(jsonText);
    const root = ((json as { data?: unknown }).data ?? json) as { session_results?: IRacingJsonSession[] };
    const sessions: IRacingJsonSession[] = root.session_results || [];
    const raceSession =
      sessions.find(s =>
        s.simsession_type === 6 ||
        (s.simsession_type_name || "").toLowerCase().includes("race") ||
        s.simsession_number === 0
      ) ??
      sessions.sort((a, b) => (b.results?.length ?? 0) - (a.results?.length ?? 0))[0];
    if (!raceSession) return { error: "Geen Race sessie gevonden in JSON — controleer of het een iRacing event result JSON is" };

    const results: IRacingJsonResult[] = raceSession.results || [];
    if (!results.length) return { error: "Geen resultaten gevonden in Race sessie" };

    const validLaps = results.filter(r => r.best_lap_time > 0);
    const fastestCustId = validLaps.length
      ? validLaps.reduce((a, b) => a.best_lap_time < b.best_lap_time ? a : b).cust_id
      : null;
    const maxLaps = Math.max(...results.map(r => r.laps_complete || 0));
    const rows: ImportRow[] = results
      .sort((a, b) => a.finish_position - b.finish_position)
      .map(r => ({
        position:              r.finish_position + 1,
        display_name:          r.display_name || "",
        laps:                  r.laps_complete || 0,
        best_lap:              formatIRacingLapTime(r.best_lap_time),
        incidents:             r.incidents || 0,
        fastest_lap:           r.cust_id === fastestCustId,
        iracing_cust_id:       String(r.cust_id),
        new_irating:           r.newi_rating ?? undefined,
        new_license_level:     r.new_license_level ?? undefined,
        new_license_sub_level: r.new_sub_level ?? undefined,
        car_name:              r.car_name || r.livery?.car_name || undefined,
        dnf: (r.reason_out_id !== undefined && r.reason_out_id !== 0) ||
             (r.reason_out && r.reason_out !== "Running") ||
             ((r.laps_complete || 0) < maxLaps),
      }))
      .filter(r => r.display_name);

    if (!rows.length) return { error: "Geen geldige drivers gevonden in JSON" };
    return { rows };
  } catch {
    return { error: "Ongeldig JSON bestand" };
  }
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
