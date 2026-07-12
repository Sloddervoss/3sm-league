import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export type RaceDeleteTarget = {
  raceId: string;
  name?: string | null;
  track?: string | null;
  race_date?: string | null;
  isSolo: boolean;
};

export function RaceDeleteConfirmation({ target, onCancel, onDeleted }: { target: RaceDeleteTarget; onCancel: () => void; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const deleteRace = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("races").delete().eq("id", target.raceId);
      if (error) throw error;
    },
    onSuccess: () => {
      [["control-room", "season", "races"], ["all-races-admin"], ["admin-leagues"], ["workspace-prototype-season-races"]]
        .forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      onDeleted();
    },
  });

  return <section className="mx-auto max-w-xl space-y-5 rounded-2xl border border-red-400/25 bg-[#151821] p-6" aria-label="Race verwijderen bevestigen">
    <div className="flex gap-3"><AlertTriangle className="h-6 w-6 shrink-0 text-red-300" /><div><p className="text-[11px] font-black uppercase tracking-[.16em] text-red-300">Onomkeerbare actie</p><h2 className="mt-1 font-heading text-2xl font-black text-white">{target.isSolo ? "Losse race verwijderen?" : "Seizoensrace verwijderen?"}</h2><p className="mt-3 text-sm leading-relaxed text-gray-300">Je staat op het punt <strong>{target.name || "deze race"}</strong>{target.track ? ` op ${target.track}` : ""} te verwijderen. Deze bevestiging is gekoppeld aan precies deze race en voert geen actie uit voor een andere race of een heel seizoen.</p></div></div>
    {deleteRace.error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/[.08] p-3 text-sm text-red-100">Verwijderen mislukt: {deleteRace.error.message}</p>}
    <div className="flex justify-end gap-2"><button type="button" disabled={deleteRace.isPending} onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-bold text-gray-300 disabled:opacity-50">Annuleren</button><button type="button" disabled={deleteRace.isPending} onClick={() => deleteRace.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{deleteRace.isPending && <Loader2 className="h-4 w-4 animate-spin" />}<Trash2 className="h-4 w-4" />Ja, race verwijderen</button></div>
  </section>;
}
