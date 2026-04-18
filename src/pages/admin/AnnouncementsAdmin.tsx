import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTeams, type Team } from "@/hooks/data/useSharedQueries";
import { toast } from "sonner";
import { Flag } from "lucide-react";

const AnnouncementsAdmin = () => {
  const { data: teams = [] } = useTeams();

  const [annTitle, setAnnTitle] = useState("");
  const [annMessage, setAnnMessage] = useState("");
  const [annImage, setAnnImage] = useState("");
  const [annTags, setAnnTags] = useState<string[]>([]);
  const [annImageUploading, setAnnImageUploading] = useState(false);
  const [annImageError, setAnnImageError] = useState<string | null>(null);

  const handleImageUpload = async (file: File) => {
    setAnnImageError(null);
    setAnnImageUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage
        .from('announcement-images')
        .upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage
        .from('announcement-images')
        .getPublicUrl(path);
      setAnnImage(publicUrl);
    } catch (e: unknown) {
      setAnnImageError(e instanceof Error ? e.message : "Upload mislukt.");
    } finally {
      setAnnImageUploading(false);
    }
  };

  const sendAnnouncement = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("announcements").insert({
        title: annTitle.trim(),
        message: annMessage.trim(),
        image_url: annImage || null,
        tag: annTags.length ? annTags.join(",") : "none",
        sent: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aankondiging ingepland — bot verstuurt binnen 1 minuut!");
      setAnnTitle(""); setAnnMessage(""); setAnnImage(""); setAnnTags([]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <h2 className="font-heading text-2xl font-black mb-6">AANKONDIGINGEN</h2>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

        {/* ── Formulier ── */}
        <div className="bg-card border border-border rounded-lg p-6 racing-stripe-left">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Titel</label>
              <input
                type="text"
                value={annTitle}
                onChange={e => setAnnTitle(e.target.value)}
                placeholder="Bijv. Race update — ronde 3"
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Bericht</label>
              <textarea
                value={annMessage}
                onChange={e => setAnnMessage(e.target.value)}
                placeholder="Schrijf hier de aankondiging..."
                rows={8}
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm focus:outline-none focus:border-primary resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1.5">Gebruik enters tussen alinea's voor de beste weergave in Discord.</p>
            </div>

            {/* Afbeelding upload */}
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Afbeelding (optioneel)</label>
              <div className="space-y-2">
                <label className={`flex items-center justify-center gap-2 w-full px-4 py-3 rounded-md border-2 border-dashed cursor-pointer transition-colors ${annImageUploading ? "border-border opacity-50" : "border-border hover:border-primary hover:bg-secondary/30"}`}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={annImageUploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ""; }}
                  />
                  {annImageUploading ? (
                    <span className="text-sm text-muted-foreground">Uploaden...</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {annImage ? "↺ Andere afbeelding kiezen" : "📎 Afbeelding uploaden (max 5 MB)"}
                    </span>
                  )}
                </label>
                {annImageError && <p className="text-xs text-red-400">{annImageError}</p>}
                {annImage && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-green-400 truncate flex-1">✓ Geüpload</span>
                    <button onClick={() => { setAnnImage(""); setAnnImageError(null); }} className="text-xs text-red-400 hover:text-red-300 shrink-0">✕ Verwijderen</button>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Tags / Mentions <span className="text-xs text-muted-foreground font-normal">(meerdere mogelijk)</span></label>
              <div className="space-y-2 p-3 rounded-md border border-border bg-secondary/30">
                {[
                  { value: "everyone", label: "@everyone" },
                  { value: "here", label: "@here" },
                  ...teams.map((t: Team) => ({ value: `team_${t.id}`, label: `@${t.name}` })),
                ].map(opt => (
                  <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={annTags.includes(opt.value)}
                      onChange={e => setAnnTags(prev =>
                        e.target.checked ? [...prev, opt.value] : prev.filter(t => t !== opt.value)
                      )}
                      className="rounded border-border"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <button
              onClick={() => sendAnnouncement.mutate()}
              disabled={!annTitle.trim() || !annMessage.trim() || sendAnnouncement.isPending || annImageUploading}
              className="flex items-center gap-2 px-6 py-2.5 rounded-md bg-gradient-racing text-white font-heading font-bold text-sm uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Flag className="w-4 h-4" />
              {sendAnnouncement.isPending ? "Versturen..." : "Verstuur aankondiging"}
            </button>
          </div>
        </div>

        {/* ── Discord embed preview ── */}
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Live preview — Discord embed</p>
          <div className="rounded-md overflow-hidden" style={{ backgroundColor: "#2b2d31" }}>
            {/* Mentions balk */}
            {annTags.length > 0 && (
              <div className="px-4 pt-3 pb-1 flex flex-wrap gap-1">
                {annTags.map(tag => (
                  <span key={tag} className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: "#5865f230", color: "#5865f2" }}>
                    {tag === "everyone" ? "@everyone" : tag === "here" ? "@here" : `@${teams.find((t: Team) => `team_${t.id}` === tag)?.name || tag}`}
                  </span>
                ))}
              </div>
            )}
            {/* Embed card */}
            <div className="flex m-3 mt-2 rounded overflow-hidden" style={{ borderLeft: "4px solid #f97316" }}>
              <div className="flex-1 px-3 py-3" style={{ backgroundColor: "#2f3136" }}>
                {/* Bot naam */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white" style={{ backgroundColor: "#f97316" }}>3</div>
                  <span className="text-xs font-bold" style={{ color: "#f97316" }}>3SM Bot</span>
                  <span className="text-[10px] px-1 rounded" style={{ backgroundColor: "#5865f2", color: "white" }}>APP</span>
                </div>
                {/* Titel */}
                {annTitle ? (
                  <div className="font-bold text-sm mb-1" style={{ color: "#ffffff" }}>{annTitle}</div>
                ) : (
                  <div className="font-bold text-sm mb-1" style={{ color: "#4f545c" }}>Titel van de aankondiging...</div>
                )}
                {/* Bericht */}
                {annMessage ? (
                  <div className="text-sm whitespace-pre-wrap" style={{ color: "#dcddde" }}>{annMessage}</div>
                ) : (
                  <div className="text-sm" style={{ color: "#4f545c" }}>Schrijf hier de aankondiging...</div>
                )}
                {/* Afbeelding */}
                {annImage && (
                  <img
                    src={annImage}
                    alt="embed afbeelding"
                    className="mt-3 rounded max-w-full"
                    style={{ maxHeight: "300px", objectFit: "contain" }}
                    onError={() => { setAnnImage(""); setAnnImageError("Afbeelding kon niet geladen worden."); }}
                  />
                )}
                {/* Footer */}
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-[11px]" style={{ color: "#72767d" }}>3 Stripe Motorsport</span>
                  <span className="text-[11px]" style={{ color: "#72767d" }}>•</span>
                  <span className="text-[11px]" style={{ color: "#72767d" }}>
                    {new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">De preview is een benadering van hoe het eruitziet in Discord.</p>
        </div>

      </div>
    </div>
  );
};

export default AnnouncementsAdmin;
