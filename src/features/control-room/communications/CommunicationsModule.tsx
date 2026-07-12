import { useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ImagePlus, Loader2, RefreshCw, Send, TriangleAlert, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Announcement = Database["public"]["Tables"]["announcements"]["Row"];
type Team = Database["public"]["Tables"]["teams"]["Row"];
type AudienceTag = "everyone" | "here" | `team_${string}`;

const ANNOUNCEMENT_IMAGE_BUCKET = "announcement-images";
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type AnnouncementDraft = {
  title: string;
  message: string;
  imageUrl: string | null;
  tags: AudienceTag[];
};

export type CommunicationsModuleProps = {
  /** @deprecated Queue insertion is now owned by this production-capable module. */
  onPrepareAnnouncement?: (draft: AnnouncementDraft) => void;
};

const botTimestamp = () => new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam",
}).format(new Date());

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function CommunicationsModule(props: CommunicationsModuleProps) {
  // Keep the deprecated callback-shaped prop source-compatible while queue insertion stays native to this module.
  void props;
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("Race update");
  const [message, setMessage] = useState("De inschrijving is geopend. Controleer je auto-keuze voordat de lock ingaat.");
  const [tags, setTags] = useState<AudienceTag[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const teamsQuery = useQuery({
    queryKey: ["control-room", "teams", "announcement-tags"],
    queryFn: async (): Promise<Team[]> => {
      const { data, error } = await supabase.from("teams").select("*").order("name");
      if (error) throw error;
      return data || [];
    },
  });
  const queueQuery = useQuery({
    queryKey: ["control-room", "announcements", "queue"],
    queryFn: async (): Promise<Announcement[]> => {
      const { data, error } = await supabase.from("announcements").select("*").order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30_000,
  });

  const queueAnnouncement = useMutation({
    mutationFn: async (draft: AnnouncementDraft) => {
      const { error } = await supabase.from("announcements").insert({
        title: draft.title,
        message: draft.message,
        image_url: draft.imageUrl,
        // The Discord worker consumes this exact comma-separated representation; no sorting or normalization.
        tag: draft.tags.length ? draft.tags.join(",") : "none",
        sent: false,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["control-room", "announcements", "queue"] });
      setTitle("");
      setMessage("");
      setImageUrl(null);
      setTags([]);
      setFormError(null);
      setSuccessMessage("Aankondiging ingepland — de bot verstuurt deze binnen 1 minuut.");
    },
    onError: (error) => {
      setSuccessMessage(null);
      setFormError(errorMessage(error, "Aankondiging kon niet in de queue worden gezet."));
    },
  });

  const teams = teamsQuery.data || [];
  const queue = queueQuery.data || [];
  const queued = queue.filter((announcement) => !announcement.sent);
  const latestSent = queue.find((announcement) => announcement.sent);
  const selectedTeams = tags.filter((tag): tag is `team_${string}` => tag.startsWith("team_"));
  const selectedTeamRecords = selectedTeams.map((tag) => teams.find((team) => team.id === tag.slice(5))).filter((team): team is Team => Boolean(team));
  const embedColor = selectedTeamRecords.length === 1 ? selectedTeamRecords[0].color : "#f97316";
  const hasCombinedTeamColours = selectedTeamRecords.length > 1;
  const unsyncedTeamTags = selectedTeamRecords.filter((team) => !team.discord_role_id);

  const toggleTag = (tag: AudienceTag) => {
    setSuccessMessage(null);
    setTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  };

  const chooseImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setImageError(null);
    setSuccessMessage(null);
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setImageError("Kies een JPG, PNG, WebP of GIF-afbeelding.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("De afbeelding mag maximaal 5 MB zijn.");
      return;
    }

    setImageUploading(true);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "image";
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      const { error } = await supabase.storage.from(ANNOUNCEMENT_IMAGE_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from(ANNOUNCEMENT_IMAGE_BUCKET).getPublicUrl(path);
      setImageUrl(data.publicUrl);
    } catch (error) {
      setImageError(errorMessage(error, "Upload mislukt."));
    } finally {
      setImageUploading(false);
    }
  };

  const submitAnnouncement = () => {
    const draft: AnnouncementDraft = { title: title.trim(), message: message.trim(), imageUrl, tags };
    if (!draft.title || !draft.message) {
      setSuccessMessage(null);
      setFormError("Vul zowel een titel als een embedbericht in.");
      return;
    }
    setFormError(null);
    setSuccessMessage(null);
    queueAnnouncement.mutate(draft);
  };

  const mentionText = tags.map((tag) => tag === "everyone" ? "@everyone" : tag === "here" ? "@here" : `@${teams.find((team) => `team_${team.id}` === tag)?.name || "team"}`).join(" ");
  const queueError = queueQuery.error ? errorMessage(queueQuery.error, "De wachtrij kon niet worden geladen.") : null;

  return <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
    <section className="space-y-5 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
      <div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-orange-300">Discord communicatie</p><h2 className="mt-1 font-heading text-2xl font-black text-white">Aankondiging voorbereiden</h2><p className="mt-2 text-sm leading-relaxed text-gray-400">Sla een aankondiging direct op in de botwachtrij. De preview volgt de botvolgorde precies.</p></div>
      <label className="block text-sm font-bold text-gray-300">Titel<input value={title} onChange={(event) => { setTitle(event.target.value); setFormError(null); }} className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2.5 font-normal text-white outline-none focus:border-orange-400/40" /></label>
      <label className="block text-sm font-bold text-gray-300">Embedbericht<textarea value={message} onChange={(event) => { setMessage(event.target.value); setFormError(null); }} rows={7} className="mt-1.5 w-full resize-none rounded-lg border border-white/10 bg-black/15 px-3 py-2.5 font-normal text-white outline-none focus:border-orange-400/40" /></label>
      <div><p className="text-sm font-bold text-gray-300">Mentions in berichtinhoud</p><p className="mt-1 text-xs text-gray-500">@everyone en @here worden boven de embed gestuurd. Een teamtag gebruikt de gekoppelde Discord-teamrol.</p><div className="mt-3 flex flex-wrap gap-2">{(["everyone", "here"] as AudienceTag[]).map((tag) => <button type="button" key={tag} onClick={() => toggleTag(tag)} className={tags.includes(tag) ? "rounded-full border border-orange-400/40 bg-orange-400/10 px-3 py-1.5 text-xs font-bold text-orange-100" : "rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold text-gray-400"}>@{tag}</button>)}{teams.map((team) => { const tag = `team_${team.id}` as AudienceTag; return <button type="button" key={team.id} onClick={() => toggleTag(tag)} className={tags.includes(tag) ? "rounded-full border border-orange-400/40 bg-orange-400/10 px-3 py-1.5 text-xs font-bold text-orange-100" : "rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold text-gray-400"}>@{team.name}</button>; })}</div>{teamsQuery.isError && <p className="mt-2 text-xs text-red-300">Teamtags konden niet geladen worden.</p>}</div>
      <div><p className="text-sm font-bold text-gray-300">Afbeelding in embed</p><div className="mt-2 flex items-center gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs font-bold text-gray-300 hover:border-orange-400/40"><ImagePlus className="h-4 w-4 text-orange-300" />{imageUploading ? "Uploaden..." : imageUrl ? "Andere afbeelding" : "Afbeelding kiezen"}<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={imageUploading} onChange={chooseImage} /></label>{imageUrl && <button type="button" onClick={() => { setImageUrl(null); setImageError(null); }} className="inline-flex items-center gap-1 text-xs font-bold text-red-300"><X className="h-3.5 w-3.5" /> Verwijderen</button>}</div><p className="mt-1.5 text-xs text-gray-500">JPG, PNG, WebP of GIF · maximaal 5 MB · opgeslagen in de publieke announcement-images bucket.</p>{imageError && <p role="alert" className="mt-2 text-xs text-red-300">{imageError}</p>}</div>
      {(hasCombinedTeamColours || unsyncedTeamTags.length > 0) && <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-relaxed text-amber-100"><div className="flex gap-2"><TriangleAlert className="h-4 w-4 shrink-0 text-amber-300" /><span>{hasCombinedTeamColours && "Meerdere teamtags hebben geen gecombineerde embedkleur; de bot gebruikt daarom de standaard 3SM-oranje. "}{unsyncedTeamTags.length > 0 && `${unsyncedTeamTags.map((team) => team.name).join(", ")} heeft/hebben geen gekoppelde Discord-rol; die mention kan niet door de bot worden opgelost.`}</span></div></div>}
      {formError && <p role="alert" className="rounded-lg border border-red-400/20 bg-red-400/[0.06] p-3 text-sm text-red-200">{formError}</p>}
      {successMessage && <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-sm text-emerald-100"><CheckCircle2 className="h-4 w-4 shrink-0" />{successMessage}</p>}
      <button type="button" onClick={submitAnnouncement} disabled={!title.trim() || !message.trim() || imageUploading || queueAnnouncement.isPending} className="inline-flex items-center gap-2 rounded-lg bg-gradient-racing px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"><Send className="h-4 w-4" />{queueAnnouncement.isPending ? "Inplannen..." : "Inplannen in botqueue"}</button>
    </section>

    <section className="space-y-5"><div className="rounded-2xl border border-white/[0.07] bg-[#313338] p-5"><div className="flex items-center justify-between"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#b5bac1]">Bot-accurate Discord preview</p><span className="rounded bg-[#5865f2] px-1.5 py-0.5 text-[10px] font-black text-white">APP</span></div><div className="mt-5 rounded-lg bg-[#2b2d31] p-4"><div className="flex items-center gap-2"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500 text-xs font-black text-white">3</div><div><p className="text-sm font-bold text-white">3SM Bot <span className="ml-1 rounded bg-[#5865f2] px-1 py-0.5 text-[9px] text-white">APP</span></p><p className="text-[11px] text-[#b5bac1]">{botTimestamp()}</p></div></div>{mentionText && <p className="mt-4 text-sm font-semibold text-[#c9cdfb]">{mentionText}</p>}<div className="mt-3 rounded border-l-4 bg-[#2b2d31] p-4" style={{ borderLeftColor: embedColor }}><p className="font-bold text-white">{title || "Titel van de aankondiging"}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#dbdee1]">{message || "Schrijf hier de aankondiging..."}</p>{imageUrl && <img src={imageUrl} alt="Gekozen embedafbeelding" className="mt-3 max-h-72 max-w-full rounded object-contain" onError={() => setImageError("Afbeelding kon niet geladen worden.")} />}<p className="mt-4 text-xs text-[#b5bac1]">3 Stripe Motorsport · {botTimestamp()}</p></div></div><p className="mt-3 text-xs leading-relaxed text-[#b5bac1]">Berichtinhoud (mentions) → embed met teamkleur of 3SM-oranje → footer en timestamp.</p></div>
      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-gray-500">Queue status</p><h3 className="mt-1 font-heading text-xl font-black text-white">Huidige botwachtrij</h3></div><div className="flex items-center gap-2"><button type="button" aria-label="Vernieuw wachtrijstatus" onClick={() => queueQuery.refetch()} disabled={queueQuery.isFetching} className="rounded-full border border-white/10 p-2 text-gray-300 hover:border-orange-400/40 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${queueQuery.isFetching ? "animate-spin" : ""}`} /></button><span className="rounded-full bg-orange-400/10 px-2.5 py-1 text-xs font-black text-orange-200">{queued.length} wachtend</span></div></div><div className="mt-4 space-y-2">{queueQuery.isLoading && <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Wachtrij laden...</p>}{queueError && <p role="alert" className="text-sm text-red-300">{queueError}</p>}{queued.map((announcement) => <div key={announcement.id} className="rounded-lg border border-amber-400/15 bg-amber-400/[0.05] p-3"><p className="font-bold text-white">{announcement.title}</p><p className="mt-1 text-xs text-amber-100/70">In wachtrij · tags: {announcement.tag || "none"}</p></div>)}{!queueQuery.isLoading && !queueError && !queued.length && <p className="text-sm text-gray-500">Geen niet-verzonden aankondigingen in de queue.</p>}{latestSent && <p className="border-t border-white/[0.06] pt-3 text-xs text-emerald-300">Laatst verzonden: {latestSent.title}</p>}</div></div></section>
  </div>;
}
