export type TrackIntelligenceSource = "iracing_recent_races" | "site_result_json" | "extension_scan";
export type TrackReliability = "Hoog" | "Middel" | "Laag";

export type MemberTrackHistoryRow = {
  id?: string;
  member_id: string;
  iracing_customer_id: string | null;
  iracing_name: string | null;
  track_id: string | null;
  track_name: string;
  race_date: string | null;
  subsession_id: string | null;
  series_name: string | null;
  source: TrackIntelligenceSource;
  first_seen_at: string;
  last_seen_at: string;
};

export type TrackInsight = {
  trackId: string | null;
  trackName: string;
  uniqueMemberCount: number;
  percentage: number;
  lastSeenAt: string;
  sources: TrackIntelligenceSource[];
  reliability: TrackReliability;
};

export type SiteRaceResult = {
  user_id: string;
  iracing_cust_id: string | null;
  profiles: {
    display_name: string | null;
    iracing_name: string | null;
    iracing_id: string | number | null;
  } | null;
};

export type SiteRaceForTrackImport = {
  id: string;
  track: string | null;
  race_date: string | null;
  iracing_session_id: string | null;
  league_name: string | null;
  results: SiteRaceResult[];
};

export type NormalizedRecentRace = {
  trackId: string | null;
  trackName: string;
  raceDate: string | null;
  subsessionId: string | null;
  seriesName: string | null;
};

const sourceOrder: TrackIntelligenceSource[] = ["iracing_recent_races", "site_result_json", "extension_scan"];

const cleanString = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const toIsoLike = (value: unknown): string | null => {
  const str = cleanString(value);
  if (!str) return null;
  const time = Date.parse(str);
  return Number.isFinite(time) ? str : null;
};

const trackKeyFor = (row: MemberTrackHistoryRow): string =>
  row.track_id ? `id:${row.track_id}` : `name:${row.track_name.trim().toLowerCase()}`;

const latest = (a: string, b: string): string => (Date.parse(a) >= Date.parse(b) ? a : b);
const earliest = (a: string, b: string): string => (Date.parse(a) <= Date.parse(b) ? a : b);

const genericTrackNames = new Set([
  "circuit",
  "circuit - medium",
  "circuit - short",
  "ev circuit",
  "international",
  "national",
  "oval",
  "raceway",
  "roval",
  "road course",
  "rallycross",
  "short",
  "medium",
  "long",
  "touring",
  "classic",
  "historic",
  "full course",
  "grand prix",
  "north",
  "south",
  "east",
  "west",
]);

export function isUsableTrackName(value: unknown): boolean {
  const trackName = cleanString(value);
  if (!trackName) return false;
  const normalized = trackName.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (normalized.length < 8 || normalized.length > 140) return false;
  if (genericTrackNames.has(normalized)) return false;
  if (/^\d+(\.\d+)?$/.test(normalized)) return false;
  if (/^(?:circuit|road course|oval|raceway|roval)\s*-\s*(?:short|medium|long|classic|historic|national|international)$/i.test(trackName)) return false;
  if (/^(?:oval\s*-\s*(?:left turning|right turning|\d{4})|roval\s+\d{4})$/i.test(trackName)) return false;
  return true;
}

export function getTrackReliability(
  input: { percentage: number; uniqueMemberCount: number; lastSeenAt: string },
  now = new Date(),
): TrackReliability {
  const ageMs = now.getTime() - Date.parse(input.lastSeenAt);
  const daysOld = Number.isFinite(ageMs) ? ageMs / 86_400_000 : Infinity;

  if (input.percentage >= 60 || input.uniqueMemberCount >= 8 || (input.percentage >= 35 && daysOld <= 45)) {
    return "Hoog";
  }
  if (input.percentage >= 30 || input.uniqueMemberCount >= 3 || daysOld <= 21) {
    return "Middel";
  }
  return "Laag";
}

export function analyzeTrackHistory(
  rows: MemberTrackHistoryRow[],
  linkedMemberCount: number,
  now = new Date(),
): TrackInsight[] {
  if (linkedMemberCount <= 0) return [];

  const grouped = new Map<string, { trackId: string | null; trackName: string; members: Set<string>; sources: Set<TrackIntelligenceSource>; lastSeenAt: string }>();

  for (const row of rows) {
    const trackName = row.track_name.trim();
    if (!isUsableTrackName(trackName) || !row.member_id) continue;
    const key = trackKeyFor({ ...row, track_name: trackName });
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        trackId: row.track_id,
        trackName,
        members: new Set([row.member_id]),
        sources: new Set([row.source]),
        lastSeenAt: row.last_seen_at || row.race_date || row.first_seen_at,
      });
      continue;
    }
    current.members.add(row.member_id);
    current.sources.add(row.source);
    current.lastSeenAt = latest(current.lastSeenAt, row.last_seen_at || row.race_date || row.first_seen_at);
  }

  return [...grouped.values()]
    .map((group) => {
      const uniqueMemberCount = group.members.size;
      const percentage = Math.round((uniqueMemberCount / linkedMemberCount) * 1000) / 10;
      return {
        trackId: group.trackId,
        trackName: group.trackName,
        uniqueMemberCount,
        percentage,
        lastSeenAt: group.lastSeenAt,
        sources: sourceOrder.filter((source) => group.sources.has(source)),
        reliability: getTrackReliability({ percentage, uniqueMemberCount, lastSeenAt: group.lastSeenAt }, now),
      };
    })
    .sort((a, b) => b.percentage - a.percentage || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt) || a.trackName.localeCompare(b.trackName));
}

export const getMemberTrackDedupeKey = (row: Pick<MemberTrackHistoryRow, "subsession_id" | "iracing_customer_id" | "track_id" | "track_name" | "race_date">): string => {
  if (row.subsession_id) return `subsession:${row.subsession_id}`;
  const date = row.race_date ? new Date(row.race_date).toISOString().slice(0, 10) : "unknown-date";
  return `combo:${row.iracing_customer_id ?? "unknown-cust"}:${row.track_id ?? row.track_name.toLowerCase()}:${date}`;
};

const raceDedupeKey = (row: MemberTrackHistoryRow): string => `${row.member_id}:${row.source}:${getMemberTrackDedupeKey(row)}`;

export function dedupeTrackHistoryRows(rows: MemberTrackHistoryRow[]): MemberTrackHistoryRow[] {
  const deduped = new Map<string, MemberTrackHistoryRow>();
  for (const row of rows) {
    if (!isUsableTrackName(row.track_name) || !row.member_id) continue;
    const key = raceDedupeKey(row);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, row);
      continue;
    }
    deduped.set(key, {
      ...existing,
      first_seen_at: earliest(existing.first_seen_at, row.first_seen_at),
      last_seen_at: latest(existing.last_seen_at, row.last_seen_at),
      series_name: existing.series_name ?? row.series_name,
      track_id: existing.track_id ?? row.track_id,
      iracing_name: existing.iracing_name ?? row.iracing_name,
      iracing_customer_id: existing.iracing_customer_id ?? row.iracing_customer_id,
    });
  }
  return [...deduped.values()];
}

export function buildMemberTrackRowsFromSiteResults(
  races: SiteRaceForTrackImport[],
  seenAt = new Date().toISOString(),
): MemberTrackHistoryRow[] {
  const rows = races.flatMap((race) => {
    const trackName = cleanString(race.track);
    if (!trackName) return [];
    return race.results.map((result): MemberTrackHistoryRow => {
      const profile = result.profiles;
      return {
        member_id: result.user_id,
        iracing_customer_id: cleanString(result.iracing_cust_id) ?? cleanString(profile?.iracing_id),
        iracing_name: cleanString(profile?.iracing_name) ?? cleanString(profile?.display_name),
        track_id: null,
        track_name: trackName,
        race_date: race.race_date,
        subsession_id: cleanString(race.iracing_session_id) ?? race.id,
        series_name: cleanString(race.league_name),
        source: "site_result_json",
        first_seen_at: seenAt,
        last_seen_at: seenAt,
      };
    });
  });
  return dedupeTrackHistoryRows(rows);
}

export function normalizeRecentRace(raw: Record<string, unknown>): NormalizedRecentRace | null {
  const track = raw.track && typeof raw.track === "object" ? raw.track as Record<string, unknown> : {};
  const trackId = cleanString(raw.track_id) ?? cleanString(track.track_id) ?? cleanString(track.id);
  const trackName = cleanString(raw.track_name) ?? cleanString(track.track_name) ?? cleanString(track.name);
  if (!isUsableTrackName(trackName)) return null;

  return {
    trackId,
    trackName,
    raceDate: toIsoLike(raw.race_date) ?? toIsoLike(raw.start_time) ?? toIsoLike(raw.session_start_time),
    subsessionId: cleanString(raw.subsession_id) ?? cleanString(raw.session_id),
    seriesName: cleanString(raw.series_name) ?? cleanString(raw.series_short_name) ?? cleanString(raw.license_category),
  };
}

export function toCsv(insights: TrackInsight[]): string {
  const escape = (value: string | number | null) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    ["Track", "Aantal members", "Percentage", "Laatst gezien", "Bronnen", "Betrouwbaarheid"].map(escape).join(","),
    ...insights.map((row) => [row.trackName, row.uniqueMemberCount, row.percentage, row.lastSeenAt, row.sources.join(" + "), row.reliability].map(escape).join(",")),
  ].join("\n");
}
