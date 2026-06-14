import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, CalendarDays, Download, FileJson, Flag, History, Lock, Play, Search, ShieldCheck, Timer, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  analyzeTrackHistory,
  buildMemberTrackRowsFromSiteResults,
  getMemberTrackDedupeKey,
  toCsv,
  type MemberTrackHistoryRow,
  type SiteRaceForTrackImport,
  type TrackIntelligenceSource,
} from "@/lib/trackIntelligence";

type TrackRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  triggered_by_admin_id: string | null;
  trigger_type: string;
  members_total: number | null;
  members_success: number | null;
  members_failed: number | null;
  created_records: number | null;
  error_summary: string | null;
};

type LinkedProfile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  iracing_id: string | null;
};

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

const sourceLabels: Record<TrackIntelligenceSource, string> = {
  iracing_recent_races: "iRacing recente races",
  site_result_json: "Site result JSON",
  extension_scan: "Extensie scan",
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Amsterdam",
  });
};

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

const TrackIntelligenceTestPage = () => {
  const { user, isAdmin, loading } = useAuth();
  const queryClient = useQueryClient();
  const [sourceFilter, setSourceFilter] = useState<"all" | TrackIntelligenceSource>("all");
  const [search, setSearch] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const { data: linkedProfiles = [] } = useQuery({
    queryKey: ["track-intelligence-linked-profiles"],
    enabled: !!user && isAdmin,
    queryFn: async (): Promise<LinkedProfile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, iracing_name, iracing_id")
        .not("iracing_id", "is", null);
      if (error) throw error;
      return ((data || []) as LinkedProfile[]).filter((profile) => String(profile.iracing_id || "").trim());
    },
  });

  const { data: historyRows = [] } = useQuery({
    queryKey: ["track-intelligence-history"],
    enabled: !!user && isAdmin,
    queryFn: async (): Promise<MemberTrackHistoryRow[]> => {
      const { data, error } = await supabase
        .from("member_track_history" as never)
        .select("id, member_id, iracing_customer_id, iracing_name, track_id, track_name, race_date, subsession_id, series_name, source, first_seen_at, last_seen_at")
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as MemberTrackHistoryRow[];
    },
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["track-intelligence-runs"],
    enabled: !!user && isAdmin,
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

  const insights = useMemo(() => analyzeTrackHistory(historyRows, linkedProfiles.length), [historyRows, linkedProfiles.length]);
  const filteredInsights = useMemo(() => insights.filter((track) => {
    const matchesSource = sourceFilter === "all" || track.sources.includes(sourceFilter);
    const matchesSearch = track.trackName.toLowerCase().includes(search.trim().toLowerCase());
    return matchesSource && matchesSearch;
  }), [insights, search, sourceFilter]);

  const recommendedSeason = useMemo(() => insights.slice(0, 13), [insights]);
  const topTenTracks = useMemo(() => insights.slice(0, 10), [insights]);
  const maxTrackMembers = topTenTracks[0]?.uniqueMemberCount || 1;
  const highReliabilityCount = insights.filter((track) => track.reliability === "Hoog").length;
  const mediumReliabilityCount = insights.filter((track) => track.reliability === "Middel").length;
  const extensionScanRows = historyRows.filter((row) => row.source === "extension_scan").length;
  const sourceCounts = useMemo(() => {
    const counts: Record<TrackIntelligenceSource, number> = {
      iracing_recent_races: 0,
      site_result_json: 0,
      extension_scan: 0,
    };
    historyRows.forEach((row) => {
      counts[row.source] = (counts[row.source] || 0) + 1;
    });
    return counts;
  }, [historyRows]);
  const averageSeasonCoverage = recommendedSeason.length
    ? Math.round((recommendedSeason.reduce((sum, track) => sum + track.percentage, 0) / recommendedSeason.length) * 10) / 10
    : 0;

  const lastRun = runs[0];
  const lastRunErrors = lastRun?.members_failed ?? (lastRun?.error_summary ? 1 : 0);
  const scannedMembers = lastRun?.members_success ?? 0;

  const startSync = useMutation({
    mutationFn: async () => {
      const startedAt = new Date().toISOString();
      setSyncMessage("Site-result JSON wordt geïmporteerd; daarna wordt de iRacing synchronisatie gestart.");

      const { data: runData, error: runError } = await supabase
        .from("track_intelligence_runs" as never)
        .insert({
          started_at: startedAt,
          status: "running",
          triggered_by_admin_id: user?.id ?? null,
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

        const { data: syncResult, error: syncError } = await supabase.functions.invoke("track-intelligence-sync", {
          body: { run_id: runId, trigger_type: "manual" },
        });
        if (syncError) throw syncError;
        if (syncResult?.error) throw new Error(syncResult.error);
        if (typeof syncResult?.created_records === "number") createdRecords += syncResult.created_records;
        if (typeof syncResult?.members_success === "number") membersSuccess = syncResult.members_success;
        if (typeof syncResult?.members_failed === "number") membersFailed = syncResult.members_failed;
        if (typeof syncResult?.error_summary === "string" && syncResult.error_summary.trim()) errorSummary = syncResult.error_summary;
      } catch (error) {
        errorSummary = error instanceof Error ? error.message : "Onbekende syncfout";
      }

      const finishedAt = new Date().toISOString();
      await supabase
        .from("track_intelligence_runs" as never)
        .update({
          finished_at: finishedAt,
          status: errorSummary ? "completed_with_errors" : "completed",
          members_success: membersSuccess,
          members_failed: errorSummary && membersFailed === 0 ? linkedProfiles.length : membersFailed,
          created_records: createdRecords,
          error_summary: errorSummary,
        } as never)
        .eq("id", runId);

      if (errorSummary) {
        return { createdRecords, warning: errorSummary };
      }
      return { createdRecords, warning: null };
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["track-intelligence-history"] }),
        queryClient.invalidateQueries({ queryKey: ["track-intelligence-runs"] }),
      ]);
      if (result.warning) {
        toast.warning("Synchronisatie afgerond met fouten; bekijk de sync log.");
        setSyncMessage(`Sync afgerond met fouten: ${result.warning}`);
      } else {
        toast.success(`Synchronisatie klaar — ${result.createdRecords} records verwerkt`);
        setSyncMessage(`Synchronisatie klaar — ${result.createdRecords} records verwerkt.`);
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Synchronisatie mislukt";
      toast.error(message);
      setSyncMessage(message);
    },
  });

  const exportCsv = () => {
    const blob = new Blob([toCsv(filteredInsights)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `3sm-track-intelligence-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSeasonCsv = () => {
    const rows = [
      ["Week", "Track", "Aantal members", "Percentage", "Betrouwbaarheid", "Bronnen"],
      ...recommendedSeason.map((track, index) => [
        String(index + 1),
        track.trackName,
        String(track.uniqueMemberCount),
        `${track.percentage}%`,
        track.reliability,
        track.sources.map((source) => sourceLabels[source]).join(" + "),
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `3sm-13-week-track-shortlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return null;
  if (!user) return <Navigate to="/auth" />;
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-24 container mx-auto px-4 min-h-screen">
          <div className="bg-card border border-border rounded-xl p-8 text-center max-w-xl mx-auto">
            <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h1 className="font-heading text-2xl font-black mb-2">GEEN TOEGANG</h1>
            <p className="text-muted-foreground">Je hebt admin rechten nodig om deze pagina te bekijken.</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="border-b border-border bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.16),transparent_34%),linear-gradient(180deg,rgba(24,26,32,0.95),transparent)]">
          <div className="container mx-auto px-4 py-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-3xl">
                <div className="flex items-center gap-2 mb-2 text-accent uppercase tracking-[0.18em] text-xs font-black">
                  <Flag className="w-4 h-4" /> Admin tool
                </div>
                <h1 className="font-heading text-3xl md:text-5xl font-black uppercase">3 Stripe Track Intelligence</h1>
                <p className="text-muted-foreground mt-3 leading-relaxed">
                  Analyseert echte iRacing racehistorie en extensie-scans van gekoppelde members om te zien welke tracks het meest voorkomen voor kalenderplanning.
                </p>
              </div>
              <button
                onClick={() => startSync.mutate()}
                disabled={startSync.isPending}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-gradient-racing text-white font-heading font-bold uppercase tracking-wider text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {startSync.isPending ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play className="w-4 h-4" />}
                {startSync.isPending ? "Sync draait..." : "Synchroniseren"}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href="/iracing-content-extension.zip?v=0.5.0"
                download
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:border-accent text-sm transition-colors"
              >
                <Download className="w-4 h-4" />
                Download iRacing Content Extension (ZIP)
              </a>
              <a
                href="https://github.com/Sloddervoss/3sm-league/tree/main/tools/iracing-content-extension"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:border-accent text-sm transition-colors"
              >
                <FileJson className="w-4 h-4" />
                Bekijk broncode op GitHub
              </a>
            </div>
            <div className="mt-5 border border-accent/25 bg-accent/5 rounded-lg px-4 py-3 text-sm text-muted-foreground flex gap-2">
              <ShieldCheck className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              <p>Deze tool gebruikt bestaande iRacing Customer IDs van members om gereden tracks te analyseren voor kalenderplanning. Er wordt geen wachtwoord van members gevraagd en er wordt geen exacte content ownership geclaimd.</p>
            </div>
            {syncMessage && (
              <div className="mt-4 border border-border bg-card rounded-lg px-4 py-3 text-sm text-muted-foreground">{syncMessage}</div>
            )}
          </div>
        </section>

        <section className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
            {[
              { label: "Gekoppelde members", value: linkedProfiles.length, icon: Users },
              { label: "Members succesvol gescand", value: scannedMembers, icon: ShieldCheck },
              { label: "Tracks gevonden", value: insights.length, icon: Flag },
              { label: "Laatste sync", value: lastRun ? formatDateTime(lastRun.finished_at || lastRun.started_at) : "—", icon: Timer },
              { label: "Fouten laatste sync", value: lastRunErrors, icon: AlertTriangle },
            ].map((stat) => (
              <div key={stat.label} className="bg-card border border-border rounded-lg p-4 relative overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-1 bg-accent/80" />
                <stat.icon className="w-5 h-5 text-accent mb-2" />
                <div className="font-heading text-2xl font-black tabular-nums">{stat.value}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">{stat.label}</div>
              </div>
            ))}
          </div>

          {historyRows.length > 0 && (
            <div className="grid xl:grid-cols-[1.15fr_0.85fr] gap-6 mb-8">
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-5 border-b border-border flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-accent uppercase tracking-[0.16em] text-xs font-black mb-2">
                      <CalendarDays className="w-4 h-4" /> 13 weken shortlist
                    </div>
                    <h2 className="font-heading text-2xl font-black uppercase">Seizoenadvies op basis van member-dekking</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Startpunt voor kalenderplanning: tracks met de meeste aantoonbaar rijdende members bovenaan. Claimt geen ownership.
                    </p>
                  </div>
                  <button
                    onClick={exportSeasonCsv}
                    disabled={!recommendedSeason.length}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/15 text-sm disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" /> Export 13 weken
                  </button>
                </div>
                <div className="p-5 grid sm:grid-cols-3 gap-3 border-b border-border bg-background/25">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Gem. dekking top 13</div>
                    <div className="font-heading text-3xl font-black text-accent tabular-nums">{averageSeasonCoverage}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Hoog betrouwbaar</div>
                    <div className="font-heading text-3xl font-black text-green-400 tabular-nums">{recommendedSeason.filter((track) => track.reliability === "Hoog").length}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Beschikbaar voor schema</div>
                    <div className="font-heading text-3xl font-black tabular-nums">{recommendedSeason.length}/13</div>
                  </div>
                </div>
                <div className="divide-y divide-border/70">
                  {recommendedSeason.map((track, index) => (
                    <div key={`${track.trackId || track.trackName}-season`} className="grid grid-cols-[3.5rem_1fr_5.5rem] gap-3 px-4 py-3 items-center hover:bg-secondary/20">
                      <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/30 text-accent font-heading font-black flex items-center justify-center">W{index + 1}</div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{track.trackName}</div>
                        <div className="mt-1 h-2 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-accent to-orange-300" style={{ width: `${Math.min(track.percentage, 100)}%` }} />
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {track.uniqueMemberCount} members · {track.percentage}% · {track.sources.map((source) => sourceLabels[source]).join(" + ")}
                        </div>
                      </div>
                      <div className={track.reliability === "Hoog" ? "text-green-400 text-sm font-bold" : track.reliability === "Middel" ? "text-yellow-400 text-sm font-bold" : "text-muted-foreground text-sm font-bold"}>{track.reliability}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center gap-2 text-accent uppercase tracking-[0.16em] text-xs font-black mb-2">
                    <BarChart3 className="w-4 h-4" /> Trackdekking top 10
                  </div>
                  <div className="space-y-3">
                    {topTenTracks.map((track, index) => (
                      <div key={`${track.trackId || track.trackName}-bar`}>
                        <div className="flex justify-between gap-3 text-sm mb-1">
                          <span className="truncate"><span className="text-muted-foreground tabular-nums mr-2">#{index + 1}</span>{track.trackName}</span>
                          <span className="text-muted-foreground tabular-nums shrink-0">{track.uniqueMemberCount}/{linkedProfiles.length}</span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full bg-accent" style={{ width: `${Math.max(6, (track.uniqueMemberCount / maxTrackMembers) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-5">
                  <div className="flex items-center gap-2 text-accent uppercase tracking-[0.16em] text-xs font-black mb-3">
                    <Trophy className="w-4 h-4" /> Datakwaliteit
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Hoog / middel betrouwbaar</div>
                      <div className="font-heading text-2xl font-black">{highReliabilityCount + mediumReliabilityCount}</div>
                    </div>
                    <div className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Extensie records</div>
                      <div className="font-heading text-2xl font-black">{extensionScanRows}</div>
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    {(Object.keys(sourceCounts) as TrackIntelligenceSource[]).map((source) => {
                      const totalRows = Math.max(historyRows.length, 1);
                      const width = Math.round((sourceCounts[source] / totalRows) * 100);
                      return (
                        <div key={source}>
                          <div className="flex justify-between text-xs text-muted-foreground mb-1">
                            <span>{sourceLabels[source]}</span><span>{sourceCounts[source]}</span>
                          </div>
                          <div className="h-2 rounded-full bg-secondary overflow-hidden">
                            <div className="h-full bg-accent/80" style={{ width: `${width}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="font-heading text-2xl font-black uppercase">Trackanalyse</h2>
                <p className="text-sm text-muted-foreground">Alleen tracks die echt in iRacing-data of bestaande site-results gevonden zijn.</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Zoek track..." className="bg-background border border-border rounded-md pl-9 pr-3 py-2 text-sm outline-none focus:border-accent" />
                </div>
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as "all" | TrackIntelligenceSource)} className="bg-background border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-accent">
                  <option value="all">Alle bronnen</option>
                  <option value="iracing_recent_races">iRacing recente races</option>
                  <option value="site_result_json">Site result JSON</option>
                  <option value="extension_scan">Extensie scan</option>
                </select>
                <button onClick={exportCsv} disabled={!filteredInsights.length} className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:border-accent text-sm disabled:opacity-50">
                  <Download className="w-4 h-4" /> Export CSV
                </button>
                <button onClick={() => setShowLog((value) => !value)} className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border hover:border-accent text-sm">
                  <History className="w-4 h-4" /> Bekijk sync log
                </button>
              </div>
            </div>

            {!historyRows.length ? (
              <div className="p-10 text-center">
                <FileJson className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="font-heading text-xl font-black mb-2">Er is nog geen trackdata opgehaald.</p>
                <p className="text-muted-foreground">Synchroniseer iRacing-data of laat members de extensie-scan uploaden om de analyse te vullen.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[820px]">
                  <div className="grid grid-cols-[2fr_8rem_10rem_11rem_13rem_9rem] gap-3 px-4 py-3 text-xs font-black uppercase tracking-wider text-muted-foreground border-b border-border bg-secondary/30">
                    <span>Track</span><span>Aantal members</span><span>Percentage</span><span>Laatst gezien</span><span>Bronnen</span><span>Betrouwbaarheid</span>
                  </div>
                  {filteredInsights.map((track) => (
                    <div key={`${track.trackId || track.trackName}`} className="grid grid-cols-[2fr_8rem_10rem_11rem_13rem_9rem] gap-3 px-4 py-3 border-b border-border/70 text-sm items-center hover:bg-secondary/20">
                      <span className="font-medium">{track.trackName}</span>
                      <span>{track.uniqueMemberCount}</span>
                      <span className="tabular-nums">{track.percentage}% van gekoppelde members</span>
                      <span>{formatDateTime(track.lastSeenAt)}</span>
                      <span className="flex flex-wrap gap-1">{track.sources.map((source) => <span key={source} className="px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20 text-[11px]">{sourceLabels[source]}</span>)}</span>
                      <span className={track.reliability === "Hoog" ? "text-green-400" : track.reliability === "Middel" ? "text-yellow-400" : "text-muted-foreground"}>{track.reliability}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {showLog && (
            <div className="mt-6 bg-card border border-border rounded-xl p-4">
              <h2 className="font-heading text-xl font-black uppercase mb-4">Sync log</h2>
              {!runs.length ? <p className="text-sm text-muted-foreground">Nog geen syncs uitgevoerd.</p> : (
                <div className="space-y-3">
                  {runs.map((run) => (
                    <div key={run.id} className="border border-border rounded-lg p-4 bg-background/40">
                      <div className="flex flex-wrap justify-between gap-3 mb-2">
                        <div className="font-heading font-bold">{formatDateTime(run.started_at)} — {run.status}</div>
                        <div className="text-xs text-muted-foreground">{run.trigger_type === "manual" ? "Handmatig gestart" : run.trigger_type} {run.triggered_by_admin_id ? `door ${run.triggered_by_admin_id}` : ""}</div>
                      </div>
                      <div className="grid sm:grid-cols-5 gap-2 text-xs text-muted-foreground">
                        <span>Start: {formatDateTime(run.started_at)}</span>
                        <span>Eind: {formatDateTime(run.finished_at)}</span>
                        <span>Verwerkt: {run.members_total ?? 0}</span>
                        <span>Successen: {run.members_success ?? 0}</span>
                        <span>Fouten: {run.members_failed ?? 0}</span>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">Nieuwe track-records: {run.created_records ?? 0}</div>
                      {run.error_summary && <div className="mt-2 text-sm text-red-400 whitespace-pre-wrap">{run.error_summary}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default TrackIntelligenceTestPage;
