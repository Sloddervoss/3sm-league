import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Clock, Plus, Shield } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { buildPenaltySummary, PROTEST_DEADLINE_HOURS, statusStyles } from "@/lib/stewardConstants";
import { toast } from "sonner";

type Race = { id: string; name: string; track: string; race_date: string; league_id: string | null };
type Driver = { user_id: string; display_name: string | null; iracing_name: string | null };
type VisibleProtest = {
  id: string;
  visibility: "submitted" | "decision";
  event_name: string;
  track: string;
  lap_number: number | null;
  race_date: string;
  created_at: string;
  status: string;
  penalty_type: string | null;
  penalty_points: number | null;
  time_penalty_seconds: number | null;
  grid_penalty_places: number | null;
  race_ban_next: boolean | null;
  public_decision: string | null;
  description: string | null;
  video_link: string | null;
};
type ProtestForm = { race_id: string; accused_user_id: string; lap_number: string; description: string; video_link: string };

const emptyForm = (): ProtestForm => ({ race_id: "", accused_user_id: "", lap_number: "", description: "", video_link: "" });
const formatDate = (value: string) => new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(value));

/** Participant read model. The RPC is the confidentiality boundary for accused drivers. */
export function UserProtestWorkspace() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState<ProtestForm>(emptyForm);

  const racesQuery = useQuery({
    queryKey: ["races-for-protest"],
    enabled: !!user,
    queryFn: async (): Promise<Race[]> => {
      const { data, error } = await supabase.from("races").select("id, name, track, race_date, league_id").eq("status", "completed").order("race_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const driversQuery = useQuery({
    queryKey: ["drivers-for-protest"],
    enabled: !!user,
    queryFn: async (): Promise<Driver[]> => {
      const { data, error } = await supabase.from("public_profiles").select("user_id, display_name, iracing_name").order("display_name");
      if (error) throw error;
      return data || [];
    },
  });
  const protestsQuery = useQuery({
    queryKey: ["my-protests", user?.id],
    enabled: !!user,
    refetchOnMount: "always",
    queryFn: async (): Promise<VisibleProtest[]> => {
      const { data, error } = await supabase.rpc("get_my_visible_protests");
      if (error) throw error;
      return (data || []) as VisibleProtest[];
    },
  });

  const submitProtest = useMutation({
    mutationFn: async () => {
      const race = racesQuery.data?.find((item) => item.id === form.race_id);
      if (race) {
        const hoursSince = (Date.now() - new Date(race.race_date).getTime()) / (1000 * 60 * 60);
        if (hoursSince > PROTEST_DEADLINE_HOURS) throw new Error(`Protest kan alleen binnen ${PROTEST_DEADLINE_HOURS} uur na de race worden ingediend.`);
      }
      const { error } = await supabase.from("protests").insert({
        race_id: form.race_id,
        reporter_user_id: user!.id,
        accused_user_id: form.accused_user_id,
        lap_number: form.lap_number ? parseInt(form.lap_number) : null,
        description: form.description,
        video_link: form.video_link || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Protest ingediend! Een steward bekijkt dit zo snel mogelijk.");
      queryClient.invalidateQueries({ queryKey: ["my-protests"] });
      setShowForm(false);
      setForm(emptyForm());
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!user) return null;
  const races = racesQuery.data || [];
  const drivers = driversQuery.data || [];
  const protests = protestsQuery.data || [];
  const loading = racesQuery.isLoading || driversQuery.isLoading || protestsQuery.isLoading;
  const error = racesQuery.error || driversQuery.error || protestsQuery.error;

  return <section aria-label="Mijn protesten" className="space-y-5 text-gray-100">
    <header className="flex flex-col gap-3 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">3SM</p><h1 className="mt-1 font-heading text-2xl font-black">PROTEST INDIENEN</h1><p className="mt-1 text-sm text-gray-400">Dien een protest in over een race-incident binnen {PROTEST_DEADLINE_HOURS} uur na de race.</p></div>
      <button type="button" onClick={() => setShowForm((visible) => !visible)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-racing px-4 py-2 text-sm font-black text-white"><Plus className="h-4 w-4" />Nieuw protest</button>
    </header>

    {showForm && <form onSubmit={(event) => { event.preventDefault(); submitProtest.mutate(); }} className="rounded-xl border border-orange-400/20 bg-orange-500/[0.05] p-5">
      <h2 className="font-heading text-lg font-black">PROTEST FORMULIER</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-gray-300">Race *<select required value={form.race_id} onChange={(event) => setForm({ ...form, race_id: event.target.value })} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"><option value="">Selecteer race...</option>{races.map((race) => { const expired = (Date.now() - new Date(race.race_date).getTime()) / (1000 * 60 * 60) > PROTEST_DEADLINE_HOURS; return <option key={race.id} value={race.id} disabled={expired}>{race.name} — {race.track} ({formatDate(race.race_date)}) {expired ? "— verlopen" : ""}</option>; })}</select></label>
        <label className="text-sm font-medium text-gray-300">Driver onder protest *<select required value={form.accused_user_id} onChange={(event) => setForm({ ...form, accused_user_id: event.target.value })} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"><option value="">Selecteer driver...</option>{drivers.filter((driver) => driver.user_id !== user.id).map((driver) => <option key={driver.user_id} value={driver.user_id}>{driver.iracing_name || driver.display_name}</option>)}</select></label>
        <label className="text-sm font-medium text-gray-300">Rondnummer<input type="number" min={1} value={form.lap_number} onChange={(event) => setForm({ ...form, lap_number: event.target.value })} placeholder="bijv. 12" className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white" /></label>
        <label className="text-sm font-medium text-gray-300">Video link<input type="url" value={form.video_link} onChange={(event) => setForm({ ...form, video_link: event.target.value })} placeholder="https://youtube.com/..." className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white" /></label>
        <label className="text-sm font-medium text-gray-300 md:col-span-2">Beschrijving van het incident *<textarea required rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Beschrijf zo duidelijk mogelijk wat er is gebeurd..." className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white" /></label>
      </div>
      <div className="mt-5 flex gap-3"><button type="submit" disabled={submitProtest.isPending || !form.race_id || !form.accused_user_id || !form.description} className="rounded-md bg-gradient-racing px-5 py-2 text-sm font-black text-white disabled:opacity-45">{submitProtest.isPending ? "Indienen..." : "Protest indienen"}</button><button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-white/15 px-5 py-2 text-sm font-bold text-gray-300">Annuleren</button></div>
    </form>}

    <div><h2 className="font-heading text-lg font-black">MIJN PROTESTEN</h2>{loading ? <p className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-gray-400">Protesten laden…</p> : error ? <p role="alert" className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">Protesten konden niet geladen worden.</p> : protests.length === 0 ? <div className="mt-3 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] p-10 text-center"><Shield className="mx-auto h-7 w-7 text-gray-600"/><p className="mt-3 text-sm text-gray-400">Je hebt nog geen protesten ingediend of definitieve stewardbeslissingen.</p></div> : <div className="mt-3 space-y-3">{protests.map((protest) => {
      const expanded = expandedId === protest.id;
      const StatusIcon = statusStyles[protest.status]?.icon || Clock;
      const ownSubmission = protest.visibility === "submitted";
      return <article key={protest.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"><button type="button" onClick={() => setExpandedId(expanded ? null : protest.id)} className="flex w-full items-start gap-3 text-left"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-heading font-bold">{ownSubmission ? "Jouw protest" : "Stewardbeslissing"} <span className="text-orange-300">·</span> {protest.event_name || "Onbekende race"}</span><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${statusStyles[protest.status]?.color || "border-white/10 text-gray-400"}`}><StatusIcon className="h-3 w-3" />{statusStyles[protest.status]?.label || protest.status}</span></div><p className="mt-1 text-xs text-gray-400">{protest.track} · {formatDate(protest.race_date)}{protest.lap_number ? ` · ronde ${protest.lap_number}` : ""}</p>{ownSubmission && protest.description && <p className="mt-2 line-clamp-2 text-sm text-gray-300">{protest.description}</p>}{!ownSubmission && <p className="mt-2 text-sm text-gray-300">{buildPenaltySummary(protest)}</p>}</div>{expanded ? <ChevronUp className="mt-1 h-4 w-4 text-gray-500" /> : <ChevronDown className="mt-1 h-4 w-4 text-gray-500" />}</button>{expanded && <div className="mt-4 border-t border-white/[0.08] pt-4">{ownSubmission ? <><p className="whitespace-pre-wrap text-sm text-gray-200">{protest.description}</p>{protest.video_link && <a className="mt-2 inline-block text-xs font-bold text-orange-300 hover:underline" href={protest.video_link} target="_blank" rel="noreferrer">Video openen</a>}</> : <><p className="text-sm font-bold text-gray-100">{buildPenaltySummary(protest)}</p>{protest.public_decision && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-black/15 p-3 text-sm text-gray-200">{protest.public_decision}</p>}</>}</div>}</article>;
    })}</div>}</div>
  </section>;
}

export default UserProtestWorkspace;
