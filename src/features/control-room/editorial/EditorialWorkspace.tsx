import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileText, Loader2, Newspaper, Save } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

const NEWS_CATEGORIES = ["Raceverslagen", "League Updates", "Race Recaps", "Interviews", "Reviews", "Community", "iRacing Nieuws", "Special Events"] as const;
type NewsCategory = typeof NEWS_CATEGORIES[number];
type NewsStatus = "draft" | "planned" | "published" | "archived";

type NewsPost = { id: string; slug: string; title: string; category: string; excerpt: string | null; content_json: Json; content_html: string; hero_image_url: string | null; hero_image_alt: string | null; seo_title: string | null; seo_description: string | null; status: string; language: string; season_id: string | null; race_id: string | null; is_featured: boolean; published_at: string | null; updated_at: string };
type Season = { id: string; name: string; season: string | null; status: string };
type Race = { id: string; name: string; track: string; race_date: string };

export type EditorialDraft = { id?: string; slug: string; title: string; category: NewsCategory; excerpt: string | null; contentHtml: string; contentJson: Json; heroImageUrl: string | null; heroImageAlt: string | null; seoTitle: string | null; seoDescription: string | null; status: NewsStatus; language: "nl" | "en"; seasonId: string | null; raceId: string | null; isFeatured: boolean; publishedAt: string | null };
export type EditorialAction = { id: "news-save"; impact: "write"; allowedRoles: Array<"editor" | "admin" | "super_admin">; context: { draft: EditorialDraft; mode: "create" | "update" } };
/** @deprecated Saving is owned natively by EditorialWorkspace. Kept for source compatibility only. */
export type EditorialWorkspaceProps = { onAction?: (action: EditorialAction) => void | Promise<void> };

type Form = Omit<EditorialDraft, "id">;
const plainContent = "<p>Schrijf hier het nieuwsbericht...</p>";
const blank = (): Form => ({ slug: "", title: "", category: "League Updates", excerpt: null, contentHtml: plainContent, contentJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Schrijf hier het nieuwsbericht..." }] }] }, heroImageUrl: null, heroImageAlt: null, seoTitle: null, seoDescription: null, status: "draft", language: "nl", seasonId: null, raceId: null, isFeatured: false, publishedAt: null });
const slugify = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
const statusLabel: Record<NewsStatus, string> = { draft: "Concept", planned: "Gepland", published: "Gepubliceerd", archived: "Gearchiveerd" };
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const textToJson = (html: string): Json => {
  const text = html.replace(/<[^>]*>/g, "").trim();
  return { type: "doc", content: text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [{ type: "paragraph" }] };
};
const toForm = (post: NewsPost): Form => ({ slug: post.slug, title: post.title, category: NEWS_CATEGORIES.includes(post.category as NewsCategory) ? post.category as NewsCategory : "League Updates", excerpt: post.excerpt, contentHtml: post.content_html || plainContent, contentJson: post.content_json, heroImageUrl: post.hero_image_url, heroImageAlt: post.hero_image_alt, seoTitle: post.seo_title, seoDescription: post.seo_description, status: (post.status as NewsStatus) || "draft", language: post.language === "en" ? "en" : "nl", seasonId: post.season_id, raceId: post.race_id, isFeatured: Boolean(post.is_featured), publishedAt: post.published_at });

export function EditorialWorkspace(props: EditorialWorkspaceProps) {
  // Do not invoke legacy callback mutations after the native write; that could duplicate a news post.
  void props;
  const { user, isAdmin, isSuperAdmin, isEditor } = useAuth();
  const queryClient = useQueryClient();
  const canEditNews = Boolean(user && (isAdmin || isSuperAdmin || isEditor));
  const [selectedId, setSelectedId] = useState<string | "new">("new");
  const [filter, setFilter] = useState<"all" | NewsCategory>("all");
  const [form, setForm] = useState<Form>(blank);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const hydratedSelectionRef = useRef<string | null>(null);

  const postsQuery = useQuery({ queryKey: ["control-room", "editorial", "news-posts"], enabled: canEditNews, queryFn: async (): Promise<NewsPost[]> => {
    const { data, error } = await supabase.from("news_posts").select("id,slug,title,category,excerpt,content_json,content_html,hero_image_url,hero_image_alt,seo_title,seo_description,status,language,season_id,race_id,is_featured,published_at,updated_at").order("updated_at", { ascending: false });
    if (error) throw error;
    return (data || []) as NewsPost[];
  } });
  const seasonsQuery = useQuery({ queryKey: ["control-room", "editorial", "seasons"], enabled: canEditNews, queryFn: async (): Promise<Season[]> => {
    const { data, error } = await supabase.from("leagues").select("id,name,season,status").order("updated_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } });
  const racesQuery = useQuery({ queryKey: ["control-room", "editorial", "races"], enabled: canEditNews, queryFn: async (): Promise<Race[]> => {
    const { data, error } = await supabase.from("races").select("id,name,track,race_date").order("race_date", { ascending: false });
    if (error) throw error;
    return data || [];
  } });

  const posts = postsQuery.data;
  const selected = posts?.find((post) => post.id === selectedId);
  const filtered = useMemo(() => { const records = posts || []; return filter === "all" ? records : records.filter((post) => post.category === filter); }, [filter, posts]);
  useEffect(() => {
    if (selectedId !== "new" && !selected) return;
    if (hydratedSelectionRef.current === selectedId) return;
    hydratedSelectionRef.current = selectedId;
    setForm(selected ? toForm(selected) : blank());
    setFormError(null);
    setSuccessMessage(null);
  }, [selected, selectedId]);
  const update = <K extends keyof Form>(key: K, value: Form[K]) => { setSuccessMessage(null); setForm((current) => ({ ...current, [key]: value })); };

  const saveNewsPost = useMutation({
    mutationFn: async (draft: EditorialDraft) => {
      const payload = {
        slug: draft.slug,
        title: draft.title,
        category: draft.category,
        excerpt: draft.excerpt,
        content_json: draft.contentJson,
        content_html: draft.contentHtml,
        hero_image_url: draft.heroImageUrl,
        hero_image_alt: draft.heroImageAlt,
        og_image_url: draft.heroImageUrl,
        seo_title: draft.seoTitle,
        seo_description: draft.seoDescription,
        status: draft.status,
        language: draft.language,
        season_id: draft.seasonId,
        race_id: draft.raceId,
        is_featured: draft.isFeatured,
        author_id: user?.id,
        published_at: draft.publishedAt,
      };
      const result = draft.id
        ? await supabase.from("news_posts").update(payload).eq("id", draft.id).select().single()
        : await supabase.from("news_posts").insert(payload).select().single();
      if (result.error) throw result.error;
      return result.data as NewsPost;
    },
    onSuccess: async (saved) => {
      hydratedSelectionRef.current = saved.id;
      setSelectedId(saved.id);
      setForm(toForm(saved));
      setFormError(null);
      setSuccessMessage(saved.status === "published" ? "Nieuwsbericht gepubliceerd." : "Nieuwsbericht opgeslagen.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["control-room", "editorial", "news-posts"] }),
        queryClient.invalidateQueries({ queryKey: ["news-posts-editor"] }),
        queryClient.invalidateQueries({ queryKey: ["public-news-posts"] }),
        queryClient.invalidateQueries({ queryKey: ["public-news-post"] }),
        queryClient.invalidateQueries({ queryKey: ["related-news-posts"] }),
      ]);
      toast.success(saved.status === "published" ? "Nieuwsbericht gepubliceerd" : "Nieuwsbericht opgeslagen");
    },
    onError: (error) => {
      const message = errorMessage(error, "Opslaan mislukt.");
      setSuccessMessage(null);
      setFormError(message);
      toast.error(message);
    },
  });

  const save = () => {
    const slug = form.slug.trim() || slugify(form.title);
    if (!form.title.trim()) { setFormError("Titel is verplicht."); return; }
    if (!form.category) { setFormError("Categorie is verplicht."); return; }
    if (!slug) { setFormError("Slug is verplicht."); return; }
    const contentHtml = form.contentHtml.trim() || plainContent;
    setFormError(null);
    setSuccessMessage(null);
    saveNewsPost.mutate({ ...form, id: selectedId === "new" ? undefined : selectedId, slug, title: form.title.trim(), contentHtml, contentJson: textToJson(contentHtml), excerpt: form.excerpt?.trim() || null, heroImageUrl: form.heroImageUrl?.trim() || null, heroImageAlt: form.heroImageAlt?.trim() || null, seoTitle: form.seoTitle?.trim() || form.title.trim(), seoDescription: form.seoDescription?.trim() || form.excerpt?.trim() || null, publishedAt: form.status === "published" ? selected?.published_at || new Date().toISOString() : null });
  };

  if (!canEditNews) return <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-gray-400"><Newspaper className="mb-2 h-5 w-5 text-orange-300" />Meld je aan met een editor-, admin- of super-adminrol om nieuws te beheren.</section>;
  const queryError = postsQuery.error || seasonsQuery.error || racesQuery.error;
  const loading = postsQuery.isLoading || seasonsQuery.isLoading || racesQuery.isLoading;
  return <section aria-label="Nieuwsredactie" className="space-y-5 text-gray-100"><header className="flex flex-col gap-4 border-b border-white/[0.08] pb-5 md:flex-row md:items-end md:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Control Room</p><h2 className="mt-1 font-heading text-2xl font-black">NIEUWSREDACTIE</h2><p className="mt-1 text-sm text-gray-400">Schrijf, classificeer, optimaliseer en plan publicaties.</p></div><button type="button" onClick={() => setSelectedId("new")} disabled={saveNewsPost.isPending} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-bold text-gray-200 disabled:opacity-50"><FileText className="h-4 w-4" />Nieuw bericht</button></header>{queryError && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">Redactiedata kon niet geladen worden: {errorMessage(queryError, "Onbekende fout")}</p>}{loading ? <p className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-6 text-sm text-gray-400">Redactiedata laden…</p> : <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]"><aside className="h-fit overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025] xl:sticky xl:top-24"><div className="border-b border-white/[0.08] p-3"><label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500">Categorie<select value={filter} onChange={(event) => setFilter(event.target.value as "all" | NewsCategory)} disabled={saveNewsPost.isPending} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm text-white"><option value="all">Alle categorieën</option>{NEWS_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label></div><button type="button" onClick={() => setSelectedId("new")} disabled={saveNewsPost.isPending} className={`w-full border-b border-white/[0.08] px-4 py-3 text-left text-sm disabled:opacity-50 ${selectedId === "new" ? "bg-orange-500/10 text-white" : "text-gray-400"}`}><b>+ Nieuw concept</b><span className="mt-1 block text-xs">Start met een leeg bericht</span></button><div className="max-h-[620px] overflow-y-auto">{filtered.map((post) => <button type="button" key={post.id} onClick={() => setSelectedId(post.id)} disabled={saveNewsPost.isPending} className={`w-full border-b border-white/[0.06] px-4 py-3 text-left disabled:opacity-50 ${selectedId === post.id ? "bg-orange-500/10 text-white" : "text-gray-400"}`}><span className="text-[10px] font-black uppercase tracking-wider text-orange-300">{post.category}</span><b className="mt-1 block line-clamp-2 text-sm">{post.title}</b><span className="mt-1 inline-block rounded bg-white/[0.06] px-2 py-0.5 text-[10px] uppercase">{statusLabel[(post.status as NewsStatus) || "draft"]} · {post.language.toUpperCase()}</span></button>)}{!filtered.length && <p className="p-4 text-sm text-gray-500">Geen berichten in deze categorie.</p>}</div></aside><div className="space-y-5"><article className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5"><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]"><label className="text-xs font-bold uppercase tracking-wider text-gray-500">Titel<input value={form.title} onChange={(event) => { update("title", event.target.value); if (!form.slug || form.slug === slugify(form.title)) update("slug", slugify(event.target.value)); }} disabled={saveNewsPost.isPending} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-4 py-3 font-heading text-2xl font-black normal-case tracking-normal text-white" placeholder="Race Recap Spa 27 Mei 2026" /></label><label className="text-xs font-bold uppercase tracking-wider text-gray-500">Categorie<select value={form.category} onChange={(event) => update("category", event.target.value as NewsCategory)} disabled={saveNewsPost.isPending} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-3 text-sm font-normal normal-case tracking-normal text-white">{NEWS_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label></div><div className="mt-5 rounded-lg border border-white/[0.08] bg-black/15"><header className="border-b border-white/[0.08] px-5 py-4"><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-300">{form.category}</p><h3 className="mt-2 font-heading text-3xl font-black">{form.title || "Titel verschijnt hier"}</h3></header><textarea aria-label="Artikelinhoud HTML" value={form.contentHtml} onChange={(event) => update("contentHtml", event.target.value)} disabled={saveNewsPost.isPending} rows={18} className="w-full resize-y bg-transparent px-5 py-4 font-mono text-sm leading-6 text-gray-200 outline-none disabled:opacity-50" placeholder="Artikelinhoud…" /></div></article><section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5"><h3 className="font-heading text-lg font-black">Publicatie</h3><div className="mt-4 grid gap-4 md:grid-cols-3"><label className="text-xs font-bold uppercase tracking-wider text-gray-500">Status<select value={form.status} onChange={(event) => update("status", event.target.value as NewsStatus)} disabled={saveNewsPost.isPending} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white">{(Object.keys(statusLabel) as NewsStatus[]).map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}</select></label><label className="rounded-lg border border-white/[0.08] p-3 text-sm text-gray-300"><input type="checkbox" checked={form.isFeatured} onChange={(event) => update("isFeatured", event.target.checked)} disabled={saveNewsPost.isPending} className="mr-2 accent-orange-500" />Uitlichten op nieuwsoverzicht</label><label className="text-xs font-bold uppercase tracking-wider text-gray-500">Korte intro<textarea value={form.excerpt || ""} onChange={(event) => update("excerpt", event.target.value || null)} disabled={saveNewsPost.isPending} rows={3} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white" /></label></div>{formError && <p role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{formError}</p>}{successMessage && <p role="status" className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">{successMessage}</p>}<div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" disabled={!form.title.trim() || saveNewsPost.isPending} onClick={save} className="inline-flex items-center gap-2 rounded-md bg-gradient-racing px-4 py-2 text-sm font-black text-white disabled:opacity-45">{saveNewsPost.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saveNewsPost.isPending ? "Opslaan..." : `Opslaan als ${statusLabel[form.status].toLowerCase()}`}</button>{(form.slug || form.title) && <span className="inline-flex items-center gap-2 text-xs text-gray-400"><Eye className="h-4 w-4" />/news/{form.slug || slugify(form.title)}</span>}</div></section><Metadata form={form} update={update} seasons={seasonsQuery.data || []} races={racesQuery.data || []} disabled={saveNewsPost.isPending} /></div></div>}</section>;
}

function Metadata({ form, update, seasons, races, disabled }: { form: Form; update: <K extends keyof Form>(key: K, value: Form[K]) => void; seasons: Season[]; races: Race[]; disabled: boolean }) {
  return <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5"><h3 className="font-heading text-lg font-black">Metadata & SEO</h3><div className="mt-4 grid gap-4 md:grid-cols-2"><Field label="Slug" value={form.slug} onChange={(value) => update("slug", slugify(value))} disabled={disabled} /><label className="text-xs font-bold uppercase tracking-wider text-gray-500">Taal<select value={form.language} onChange={(event) => update("language", event.target.value as "nl" | "en")} disabled={disabled} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white"><option value="nl">NL</option><option value="en">EN</option></select></label><label className="text-xs font-bold uppercase tracking-wider text-gray-500">Seizoen<select value={form.seasonId || ""} onChange={(event) => update("seasonId", event.target.value || null)} disabled={disabled} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white"><option value="">Geen seizoen</option>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}{season.season ? ` · ${season.season}` : ""}</option>)}</select></label><label className="text-xs font-bold uppercase tracking-wider text-gray-500">Race uitslag<select value={form.raceId || ""} onChange={(event) => update("raceId", event.target.value || null)} disabled={disabled} className="mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white"><option value="">Geen race</option>{races.map((race) => <option key={race.id} value={race.id}>{race.name} · {race.track}</option>)}</select></label><Field label="Hero afbeelding URL" value={form.heroImageUrl || ""} onChange={(value) => update("heroImageUrl", value || null)} disabled={disabled} /><Field label="Hero alt-tekst" value={form.heroImageAlt || ""} onChange={(value) => update("heroImageAlt", value || null)} disabled={disabled} /><Field label="SEO titel" value={form.seoTitle || ""} onChange={(value) => update("seoTitle", value || null)} disabled={disabled} /><Field label="SEO beschrijving" value={form.seoDescription || ""} onChange={(value) => update("seoDescription", value || null)} textarea disabled={disabled} /></div></section>;
}

function Field({ label, value, onChange, textarea = false, disabled }: { label: string; value: string; onChange: (value: string) => void; textarea?: boolean; disabled: boolean }) {
  const className = "mt-1.5 w-full rounded-md border border-white/10 bg-[#151820] px-3 py-2 text-sm font-normal normal-case tracking-normal text-white disabled:opacity-50";
  return <label className="text-xs font-bold uppercase tracking-wider text-gray-500">{label}{textarea ? <textarea rows={2} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={className} /> : <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={className} />}</label>;
}

export default EditorialWorkspace;
