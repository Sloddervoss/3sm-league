import { useState } from "react";
import { FileUp, Gauge, Plus } from "lucide-react";
import { useEnduranceStore } from "../core/EnduranceStore";
import { makeId } from "../core/actions";
import { canManageEvent, formatLapTime, paceConfidence, paceScore } from "../core/selectors";
import type { EnduranceEvent } from "../core/types";
import { Field, inputClass, Panel, PrimaryButton, SectionHeading, StatusPill } from "../shared/ui";
import { parseLapSeconds, parsePaceCsv } from "./csv";

export const PacePanel = ({ event }: { event: EnduranceEvent }) => {
  const { state, activePersona, dispatch } = useEnduranceStore();
  const manager = canManageEvent(event, activePersona);
  const participants = state.personas.filter((persona) => state.registrations.some((registration) => registration.eventId === event.id && registration.userId === persona.id));
  const [userId, setUserId] = useState(participants.some((persona) => persona.id === activePersona.id) ? activePersona.id : participants[0]?.id ?? activePersona.id);
  const [car, setCar] = useState(event.cars[0]?.carName ?? "");
  const [average, setAverage] = useState("2:08.500");
  const [best, setBest] = useState("2:07.900");
  const [laps, setLaps] = useState(20);
  const [consistency, setConsistency] = useState(0.8);
  const [incidents, setIncidents] = useState(0);
  const [feedback, setFeedback] = useState("");
  const entries = state.paceEntries.filter((entry) => entry.eventId === event.id).sort((a, b) => a.averageLapSeconds - b.averageLapSeconds);

  const addManual = (formEvent: React.FormEvent) => { formEvent.preventDefault(); try { const averageLapSeconds = parseLapSeconds(average); const bestLapSeconds = parseLapSeconds(best); dispatch({ type: "add_pace_entry", entry: { id: makeId("pace"), eventId: event.id, userId: manager ? userId : activePersona.id, circuit: event.circuit, configuration: event.configuration, car, conditions: "dry", averageLapSeconds, medianLapSeconds: averageLapSeconds, bestLapSeconds, bestFiveAverageSeconds: (averageLapSeconds + bestLapSeconds) / 2, consistencySeconds: consistency, validLaps: laps, incidents, averageStintMinutes: 0, recordedAt: new Date().toISOString(), source: "manual", notes: "" } }); setFeedback("Pacegegevens opgeslagen."); } catch (error) { setFeedback(error instanceof Error ? error.message : "Pace kon niet worden opgeslagen."); } };

  const upload = async (file?: File) => { if (!file) return; try { const parsed = parsePaceCsv(await file.text()); dispatch({ type: "add_pace_entry", entry: { id: makeId("pace"), eventId: event.id, userId: manager ? userId : activePersona.id, circuit: event.circuit, configuration: event.configuration, car, conditions: "dry", ...parsed, recordedAt: new Date().toISOString(), source: "csv", notes: file.name } }); setFeedback(`${file.name} verwerkt zonder gedeeltelijke import.`); } catch (error) { setFeedback(error instanceof Error ? error.message : "CSV kon niet worden verwerkt."); } };

  return <div className="space-y-5"><Panel><SectionHeading eyebrow="Meerdere ronden" title="Pace & betrouwbaarheid" description="Rangschikking gebruikt gemiddelde, consistentie, incidenten en hoeveelheid data—nooit alleen de snelste ronde." />
    <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-[11px] uppercase tracking-wider text-gray-500"><tr><th className="pb-3">Coureur</th><th>Auto</th><th>Gemiddelde</th><th>Beste 5</th><th>Afwijking</th><th>Ronden</th><th>Score</th><th>Betrouwbaarheid</th></tr></thead><tbody className="divide-y divide-white/5">{entries.map((entry) => { const driver = state.personas.find((persona) => persona.id === entry.userId); const confidence = paceConfidence(entry); return <tr key={entry.id}><td className="py-3 font-bold text-white">{driver?.name}</td><td className="text-gray-400">{entry.car}</td><td className="text-gray-200">{formatLapTime(entry.averageLapSeconds)}</td><td className="text-gray-300">{formatLapTime(entry.bestFiveAverageSeconds)}</td><td className="text-gray-400">±{entry.consistencySeconds.toFixed(2)}s</td><td className="text-gray-400">{entry.validLaps}</td><td><span className="inline-flex items-center gap-1 font-black text-orange-300"><Gauge className="h-3.5 w-3.5" />{paceScore(entry)}</span></td><td><StatusPill tone={confidence === "Hoog" ? "green" : confidence === "Gemiddeld" ? "orange" : "red"}>{confidence}</StatusPill></td></tr>; })}</tbody></table></div>
  </Panel>
  <Panel><SectionHeading title="Pace toevoegen" description="Voer een long-run handmatig in of upload een CSV met average_lap/best_lap/valid_laps of lap_times gescheiden door puntkomma’s." />
    <form onSubmit={addManual} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{manager && <Field label="Coureur"><select className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)}>{participants.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}</select></Field>}<Field label="Auto"><select className={inputClass} value={car} onChange={(e) => setCar(e.target.value)}>{event.cars.map((entry) => <option key={entry.id}>{entry.carName}</option>)}</select></Field><Field label="Gemiddelde rondetijd"><input className={inputClass} value={average} onChange={(e) => setAverage(e.target.value)} /></Field><Field label="Snelste ronde"><input className={inputClass} value={best} onChange={(e) => setBest(e.target.value)} /></Field><Field label="Geldige ronden"><input type="number" min={1} className={inputClass} value={laps} onChange={(e) => setLaps(Number(e.target.value))} /></Field><Field label="Afwijking in seconden"><input type="number" min={0} step="0.01" className={inputClass} value={consistency} onChange={(e) => setConsistency(Number(e.target.value))} /></Field><Field label="Incidenten"><input type="number" min={0} className={inputClass} value={incidents} onChange={(e) => setIncidents(Number(e.target.value))} /></Field><div className="flex items-end gap-2"><PrimaryButton type="submit"><Plus className="h-4 w-4" /> Opslaan</PrimaryButton><label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-white/[0.045] px-4 py-2 text-sm font-bold text-gray-200 ring-1 ring-white/10"><FileUp className="h-4 w-4" /> CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} /></label></div></form>{feedback && <p role="status" className="mt-4 text-sm text-orange-200">{feedback}</p>}
  </Panel></div>;
};
