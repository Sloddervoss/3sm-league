import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bold, Eye, FileText, Heading1, Heading2, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, Loader2, Newspaper, Quote, Save, Search, Send } from "lucide-react";
import { toast } from "sonner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

type NewsPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content_json: Json;
  content_html: string;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  status: string;
  language: string;
  published_at: string | null;
  updated_at: string;
};

type NewsStatus = "draft" | "review" | "published" | "archived";

const emptyEditorContent = "<h2>Nieuwe update</h2><p>Schrijf hier het nieuwsbericht...</p>";

const generateSlug = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

const statusLabel = (status: string) => {
  switch (status) {
    case "published": return "Gepubliceerd";
    case "review": return "Review";
    case "archived": return "Archief";
    default: return "Concept";
  }
};

const NewsEditorPage = () => {
  const { user, loading, isAdmin, isSuperAdmin, isEditor } = useAuth();
  const queryClient = useQueryClient();
  const canEditNews = isAdmin || isSuperAdmin || isEditor;

  const [selectedPostId, setSelectedPostId] = useState<string | "new">("new");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [heroImageAlt, setHeroImageAlt] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [language, setLanguage] = useState<"nl" | "en">("nl");
  const [status, setStatus] = useState<NewsStatus>("draft");

  const editor = useEditor({
    extensions: [
      StarterKit,
      ImageExtension.configure({ inline: false, allowBase64: false }),
      LinkExtension.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
      Placeholder.configure({ placeholder: "Schrijf het nieuwsbericht..." }),
    ],
    content: emptyEditorContent,
    editorProps: {
      attributes: {
        class: "min-h-[320px] rounded-b-lg border-x border-b border-border bg-background/50 px-4 py-3 text-sm leading-relaxed outline-none prose prose-invert prose-sm max-w-none prose-headings:font-heading prose-a:text-primary prose-blockquote:border-primary",
      },
    },
  });

  const { data: posts = [], isLoading: postsLoading } = useQuery({
    queryKey: ["news-posts-editor"],
    enabled: Boolean(user && canEditNews),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_posts")
        .select("id,slug,title,excerpt,content_json,content_html,hero_image_url,hero_image_alt,seo_title,seo_description,status,language,published_at,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as NewsPost[];
    },
  });

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId),
    [posts, selectedPostId]
  );

  useEffect(() => {
    if (!editor) return;
    if (!selectedPost || selectedPostId === "new") {
      setTitle("");
      setSlug("");
      setExcerpt("");
      setHeroImageUrl("");
      setHeroImageAlt("");
      setSeoTitle("");
      setSeoDescription("");
      setLanguage("nl");
      setStatus("draft");
      editor.commands.setContent(emptyEditorContent);
      return;
    }

    setTitle(selectedPost.title);
    setSlug(selectedPost.slug);
    setExcerpt(selectedPost.excerpt || "");
    setHeroImageUrl(selectedPost.hero_image_url || "");
    setHeroImageAlt(selectedPost.hero_image_alt || "");
    setSeoTitle(selectedPost.seo_title || "");
    setSeoDescription(selectedPost.seo_description || "");
    setLanguage(selectedPost.language === "en" ? "en" : "nl");
    setStatus((selectedPost.status as NewsStatus) || "draft");
    editor.commands.setContent(selectedPost.content_html || emptyEditorContent);
  }, [editor, selectedPost, selectedPostId]);

  const normalizedSlug = slug.trim() || generateSlug(title);

  const buildPayload = (nextStatus: NewsStatus) => {
    if (!editor) throw new Error("Editor is nog niet geladen");
    if (!title.trim()) throw new Error("Titel is verplicht");
    if (!normalizedSlug) throw new Error("Slug is verplicht");

    return {
      slug: normalizedSlug,
      title: title.trim(),
      excerpt: excerpt.trim() || null,
      content_json: editor.getJSON() as Json,
      content_html: editor.getHTML(),
      hero_image_url: heroImageUrl.trim() || null,
      hero_image_alt: heroImageAlt.trim() || null,
      og_image_url: heroImageUrl.trim() || null,
      seo_title: seoTitle.trim() || title.trim(),
      seo_description: seoDescription.trim() || excerpt.trim() || null,
      status: nextStatus,
      language,
      author_id: user?.id,
      published_at: nextStatus === "published" ? new Date().toISOString() : selectedPost?.published_at ?? null,
    };
  };

  const upsertNewsPost = useMutation({
    mutationFn: async (nextStatus: NewsStatus) => {
      const payload = buildPayload(nextStatus);
      if (selectedPostId === "new") {
        const { data, error } = await supabase.from("news_posts").insert(payload).select().single();
        if (error) throw error;
        return data as NewsPost;
      }
      const { data, error } = await supabase.from("news_posts").update(payload).eq("id", selectedPostId).select().single();
      if (error) throw error;
      return data as NewsPost;
    },
    onSuccess: (saved) => {
      setSelectedPostId(saved.id);
      setSlug(saved.slug);
      setStatus(saved.status as NewsStatus);
      queryClient.invalidateQueries({ queryKey: ["news-posts-editor"] });
      toast.success(saved.status === "published" ? "Nieuwsbericht gepubliceerd" : "Concept opgeslagen");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Opslaan mislukt"),
  });

  const publishNewsPost = () => upsertNewsPost.mutate("published");

  const uploadNewsImage = async (file: File) => {
    if (!file) return;
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${user?.id || "editor"}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from("news-images").upload(path, file, { upsert: false });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from("news-images").getPublicUrl(path);
    editor?.chain().focus().setImage({ src: publicUrl, alt: file.name }).run();
    if (!heroImageUrl) {
      setHeroImageUrl(publicUrl);
      setHeroImageAlt(file.name);
    }
    toast.success("Afbeelding ingevoegd");
  };

  const setLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl || "https://");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  if (loading) return null;
  if (!user) return <Navigate to="/auth" />;
  if (!canEditNews) return <Navigate to="/profile" replace />;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="py-12">
          <div className="container mx-auto px-4 max-w-7xl">
            <div className="flex items-center gap-2 mb-1">
              <Newspaper className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-primary uppercase tracking-[0.15em]">Redactie</span>
            </div>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-8">
              <div>
                <h1 className="font-heading text-4xl font-black">NIEUWS REDACTIE</h1>
                <p className="text-sm text-muted-foreground mt-2">Maak concepten, voeg afbeeldingen in en publiceer nieuws voor 3SM.</p>
              </div>
              <button
                onClick={() => setSelectedPostId("new")}
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <FileText className="w-4 h-4" /> Nieuw bericht
              </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
              <aside className="bg-card border border-border rounded-lg overflow-hidden h-fit">
                <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between">
                  <span className="font-heading font-bold text-sm uppercase tracking-wider">Berichten</span>
                  {postsLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </div>
                <button
                  onClick={() => setSelectedPostId("new")}
                  className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${selectedPostId === "new" ? "bg-primary/10 text-foreground" : "hover:bg-secondary/30 text-muted-foreground"}`}
                >
                  <span className="block text-sm font-bold">+ Nieuw concept</span>
                  <span className="text-xs">Start met een leeg bericht</span>
                </button>
                <div className="max-h-[620px] overflow-y-auto">
                  {posts.map((post) => (
                    <button
                      key={post.id}
                      onClick={() => setSelectedPostId(post.id)}
                      className={`w-full text-left px-4 py-3 border-b border-border/70 transition-colors ${selectedPostId === post.id ? "bg-primary/10 text-foreground" : "hover:bg-secondary/30 text-muted-foreground"}`}
                    >
                      <span className="block text-sm font-bold line-clamp-1">{post.title}</span>
                      <span className="mt-1 inline-flex items-center gap-2 text-[11px] uppercase tracking-wider">
                        <span className="rounded bg-secondary px-2 py-0.5">{statusLabel(post.status)}</span>
                        <span>{post.language.toUpperCase()}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-6 racing-stripe-left">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block md:col-span-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Titel</span>
                    <input
                      value={title}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        if (!slug || slug === generateSlug(title)) setSlug(generateSlug(e.target.value));
                      }}
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      placeholder="Bijv. Raceverslag Snetterton"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Slug</span>
                    <input
                      value={slug}
                      onChange={(e) => setSlug(generateSlug(e.target.value))}
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      placeholder="raceverslag-snetterton"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</span>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as NewsStatus)}
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    >
                      <option value="draft">Concept</option>
                      <option value="review">Review</option>
                      <option value="published">Gepubliceerd</option>
                      <option value="archived">Archief</option>
                    </select>
                  </label>
                  <label className="block md:col-span-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Korte intro / excerpt</span>
                    <textarea
                      value={excerpt}
                      onChange={(e) => setExcerpt(e.target.value)}
                      rows={3}
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      placeholder="Korte samenvatting voor overzichten en SEO..."
                    />
                  </label>
                </div>

                <div className="mt-6">
                  <div className="rounded-t-lg border border-border bg-secondary/30 p-2 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} className="p-2 rounded hover:bg-secondary" aria-label="Vet"><Bold className="w-4 h-4" /></button>
                    <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} className="p-2 rounded hover:bg-secondary" aria-label="Cursief"><Italic className="w-4 h-4" /></button>
                    <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} className="p-2 rounded hover:bg-secondary" aria-label="Kop 1"><Heading1 className="w-4 h-4" /></button>
                    <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} className="p-2 rounded hover:bg-secondary" aria-label="Kop 2"><Heading2 className="w-4 h-4" /></button>
                    <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()} className="p-2 rounded hover:bg-secondary" aria-label="Lijst"><List className="w-4 h-4" /></button>
                    <button type="button" onClick={() => editor?.chain().focus().toggleOrderedList().run()} className="p-2 rounded hover:bg-secondary" aria-label="Genummerde lijst"><ListOrdered className="w-4 h-4" /></button>
                    <button type="button" onClick={() => editor?.chain().focus().toggleBlockquote().run()} className="p-2 rounded hover:bg-secondary" aria-label="Quote"><Quote className="w-4 h-4" /></button>
                    <button type="button" onClick={setLink} className="p-2 rounded hover:bg-secondary" aria-label="Link"><LinkIcon className="w-4 h-4" /></button>
                    <label className="p-2 rounded hover:bg-secondary cursor-pointer" aria-label="Afbeelding uploaden">
                      <ImagePlus className="w-4 h-4" />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadNewsImage(file).catch((error) => toast.error(error instanceof Error ? error.message : "Upload mislukt"));
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                  <EditorContent editor={editor} />
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Hero afbeelding URL</span>
                    <input value={heroImageUrl} onChange={(e) => setHeroImageUrl(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Hero afbeelding alt</span>
                    <input value={heroImageAlt} onChange={(e) => setHeroImageAlt(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">SEO titel</span>
                    <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={70} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" placeholder="Valt terug op titel" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Taal</span>
                    <select value={language} onChange={(e) => setLanguage(e.target.value as "nl" | "en")} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                      <option value="nl">NL</option>
                      <option value="en">EN</option>
                    </select>
                  </label>
                  <label className="block md:col-span-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">SEO beschrijving</span>
                    <textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} maxLength={160} rows={2} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" placeholder="Valt terug op intro" />
                  </label>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => upsertNewsPost.mutate(status === "published" ? "review" : status)}
                    disabled={upsertNewsPost.isPending}
                    className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-50 transition-colors"
                  >
                    {upsertNewsPost.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Concept opslaan
                  </button>
                  <button
                    onClick={publishNewsPost}
                    disabled={upsertNewsPost.isPending}
                    className="inline-flex items-center gap-2 rounded-md bg-gradient-racing px-4 py-2 text-sm font-heading font-bold uppercase tracking-wider text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    <Send className="w-4 h-4" /> Publiceren
                  </button>
                  {normalizedSlug && (
                    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <Eye className="w-4 h-4" /> /news/{normalizedSlug}
                    </span>
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default NewsEditorPage;
