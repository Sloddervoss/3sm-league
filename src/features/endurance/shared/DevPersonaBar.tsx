import { RotateCcw, ShieldCheck } from "lucide-react";
import { useEnduranceStore } from "../core/EnduranceStore";
import { SecondaryButton } from "./ui";

const roleLabels = {
  endurance_admin: "Endurancebeheerder",
  race_manager: "Racemanager",
  team_manager: "Teammanager",
  driver: "Coureur",
  reserve: "Reserve",
};

export const DevPersonaBar = () => {
  const { state, activePersona, dispatch, reset } = useEnduranceStore();
  return (
    <div className="rounded-2xl bg-sky-500/[0.07] p-3 ring-1 ring-sky-400/20">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-sm text-sky-100">
          <ShieldCheck className="h-4 w-4 text-sky-300" />
          <div><strong>Lokale ontwikkelomgeving</strong><span className="ml-2 text-sky-200/65">Alle gegevens blijven in deze browser · MVP-taal: Nederlands.</span></div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-xs font-bold text-sky-100">
            Test als
            <select value={activePersona.id} onChange={(event) => dispatch({ type: "set_active_persona", personaId: event.target.value })} className="h-9 rounded-lg bg-black/35 px-3 text-sm text-white ring-1 ring-white/10">
              {state.personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name} · {roleLabels[persona.role]}</option>)}
            </select>
          </label>
          <SecondaryButton type="button" onClick={reset} className="min-h-9 px-3 py-1.5 text-xs"><RotateCcw className="h-3.5 w-3.5" /> Reset werkset</SecondaryButton>
        </div>
      </div>
    </div>
  );
};
