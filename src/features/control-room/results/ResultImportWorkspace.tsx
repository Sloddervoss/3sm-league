import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileJson,
  FileUp,
  Info,
  Loader2,
  PencilLine,
  Plus,
  ShieldAlert,
  Trash2,
  Trophy,
  Upload,
  XCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isSupportedCommunitySupportRace } from "@/features/community-support/raceEligibility";
import {
  calculateRaceHostingAmountUsd,
  convertUsdToEur,
  DEFAULT_RACE_HOSTING_HOURS,
  normalizeHostedHours,
  normalizeUsdEurRate,
} from "@/features/community-support/raceHostingPricing";
import { useCommunitySupport, type SupportRaceCostDraft } from "@/features/community-support/store";
import {
  matchProfileForImportRow,
  parseIRacingJsonRows,
  type ImportRow,
  type IRacingRaceMetadata,
  type ProfileRow,
  type RaceOption,
  type SessionImportRow,
} from "@/lib/importHelpers";

export type ResultImportMode = "json" | "manual";
export type ParticipantMatchStatus = "matched-id" | "matched-name" | "unmatched";

export type ResultImportRace = RaceOption & {
  status?: string | null;
  race_type?: string | null;
  leagues?: { name?: string | null; season?: string | null } | null;
};

export type ResultImportParticipant = {
  row: ImportRow;
  profile?: ProfileRow;
  matchStatus: ParticipantMatchStatus;
  points: number;
};

export type ResultImportImpact = {
  resultRows: number;
  matchedDrivers: number;
  unmatchedDrivers: number;
  existingResults: number;
  profileUpdates: number;
  practiceRows: number;
  qualifyingRows: number;
  carChoiceCandidates: number;
};

export type CarLockRegistration = { user_id: string; car_choice: string | null; car_locked: boolean | null };
export type CarLockData = { seasonRegistrations: CarLockRegistration[]; raceRegistrations: CarLockRegistration[] };
export type LockedCarMismatch = { userId: string; driver: string; lockedCar: string; importedCar: string };

/** The reviewed payload written by the native workspace after confirmation. */
export type ResultImportConfirmation = {
  race: ResultImportRace;
  mode: ResultImportMode;
  rows: ImportRow[];
  sessionResults: SessionImportRow[];
  raceMetadata: IRacingRaceMetadata | null;
  participants: ResultImportParticipant[];
  impact: ResultImportImpact;
  dqUserIds: string[];
  lockedCarMismatches: LockedCarMismatch[];
  hostingCostDraft: SupportRaceCostDraft | null;
  hostingCostAlreadyBooked: boolean;
};

export type ResultImportWorkspaceProps = {
  /** @deprecated The native workspace owns its confirmed production write; retained for parent compatibility. */
  onConfirm?: (confirmation: ResultImportConfirmation) => void | Promise<void>;
  points?: readonly number[];
  className?: string;
};

const DEFAULT_POINTS = [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const emptyRow = (position: number): ImportRow => ({ position, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false });

const queryRaces = async (): Promise<ResultImportRace[]> => {
  const { data, error } = await supabase
    .from("races")
    .select("id, name, track, race_date, league_id, status, race_type, leagues(name, season)")
    .order("race_date", { ascending: true });
  if (error) throw error;
  return (data || []) as ResultImportRace[];
};

const queryProfiles = async (): Promise<ProfileRow[]> => {
  const { data, error } = await supabase.from("profiles").select("user_id, display_name, iracing_name, iracing_id");
  if (error) throw error;
  return (data || []) as ProfileRow[];
};

const queryExistingResults = async (raceId: string): Promise<{ user_id: string }[]> => {
  const { data, error } = await supabase.from("race_results").select("user_id").eq("race_id", raceId);
  if (error) throw error;
  return (data || []) as { user_id: string }[];
};

const queryCarLocks = async (leagueId: string): Promise<CarLockData> => {
  const [seasonResponse, raceResponse] = await Promise.all([
    supabase.from("season_registrations").select("user_id, car_choice, car_locked").eq("league_id", leagueId),
    supabase.from("race_registrations").select("user_id, car_choice, car_locked, races!inner(league_id)").eq("car_locked", true).eq("races.league_id", leagueId),
  ]);
  if (seasonResponse.error) throw seasonResponse.error;
  if (raceResponse.error) throw raceResponse.error;
  return {
    seasonRegistrations: (seasonResponse.data || []) as CarLockRegistration[],
    raceRegistrations: (raceResponse.data || []) as CarLockRegistration[],
  };
};

const matchParticipant = (row: ImportRow, profiles: ProfileRow[]): ResultImportParticipant => {
  const profile = matchProfileForImportRow(row, profiles);
  const idMatch = Boolean(profile && row.iracing_cust_id && String(profile.iracing_id) === String(row.iracing_cust_id));
  return {
    row,
    profile,
    matchStatus: profile ? (idMatch ? "matched-id" : "matched-name") : "unmatched",
    points: 0,
  };
};

const matchCopy: Record<ParticipantMatchStatus, { label: string; className: string }> = {
  "matched-id": { label: "iRacing ID match", className: "text-emerald-300" },
  "matched-name": { label: "Naam match · controleer", className: "text-amber-300" },
  unmatched: { label: "Geen profiel gevonden", className: "text-red-300" },
};

type ImportWriteProgress = "resultaten opslaan" | "diskwalificaties opslaan" | "profielsnapshots bijwerken" | "race afronden" | "sessieresultaten vervangen" | "straffen opnieuw toepassen" | "3SR herberekenen" | "auto-keuzes bijwerken";

const invalidateResultImportQueries = (queryClient: QueryClient) => {
  [
    ["all-results-with-profiles"], ["all-races-admin"], ["completed-races"], ["total-results"],
    ["race-results"], ["race-results-detail"], ["race-session-results-detail"], ["race-modal-results"],
    ["all-results-dnf"], ["control-room", "stewarding", "dnf-results"], ["driver-3sr"],
    ["driver-modal-results"], ["my-results"], ["team-results"], ["all-results-for-seasons"],
    ["admin-season-registrations"], ["admin-race-registrations"], ["season-registrations"],
    ["race-registrations"], ["control-room", "overview", "season-registrations"],
    ["control-room", "overview", "race-registrations"], ["control-room", "season", "season-registrations"],
    ["control-room", "season", "race-registrations"], ["standings-full"], ["standings-preview"],
    ["latest-completed-race"], ["latest-race-results"], ["control-room-result-import-races"],
    ["community-support", "race-cost-options"],
    ["control-room-result-import-profiles"], ["control-room-result-import-existing-results"],
    ["control-room-result-import-car-locks"],
  ].forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
};

const normalizedCar = (car: string) => car.trim().replace(/\s+/g, " ").toLocaleLowerCase();

export function buildResultImportHostingCostDraft(
  race: ResultImportRace,
  hostedHours: number,
  discountApplied: boolean,
  exchangeRateUsdEur: number,
): SupportRaceCostDraft | null {
  const normalizedHours = normalizeHostedHours(hostedHours);
  const normalizedRate = normalizeUsdEurRate(exchangeRateUsdEur);
  const raceScope = race.league_id ? "season" : "standalone";
  if (normalizedHours === null || !isSupportedCommunitySupportRace({
    raceScope,
    leagueId: race.league_id,
    leagueName: race.leagues?.name,
    raceName: race.name,
    raceFormat: race.race_type,
  }) || normalizedRate === null) return null;

  return {
    raceId: race.id,
    raceScope,
    ...(race.league_id ? { leagueId: race.league_id } : {}),
    ...(race.leagues?.name ? { leagueName: race.leagues.name } : {}),
    ...(race.leagues?.season ? { season: race.leagues.season } : {}),
    raceName: race.name,
    track: race.track,
    date: race.race_date.slice(0, 10),
    ...(race.race_type ? { raceFormat: race.race_type } : {}),
    hostedHours: normalizedHours,
    discountApplied,
    exchangeRateUsdEur: normalizedRate,
    isPublic: true,
    note: "Vastgelegd tijdens resultatenimport",
  };
}

/**
 * Car policy is intentionally scoped to JSON imports of a league race. A whole-season
 * registration takes precedence; race-by-race entrants use only locked registrations
 * belonging to races in that exact league. Standalone races therefore never warn.
 */
export function findLockedCarMismatches({
  mode,
  leagueId,
  participants,
  carLocks,
}: {
  mode: ResultImportMode;
  leagueId: string | null | undefined;
  participants: ResultImportParticipant[];
  carLocks: CarLockData | undefined;
}): LockedCarMismatch[] {
  if (mode !== "json" || !leagueId || !carLocks) return [];
  const seasonByUser = new Map(carLocks.seasonRegistrations.map((registration) => [registration.user_id, registration]));
  const raceLockByUser = new Map(carLocks.raceRegistrations
    .filter((registration) => registration.car_locked && registration.car_choice)
    .map((registration) => [registration.user_id, registration]));

  return participants.flatMap((participant): LockedCarMismatch[] => {
    if (!participant.profile || !participant.row.car_name) return [];
    const seasonRegistration = seasonByUser.get(participant.profile.user_id);
    const lock = seasonRegistration?.car_locked ? seasonRegistration : !seasonRegistration ? raceLockByUser.get(participant.profile.user_id) : undefined;
    if (!lock?.car_choice || normalizedCar(lock.car_choice) === normalizedCar(participant.row.car_name)) return [];
    return [{
      userId: participant.profile.user_id,
      driver: participant.row.display_name,
      lockedCar: lock.car_choice,
      importedCar: participant.row.car_name,
    }];
  });
}

const lapMilliseconds = (lap: string) => {
  const match = lap.trim().match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  return ((Number(match[1] || 0) * 60 + Number(match[2])) * 1000) + Number((match[3] || "").padEnd(3, "0"));
};

export function classifyImportParticipants(participants: ResultImportParticipant[], dqUserIds: string[], points: readonly number[]) {
  const dqUsers = new Set(dqUserIds);
  const ordered = [...participants].sort((a, b) => a.row.position - b.row.position);
  const dqHasFastestLap = ordered.some(({ profile, row }) => Boolean(profile && dqUsers.has(profile.user_id) && row.fastest_lap));
  const eligible = ordered.filter(({ profile }) => Boolean(profile && !dqUsers.has(profile.user_id)));
  const promotedFastestUserId = dqHasFastestLap
    ? eligible.reduce<{ userId: string; lap: number } | null>((fastest, participant) => {
      const lap = lapMilliseconds(participant.row.best_lap);
      if (lap === null || !participant.profile || (fastest && fastest.lap <= lap)) return fastest;
      return { userId: participant.profile.user_id, lap };
    }, null)?.userId ?? null
    : null;
  let classifiedPosition = 0;
  return ordered.map((participant) => {
    const isDq = Boolean(participant.profile && dqUsers.has(participant.profile.user_id));
    const position = isDq ? participant.row.position : ++classifiedPosition;
    const fastestLap = isDq ? false : dqHasFastestLap ? participant.profile?.user_id === promotedFastestUserId : Boolean(participant.row.fastest_lap);
    return { ...participant, isDq, position, fastestLap, points: isDq ? 0 : (points[position - 1] ?? 0) + (fastestLap ? 1 : 0) };
  });
}

async function executeResultImport(confirmation: ResultImportConfirmation, points: readonly number[], onProgress: (progress: ImportWriteProgress) => void): Promise<{ iRatingUpdates: number }> {
  const { race, rows, sessionResults, raceMetadata, mode, participants, dqUserIds, lockedCarMismatches } = confirmation;
  // A DQ is only a JSON locked-car decision. Derive it from the current mismatch
  // list so a stale checkbox (after replacing the file/race) cannot DQ another row.
  const mismatchUserIds = new Set(mode === "json" ? lockedCarMismatches.map((mismatch) => mismatch.userId) : []);
  const selectedDqUserIds = [...new Set(dqUserIds.filter((userId) => mismatchUserIds.has(userId)))];
  const selectedDqUsers = new Set(selectedDqUserIds);
  const classifiedParticipants = classifyImportParticipants(participants, selectedDqUserIds, points);
  let iRatingUpdates = 0;
  onProgress("resultaten opslaan");
  for (const { row, profile, isDq, position, fastestLap, points: classifiedPoints } of classifiedParticipants) {
    if (!profile) throw new Error(`Coureur niet gevonden: ${row.display_name}`);
    const { error } = await supabase.from("race_results").upsert({ race_id: race.id, user_id: profile.user_id, position, start_position: row.start_position ?? null, points: classifiedPoints, fastest_lap: fastestLap, laps: row.laps, laps_led: row.laps_led ?? null, best_lap: row.best_lap || null, best_lap_num: row.best_lap_num ?? null, avg_lap: row.avg_lap ?? null, incidents: row.incidents, dnf: isDq || row.dnf || false, irating_snapshot: row.new_irating ?? null, gap_to_leader: row.gap_to_leader ?? null, car_name: row.car_name ?? null, country_code: row.country_code ?? null, club_name: row.club_name ?? null, reason_out: row.reason_out ?? null }, { onConflict: "race_id,user_id" });
    if (error) throw error;
  }
  const selectedMismatches = lockedCarMismatches.filter((mismatch) => selectedDqUsers.has(mismatch.userId));
  if (selectedMismatches.length) {
    onProgress("diskwalificaties opslaan");
    for (const mismatch of selectedMismatches) {
      const reason = `Locked-vs-imported car mismatch: locked ${mismatch.lockedCar}; imported ${mismatch.importedCar}.`;
      const { data: existingPenalties, error: existingPenaltyError } = await supabase.from("penalties").select("id").eq("race_id", race.id).eq("user_id", mismatch.userId).eq("penalty_type", "disqualification").limit(1);
      if (existingPenaltyError) throw existingPenaltyError;
      const existingPenalty = existingPenalties?.[0];
      const penaltyPayload = { league_id: race.league_id ?? null, penalty_type: "disqualification", points_deduction: 0, reason, source: "result_import" };
      const { error: penaltyError } = existingPenalty
        ? await supabase.from("penalties").update(penaltyPayload).eq("id", existingPenalty.id)
        : await supabase.from("penalties").insert({ ...penaltyPayload, race_id: race.id, user_id: mismatch.userId });
      if (penaltyError) throw penaltyError;
    }
  }
  onProgress("profielsnapshots bijwerken");
  for (const { row, profile } of participants) {
    if (!profile || !row.new_irating || !row.new_license_level || row.new_license_sub_level === undefined) continue;
    const licLetters = ["", "R", "D", "C", "B", "A"];
    const safetyRating = `${licLetters[Math.min(Math.ceil(row.new_license_level / 4), 5)]} ${(row.new_license_sub_level / 100).toFixed(2)}`;
    const { error } = await supabase.from("profiles").update({ irating: row.new_irating, safety_rating: safetyRating }).eq("user_id", profile.user_id);
    if (error) throw new Error(`iRating update mislukt voor ${row.display_name}: ${error.message}`);
    iRatingUpdates++;
  }
  onProgress("race afronden");
  const { error: raceError } = await supabase.from("races").update({ status: "completed", counts_for_3sr: true, ...(raceMetadata?.iracing_session_id ? { iracing_session_id: raceMetadata.iracing_session_id } : {}), ...(raceMetadata?.sof != null ? { sof: raceMetadata.sof } : {}), ...(raceMetadata?.cautions != null ? { cautions: raceMetadata.cautions } : {}), ...(raceMetadata?.caution_laps != null ? { caution_laps: raceMetadata.caution_laps } : {}), ...(raceMetadata?.lead_changes != null ? { lead_changes: raceMetadata.lead_changes } : {}), ...(raceMetadata?.weather ? { weather: raceMetadata.weather } : {}) }).eq("id", race.id);
  if (raceError) throw raceError;
  if (mode === "json") {
    onProgress("sessieresultaten vervangen");
    const sessionTable = supabase.from("race_session_results");
    const { error: deleteError } = await sessionTable.delete().eq("race_id", race.id);
    if (deleteError) throw deleteError;
    if (sessionResults.length) {
      const { error: insertError } = await sessionTable.insert(sessionResults.map((row) => ({ race_id: race.id, session_type: row.session_type, session_name: row.session_name, session_number: row.session_number ?? null, position: row.position, display_name: row.display_name, iracing_cust_id: row.iracing_cust_id ?? null, laps: row.laps, best_lap: row.best_lap || null, best_lap_num: row.best_lap_num ?? null, avg_lap: row.avg_lap ?? null, incidents: row.incidents, car_name: row.car_name ?? null, club_name: row.club_name ?? null, country_code: row.country_code ?? null })));
      if (insertError) throw insertError;
    }
  }
  onProgress("straffen opnieuw toepassen");
  const { data: penalties, error: penaltiesError } = await supabase.from("penalties").select("user_id, points_deduction").eq("race_id", race.id).eq("penalty_type", "points_deduction");
  if (penaltiesError) throw penaltiesError;
  for (const penalty of penalties || []) {
    // A selected locked-car DQ is always DNF with zero points; never let an
    // older points-deduction turn that zero into a negative value on re-import.
    if (selectedDqUsers.has(penalty.user_id)) continue;
    const { data: result, error: resultError } = await supabase.from("race_results").select("points").eq("race_id", race.id).eq("user_id", penalty.user_id).maybeSingle();
    if (resultError) throw resultError;
    if (!result) continue;
    const { error } = await supabase.from("race_results").update({ points: Math.max(0, (result.points || 0) - (penalty.points_deduction || 0)) }).eq("race_id", race.id).eq("user_id", penalty.user_id);
    if (error) throw error;
  }
  onProgress("3SR herberekenen");
  const { error: threeSrError } = await supabase.rpc("recalculate_3sr_for_race", { p_race_id: race.id });
  if (threeSrError) throw threeSrError;
  if (race.league_id) {
    onProgress("auto-keuzes bijwerken");
    const { data: freshProfiles, error: profilesError } = await supabase.from("profiles").select("user_id, iracing_id, display_name, iracing_name");
    if (profilesError) throw profilesError;
    const { data: leagueRaces, error: leagueRacesError } = await supabase.from("races").select("id").eq("league_id", race.league_id);
    if (leagueRacesError) throw leagueRacesError;
    const leagueRaceIds = (leagueRaces || []).map((leagueRace) => leagueRace.id);
    for (const row of rows) {
      if (!row.car_name) continue;
      const profile = matchProfileForImportRow(row, (freshProfiles || []) as ProfileRow[]);
      if (!profile) continue;
      const { data: seasonRegistration, error: seasonRegistrationError } = await supabase
        .from("season_registrations")
        .select("id")
        .eq("league_id", race.league_id)
        .eq("user_id", profile.user_id)
        .maybeSingle();
      if (seasonRegistrationError) throw seasonRegistrationError;

      if (seasonRegistration) {
        // Full-season entrants keep their lock on the season registration itself.
        const { error: seasonError } = await supabase
          .from("season_registrations")
          .update({ car_choice: row.car_name, car_locked: true })
          .eq("league_id", race.league_id)
          .eq("user_id", profile.user_id)
          .eq("car_locked", false);
        if (seasonError) throw seasonError;
        continue;
      }

      // A race-by-race entrant has no season registration. Their first completed
      // league race establishes the per-league lock, then any already-created
      // registrations for other rounds inherit that same lock and car.
      const { error: currentRaceRegistrationError } = await supabase
        .from("race_registrations")
        .update({ car_choice: row.car_name, car_locked: true })
        .eq("race_id", race.id)
        .eq("user_id", profile.user_id)
        .eq("car_locked", false);
      if (currentRaceRegistrationError) throw currentRaceRegistrationError;
      if (!leagueRaceIds.length) continue;
      const { error: propagatedRaceRegistrationsError } = await supabase
        .from("race_registrations")
        .update({ car_choice: row.car_name, car_locked: true })
        .eq("user_id", profile.user_id)
        .eq("car_locked", false)
        .in("race_id", leagueRaceIds);
      if (propagatedRaceRegistrationsError) throw propagatedRaceRegistrationsError;
    }
  }
  return { iRatingUpdates };
}

export function ResultImportWorkspace({ points = DEFAULT_POINTS, className = "" }: ResultImportWorkspaceProps) {
  const queryClient = useQueryClient();
  const { state: supportState, initializeRaceCosts } = useCommunitySupport();
  const [mode, setMode] = useState<ResultImportMode>("json");
  const [raceId, setRaceId] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([emptyRow(1)]);
  const [sessionResults, setSessionResults] = useState<SessionImportRow[]>([]);
  const [raceMetadata, setRaceMetadata] = useState<IRacingRaceMetadata | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [writeProgress, setWriteProgress] = useState<ImportWriteProgress | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [writeSuccess, setWriteSuccess] = useState<string | null>(null);
  const [dqUserIds, setDqUserIds] = useState<string[]>([]);
  const [hostingHours, setHostingHours] = useState(String(DEFAULT_RACE_HOSTING_HOURS));
  const [hostingDiscountApplied, setHostingDiscountApplied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: races = [], isLoading: racesLoading, error: racesError } = useQuery({ queryKey: ["control-room-result-import-races"], queryFn: queryRaces });
  const { data: profiles = [], isLoading: profilesLoading, error: profilesError } = useQuery({ queryKey: ["control-room-result-import-profiles"], queryFn: queryProfiles });
  const { data: existingResults = [], isLoading: existingLoading } = useQuery({
    queryKey: ["control-room-result-import-existing-results", raceId],
    queryFn: () => queryExistingResults(raceId),
    enabled: Boolean(raceId),
  });

  const selectedRace = races.find((race) => race.id === raceId);
  const existingHostingCost = selectedRace ? supportState.raceCosts.find((cost) => cost.raceId === selectedRace.id) : undefined;
  const hostingEligible = Boolean(selectedRace && isSupportedCommunitySupportRace({
    raceScope: selectedRace.league_id ? "season" : "standalone",
    leagueId: selectedRace.league_id,
    leagueName: selectedRace.leagues?.name,
    raceName: selectedRace.name,
    raceFormat: selectedRace.race_type,
  }));
  const parsedHostingHours = Number(hostingHours);
  const normalizedHostingHours = Number.isInteger(parsedHostingHours) ? normalizeHostedHours(parsedHostingHours) : null;
  const hostingSourceAmountUsd = normalizedHostingHours === null ? 0 : calculateRaceHostingAmountUsd(normalizedHostingHours, hostingDiscountApplied);
  const hostingAmountEur = convertUsdToEur(hostingSourceAmountUsd, supportState.settings.usdEurRate);
  const { data: carLocks, isLoading: carLocksLoading, error: carLocksError } = useQuery({
    queryKey: ["control-room-result-import-car-locks", selectedRace?.league_id],
    queryFn: () => queryCarLocks(selectedRace!.league_id!),
    enabled: mode === "json" && Boolean(selectedRace?.league_id),
  });
  const populatedRows = rows.filter((row) => row.display_name.trim());
  const participants = useMemo(() => populatedRows.map((row) => {
    const participant = matchParticipant(row, profiles);
    return { ...participant, points: (points[row.position - 1] ?? 0) + (row.fastest_lap ? 1 : 0) };
  }), [points, populatedRows, profiles]);
  const lockedCarMismatches = useMemo(() => findLockedCarMismatches({
    mode,
    leagueId: selectedRace?.league_id,
    participants,
    carLocks,
  }), [carLocks, mode, participants, selectedRace?.league_id]);
  const matched = participants.filter((participant) => participant.profile);
  const unmatched = participants.filter((participant) => !participant.profile);
  const practiceRows = sessionResults.filter((row) => row.session_type === "practice").length;
  const qualifyingRows = sessionResults.filter((row) => row.session_type === "qualifying").length;
  const profileUpdates = participants.filter((participant) => participant.row.new_irating && participant.row.new_license_level && participant.row.new_license_sub_level !== undefined).length;
  const impact: ResultImportImpact = {
    resultRows: participants.length,
    matchedDrivers: matched.length,
    unmatchedDrivers: unmatched.length,
    existingResults: existingResults.length,
    profileUpdates,
    practiceRows,
    qualifyingRows,
    carChoiceCandidates: matched.filter((participant) => participant.row.car_name).length,
  };
  const sourceReady = mode === "manual" || Boolean(fileName);
  const hostingReady = !hostingEligible || Boolean(existingHostingCost) || normalizedHostingHours !== null;
  const canConfirm = Boolean(selectedRace && sourceReady && participants.length && !unmatched.length && !racesLoading && !profilesLoading && !existingLoading && !carLocksLoading && !racesError && !profilesError && !carLocksError && !submitting);
  const confirmationBlocker = !selectedRace
    ? "Kies eerst de kalender-race waarvoor deze uitslag bedoeld is."
    : mode === "json" && !fileName
      ? "Upload daarna het iRacing result JSON voor deze race."
      : !participants.length
        ? "Voeg minstens één uitslagregel toe."
        : profilesLoading || existingLoading || carLocksLoading
          ? "De live controlegegevens worden nog geladen."
          : racesError || profilesError || carLocksError
            ? "Herstel eerst de fout bij het laden van live race-, profiel- of autolockgegevens."
            : unmatched.length
              ? "Los alle coureurmatches op voordat je verdergaat."
              : null;

  const updateRow = (index: number, update: Partial<ImportRow>) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...update } : row));
  const resetImport = () => {
    setRows([emptyRow(1)]);
    setSessionResults([]);
    setRaceMetadata(null);
    setFileName(null);
    setParseError(null);
    setDqUserIds([]);
    if (fileInput.current) fileInput.current.value = "";
  };
  const switchMode = (nextMode: ResultImportMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setWriteError(null);
    setWriteSuccess(null);
    resetImport();
  };

  const loadJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseIRacingJsonRows(String(reader.result || ""));
      if (parsed.error) {
        setParseError(parsed.error);
        return;
      }
      setRows(parsed.rows);
      setSessionResults(parsed.sessionResults || []);
      setRaceMetadata(parsed.raceMetadata || null);
      setFileName(file.name);
      setParseError(null);
    };
    reader.readAsText(file);
  };

  const importResults = useMutation({
    mutationFn: (confirmation: ResultImportConfirmation) => executeResultImport(confirmation, points, setWriteProgress),
    onSuccess: ({ iRatingUpdates }, confirmation) => {
      if (confirmation.hostingCostDraft) initializeRaceCosts([confirmation.hostingCostDraft]);
      invalidateResultImportQueries(queryClient);
      const hostingMessage = confirmation.hostingCostDraft
        ? ` · racehosting lokaal geboekt voor ${confirmation.hostingCostDraft.hostedHours} uur${confirmation.hostingCostDraft.discountApplied ? " met 25% korting" : " zonder korting"}`
        : confirmation.hostingCostAlreadyBooked ? " · bestaande racehosting ongewijzigd" : "";
      setWriteSuccess(`Resultaten geïmporteerd${iRatingUpdates ? ` · iRating bijgewerkt voor ${iRatingUpdates} drivers` : ""}${hostingMessage}.`);
      setConfirming(false);
      setRaceId("");
      resetImport();
    },
    onError: (error: Error) => setWriteError(error.message),
    onSettled: () => {
      setSubmitting(false);
      setWriteProgress(null);
    },
  });

  const requestConfirmation = () => {
    setWriteError(null);
    setWriteSuccess(null);
    if (canConfirm) {
      setDqUserIds([]);
      const previousSeasonCost = selectedRace?.league_id
        ? supportState.raceCosts
          .filter((cost) => cost.leagueId === selectedRace.league_id && cost.raceId !== selectedRace.id && cost.date <= selectedRace.race_date.slice(0, 10))
          .sort((a, b) => b.date.localeCompare(a.date))[0]
        : undefined;
      setHostingHours(String(existingHostingCost?.hostedHours ?? DEFAULT_RACE_HOSTING_HOURS));
      setHostingDiscountApplied(existingHostingCost?.discountApplied ?? previousSeasonCost?.discountApplied ?? false);
      setConfirming(true);
    }
  };

  const confirm = async () => {
    if (!selectedRace || !canConfirm || !hostingReady) return;
    const hostingCostDraft = existingHostingCost || !hostingEligible || normalizedHostingHours === null
      ? null
      : buildResultImportHostingCostDraft(selectedRace, normalizedHostingHours, hostingDiscountApplied, supportState.settings.usdEurRate);
    const confirmation: ResultImportConfirmation = {
      race: selectedRace,
      mode,
      rows: populatedRows,
      sessionResults,
      raceMetadata,
      participants,
      impact,
      dqUserIds,
      lockedCarMismatches,
      hostingCostDraft,
      hostingCostAlreadyBooked: Boolean(existingHostingCost),
    };
    setSubmitting(true);
    setWriteError(null);
    setWriteSuccess(null);
    try {
      await importResults.mutateAsync(confirmation);
    } catch {
      // The mutation keeps the confirmation open and renders its concrete write error.
    }
  };

  return (
    <section className={`space-y-5 ${className}`} aria-label="Resultaten importeren">
      <header className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Control Room · live resultatenimport</p>
          <h2 className="mt-1 font-heading text-2xl font-black text-white">Resultaten importeren</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">Koppel een echte kalender-race, lees de iRacing-uitslag in of voer een gecontroleerde correctie in. Pas na matchcontrole en een expliciete impactbevestiging schrijft deze workflow naar de live uitslag.</p>
        </div>
        <div className="flex rounded-lg border border-white/10 bg-black/15 p-1 text-xs font-bold">
          <button type="button" onClick={() => switchMode("json")} className={`rounded-md px-3 py-2 ${mode === "json" ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white"}`}><FileJson className="mr-1.5 inline h-3.5 w-3.5" />iRacing JSON</button>
          <button type="button" onClick={() => switchMode("manual")} className={`rounded-md px-3 py-2 ${mode === "manual" ? "bg-orange-500 text-white" : "text-gray-400 hover:text-white"}`}><PencilLine className="mr-1.5 inline h-3.5 w-3.5" />Handmatige correctie</button>
        </div>
      </header>

      {writeSuccess && <p role="status" className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.08] px-4 py-3 text-sm text-emerald-100"><CheckCircle2 className="mr-2 inline h-4 w-4 text-emerald-300" />{writeSuccess}</p>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <section className="rounded-2xl border border-white/[0.08] bg-[#151821] p-5">
            <label className="text-xs font-black uppercase tracking-wider text-gray-400" htmlFor="result-import-race">1. Kies de echte kalender-race</label>
            <p className="mt-2 text-sm text-gray-300">Deze selectie bepaalt exact welke live race, standings en 3SR de bevestigde import bijwerkt.</p>
            <select id="result-import-race" value={raceId} onChange={(event) => { setRaceId(event.target.value); setDqUserIds([]); setWriteError(null); setWriteSuccess(null); }} disabled={racesLoading || Boolean(racesError)} className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-orange-400/50 disabled:cursor-not-allowed disabled:opacity-50">
              <option value="">{racesLoading ? "Echte races laden…" : racesError ? "Races niet beschikbaar" : "Selecteer de kalender-race…"}</option>
              {races.map((race) => <option value={race.id} key={race.id}>{race.name} · {race.track} · {new Date(race.race_date).toLocaleDateString("nl-NL")}</option>)}
            </select>
            {racesError && <p className="mt-2 text-xs text-red-300">Races konden niet worden geladen: {racesError.message}</p>}
            {selectedRace && <p className="mt-2 text-xs text-gray-400">{selectedRace.leagues?.name || "Losse race"}{selectedRace.leagues?.season ? ` · ${selectedRace.leagues.season}` : ""} · status: {selectedRace.status || "onbekend"}</p>}
            {raceId && !existingLoading && existingResults.length > 0 && <div className="mt-4 flex gap-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.08] p-3 text-sm text-amber-100"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" /><p><strong>{existingResults.length} bestaande resultaten.</strong> Deze import doet een upsert op race + coureur; bestaande uitslagdata kan dus worden overschreven en bestaande puntenstraffen worden daarna opnieuw toegepast.</p></div>}
          </section>

          <section className="rounded-2xl border border-white/[0.08] bg-[#151821] p-5">
            <p className="text-xs font-black uppercase tracking-wider text-gray-400">2. Bron en uitslag</p>
            {mode === "json" ? <div className="mt-3">
              <div className="mb-3 flex gap-2 rounded-lg border border-sky-400/20 bg-sky-400/[0.06] p-3 text-xs leading-relaxed text-sky-100"><Info className="h-4 w-4 shrink-0 text-sky-300" /><p><strong>Waarom JSON?</strong> Het officiële iRacing result JSON levert finishposities, iRacing-ID&apos;s, sessies en race-metadata. Daardoor kan de import coureurs betrouwbaar koppelen en de volledige uitslag herstellen.</p></div>
              {!selectedRace && <p className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-100">Selecteer eerst de echte kalender-race. Het bestand blijft geblokkeerd totdat duidelijk is waar de live uitslag terechtkomt.</p>}
              <input ref={fileInput} type="file" accept="application/json,.json" disabled={!selectedRace} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) loadJson(file); }} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={!selectedRace} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-orange-400/35 bg-orange-400/[0.05] px-4 py-8 text-sm font-bold text-orange-100 hover:bg-orange-400/[0.1] disabled:cursor-not-allowed disabled:opacity-40"><FileUp className="h-5 w-5 text-orange-300" />{fileName ? `Vervang ${fileName}` : selectedRace ? "Upload iRacing result JSON" : "Kies eerst een kalender-race"}</button>
              {fileName && <div className="mt-3 flex items-center justify-between rounded-lg bg-black/15 px-3 py-2 text-xs text-gray-300"><span><FileJson className="mr-1 inline h-3.5 w-3.5 text-orange-300" />{fileName} · {participants.length} race-regels</span><button type="button" onClick={resetImport} className="text-gray-400 hover:text-white">Wis import</button></div>}
              {parseError && <p className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[0.07] p-3 text-sm text-red-200">{parseError}</p>}
              {raceMetadata && <div className="mt-4 rounded-lg border border-violet-400/20 bg-violet-400/[0.05] p-3"><p className="text-xs font-black uppercase tracking-wider text-violet-200">JSON race-metadata</p><div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-300">{raceMetadata.iracing_session_id && <span className="rounded bg-black/15 px-2 py-1">Sessie #{raceMetadata.iracing_session_id}</span>}{raceMetadata.sof != null && <span className="rounded bg-black/15 px-2 py-1">SOF {raceMetadata.sof}</span>}{raceMetadata.cautions != null && <span className="rounded bg-black/15 px-2 py-1">{raceMetadata.cautions} cauties</span>}{raceMetadata.caution_laps != null && <span className="rounded bg-black/15 px-2 py-1">{raceMetadata.caution_laps} caution laps</span>}{raceMetadata.lead_changes != null && <span className="rounded bg-black/15 px-2 py-1">{raceMetadata.lead_changes} kopwisselingen</span>}{raceMetadata.weather && <span className="rounded bg-black/15 px-2 py-1">{raceMetadata.weather}</span>}</div><p className="mt-2 text-xs text-violet-100/70">{practiceRows} trainingregels · {qualifyingRows} kwalificatieregels worden als sessieresultaten vervangen.</p></div>}
            </div> : <div className="mt-3 overflow-x-auto"><div className="mb-3 flex gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-100"><PencilLine className="h-4 w-4 shrink-0 text-amber-300" /><p><strong>Handmatige correctie:</strong> gebruik dit alleen wanneer geen bruikbaar iRacing JSON beschikbaar is of een gecontroleerde uitslagcorrectie nodig is. Handmatige regels werken finishpositie, punten en straffen bij; ze vervangen geen iRacing-sessies of metadata.</p></div>{!selectedRace && <p className="mb-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-100">Kies vóór de definitieve import de echte kalender-race waarvoor je deze correctie invoert.</p>}<div className="min-w-[700px] space-y-2"><div className="grid grid-cols-[3rem_1fr_5rem_7rem_5rem_3rem_2rem] gap-2 px-1 text-[10px] font-black uppercase tracking-wider text-gray-500"><span>Pos</span><span>Coureur</span><span>Ronden</span><span>Beste ronde</span><span>Inc.</span><span>FL</span><span /></div>{rows.map((row, index) => <div className="grid grid-cols-[3rem_1fr_5rem_7rem_5rem_3rem_2rem] items-center gap-2" key={index}><span className="rounded bg-black/20 py-2 text-center text-sm font-black text-white">{row.position}</span><input value={row.display_name} onChange={(event) => updateRow(index, { display_name: event.target.value })} placeholder="Coureurnaam" list="control-room-driver-names" className="rounded border border-white/10 bg-black/20 px-2 py-2 text-sm text-white outline-none" /><input type="number" min="0" value={row.laps} onChange={(event) => updateRow(index, { laps: Number(event.target.value) || 0 })} className="rounded border border-white/10 bg-black/20 px-2 py-2 text-sm text-white outline-none" /><input value={row.best_lap} onChange={(event) => updateRow(index, { best_lap: event.target.value })} placeholder="1:23.456" className="rounded border border-white/10 bg-black/20 px-2 py-2 text-sm text-white outline-none" /><input type="number" min="0" value={row.incidents} onChange={(event) => updateRow(index, { incidents: Number(event.target.value) || 0 })} className="rounded border border-white/10 bg-black/20 px-2 py-2 text-sm text-white outline-none" /><input aria-label={`Snelste ronde ${row.display_name || index + 1}`} type="checkbox" checked={row.fastest_lap} onChange={(event) => updateRow(index, { fastest_lap: event.target.checked })} className="mx-auto h-4 w-4 accent-orange-500" /><button type="button" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index).map((item, rowIndex) => ({ ...item, position: rowIndex + 1 })))} className="text-gray-500 hover:text-red-300" aria-label="Rij verwijderen"><Trash2 className="h-4 w-4" /></button></div>)}<datalist id="control-room-driver-names">{profiles.map((profile) => <option key={profile.user_id} value={profile.display_name || profile.iracing_name || ""} />)}</datalist></div><button type="button" onClick={() => setRows((current) => [...current, emptyRow(current.length + 1)])} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-orange-300 hover:text-orange-200"><Plus className="h-4 w-4" /> Coureur toevoegen</button></div>}
          </section>

          <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151821]">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4"><div><p className="text-xs font-black uppercase tracking-wider text-gray-400">3. Participantmatches & punten</p><p className="mt-1 text-xs text-gray-500">iRacing-ID heeft voorrang; een naammatch blijft zichtbaar voor controle.</p></div><span className="text-xs font-bold text-gray-300">{profilesLoading ? "Profielen laden…" : `${matched.length}/${participants.length} gekoppeld`}</span></div>
            {profilesError && <p className="m-4 text-xs text-red-300">Profielen konden niet worden geladen: {profilesError.message}</p>}
            {participants.length ? <div className="overflow-x-auto"><div className="min-w-[740px]"><div className="grid grid-cols-[3rem_1fr_10rem_6rem_5rem_7rem] gap-3 bg-white/[0.025] px-5 py-3 text-[10px] font-black uppercase tracking-wider text-gray-500"><span>Pos</span><span>Coureur</span><span>Match</span><span>Basis</span><span>FL</span><span>Punten</span></div>{participants.map((participant) => <div className="grid grid-cols-[3rem_1fr_10rem_6rem_5rem_7rem] gap-3 border-t border-white/[0.06] px-5 py-3 text-sm" key={`${participant.row.position}-${participant.row.display_name}`}><span className="font-heading font-black text-white">P{participant.row.position}</span><span><strong className="text-white">{participant.row.display_name}</strong><span className="ml-2 text-xs text-gray-500">{participant.row.car_name || ""}</span></span><span className={`text-xs font-bold ${matchCopy[participant.matchStatus].className}`}>{participant.matchStatus === "unmatched" ? <XCircle className="mr-1 inline h-3.5 w-3.5" /> : <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />}{matchCopy[participant.matchStatus].label}</span><span className="text-gray-300">{points[participant.row.position - 1] ?? 0}</span><span className="text-gray-300">{participant.row.fastest_lap ? "+1" : "—"}</span><span className="font-black text-orange-200">{participant.points} pt</span></div>)}</div></div> : <p className="p-5 text-sm text-gray-500">Upload JSON of voeg handmatig minstens één coureur toe.</p>}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-orange-400/20 bg-orange-400/[0.06] p-5"><p className="text-xs font-black uppercase tracking-wider text-orange-200">Impact-preview</p><div className="mt-4 space-y-3 text-sm"><p className="flex justify-between text-gray-300"><span>Uitslagregels</span><strong className="text-white">{impact.resultRows}</strong></p><p className="flex justify-between text-gray-300"><span>Gekoppelde coureurs</span><strong className="text-emerald-300">{impact.matchedDrivers}</strong></p><p className="flex justify-between text-gray-300"><span>Onopgelost</span><strong className={impact.unmatchedDrivers ? "text-red-300" : "text-gray-500"}>{impact.unmatchedDrivers}</strong></p><p className="flex justify-between text-gray-300"><span>Bestaande resultaten</span><strong className={impact.existingResults ? "text-amber-200" : "text-white"}>{impact.existingResults}</strong></p><p className="flex justify-between text-gray-300"><span>Profielupdates (SR/iRating)</span><strong className="text-white">{impact.profileUpdates}</strong></p>{mode === "json" && <><p className="flex justify-between text-gray-300"><span>Training vervangen</span><strong className="text-white">{impact.practiceRows}</strong></p><p className="flex justify-between text-gray-300"><span>Kwalificatie vervangen</span><strong className="text-white">{impact.qualifyingRows}</strong></p></>}</div></section>
          <section className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-5"><Trophy className="h-5 w-5 text-orange-300" /><p className="mt-3 text-sm font-bold text-white">Puntenpreview</p><p className="mt-1 text-xs leading-relaxed text-gray-400">Punten per positie + één punt voor snelste ronde. De ingestelde puntenreeks komt via de props van de integratie.</p><div className="mt-3 flex flex-wrap gap-1.5">{participants.slice(0, 8).map((participant) => <span className="rounded bg-black/15 px-2 py-1 text-[11px] text-gray-300" key={participant.row.position}>P{participant.row.position}: <b className="text-white">{participant.points}</b></span>)}</div></section>
          <button type="button" onClick={requestConfirmation} disabled={!canConfirm} aria-describedby="result-import-confirmation-blocker" className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-racing px-4 py-3 text-sm font-black text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"><Upload className="h-4 w-4" />Bekijk definitieve live-impact</button>
          {confirmationBlocker ? <p id="result-import-confirmation-blocker" className="text-center text-xs leading-relaxed text-gray-400">{confirmationBlocker}</p> : <p id="result-import-confirmation-blocker" className="text-center text-xs leading-relaxed text-emerald-300">Klaar voor de impactcontrole. Er wordt nog niets geschreven totdat je in het volgende scherm bevestigt.</p>}
        </aside>
      </div>

      {confirming && selectedRace && <div className="fixed inset-0 z-[100] flex items-end bg-black/70 p-4 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="result-import-confirm-title"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-amber-400/30 bg-[#151821] p-6 shadow-2xl"><div className="flex gap-3"><ShieldAlert className="h-6 w-6 shrink-0 text-amber-300" /><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-200">Definitieve importbevestiging</p><h3 id="result-import-confirm-title" className="mt-1 font-heading text-xl font-black text-white">Controleer alle live wijzigingen</h3><p className="mt-1 text-sm text-gray-400">{selectedRace.name} · {impact.resultRows} resultaten · de productie-import start uitsluitend na deze bevestiging.</p></div></div>{writeError && <p role="alert" className="mt-4 rounded-lg border border-red-400/25 bg-red-400/[0.08] p-3 text-sm text-red-100">Import mislukt: {writeError}</p>}

        <section className="mt-5 rounded-xl border border-orange-400/25 bg-orange-400/[0.06] p-4" aria-labelledby="result-import-hosting-title">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 id="result-import-hosting-title" className="font-bold text-orange-100">Racehosting</h4>
              <p className="mt-1 text-xs leading-relaxed text-gray-400">Leg de iRacing-hostingkosten tegelijk met de uitslag vast. De USD/EUR-koers wordt bij de eerste boeking bevroren.</p>
            </div>
            <span className="shrink-0 rounded-full bg-black/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-orange-200">Community Support</span>
          </div>

          {!hostingEligible ? <p className="mt-4 rounded-lg border border-white/10 bg-black/15 p-3 text-sm text-gray-300">Dit raceformat valt buiten de huidige racekostenregeling. De resultaten kunnen wel normaal worden geïmporteerd.</p> : existingHostingCost ? <div className="mt-4 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.07] p-3 text-sm text-emerald-100">
            <p className="font-bold">Racehosting is al geboekt en blijft ongewijzigd.</p>
            <p className="mt-1 text-xs text-emerald-100/80">{existingHostingCost.hostedHours} uur · {existingHostingCost.discountApplied ? "25% korting" : "geen korting"} · ${existingHostingCost.sourceAmountUsd.toFixed(2)} · €{existingHostingCost.amount.toFixed(2)} · koers {existingHostingCost.exchangeRateUsdEur.toFixed(4)}</p>
          </div> : <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-black uppercase tracking-wider text-gray-400">Gehoste uren
              <input type="number" min="1" max="24" step="1" inputMode="numeric" value={hostingHours} disabled={submitting} onChange={(event) => setHostingHours(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-orange-400/50 disabled:opacity-50" />
              {normalizedHostingHours === null && <span role="alert" className="mt-1 block normal-case tracking-normal text-red-300">Vul een heel aantal uren van 1 t/m 24 in.</span>}
            </label>
            <label className="flex min-h-[4.55rem] cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/15 px-3 py-2.5 text-sm font-bold text-gray-200">
              <span>25% korting toegepast</span>
              <input type="checkbox" checked={hostingDiscountApplied} disabled={submitting} onChange={(event) => setHostingDiscountApplied(event.target.checked)} className="h-4 w-4 accent-orange-500" />
            </label>
            <div className="sm:col-span-2 grid gap-2 rounded-lg bg-black/20 p-3 text-xs sm:grid-cols-3">
              <p className="text-gray-400">Bronbedrag<br /><strong className="text-white">${hostingSourceAmountUsd.toFixed(2)}</strong></p>
              <p className="text-gray-400">Koerssnapshot<br /><strong className="text-white">{supportState.settings.usdEurRate.toFixed(4)}</strong></p>
              <p className="text-gray-400">Te boeken uitgave<br /><strong className="text-lg text-orange-200">€{hostingAmountEur.toFixed(2)}</strong></p>
            </div>
          </div>}
        </section>

        {lockedCarMismatches.length > 0 && <section className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/[0.08] p-4"><h4 className="flex items-center gap-2 font-bold text-amber-100"><AlertTriangle className="h-4 w-4 text-amber-300" />Vergrendelde auto komt niet overeen</h4><p className="mt-1 text-xs leading-relaxed text-amber-100/85">Kies per coureur expliciet voor diskwalificatie. Alleen dan verandert de classificatie en worden de niet-gediskwalificeerde coureurs opnieuw gepositioneerd en van punten voorzien. Zonder keuze wordt de JSON-import normaal verwerkt.</p><div className="mt-3 space-y-2">{lockedCarMismatches.map((mismatch) => { const selected = dqUserIds.includes(mismatch.userId); return <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-300/15 bg-black/15 p-3 text-sm" key={mismatch.userId}><input type="checkbox" checked={selected} disabled={submitting} onChange={() => setDqUserIds((current) => selected ? current.filter((id) => id !== mismatch.userId) : [...current, mismatch.userId])} className="mt-0.5 h-4 w-4 accent-orange-500" /><span><strong className="text-white">{mismatch.driver}</strong><span className="block text-xs text-amber-100/80">Vergrendeld: {mismatch.lockedCar} · JSON: {mismatch.importedCar}</span><span className="mt-1 block text-xs font-bold text-orange-200">{selected ? "DQ geselecteerd: DNF, 0 punten en herclassificatie." : "Geen DQ geselecteerd: import blijft ongewijzigd."}</span></span></label>; })}</div></section>}<ul className="mt-5 space-y-3 text-sm text-gray-300"><li><b className="text-white">Resultaten:</b> {impact.resultRows} race_results worden geüpsert; {impact.existingResults ? `${impact.existingResults} bestaande uitslagen kunnen worden overschreven.` : "geen bestaande uitslagregels gevonden."}</li><li><b className="text-white">Profielen:</b> {impact.profileUpdates} SR/iRating-snapshots bevatten alle benodigde iRacing-waarden en worden bijgewerkt.</li><li><b className="text-white">Race-status:</b> race wordt <code>completed</code>, telt voor 3SR en JSON-metadata (sessie, SOF, cauties, kopwisselingen, weer) wordt opgeslagen indien aanwezig.</li>{mode === "json" && <li><b className="text-white">Sessies:</b> alle bestaande practice/qualifying sessieresultaten voor deze race worden verwijderd en vervangen door {impact.practiceRows + impact.qualifyingRows} JSON-regels.</li>}<li><b className="text-white">Straffen:</b> bestaande puntenaftrek-straffen voor deze race worden na de result-upsert opnieuw op de punten toegepast.</li><li><b className="text-white">3SR:</b> 3SR wordt opnieuw berekend via <code>recalculate_3sr_for_race</code>.</li><li><b className="text-white">Auto-keuzes:</b> voor maximaal {impact.carChoiceCandidates} gekoppelde coureurs met een auto in de import worden ontgrendelde season- en race-registratiekeuzes bijgewerkt.</li></ul><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setConfirming(false)} disabled={submitting} className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-bold text-gray-300 hover:bg-white/5">Annuleren</button><button type="button" onClick={confirm} disabled={submitting || !hostingReady} className="rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50">{submitting ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : null}{submitting ? `Importeren: ${writeProgress || "voorbereiden"}…` : existingHostingCost ? "Resultaten opslaan · racekosten behouden" : hostingEligible ? "Resultaten opslaan en racekosten boeken" : "Bevestig en importeer resultaten"}</button></div></div></div>}
    </section>
  );
}

export default ResultImportWorkspace;
