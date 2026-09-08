import { useState } from "react";
import { Gauge, TimerReset } from "lucide-react";
import type { EnduranceEvent } from "../core/types";
import { PacePanel } from "../pace/PacePanel";
import { PracticeSessionPanel } from "./PracticeSessionPanel";

export const PracticePaceWorkspace = ({ event }: { event: EnduranceEvent }) => {
  const [view, setView] = useState<"pace" | "sessions">("pace");
  return <div className="space-y-5">
    <div className="flex flex-col gap-4 rounded-2xl border border-orange-500/15 bg-gradient-to-br from-orange-500/10 to-transparent p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="font-heading text-xl font-black text-white">Practice & Pace</h2><p className="mt-1 text-sm text-gray-400">Train samen, vergelijk je tempo en bereid je race voor.</p></div>
      <div className="flex gap-1 rounded-xl bg-black/30 p-1" aria-label="Practice en pace weergave">
        {([{ id: "pace", label: "Pace-analyse", icon: Gauge }, { id: "sessions", label: "Sessies", icon: TimerReset }] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} className={`flex min-h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-400 ${view === id ? "bg-orange-500 text-white shadow-lg shadow-orange-950/20" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}><Icon className="h-4 w-4" />{label}</button>)}
      </div>
    </div>
    {view === "pace" ? <PacePanel event={event} /> : <PracticeSessionPanel event={event} onPaceSynced={() => setView("pace")} />}
  </div>;
};
