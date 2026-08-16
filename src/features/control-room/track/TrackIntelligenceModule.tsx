import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, CalendarDays, Download, ExternalLink, FileWarning, History, Play, ScanLine, Search, ShieldCheck, Timer, Users, X } from "lucide-react";
import { toCsv, type TrackInsight, type TrackIntelligenceSource, type TrackScannerMemberCoverage } from "@/lib/trackIntelligence";
import { useTrackIntelligence, useTrackIntelligenceSync } from "./useTrackIntelligence";
import type { TrackExportAction, TrackFilter, TrackIntelligenceAction, TrackRun } from "./types";

const sourceLabels: Record<TrackIntelligenceSource, string> = {
  iracing_recent_races: "iRacing recente races",
  site_result_json: "Site result JSON",
  extension_scan: "Extensie scan",
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  return new Date(value).toLocaleString("nl-NL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" });
};

const downloadCsv = (name: string, csv: string) => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

const shortlistCsv = (tracks: TrackInsight[]) => [
  ["Week", "Track", "Aantal members", "Percentage", "Betrouwbaarheid", "Bronnen"],
  ...tracks.map((track, index) => [String(index + 1), track.trackName, String(track.uniqueMemberCount), `${track.percentage}%`, track.reliability, track.sources.map((source) => sourceLabels[source]).join(" + ")]),
].map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(",")).join("\n");

export type TrackIntelligenceModuleProps = {
  /** Optional read-only intent notifications for the Control Room action router. */
  onAction?: (action: TrackIntelligenceAction) => void;
};

export function TrackIntelligenceModule({ onAction }: TrackIntelligenceModuleProps) {
  const { linkedProfiles, scannerMembers, insights, runs, loading, errors } = useTrackIntelligence();
  const sync = useTrackIntelligenceSync(linkedProfiles);
  const [sourceFilter, setSourceFilter] = useState<TrackFilter>("all");
  const [search, setSearch] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showScannerCoverage, setShowScannerCoverage] = useState(false);
  const [showSyncConfirmation, setShowSyncConfirmation] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{ tone: "success" | "warning" | "error"; message: string } | null>(null);

  const filteredInsights = useMemo(() => insights.filter((track) =>
    (sourceFilter === "all" || track.sources.includes(sourceFilter))
    && track.trackName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  ), [insights, search, sourceFilter]);
  const shortlist = useMemo(() => insights.slice(0, 13), [insights]);
  // Retain the legacy compact coverage chart: it is a separate planning aid
  // from both the 13-week shortlist and the full, filterable analysis table.
  const topCoverageTracks = useMemo(() => insights.slice(0, 30), [insights]);
  const maxTrackMembers = topCoverageTracks[0]?.uniqueMemberCount || 1;
  const lastRun = runs[0] || null;
  const lastRunErrors = lastRun?.members_failed ?? (lastRun?.error_summary ? 1 : 0);
  const averageCoverage = shortlist.length ? Math.round(shortlist.reduce((total, track) => total + track.percentage, 0) / shortlist.length * 10) / 10 : 0;
  const scannedMemberCount = scannerMembers.filter((member) => member.scanned).length;

  const dispatchExport = (scope: TrackExportAction["context"]["scope"], rowCount: number) => onAction?.({
    id: "track-export", impact: "read", allowedRoles: ["admin", "super_admin"], panel: "track-export", context: { scope, source: "csv", rowCount },
  });

  const confirmSync = async () => {
    setSyncFeedback(null);
    try {
      const result = await sync.mutateAsync();
      setShowSyncConfirmation(false);
      setSyncFeedback(result.warning
        ? { tone: "warning", message: `Synchronisatie afgerond met fouten: ${result.warning}` }
        : { tone: "success", message: `Synchronisatie klaar — ${result.createdRecords} records verwerkt.` });
    } catch (error) {
      setSyncFeedback({ tone: "error", message: error instanceof Error ? error.message : "Synchronisatie mislukt" });
    }
  };

  const openSyncConfirmation = () => {
    setSyncFeedback(null);
    setShowSyncConfirmation(true);
  };

  return (
    <section aria-label="Track Intelligence" className="space-y-6 text-gray-100">
      <header className="rounded-2xl border border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.15),transparent_38%),rgba(255,255,255,0.025)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Planning op echte data</p>
            <h2 className="mt-1 font-heading text-2xl font-black text-white">Track Intelligence</h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-400">Combineert opgeslagen site-resultaten, recente iRacing-races van gekoppelde members en Content Extension-scans. De dekking is kalenderadvies, geen claim over content ownership.</p>
          </div>
          {sync.canSync && <button type="button" disabled={sync.isPending} onClick={openSyncConfirmation} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-orange-400/35 bg-orange-500/15 px-4 py-2.5 text-sm font-bold text-orange-100 transition hover:border-orange-400 hover:bg-orange-500/25 disabled:cursor-wait disabled:opacity-60">
            <Play className="h-4 w-4" /> {sync.isPending ? "Synchronisatie draait…" : "Synchronisatie starten"}
          </button>}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => setShowScannerCoverage(true)} aria-haspopup="dialog" className="inline-flex items-center gap-2 rounded-md border border-orange-400/30 bg-orange-500/[0.08] px-3 py-2 text-xs font-bold text-orange-100 transition hover:border-orange-400/60 hover:bg-orange-500/[0.14]">
            <ScanLine className="h-4 w-4" /> Scannerdekking <span className="rounded bg-black/20 px-1.5 py-0.5 font-black tabular-nums text-white">{scannedMemberCount}/{scannerMembers.length}</span>
          </button>
          <a href="/iracing-content-extension.zip?v=0.6.2" download className="inline-flex items-center gap-2 rounded-md border border-white/[0.1] px-3 py-2 text-xs font-bold text-gray-300 transition hover:border-orange-400/40 hover:text-white"><Download className="h-4 w-4" /> Content Extension downloaden</a>
          <a href="https://github.com/Sloddervoss/3sm-league/tree/main/tools/iracing-content-extension" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border border-white/[0.1] px-3 py-2 text-xs font-bold text-gray-300 transition hover:border-orange-400/40 hover:text-white"><ExternalLink className="h-4 w-4" /> Extensie broncode</a>
        </div>
      </header>

      {showSyncConfirmation && <section role="dialog" aria-modal="true" aria-labelledby="track-sync-confirmation-title" className="rounded-2xl border border-orange-400/30 bg-orange-500/[0.08] p-5 shadow-2xl shadow-black/20">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-wider text-orange-300">Productieactie</p><h3 id="track-sync-confirmation-title" className="mt-1 font-heading text-xl font-black text-white">Track Intelligence synchroniseren?</h3></div>{!sync.isPending && <button type="button" onClick={() => setShowSyncConfirmation(false)} aria-label="Synchronisatiebevestiging sluiten" className="rounded-md p-1 text-gray-400 hover:bg-white/[0.07] hover:text-white"><X className="h-5 w-5" /></button>}</div>
        <p className="mt-3 text-sm leading-relaxed text-gray-300">Dit importeert site-result JSON en start daarna de bestaande iRacing Edge Function voor <strong className="text-white">{linkedProfiles.length} gekoppelde members</strong>, in batches van maximaal 3. De actie schrijft naar de live trackhistorie en het sync-log.</p>
        {sync.isPending && <p role="status" className="mt-4 rounded-lg border border-orange-400/20 bg-black/20 p-3 text-sm text-orange-100">{sync.progress || "Synchronisatie wordt voorbereid…"}</p>}
        {syncFeedback?.tone === "error" && <p role="alert" className="mt-4 rounded-lg border border-red-400/25 bg-red-500/[0.08] p-3 text-sm text-red-100">{syncFeedback.message}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-3"><button type="button" disabled={sync.isPending} onClick={() => setShowSyncConfirmation(false)} className="rounded-md border border-white/[0.12] px-3 py-2 text-sm font-bold text-gray-300 disabled:opacity-50">Annuleren</button><button type="button" disabled={sync.isPending} onClick={() => void confirmSync()} className="inline-flex items-center gap-2 rounded-md bg-orange-500 px-3 py-2 text-sm font-black text-white transition hover:bg-orange-400 disabled:cursor-wait disabled:opacity-60"><Play className="h-4 w-4" /> {sync.isPending ? "Bezig met synchroniseren…" : "Ja, start live sync"}</button></div>
      </section>}

      {syncFeedback && syncFeedback.tone !== "error" && <div role="status" className={syncFeedback.tone === "success" ? "flex gap-3 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.08] p-4 text-sm text-emerald-100" : "flex gap-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] p-4 text-sm text-amber-100"}><ShieldCheck className="h-5 w-5 shrink-0" /><p>{syncFeedback.message}</p></div>}

      {errors.map((error) => <div key={error} role="alert" className="flex gap-3 rounded-xl border border-red-400/25 bg-red-500/[0.08] p-4 text-sm text-red-100"><FileWarning className="h-5 w-5 shrink-0 text-red-300" /><p>{error}</p></div>)}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Gekoppelde members", value: linkedProfiles.length, icon: Users },
          { label: "Succesvolle laatste sync", value: lastRun?.members_success ?? 0, icon: ShieldCheck },
          { label: "Tracks gevonden", value: insights.length, icon: CalendarDays },
          { label: "Laatste sync", value: formatDateTime(lastRun?.finished_at || lastRun?.started_at), icon: Timer },
          { label: "Fouten laatste sync", value: lastRunErrors, icon: AlertTriangle },
        ].map((stat) => <div key={stat.label} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4"><stat.icon className="mb-2 h-5 w-5 text-orange-300" /><p className="font-heading text-xl font-black tabular-nums text-white">{stat.value}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">{stat.label}</p></div>)}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]">
          <div className="flex flex-col gap-3 border-b border-white/[0.07] p-5 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-orange-300">13 weken shortlist</p><h3 className="mt-1 font-heading text-xl font-black text-white">Seizoenadvies op member-dekking</h3><p className="mt-1 text-sm text-gray-400">Tracks met de meeste aantoonbaar rijdende gekoppelde members.</p></div><button type="button" disabled={!shortlist.length} onClick={() => { dispatchExport("shortlist", shortlist.length); downloadCsv(`3sm-13-week-track-shortlist-${new Date().toISOString().slice(0, 10)}.csv`, shortlistCsv(shortlist)); }} className="inline-flex items-center gap-2 rounded-md border border-orange-400/35 px-3 py-2 text-xs font-bold text-orange-200 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-4 w-4" /> Export 13 weken</button></div>
          <div className="grid grid-cols-3 gap-3 border-b border-white/[0.07] bg-black/10 p-4"><Metric label="Gem. dekking" value={`${averageCoverage}%`} /><Metric label="Hoog betrouwbaar" value={shortlist.filter((track) => track.reliability === "Hoog").length} /><Metric label="Beschikbaar" value={`${shortlist.length}/13`} /></div>
          <div className="divide-y divide-white/[0.06]">{shortlist.map((track, index) => <div key={`${track.trackId || track.trackName}-shortlist`} className="grid grid-cols-[2.8rem_1fr_auto] items-center gap-3 px-4 py-3"><span className="flex h-8 w-8 items-center justify-center rounded-full border border-orange-400/25 bg-orange-500/10 text-xs font-black text-orange-200">W{index + 1}</span><span className="min-w-0"><span className="block truncate text-sm font-bold text-white">{track.trackName}</span><span className="mt-1 block text-xs text-gray-500">{track.uniqueMemberCount} members · {track.percentage}% · {track.sources.map((source) => sourceLabels[source]).join(" + ")}</span></span><span className={track.reliability === "Hoog" ? "text-xs font-bold text-emerald-300" : track.reliability === "Middel" ? "text-xs font-bold text-amber-300" : "text-xs font-bold text-gray-500"}>{track.reliability}</span></div>)}{!loading && !shortlist.length && <Empty text="Nog geen bruikbare trackhistorie. Start een sync of verzamel een Content Extension-scan." />}</div>
        </section>
        <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><p className="text-xs font-black uppercase tracking-wider text-gray-500">Bronnen en betrouwbaarheid</p><h3 className="mt-1 font-heading text-xl font-black text-white">Datakwaliteit</h3><div className="mt-5 space-y-3">{(Object.keys(sourceLabels) as TrackIntelligenceSource[]).map((source) => { const count = insights.filter((track) => track.sources.includes(source)).length; const width = insights.length ? Math.round(count / insights.length * 100) : 0; return <div key={source}><div className="flex justify-between gap-3 text-xs text-gray-400"><span>{sourceLabels[source]}</span><span className="tabular-nums">{count} tracks</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full bg-orange-400/75" style={{ width: `${width}%` }} /></div></div>; })}</div><p className="mt-5 rounded-lg border border-orange-400/15 bg-orange-500/[0.06] p-3 text-xs leading-relaxed text-orange-100/80">iRacing Customer IDs worden alleen gebruikt om gereden tracks voor kalenderplanning te analyseren. De module vraagt geen member-wachtwoorden en bepaalt geen exacte ownership.</p></section>
      </div>

      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-orange-300"><BarChart3 className="h-4 w-4" />Trackdekking top 30</p>
            <h3 className="mt-1 font-heading text-xl font-black text-white">Compact dekkingsoverzicht</h3>
            <p className="mt-1 text-sm text-gray-400">De 30 tracks met de hoogste member-dekking voor snelle kalenderkeuze, zonder naar de volledige analyse te scrollen.</p>
          </div>
          <p className="shrink-0 text-right"><span className="block font-heading text-2xl font-black tabular-nums text-white">{topCoverageTracks.length}</span><span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">tracks</span></p>
        </div>
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {topCoverageTracks.map((track, index) => <div key={`${track.trackId || track.trackName}-coverage`} className="rounded-md border border-white/[0.08] bg-black/10 px-3 py-2.5">
            <div className="flex justify-between gap-3 text-xs"><span className="min-w-0 truncate font-medium text-white"><span className="mr-2 tabular-nums text-gray-500">#{index + 1}</span>{track.trackName}</span><span className="shrink-0 tabular-nums text-gray-400">{track.uniqueMemberCount}/{linkedProfiles.length}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.max(6, (track.uniqueMemberCount / maxTrackMembers) * 100)}%` }} /></div>
          </div>)}
          {!loading && !topCoverageTracks.length && <Empty text="Nog geen trackdata voor een top 30-overzicht." />}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]"><div className="flex flex-col gap-3 border-b border-white/[0.07] p-5 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-black uppercase tracking-wider text-orange-300">Trackanalyse</p><h3 className="mt-1 font-heading text-xl font-black text-white">Alle gevonden tracks</h3></div><div className="flex flex-col gap-2 sm:flex-row"><label className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Zoek track…" className="rounded-md border border-white/[0.1] bg-black/20 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-orange-400" /></label><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as TrackFilter)} className="rounded-md border border-white/[0.1] bg-[#151820] px-3 py-2 text-sm text-gray-200 outline-none focus:border-orange-400"><option value="all">Alle bronnen</option>{(Object.keys(sourceLabels) as TrackIntelligenceSource[]).map((source) => <option key={source} value={source}>{sourceLabels[source]}</option>)}</select><button type="button" disabled={!filteredInsights.length} onClick={() => { dispatchExport("analysis", filteredInsights.length); downloadCsv(`3sm-track-intelligence-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(filteredInsights)); }} className="inline-flex items-center gap-2 rounded-md border border-white/[0.1] px-3 py-2 text-xs font-bold text-gray-300 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-4 w-4" /> Export CSV</button><button type="button" onClick={() => { setShowLog((visible) => !visible); onAction?.({ id: "track-log", impact: "read", allowedRoles: ["admin", "super_admin"], panel: "track-run-log", context: { runs } }); }} className="inline-flex items-center gap-2 rounded-md border border-white/[0.1] px-3 py-2 text-xs font-bold text-gray-300"><History className="h-4 w-4" /> {showLog ? "Log sluiten" : "Sync log"}</button></div></div>
        {!loading && !insights.length ? <Empty text="Er is nog geen trackdata opgehaald." /> : <div className="overflow-x-auto"><div className="min-w-[780px]"><div className="grid grid-cols-[2fr_7rem_10rem_10rem_1.5fr_7rem] gap-3 bg-white/[0.035] px-5 py-3 text-[10px] font-black uppercase tracking-wider text-gray-500"><span>Track</span><span>Members</span><span>Dekking</span><span>Laatst gezien</span><span>Bronnen</span><span>Betrouwbaar</span></div>{filteredInsights.map((track) => <div key={track.trackId || track.trackName} className="grid grid-cols-[2fr_7rem_10rem_10rem_1.5fr_7rem] items-center gap-3 border-t border-white/[0.06] px-5 py-3 text-sm"><span className="font-bold text-white">{track.trackName}</span><span>{track.uniqueMemberCount}</span><span className="tabular-nums text-gray-300">{track.percentage}%</span><span className="text-xs text-gray-400">{formatDateTime(track.lastSeenAt)}</span><span className="flex flex-wrap gap-1">{track.sources.map((source) => <span key={source} className="rounded border border-orange-400/20 bg-orange-500/[0.08] px-1.5 py-0.5 text-[10px] text-orange-200">{sourceLabels[source]}</span>)}</span><span className="text-xs text-gray-300">{track.reliability}</span></div>)}{!loading && !filteredInsights.length && <Empty text="Geen tracks voldoen aan dit filter." />}</div></div>}
      </section>

      {showLog && <RunLog runs={runs} />}
      <ScannerCoverageDialog open={showScannerCoverage} members={scannerMembers} onClose={() => setShowScannerCoverage(false)} />
    </section>
  );
}

function ScannerCoverageDialog({ open, members, onClose }: { open: boolean; members: TrackScannerMemberCoverage[]; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const scannedMembers = members.filter((member) => member.scanned);
  const unscannedMembers = members.filter((member) => !member.scanned);
  const percentage = members.length ? Math.round((scannedMembers.length / members.length) * 100) : 0;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("button, summary, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
        .filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="scanner-coverage-title" aria-describedby="scanner-coverage-description" className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#11141b] shadow-2xl shadow-black/60">
      <header className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.16),transparent_45%)] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Content Extension</p>
            <h2 id="scanner-coverage-title" className="mt-1 font-heading text-2xl font-black text-white">Track Scanner-dekking</h2>
            <p id="scanner-coverage-description" className="mt-2 text-sm leading-relaxed text-gray-400"><strong className="text-white"><span>{scannedMembers.length}</span> <span>van</span> <span>{members.length}</span></strong> <span>gekoppelde members hebben trackdata gedeeld via de Track Scanner.</span></p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Scannerdekking sluiten" className="shrink-0 rounded-md p-2 text-gray-400 transition hover:bg-white/[0.07] hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 flex items-center gap-4">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-gradient-to-r from-orange-600 to-orange-400" style={{ width: `${percentage}%` }} /></div>
          <span className="font-heading text-xl font-black tabular-nums text-white">{percentage}%</span>
        </div>
      </header>

      <div className="overflow-y-auto p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wider text-orange-300">Gescande members</p><h3 className="mt-1 font-heading text-lg font-black text-white">Ontvangen scannerdata</h3></div><span className="rounded-full border border-emerald-400/20 bg-emerald-500/[0.08] px-2.5 py-1 text-xs font-bold tabular-nums text-emerald-200">{scannedMembers.length}</span></div>

        <div className="mt-4 divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02]">
          {scannedMembers.map((member) => <div key={member.userId} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-5">
            <span className="min-w-0 truncate text-sm font-bold text-white">{member.name}</span>
            <span className="text-xs tabular-nums text-gray-400"><span>{member.uniqueTrackCount}</span> <span>unieke tracks</span></span>
            <span className="text-xs text-gray-500">{formatDateTime(member.lastScannedAt)}</span>
          </div>)}
          {!scannedMembers.length && <p className="p-5 text-center text-sm text-gray-500">Nog geen scanneruploads ontvangen.</p>}
        </div>

        <details className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] open:bg-white/[0.03]">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-gray-300 marker:hidden">Nog niet gescand <span className="ml-1 text-gray-500">({unscannedMembers.length})</span></summary>
          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] p-4">{unscannedMembers.map((member) => <span key={member.userId} className="rounded-md border border-white/[0.08] bg-black/10 px-2.5 py-1.5 text-xs text-gray-400">{member.name}</span>)}{!unscannedMembers.length && <span className="text-xs text-emerald-300">Alle gekoppelde members hebben gescand.</span>}</div>
        </details>

        <p className="mt-4 text-xs leading-relaxed text-gray-500">Alleen uploads met bron <strong className="text-gray-400">Extensie scan</strong> tellen mee. Gewone iRacing-syncs en site-resultaten verhogen deze teller niet.</p>
      </div>
    </div>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div><p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</p><p className="mt-1 font-heading text-2xl font-black text-white">{value}</p></div>; }
function Empty({ text }: { text: string }) { return <p className="p-8 text-center text-sm text-gray-500">{text}</p>; }
function RunLog({ runs }: { runs: TrackRun[] }) { return <section className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><h3 className="font-heading text-xl font-black text-white">Sync log</h3><div className="mt-4 space-y-3">{runs.map((run) => <article key={run.id} className="rounded-xl border border-white/[0.07] bg-black/10 p-4"><div className="flex flex-wrap justify-between gap-2"><p className="font-bold text-white">{formatDateTime(run.started_at)} · {run.status}</p><p className="text-xs text-gray-500">{run.trigger_type === "manual" ? "Handmatig gestart" : run.trigger_type}</p></div><div className="mt-3 grid gap-2 text-xs text-gray-400 sm:grid-cols-4"><span>Members: {run.members_total ?? 0}</span><span>Succes: {run.members_success ?? 0}</span><span>Fouten: {run.members_failed ?? 0}</span><span>Records: {run.created_records ?? 0}</span></div>{run.error_summary && <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-red-400/20 bg-red-500/[0.06] p-3 text-xs text-red-200">{run.error_summary}</pre>}</article>)}{!runs.length && <Empty text="Nog geen syncs uitgevoerd." />}</div></section>; }

export default TrackIntelligenceModule;
