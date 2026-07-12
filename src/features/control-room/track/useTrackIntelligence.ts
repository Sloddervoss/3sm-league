import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  analyzeTrackHistory,
  buildMemberTrackRowsFromSiteResults,
  getMemberTrackDedupeKey,
  type MemberTrackHistoryRow,
  type SiteRaceForTrackImport,
} from "@/lib/trackIntelligence";
import type { LinkedTrackProfile, TrackIntelligenceData, TrackRun } from "./types";

const TRACK_SYNC_BATCH_SIZE = 3;

type DbRaceResult = {
  user_id: string;
  iracing_cust_id: string | null;
  profiles: SiteRaceForTrackImport["results"][number]["profiles"];
};

type DbRace = {
  id: string;
  track: string | null;
  race_date: string | null;
  iracing_session_id: string | null;
  leagues: { name: string | null } | null;
  race_results: DbRaceResult[] | null;
};

type SyncResult = { createdRecords: number; warning: string | null };

const upsertHistoryRows = async (rows: MemberTrackHistoryRow[]) => {
  if (!rows.length) return 0;
  const payload = rows.map((row) => ({
    member_id: row.member_id,
    iracing_customer_id: row.iracing_customer_id,
    iracing_name: row.iracing_name,
    track_id: row.track_id,
    track_name: row.track_name,
    race_date: row.race_date,
    subsession_id: row.subsession_id,
    series_name: row.series_name,
    source: row.source,
    dedupe_key: getMemberTrackDedupeKey(row),
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
  }));

  const { error } = await supabase
    .from("member_track_history" as never)
    .upsert(payload as never[], { onConflict: "member_id,source,dedupe_key" });
  if (error) throw error;
  return payload.length;
};

const readError = (label: string, error: unknown) =>
  `${label}: ${error instanceof Error ? error.message : "onbekende fout"}`;

/** Read-only data access. Sync execution stays with the parent Control Room action router. */
export function useTrackIntelligence(): TrackIntelligenceData {
  const linkedProfilesQuery = useQuery({
    queryKey: ["control-room", "track-intelligence", "linked-profiles"],
    queryFn: async (): Promise<LinkedTrackProfile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, iracing_name, iracing_id")
        .not("iracing_id", "is", null);
      if (error) throw error;
      return ((data || []) as LinkedTrackProfile[]).filter((profile) => Boolean(String(profile.iracing_id || "").trim()));
    },
  });

  const historyQuery = useQuery({
    queryKey: ["control-room", "track-intelligence", "history"],
    queryFn: async (): Promise<MemberTrackHistoryRow[]> => {
      const { data, error } = await supabase
        .from("member_track_history" as never)
        .select("id, member_id, iracing_customer_id, iracing_name, track_id, track_name, race_date, subsession_id, series_name, source, first_seen_at, last_seen_at")
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as MemberTrackHistoryRow[];
    },
  });

  const runsQuery = useQuery({
    queryKey: ["control-room", "track-intelligence", "runs"],
    queryFn: async (): Promise<TrackRun[]> => {
      const { data, error } = await supabase
        .from("track_intelligence_runs" as never)
        .select("id, started_at, finished_at, status, triggered_by_admin_id, trigger_type, members_total, members_success, members_failed, created_records, error_summary")
        .order("started_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as unknown as TrackRun[];
    },
  });

  const linkedProfiles = linkedProfilesQuery.data;
  const historyRows = historyQuery.data;
  const insights = useMemo(
    () => analyzeTrackHistory(historyRows || [], linkedProfiles?.length || 0),
    [historyRows, linkedProfiles?.length],
  );
  const errors = [
    linkedProfilesQuery.error && readError("Gekoppelde members konden niet worden geladen", linkedProfilesQuery.error),
    historyQuery.error && readError("Trackhistorie kon niet worden geladen", historyQuery.error),
    runsQuery.error && readError("Sync-log kon niet worden geladen", runsQuery.error),
  ].filter((message): message is string => Boolean(message));

  return {
    linkedProfiles: linkedProfiles || [],
    insights,
    runs: runsQuery.data || [],
    loading: linkedProfilesQuery.isLoading || historyQuery.isLoading || runsQuery.isLoading,
    errors,
  };
}

/**
 * Live counterpart of TrackIntelligenceTestPage's manual sync. It imports site
 * result JSON, then invokes the existing Edge Function in three-member batches.
 */
export function useTrackIntelligenceSync(linkedProfiles: LinkedTrackProfile[]) {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<string | null>(null);
  const canManageTrackIntelligence = Boolean(user && (isAdmin || isSuperAdmin));

  const mutation = useMutation({
    mutationFn: async (): Promise<SyncResult> => {
      if (!user) throw new Error("Niet ingelogd");
      if (!canManageTrackIntelligence) throw new Error("Je hebt admin- of super-adminrechten nodig om Track Intelligence te synchroniseren");

      const { data: runData, error: runError } = await supabase
        .from("track_intelligence_runs" as never)
        .insert({
          started_at: new Date().toISOString(),
          status: "running",
          triggered_by_admin_id: user.id,
          trigger_type: "manual",
          members_total: linkedProfiles.length,
          members_success: 0,
          members_failed: 0,
          created_records: 0,
          error_summary: null,
        } as never)
        .select("id")
        .single();
      if (runError) throw runError;
      const runId = (runData as { id: string }).id;

      let createdRecords = 0;
      let membersSuccess = 0;
      let membersFailed = 0;
      let errorSummary: string | null = null;
      setProgress("Site-result JSON wordt geïmporteerd; daarna wordt de iRacing synchronisatie gestart.");

      try {
        const { data: racesData, error: racesError } = await supabase
          .from("races")
          .select("id, track, race_date, iracing_session_id, leagues(name), race_results(user_id, iracing_cust_id, profiles(display_name, iracing_name, iracing_id))")
          .not("track", "is", null);
        if (racesError) throw racesError;

        const siteRows = buildMemberTrackRowsFromSiteResults(((racesData || []) as unknown as DbRace[]).map((race) => ({
          id: race.id,
          track: race.track,
          race_date: race.race_date,
          iracing_session_id: race.iracing_session_id,
          league_name: race.leagues?.name ?? null,
          results: race.race_results || [],
        })));
        createdRecords += await upsertHistoryRows(siteRows);

        const batches: LinkedTrackProfile[][] = [];
        for (let index = 0; index < linkedProfiles.length; index += TRACK_SYNC_BATCH_SIZE) {
          batches.push(linkedProfiles.slice(index, index + TRACK_SYNC_BATCH_SIZE));
        }

        const batchErrors: string[] = [];
        for (const [batchIndex, batch] of batches.entries()) {
          setProgress(`iRacing synchronisatie batch ${batchIndex + 1}/${batches.length} (${batch.length} members)…`);
          try {
            const { data: syncResult, error: syncError } = await supabase.functions.invoke("track-intelligence-sync", {
              body: {
                run_id: runId,
                trigger_type: "manual",
                member_ids: batch.map((profile) => profile.user_id),
                max_members: TRACK_SYNC_BATCH_SIZE,
                batch_index: batchIndex + 1,
                batch_total: batches.length,
              },
            });
            if (syncError) throw syncError;
            if (syncResult?.error) throw new Error(syncResult.error);
            if (typeof syncResult?.created_records === "number") createdRecords += syncResult.created_records;
            if (typeof syncResult?.members_success === "number") membersSuccess += syncResult.members_success;
            if (typeof syncResult?.members_failed === "number") membersFailed += syncResult.members_failed;
            if (typeof syncResult?.error_summary === "string" && syncResult.error_summary.trim()) {
              batchErrors.push(syncResult.error_summary.trim());
            }

            await supabase
              .from("track_intelligence_runs" as never)
              .update({
                members_success: membersSuccess,
                members_failed: membersFailed,
                created_records: createdRecords,
                error_summary: batchErrors.join("\n") || null,
              } as never)
              .eq("id", runId);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Onbekende batchfout";
            membersFailed += batch.length;
            batchErrors.push(`Batch ${batchIndex + 1}/${batches.length}: ${message}`);
          }
        }
        errorSummary = batchErrors.join("\n") || null;
      } catch (error) {
        errorSummary = error instanceof Error ? error.message : "Onbekende syncfout";
      }

      const { error: finalRunError } = await supabase
        .from("track_intelligence_runs" as never)
        .update({
          finished_at: new Date().toISOString(),
          status: errorSummary ? "completed_with_errors" : "completed",
          members_success: membersSuccess,
          members_failed: errorSummary && membersFailed === 0 ? linkedProfiles.length : membersFailed,
          created_records: createdRecords,
          error_summary: errorSummary,
        } as never)
        .eq("id", runId);
      if (finalRunError) throw finalRunError;

      return { createdRecords, warning: errorSummary };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["control-room", "track-intelligence"] }),
        queryClient.invalidateQueries({ queryKey: ["track-intelligence-history"] }),
        queryClient.invalidateQueries({ queryKey: ["track-intelligence-runs"] }),
      ]);
    },
  });

  return { ...mutation, canSync: canManageTrackIntelligence, progress };
}
