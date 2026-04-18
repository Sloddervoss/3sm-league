import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, BarChart2, Upload, X, Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  type ImportRow,
  type ProfileRow,
  type RaceOption,
  type IRacingJsonSession,
  type IRacingJsonResult,
  parseLapMs,
  formatIRacingLapTime,
  matchProfileForImportRow,
} from "@/lib/importHelpers";

const DEFAULT_POINTS = [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

const EMPTY_ROW: ImportRow = { position: 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false };

const ResultsImportAdmin = () => {
  const queryClient = useQueryClient();

  const [importRaceId, setImportRaceId] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([{ ...EMPTY_ROW }]);
  const [pointsConfig] = useState<number[]>(DEFAULT_POINTS);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [jsonFileName, setJsonFileName] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<"manual" | "csv" | "json">("csv");

  const { data: profiles } = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, display_name, iracing_name, iracing_id");
      if (error) throw error;
      return data;
    },
  });

  const { data: allRaces } = useQuery({
    queryKey: ["all-races-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("races")
        .select("id, name, track, race_date, league_id, status, practice_duration, qualifying_duration, race_duration, start_type, weather, setup, leagues(name, season)")
        .order("race_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: existingImportResults } = useQuery({
    queryKey: ["existing-import-results", importRaceId],
    enabled: !!importRaceId,
    queryFn: async () => {
      const { data } = await supabase
        .from("race_results")
        .select("user_id")
        .eq("race_id", importRaceId);
      return (data || []) as { user_id: string }[];
    },
  });

  const importResults = useMutation({
    mutationFn: async () => {
      if (!importRaceId) throw new Error("Selecteer een race");
      let iRatingUpdates = 0;
      for (const row of importRows) {
        if (!row.display_name.trim()) continue;
        const profile = matchProfileForImportRow(row, (profiles ?? []) as ProfileRow[]);
        if (!profile) { toast.error(`Driver niet gevonden: ${row.display_name}`); continue; }
        const pts = (pointsConfig[row.position - 1] ?? 0) + (row.fastest_lap ? 1 : 0);
        const { error } = await supabase.from("race_results").upsert(
          { race_id: importRaceId, user_id: profile.user_id, position: row.position, points: pts, fastest_lap: row.fastest_lap, laps: row.laps, best_lap: row.best_lap || null, incidents: row.incidents, dnf: row.dnf ?? false, irating_snapshot: row.new_irating ?? null },
          { onConflict: "race_id,user_id" }
        );
        if (error) throw error;
        if (row.new_irating && row.new_license_level && row.new_license_sub_level !== undefined) {
          const licLetters = ["", "R", "D", "C", "B", "A"];
          const licIdx = Math.min(Math.ceil(row.new_license_level / 4), 5);
          const safetyRating = `${licLetters[licIdx]} ${(row.new_license_sub_level / 100).toFixed(2)}`;
          const { error: profErr } = await supabase.from("profiles").update({ irating: row.new_irating, safety_rating: safetyRating }).eq("user_id", profile.user_id);
          if (profErr) toast.error(`iRating update mislukt voor ${row.display_name}: ${profErr.message}`);
          else iRatingUpdates++;
        }
      }
      await supabase.from("races").update({ status: "completed", counts_for_3sr: true }).eq("id", importRaceId);

      const { data: existingPenalties } = await supabase
        .from("penalties")
        .select("user_id, points_deduction")
        .eq("race_id", importRaceId)
        .eq("penalty_type", "points_deduction");
      if (existingPenalties?.length) {
        for (const pen of existingPenalties) {
          const { data: rr } = await supabase.from("race_results").select("points").eq("race_id", importRaceId).eq("user_id", pen.user_id).maybeSingle();
          if (rr) {
            await supabase.from("race_results").update({ points: rr.points - pen.points_deduction }).eq("race_id", importRaceId).eq("user_id", pen.user_id);
          }
        }
      }

      await supabase.rpc("recalculate_3sr_for_race", { p_race_id: importRaceId });

      const raceForCar = (allRaces || []).find((r: RaceOption) => r.id === importRaceId);
      if (raceForCar?.league_id) {
        const { data: freshProfiles } = await supabase.from("profiles").select("user_id, iracing_id, display_name, iracing_name");
        for (const row of importRows) {
          if (!row.car_name) continue;
          const profile = matchProfileForImportRow(row, (freshProfiles ?? []) as ProfileRow[]);
          if (!profile) continue;
          await supabase.from("season_registrations")
            .update({ car_choice: row.car_name })
            .eq("league_id", raceForCar.league_id)
            .eq("user_id", profile.user_id)
            .eq("car_locked", false);
          await supabase.from("race_registrations")
            .update({ car_choice: row.car_name })
            .eq("race_id", importRaceId)
            .eq("user_id", profile.user_id)
            .eq("car_locked", false);
        }
      }
      if (iRatingUpdates > 0) toast.success(`iRating bijgewerkt voor ${iRatingUpdates} drivers`);
    },
    onSuccess: () => {
      toast.success("Resultaten geïmporteerd!");
      queryClient.invalidateQueries({ queryKey: ["all-results-with-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["all-races-admin"] });
      queryClient.invalidateQueries({ queryKey: ["completed-races"] });
      queryClient.invalidateQueries({ queryKey: ["admin-season-registrations"] });
      setImportRaceId("");
      setImportRows([{ ...EMPTY_ROW }]);
      setCsvFileName(null);
      setJsonFileName(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <h2 className="font-heading text-2xl font-black mb-6">RESULTATEN IMPORTEREN</h2>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => setImportMode("csv")} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-colors ${importMode === "csv" ? "bg-gradient-racing text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          <FileText className="w-4 h-4" /> CSV Upload
        </button>
        <button onClick={() => setImportMode("json")} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-colors ${importMode === "json" ? "bg-gradient-racing text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          <BarChart2 className="w-4 h-4" /> JSON Export
        </button>
        <button onClick={() => setImportMode("manual")} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-colors ${importMode === "manual" ? "bg-gradient-racing text-white" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
          <Upload className="w-4 h-4" /> Handmatig
        </button>
      </div>

      <div className="bg-card border border-border rounded-lg p-6 racing-stripe-left">
        {/* Race selector — always shown */}
        <div className="mb-6">
          <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Selecteer Race *</label>
          <select value={importRaceId} onChange={(e) => setImportRaceId(e.target.value)} className="w-full md:w-96 px-4 py-2.5 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
            <option value="">Kies een race...</option>
            {allRaces?.map((race: RaceOption) => (
              <option key={race.id} value={race.id}>{race.name} — {race.track} ({new Date(race.race_date).toLocaleDateString("nl-NL")})</option>
            ))}
          </select>
          {existingImportResults && existingImportResults.length > 0 && (
            <div className="mt-3 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-sm text-yellow-400">
              <span className="font-bold">⚠ Deze race heeft al {existingImportResults.length} resultaten.</span>
              <span className="ml-1 opacity-80">Importeren overschrijft bestaande data. Bestaande straffen worden automatisch hertoegepast.</span>
            </div>
          )}
        </div>

        {/* ── CSV MODE ── */}
        {importMode === "csv" && (
          <div>
            <div className="mb-5 p-4 rounded-md bg-blue-500/10 border border-blue-500/20 text-sm text-blue-300">
              <div className="font-bold mb-1">📄 iRacing CSV Export</div>
              <p className="text-xs leading-relaxed mb-2">Download de race resultaten als CSV van <strong>members.iracing.com</strong> → Race Results → Export. De CSV wordt automatisch ingelezen en gekoppeld aan drivers op basis van iRacing naam of Customer ID.</p>
              <p className="text-xs text-blue-400 font-bold">Verwacht formaat: FinPos, CustID, Display Name, Laps, Best Lap Time, Incidents (iRacing standaard export)</p>
            </div>

            <div className="mb-5">
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">CSV Bestand</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{csvFileName || "Kies CSV bestand..."}</span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setCsvFileName(file.name);
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const text = ev.target?.result as string;
                        if (!text) return;
                        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
                        if (lines.length < 2) { toast.error("CSV lijkt leeg"); return; }

                        let headerLineIdx = 0;
                        for (let li = 0; li < Math.min(lines.length, 5); li++) {
                          if (lines[li].toLowerCase().includes("fin pos") || lines[li].toLowerCase().includes("finpos") || lines[li].toLowerCase().startsWith('"fin pos"')) { headerLineIdx = li; break; }
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

                        const parsed = lines.slice(headerLineIdx + 1).map((line, i) => {
                          const cols = line.split(",").map(c => c.trim().replace(/"/g, ""));
                          if (cols.length < 3) return null;
                          const pos       = finPosIdx >= 0  ? parseInt(cols[finPosIdx]) || i + 1 : i + 1;
                          const name      = nameIdx >= 0    ? cols[nameIdx]   : `Driver ${i + 1}`;
                          const laps      = lapsIdx >= 0    ? parseInt(cols[lapsIdx]) || 0 : 0;
                          const bestLap   = bestLapIdx >= 0 ? cols[bestLapIdx] : "";
                          const incidents = incIdx >= 0     ? parseInt(cols[incIdx]) || 0 : 0;
                          const custId    = custIdIdx >= 0  ? cols[custIdIdx] : undefined;
                          const newIR     = newIRatingIdx >= 0 && cols[newIRatingIdx]   ? parseInt(cols[newIRatingIdx])  : undefined;
                          const newLL     = newLicLevelIdx >= 0 && cols[newLicLevelIdx] ? parseInt(cols[newLicLevelIdx]) : undefined;
                          const newLS     = newLicSubIdx >= 0 && cols[newLicSubIdx] !== "" ? parseInt(cols[newLicSubIdx]) : undefined;
                          return { position: pos, display_name: name, laps, best_lap: bestLap, incidents, fastest_lap: false, iracing_cust_id: custId, new_irating: newIR, new_license_level: newLL, new_license_sub_level: newLS };
                        }).filter((r): r is NonNullable<typeof r> => !!r && !!r.display_name && !isNaN(r.position));

                        const withLaps = parsed.filter(r => r.best_lap && parseLapMs(r.best_lap) < Infinity);
                        if (withLaps.length) {
                          const fastest = withLaps.reduce((a, b) => parseLapMs(a.best_lap) < parseLapMs(b.best_lap) ? a : b);
                          fastest.fastest_lap = true;
                        }

                        if (parsed.length === 0) { toast.error("Geen geldige rijen gevonden in CSV"); return; }
                        setImportRows(parsed);
                        toast.success(`${parsed.length} drivers geladen uit CSV`);
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
                {csvFileName && (
                  <button onClick={() => { setCsvFileName(null); setImportRows([{ ...EMPTY_ROW }]); }} className="p-2 text-muted-foreground hover:text-destructive transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {importRows.length > 0 && importRows[0].display_name && (() => {
              const unmatched = importRows.filter((row) => !profiles?.find((p: ProfileRow) =>
                (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
                (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
              ));
              return (
                <div className="mb-5">
                  <div className="text-sm font-medium text-muted-foreground mb-2">{importRows.length} drivers geladen — preview:</div>
                  <div className="bg-secondary/30 rounded-md border border-border overflow-hidden">
                    <div className="grid grid-cols-[3rem_1fr_4rem_8rem_4rem_5rem] gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                      <span>Pos</span><span>Driver</span><span>Laps</span><span>Best Lap</span><span>Inc.</span><span className="text-center">FL</span>
                    </div>
                    {importRows.slice(0, 10).map((row, i) => {
                      const matched = profiles?.find((p: ProfileRow) =>
                        (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
                        (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
                      );
                      return (
                        <div key={i} className={`grid grid-cols-[3rem_1fr_4rem_8rem_4rem_5rem] gap-2 px-3 py-2 items-center border-b border-border/30 text-sm ${matched ? "" : "opacity-60"}`}>
                          <span className="font-heading font-bold">{row.position}</span>
                          <div>
                            <span>{row.display_name}</span>
                            {matched ? <span className="ml-2 text-[10px] text-green-400 font-bold">✓ gevonden</span> : <span className="ml-2 text-[10px] text-red-400 font-bold">✗ niet gevonden</span>}
                          </div>
                          <span className="text-muted-foreground">{row.laps}</span>
                          <span className="font-mono text-muted-foreground text-xs">{row.best_lap || "—"}</span>
                          <span className="text-muted-foreground">{row.incidents}x</span>
                          <div className="flex items-center justify-center">
                            <input type="checkbox" checked={row.fastest_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], fastest_lap: e.target.checked }; setImportRows(u); }} className="w-4 h-4 accent-primary cursor-pointer" />
                          </div>
                        </div>
                      );
                    })}
                    {importRows.length > 10 && <div className="px-3 py-2 text-xs text-muted-foreground">...en {importRows.length - 10} meer</div>}
                  </div>
                  {unmatched.length > 0 && (
                    <div className="mt-3 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm">
                      <span className="font-bold text-red-400">⚠ {unmatched.length} driver{unmatched.length !== 1 ? "s" : ""} niet gevonden</span>
                      <span className="text-muted-foreground ml-2">— worden overgeslagen bij import:</span>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {unmatched.map((row, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/20">{row.display_name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── JSON MODE ── */}
        {importMode === "json" && (
          <div>
            <div className="mb-5 p-4 rounded-md bg-purple-500/10 border border-purple-500/20 text-sm text-purple-300">
              <div className="font-bold mb-1">📊 iRacing JSON Export</div>
              <p className="text-xs leading-relaxed mb-2">Download de race resultaten als JSON van <strong>members.iracing.com</strong> → Race Results → Export to JSON. De JSON bevat ook iRating-data per driver en wordt automatisch ingelezen.</p>
              <p className="text-xs text-purple-400 font-bold">iRating, licentieniveau en positie worden automatisch ingevuld vanuit de JSON.</p>
            </div>

            <div className="mb-5">
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">JSON Bestand</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-dashed border-border hover:border-primary/50 bg-secondary/50 cursor-pointer transition-colors">
                  <BarChart2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{jsonFileName || "Kies JSON bestand..."}</span>
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setJsonFileName(file.name);
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        try {
                          const json = JSON.parse(ev.target?.result as string);
                          const root = json.data ?? json;
                          const sessions: IRacingJsonSession[] = root.session_results || [];
                          const raceSession = sessions.find((s: IRacingJsonSession) =>
                            s.simsession_type === 6 ||
                            (s.simsession_type_name || "").toLowerCase().includes("race") ||
                            s.simsession_number === 0
                          ) ?? sessions.sort((a: IRacingJsonSession, b: IRacingJsonSession) => (b.results?.length ?? 0) - (a.results?.length ?? 0))[0];
                          if (!raceSession) {
                            toast.error("Geen Race sessie gevonden in JSON — controleer of het een iRacing event result JSON is");
                            return;
                          }
                          const results: IRacingJsonResult[] = raceSession.results || [];
                          if (!results.length) {
                            toast.error("Geen resultaten gevonden in Race sessie");
                            return;
                          }
                          const validLaps = results.filter((r: IRacingJsonResult) => r.best_lap_time > 0);
                          const fastestCustId = validLaps.length
                            ? validLaps.reduce((a: IRacingJsonResult, b: IRacingJsonResult) => a.best_lap_time < b.best_lap_time ? a : b).cust_id
                            : null;
                          const maxLaps = Math.max(...results.map((r: IRacingJsonResult) => r.laps_complete || 0));
                          const parsed: ImportRow[] = results
                            .sort((a: IRacingJsonResult, b: IRacingJsonResult) => a.finish_position - b.finish_position)
                            .map((r: IRacingJsonResult) => ({
                              position: r.finish_position + 1,
                              display_name: r.display_name || "",
                              laps: r.laps_complete || 0,
                              best_lap: formatIRacingLapTime(r.best_lap_time),
                              incidents: r.incidents || 0,
                              fastest_lap: r.cust_id === fastestCustId,
                              iracing_cust_id: String(r.cust_id),
                              new_irating: r.newi_rating ?? undefined,
                              new_license_level: r.new_license_level ?? undefined,
                              new_license_sub_level: r.new_sub_level ?? undefined,
                              car_name: r.car_name || r.livery?.car_name || undefined,
                              dnf: (r.reason_out_id !== undefined && r.reason_out_id !== 0) || (r.reason_out && r.reason_out !== "Running") || ((r.laps_complete || 0) < maxLaps),
                            }))
                            .filter((r: ImportRow) => r.display_name);
                          if (!parsed.length) {
                            toast.error("Geen geldige drivers gevonden in JSON");
                            return;
                          }
                          setImportRows(parsed);
                          toast.success(`${parsed.length} drivers geladen uit JSON (inclusief iRating)`);
                        } catch {
                          toast.error("Ongeldig JSON bestand");
                        }
                      };
                      reader.readAsText(file);
                    }}
                  />
                </label>
                {jsonFileName && (
                  <button onClick={() => { setJsonFileName(null); setImportRows([{ ...EMPTY_ROW }]); }} className="p-2 text-muted-foreground hover:text-destructive transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {importRows.length > 0 && importRows[0].display_name && (() => {
              const unmatched = importRows.filter((row) => !profiles?.find((p: any) =>
                (p.iracing_cust_id && row.iracing_cust_id && String(p.iracing_cust_id) === String(row.iracing_cust_id)) ||
                (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
                (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
              ));
              return (
                <div className="mb-5">
                  <div className="text-sm font-medium text-muted-foreground mb-2">{importRows.length} drivers geladen — preview:</div>
                  <div className="bg-secondary/30 rounded-md border border-border overflow-hidden">
                    <div className="grid grid-cols-[3rem_1fr_4rem_8rem_4rem_6rem_5rem] gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                      <span>Pos</span><span>Driver</span><span>Laps</span><span>Best Lap</span><span>Inc.</span><span>iRating</span><span className="text-center">FL</span>
                    </div>
                    {importRows.slice(0, 10).map((row, i) => {
                      const matched = profiles?.find((p: any) =>
                        (p.iracing_cust_id && row.iracing_cust_id && String(p.iracing_cust_id) === String(row.iracing_cust_id)) ||
                        (p.display_name || "").toLowerCase() === row.display_name.toLowerCase() ||
                        (p.iracing_name || "").toLowerCase() === row.display_name.toLowerCase()
                      );
                      return (
                        <div key={i} className={`grid grid-cols-[3rem_1fr_4rem_8rem_4rem_6rem_5rem] gap-2 px-3 py-2 items-center border-b border-border/30 text-sm ${matched ? "" : "opacity-60"}`}>
                          <span className="font-heading font-bold">{row.position}</span>
                          <div>
                            <span>{row.display_name}</span>
                            {matched ? <span className="ml-2 text-[10px] text-green-400 font-bold">✓ gevonden</span> : <span className="ml-2 text-[10px] text-red-400 font-bold">✗ niet gevonden</span>}
                          </div>
                          <span className="text-muted-foreground">{row.laps}</span>
                          <span className="font-mono text-muted-foreground text-xs">{row.best_lap || "—"}</span>
                          <span className="text-muted-foreground">{row.incidents}x</span>
                          <span className="text-purple-400 font-bold text-xs">{row.new_irating ?? "—"}</span>
                          <div className="flex items-center justify-center">
                            <input type="checkbox" checked={row.fastest_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], fastest_lap: e.target.checked }; setImportRows(u); }} className="w-4 h-4 accent-primary cursor-pointer" />
                          </div>
                        </div>
                      );
                    })}
                    {importRows.length > 10 && <div className="px-3 py-2 text-xs text-muted-foreground">...en {importRows.length - 10} meer</div>}
                  </div>
                  {unmatched.length > 0 && (
                    <div className="mt-3 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm">
                      <span className="font-bold text-red-400">⚠ {unmatched.length} driver{unmatched.length !== 1 ? "s" : ""} niet gevonden</span>
                      <span className="text-muted-foreground ml-2">— worden overgeslagen bij import:</span>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {unmatched.map((row, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/20">{row.display_name}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── MANUAL MODE ── */}
        {importMode === "manual" && (
          <div>
            <div className="overflow-x-auto mb-4">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-[3rem_1fr_5rem_8rem_5rem_6rem_3rem] gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground px-1">
                  <span>Pos</span><span>Driver</span><span className="text-center">Laps</span><span className="text-center">Best Lap</span><span className="text-center">Inc.</span><span className="text-center">FL</span><span></span>
                </div>
                {importRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[3rem_1fr_5rem_8rem_5rem_6rem_3rem] gap-2 mb-2 items-center">
                    <div className="py-2 rounded-md bg-secondary border border-border text-center text-sm font-heading font-bold">{row.position}</div>
                    <input type="text" value={row.display_name} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], display_name: e.target.value }; setImportRows(u); }} placeholder="Driver naam" list="driver-names-import" className="px-3 py-2 rounded-md bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    <input type="number" min={0} value={row.laps} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], laps: parseInt(e.target.value) || 0 }; setImportRows(u); }} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    <input type="text" value={row.best_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], best_lap: e.target.value }; setImportRows(u); }} placeholder="1:23.456" className="px-3 py-2 rounded-md bg-secondary border border-border text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    <input type="number" min={0} value={row.incidents} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], incidents: parseInt(e.target.value) || 0 }; setImportRows(u); }} className="px-3 py-2 rounded-md bg-secondary border border-border text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    <div className="flex items-center justify-center"><input type="checkbox" checked={row.fastest_lap} onChange={(e) => { const u = [...importRows]; u[i] = { ...u[i], fastest_lap: e.target.checked }; setImportRows(u); }} className="w-4 h-4 accent-primary cursor-pointer" /></div>
                    <button onClick={() => setImportRows(importRows.filter((_, j) => j !== i))} className="flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
                <datalist id="driver-names-import">
                  {profiles?.map((p: ProfileRow) => <option key={p.user_id} value={p.display_name || p.iracing_name || ""} />)}
                </datalist>
              </div>
            </div>
            <button onClick={() => setImportRows([...importRows, { position: importRows.length + 1, display_name: "", laps: 0, best_lap: "", incidents: 0, fastest_lap: false }])} className="flex items-center gap-1 px-3 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-4">
              <Plus className="w-4 h-4" /> Driver toevoegen
            </button>
          </div>
        )}

        {/* Submit */}
        <div className="border-t border-border pt-4">
          <div className="text-xs text-muted-foreground mb-3 flex flex-wrap gap-2">
            <span className="font-bold uppercase tracking-wider">Punten preview:</span>
            {importRows.slice(0, 8).map((row) => (
              <span key={row.position} className="px-2 py-0.5 rounded bg-secondary">P{row.position}: {(pointsConfig[row.position - 1] ?? 0) + (row.fastest_lap ? 1 : 0)} pts</span>
            ))}
          </div>
          <button onClick={() => importResults.mutate()} disabled={!importRaceId || importResults.isPending} className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity">
            <Upload className="w-4 h-4" />{importResults.isPending ? "Importeren..." : "Resultaten Importeren"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResultsImportAdmin;
