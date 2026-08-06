import { Database, Loader2, ShieldCheck } from "lucide-react";
import { useEnduranceEvents } from "../repository/eventsRepository";
import { formatAmsterdam } from "../core/selectors";
import { Panel } from "../shared/ui";

/**
 * Live-databank-venster — Fase 3.
 * Toont de ECHTE endurance-events uit de productie-Supabase via de repository
 * (super-admin-only RLS). Dit is een read-only bewijs-venster dat naast de mock
 * draait: zodra een component volledig is overgezet naar de databank kan dit
 * venster verdwijnen. Geen enkele write; alleen super-admin leest.
 */
export const LiveDatabaseEvents = () => {
  const { data, isLoading, isError, error } = useEnduranceEvents();
  return (
    <Panel className="ring-1 ring-emerald-500/20">
      <div className="mb-3 flex items-center gap-2">
        <Database className="h-4 w-4 text-emerald-400" />
        <h3 className="font-heading text-sm font-black uppercase tracking-wider text-emerald-300">Live databank (echte events)</h3>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300"><ShieldCheck className="h-3 w-3" /> super-admin DB</span>
      </div>
      {isLoading ? (
        <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /> Events laden…</p>
      ) : isError ? (
        <p className="text-sm text-red-400">Kon live events niet laden: {(error as Error)?.message}</p>
      ) : data && data.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {data.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-black/20 px-3 py-2">
              <span className="font-bold text-white">{event.name}</span>
              <span className="text-gray-400">{event.circuit}</span>
              <span className="ml-auto text-gray-500">{formatAmsterdam(event.start_at)}</span>
              <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-orange-300">{event.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-400">Nog geen endurance-events in de databank.</p>
      )}
    </Panel>
  );
};
