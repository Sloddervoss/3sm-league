import { useState } from "react";
import { FileUp, Gauge, Plus } from "lucide-react";
import { useEnduranceActor } from "../core/ActorContext";
import { useEndurancePace, useEndurancePaceMutations } from "../repository/paceRepository";
import { formatLapTime, paceConfidence, paceScore } from "../core/selectors";
import type { EnduranceEvent } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { parseLapSeconds, parsePaceCsv } from "./csv";
import { getEnduranceCar } from "../core/carCatalog";

/**
 * Pace & betrouwbaarheid — Fase 3 (test-als).
 * Leest/schrijft pace-entries via de DB-repository. De coureur is de
 * geselecteerde actor (Test-als); de sessie blijft super-admin.
 */
export const PacePanel = ({ event }: { event: EnduranceEvent }) => {
  const { actorId, displayName } = useEnduranceActor();
  const { data: entries = [], isLoading } = useEndurancePace(event.id);
  const { upsert } = useEndurancePaceMutations(event.id);
  const selectedCar = getEnduranceCar(event.selectedCarId);
  const [average, setAverage] = useState("2:08.500");
  const [best, setBest] = useState("2:07.900");
  const [laps, setLaps] = useState(20);
  const [consistency, setConsistency] = useState(0.8);
  const [incidents, setIncidents] = useState(0);
  const [feedback, setFeedback] = useState("");
  const sorted = [...entries].sort((a, b) => (a.average_lap_seconds ?? 0) - (b.average_lap_seconds ?? 0));

  const persist = (payload: Parameters<typeof upsert.mutateAsync>[0]) => {
    void upsert.mutateAsync(payload);
  };

  const addManual = (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    if (!actorId) return;
    if (!selectedCar) { setFeedback("Bevestig eerst de definitieve auto in het overzicht."); return; }
    try {
      const averageLapSeconds = parseLapSeconds(average);
      const bestLapSeconds = parseLapSeconds(best);
      persist({
        event_id: event.id,
        user_id: actorId,
        circuit: event.circuit,
        configuration: event.configuration,
        car: selectedCar.name,
        conditions: "dry",
        average_lap_seconds: averageLapSeconds,
        median_lap_seconds: averageLapSeconds,
        best_lap_seconds: bestLapSeconds,
        best_five_average_seconds: (averageLapSeconds + bestLapSeconds) / 2,
        consistency_seconds: consistency,
        valid_laps: laps,
        incidents,
        average_stint_minutes: 0,
      });
      setFeedback("Pacegegevens opgeslagen.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Pace kon niet worden opgeslagen.");
    }
  };

  const upload = async (file?: File) => {
    if (!file || !actorId) return;
    if (!selectedCar) { setFeedback("Bevestig eerst de definitieve auto in het overzicht."); return; }
    try {
      const parsed = parsePaceCsv(await file.text());
      persist({
        event_id: event.id,
        user_id: actorId,
        circuit: event.circuit,
        configuration: event.configuration,
        car: selectedCar.name,
        conditions: "dry",
        ...parsed,
      });
      setFeedback(`${file.name} verwerkt zonder gedeeltelijke import.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "CSV kon niet worden verwerkt.");
    }
  };

  return <div className="space-y-5"><Panel><SectionHeading eyebrow="Meerdere ronden" title="Pace & betrouwbaarheid" description="Rangschikking gebruikt gemiddelde, consistentie, incidenten en hoeveelheid data—nooit alleen de snelste ronde." />
    {isLoading ? <p className="text-sm text-gray-400">Laden…</p> : <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-[11px] uppercase tracking-wider text-gray-500"><tr><th className="pb-3">Coureur</th><th>Auto</th><th>Gemiddelde</th><th>Beste 5</th><th>Afwijking</th><th>Ronden</th><th>Score</th><th>Betrouwbaarheid</th></tr></thead><tbody className="divide-y divide-white/5">{sorted.map((entry) => { const confidence = paceConfidence({ id: entry.id, eventId: entry.event_id, userId: entry.user_id, circuit: entry.circuit, configuration: entry.configuration, car: entry.car, conditions: entry.conditions as "dry" | "wet", averageLapSeconds: entry.average_lap_seconds ?? 0, medianLapSeconds: entry.median_lap_seconds ?? 0, bestLapSeconds: entry.best_lap_seconds ?? 0, bestFiveAverageSeconds: entry.best_five_average_seconds ?? 0, consistencySeconds: entry.consistency_seconds ?? 0, validLaps: entry.valid_laps ?? 0, incidents: entry.incidents ?? 0, averageStintMinutes: entry.average_stint_minutes ?? 0, recordedAt: entry.recorded_at, source: entry.source, notes: entry.notes ?? "" }); return <tr key={entry.id}><td className="py-3 font-bold text-white">{displayName(entry.user_id)}</td><td className="text-gray-400">{entry.car}</td><td className="text-gray-200">{formatLapTime(entry.average_lap_seconds ?? 0)}{entry.source === "practice" && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Practice</span>}</td><td className="text-gray-300">{formatLapTime(entry.best_five_average_seconds ?? 0)}</td><td className="text-gray-400">±{(entry.consistency_seconds ?? 0).toFixed(2)}s</td><td className="text-gray-400">{entry.valid_laps}</td><td><span className="inline-flex items-center gap-1 font-black text-orange-300"><Gauge className="h-3.5 w-3.5" />{paceScore({ id: entry.id, eventId: entry.event_id, userId: entry.user_id, circuit: entry.circuit, configuration: entry.configuration, car: entry.car, conditions: entry.conditions as "dry" | "wet", averageLapSeconds: entry.average_lap_seconds ?? 0, medianLapSeconds: entry.median_lap_seconds ?? 0, bestLapSeconds: entry.best_lap_seconds ?? 0, bestFiveAverageSeconds: entry.best_five_average_seconds ?? 0, consistencySeconds: entry.consistency_seconds ?? 0, validLaps: entry.valid_laps ?? 0, incidents: entry.incidents ?? 0, averageStintMinutes: entry.average_stint_minutes ?? 0, recordedAt: entry.recorded_at, source: entry.source, notes: entry.notes ?? "" })}</span></td><td><StatusPill tone={confidence === "Hoog" ? "green" : confidence === "Gemiddeld" ? "orange" : "red"}>{confidence}</StatusPill></td></tr>; })}</tbody></table></div>}
  </Panel>
  <Panel><SectionHeading title="Pace toevoegen" description="Voer een long-run handmatig in of upload een CSV met average_lap/best_lap/valid_laps of lap_times gescheiden door puntkomma’s." />
    <form onSubmit={addManual} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Vaste auto"><div className={`${inputClass} flex items-center text-gray-300`}>{selectedCar?.name ?? "Nog niet bevestigd"}</div></Field><Field label="Gemiddelde rondetijd"><input className={inputClass} value={average} onChange={(e) => setAverage(e.target.value)} /></Field><Field label="Snelste ronde"><input className={inputClass} value={best} onChange={(e) => setBest(e.target.value)} /></Field><Field label="Geldige ronden"><input type="number" min={1} className={inputClass} value={laps} onChange={(e) => setLaps(Number(e.target.value))} /></Field><Field label="Afwijking in seconden"><input type="number" min={0} step="0.01" className={inputClass} value={consistency} onChange={(e) => setConsistency(Number(e.target.value))} /></Field><Field label="Incidenten"><input type="number" min={0} className={inputClass} value={incidents} onChange={(e) => setIncidents(Number(e.target.value))} /></Field><div className="flex items-end gap-2"><PrimaryButton type="submit" disabled={!selectedCar}><Plus className="h-4 w-4" /> Opslaan</PrimaryButton><label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-white/[0.045] px-4 py-2 text-sm font-bold text-gray-200 ring-1 ring-white/10"><FileUp className="h-4 w-4" /> CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} /></label></div></form>{feedback && <p role="status" className="mt-4 text-sm text-orange-200">{feedback}</p>}
  </Panel></div>;
};
