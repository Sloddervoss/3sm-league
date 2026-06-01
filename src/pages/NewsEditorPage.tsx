import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import { mergeAttributes } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import ImageExtension from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlignCenter, AlignLeft, AlignRight, Bold, Code2, Eraser, Eye, FileText, Heading1, Heading2, Heading3, Heading4, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, Loader2, Minus, Newspaper, Quote, Save, Send, Table2, Trash2 } from "lucide-react";
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
  category: string;
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

type NewsStatus = "draft" | "planned" | "published" | "archived";
type NewsCategory = typeof NEWS_CATEGORIES[number];
type ImageAlignment = "left" | "center" | "right";
type TextSize = "small" | "normal" | "large";
type NewsImageAttributes = {
  src: string;
  alt: string;
  title: string;
  width: "33%" | "50%" | "100%" | string;
  align: ImageAlignment;
  caption: string;
};

const NEWS_CATEGORIES = [
  "Raceverslagen",
  "League Updates",
  "Race Recaps",
  "Interviews",
  "Reviews",
  "Community",
  "iRacing Nieuws",
  "Special Events",
] as const;

const emptyEditorContent = "<p>Schrijf hier het nieuwsbericht...</p>";
const titlePlaceholder = "Titel verschijnt hier automatisch als H1";

const ResizableImageExtension = ImageExtension.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("title"),
        renderHTML: (attributes) => attributes.title ? { title: attributes.title } : {},
      },
      caption: {
        default: "",
        parseHTML: (element) => element.closest("figure")?.querySelector("figcaption")?.textContent || "",
        renderHTML: () => ({}),
      },
      width: {
        default: "100%",
        parseHTML: (element) => element.getAttribute("width") || element.style.width || element.closest("figure")?.getAttribute("data-width") || "100%",
        renderHTML: () => ({}),
      },
      align: {
        default: "center",
        parseHTML: (element) => element.getAttribute("data-align") || element.closest("figure")?.getAttribute("data-align") || "center",
        renderHTML: () => ({}),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const align = HTMLAttributes["data-align"] || "center";
    const width = HTMLAttributes.width || "100%";
    const { caption, width: _width, style: _style, ...imageAttributes } = HTMLAttributes;
    const isPresetWidth = ["33%", "50%", "100%"].includes(String(width));
    const figureAttributes = {
      class: "news-image-block",
      "data-align": align,
      "data-width": width,
      ...(!isPresetWidth ? { style: `width: ${width}; max-width: 100%;` } : {}),
    };
    return [
      "figure",
      figureAttributes,
      ["img", mergeAttributes(imageAttributes, { style: "width: 100%; max-width: 100%; height: auto;" })],
      caption ? ["figcaption", {}, caption] : ["figcaption", { class: "sr-only" }, ""],
    ];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentAttrs = { ...node.attrs };
      const wrapper = document.createElement("figure");
      wrapper.className = "resizable-image-node news-image-block";
      wrapper.setAttribute("data-align", currentAttrs.align || "center");
      wrapper.style.maxWidth = "100%";
      wrapper.contentEditable = "false";

      const applyImageWidth = (width: string) => {
        const nextWidth = width || "100%";
        wrapper.setAttribute("data-width", nextWidth);
        if (["33%", "50%", "100%"].includes(nextWidth)) {
          wrapper.style.width = "";
        } else {
          wrapper.style.width = nextWidth;
        }
      };

      applyImageWidth(currentAttrs.width || "100%");

      const img = document.createElement("img");
      img.src = currentAttrs.src;
      img.alt = currentAttrs.alt || "";
      img.title = currentAttrs.title || "";
      img.style.width = "100%";
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      wrapper.appendChild(img);

      const caption = document.createElement("figcaption");
      caption.textContent = currentAttrs.caption || "";
      caption.className = currentAttrs.caption ? "" : "sr-only";
      wrapper.appendChild(caption);

      const updateImageAttrs = (attrs: Record<string, string>) => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (typeof pos !== "number") return;
        currentAttrs = { ...currentAttrs, ...attrs };
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, currentAttrs));
      };

      ["nw", "ne", "sw", "se"].forEach((corner) => {
        const handle = document.createElement("span");
        handle.className = `resize-handle resize-handle-${corner}`;
        handle.addEventListener("mousedown", (event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth = img.getBoundingClientRect().width;
          const onMove = (moveEvent: MouseEvent) => {
            const direction = corner.includes("w") ? -1 : 1;
            const nextWidth = Math.max(180, Math.min(960, startWidth + (moveEvent.clientX - startX) * direction));
            wrapper.style.width = `${Math.round(nextWidth)}px`;
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            updateImageAttrs({ width: wrapper.style.width });
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
        wrapper.appendChild(handle);
      });

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type.name !== node.type.name) return false;
          currentAttrs = { ...updatedNode.attrs };
          img.src = currentAttrs.src;
          img.alt = currentAttrs.alt || "";
          img.title = currentAttrs.title || "";
          img.style.width = "100%";
          caption.textContent = currentAttrs.caption || "";
          caption.className = currentAttrs.caption ? "" : "sr-only";
          wrapper.setAttribute("data-align", currentAttrs.align || "center");
          applyImageWidth(currentAttrs.width || "100%");
          return true;
        },
      };
    };
  },
});

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
    case "planned": return "Gepland";
    case "archived": return "Gearchiveerd";
    default: return "Concept";
  }
};

const statusDescription = (status: NewsStatus) => {
  switch (status) {
    case "published": return "Live zichtbaar op de website.";
    case "planned": return "Klaar voor latere publicatie, nog niet zichtbaar.";
    case "archived": return "Niet zichtbaar, maar blijft bewaard.";
    default: return "Niet zichtbaar op de website.";
  }
};

const NewsEditorPage = () => {
  const { user, loading, rolesLoading, isAdmin, isSuperAdmin, isEditor } = useAuth();
  const queryClient = useQueryClient();
  const canEditNews = isAdmin || isSuperAdmin || isEditor;

  const [selectedPostId, setSelectedPostId] = useState<string | "new">("new");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState<NewsCategory>("League Updates");
  const [categoryFilter, setCategoryFilter] = useState<"all" | NewsCategory>("all");
  const [excerpt, setExcerpt] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");
  const [heroImageAlt, setHeroImageAlt] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [language, setLanguage] = useState<"nl" | "en">("nl");
  const [status, setStatus] = useState<NewsStatus>("draft");
  const [, setEditorTick] = useState(0);

  const refreshEditorState = () => setEditorTick((tick) => tick + 1);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ horizontalRule: false }),
      ResizableImageExtension.configure({ inline: false, allowBase64: false }),
      LinkExtension.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
      Placeholder.configure({ placeholder: "Begin hier met schrijven. De titel hierboven wordt automatisch als H1 boven het artikel getoond." }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      HorizontalRule,
      TextStyle,
      FontSize,
      Color,
    ],
    content: emptyEditorContent,
    editorProps: {
      attributes: {
        class: "news-editor-prose min-h-[720px] rounded-b-lg border-x border-b border-border bg-background/50 px-6 py-5 text-[18px] leading-[1.7] outline-none prose prose-invert max-w-none prose-headings:font-heading prose-a:text-primary prose-blockquote:border-primary prose-blockquote:bg-secondary/20 prose-blockquote:px-4 prose-blockquote:py-2 prose-img:rounded-lg prose-hr:border-border",
      },
    },
    onUpdate: refreshEditorState,
    onSelectionUpdate: refreshEditorState,
    onFocus: refreshEditorState,
    onBlur: refreshEditorState,
  });

  const { data: posts = [], isLoading: postsLoading } = useQuery({
    queryKey: ["news-posts-editor"],
    enabled: Boolean(user && canEditNews),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_posts")
        .select("id,slug,title,category,excerpt,content_json,content_html,hero_image_url,hero_image_alt,seo_title,seo_description,status,language,published_at,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as NewsPost[];
    },
  });

  const filteredPosts = useMemo(
    () => categoryFilter === "all" ? posts : posts.filter((post) => post.category === categoryFilter),
    [categoryFilter, posts]
  );

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId),
    [posts, selectedPostId]
  );

  useEffect(() => {
    if (!editor) return;
    if (!selectedPost || selectedPostId === "new") {
      setTitle("");
      setSlug("");
      setCategory("League Updates");
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
    setCategory(NEWS_CATEGORIES.includes(selectedPost.category as NewsCategory) ? selectedPost.category as NewsCategory : "League Updates");
    setExcerpt(selectedPost.excerpt || "");
    setHeroImageUrl(selectedPost.hero_image_url || "");
    setHeroImageAlt(selectedPost.hero_image_alt || "");
    setSeoTitle(selectedPost.seo_title || "");
    setSeoDescription(selectedPost.seo_description || "");
    setLanguage(selectedPost.language === "en" ? "en" : "nl");
    setStatus((selectedPost.status as NewsStatus) || "draft");
    editor.commands.setContent((selectedPost.content_json || selectedPost.content_html || emptyEditorContent) as Parameters<typeof editor.commands.setContent>[0]);
  }, [editor, selectedPost, selectedPostId]);

  const normalizedSlug = slug.trim() || generateSlug(title);

  const buildPayload = (nextStatus: NewsStatus) => {
    if (!editor) throw new Error("Editor is nog niet geladen");
    if (!title.trim()) throw new Error("Titel is verplicht");
    if (!category) throw new Error("Categorie is verplicht");
    if (!normalizedSlug) throw new Error("Slug is verplicht");

    return {
      slug: normalizedSlug,
      title: title.trim(),
      category,
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
      published_at: nextStatus === "published" ? selectedPost?.published_at ?? new Date().toISOString() : null,
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
      toast.success(saved.status === "published" ? "Nieuwsbericht gepubliceerd" : "Nieuwsbericht opgeslagen");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Opslaan mislukt"),
  });

  const publishNewsPost = () => upsertNewsPost.mutate("published");

  const insertNewsImage = (attrs: NewsImageAttributes) => {
    if (!editor) return;
    const { selection } = editor.state;
    const isImageSelection = selection instanceof NodeSelection && selection.node.type.name === "image";

    if (isImageSelection) {
      const insertPos = selection.from + selection.node.nodeSize;
      editor
        .chain()
        .focus()
        .insertContentAt(insertPos, { type: "image", attrs })
        .setNodeSelection(insertPos)
        .run();
      return;
    }

    editor.chain().focus().setImage(attrs as never).run();
  };

  const uploadNewsImage = async (file: File) => {
    if (!file) return;
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${user?.id || "editor"}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from("news-images").upload(path, file, { upsert: false });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from("news-images").getPublicUrl(path);
    insertNewsImage({ src: publicUrl, alt: file.name, title: file.name, width: "100%", align: "center", caption: "" });
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

  const selectedImageAttrs = editor?.isActive("image") ? editor.getAttributes("image") : null;

  const isStyleActive = (style: "small" | "normal" | "large" | "orange" | "white") => {
    if (!editor) return false;
    if (style === "small") return editor.isActive("textStyle", { fontSize: "16px" });
    if (style === "large") return editor.isActive("textStyle", { fontSize: "22px" });
    if (style === "normal") return !editor.getAttributes("textStyle").fontSize || editor.isActive("textStyle", { fontSize: "18px" });
    if (style === "orange") return editor.isActive("textStyle", { color: "#f97316" });
    return editor.isActive("textStyle", { color: "#ffffff" });
  };

  const setImageAlignment = (align: ImageAlignment) => {
    editor?.chain().focus().updateAttributes("image", { align }).run();
  };

  const setImageWidth = (width: "33%" | "50%" | "100%") => {
    editor?.chain().focus().updateAttributes("image", { width, align: width === "100%" ? "center" : "left" }).run();
  };

  const setImageAltText = () => {
    if (!editor?.isActive("image")) return;
    const currentAlt = editor.getAttributes("image").alt as string | undefined;
    const alt = window.prompt("Alt-tekst voor deze afbeelding", currentAlt || "");
    if (alt === null) return;
    editor.chain().focus().updateAttributes("image", { alt, title: alt }).run();
  };

  const setImageCaption = () => {
    if (!editor?.isActive("image")) return;
    const currentCaption = editor.getAttributes("image").caption as string | undefined;
    const caption = window.prompt("Caption onder de afbeelding", currentCaption || "");
    if (caption === null) return;
    editor.chain().focus().updateAttributes("image", { caption }).run();
  };

  const setTextSize = (size: TextSize) => {
    const fontSize = size === "small" ? "16px" : size === "large" ? "22px" : "18px";
    editor?.chain().focus().setFontSize(fontSize).run();
  };

  const setTextColor = (color: "orange" | "white") => {
    editor?.chain().focus().setColor(color === "orange" ? "#f97316" : "#ffffff").run();
  };

  const clearFormatting = () => {
    editor?.chain().focus().unsetAllMarks().clearNodes().run();
  };

  if (loading || rolesLoading) return null;
  if (!user) return <Navigate to="/auth" />;
  if (!canEditNews) return <Navigate to="/profile" replace />;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="py-10">
          <div className="container mx-auto px-4 max-w-[1500px]">
            <div className="flex items-center gap-2 mb-1">
              <Newspaper className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-primary uppercase tracking-[0.15em]">Professionele nieuwsredactie</span>
            </div>
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-8">
              <div>
                <h1 className="font-heading text-4xl font-black">NIEUWS REDACTIE</h1>
                <p className="text-sm text-muted-foreground mt-2">Schrijven eerst. Afbeeldingen, categorie en SEO daarna.</p>
              </div>
              <button
                onClick={() => setSelectedPostId("new")}
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <FileText className="w-4 h-4" /> Nieuw bericht
              </button>
            </div>

            <div className="grid gap-6 xl:grid-cols-[19rem_minmax(0,1fr)]">
              <aside className="bg-card border border-border rounded-lg overflow-hidden h-fit xl:sticky xl:top-24">
                <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between">
                  <span className="font-heading font-bold text-sm uppercase tracking-wider">Berichten</span>
                  {postsLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </div>
                <div className="p-3 border-b border-border">
                  <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Filter categorie</label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value as "all" | NewsCategory)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                  >
                    <option value="all">Toon alle categorieën</option>
                    {NEWS_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </div>
                <button
                  onClick={() => setSelectedPostId("new")}
                  className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${selectedPostId === "new" ? "bg-primary/10 text-foreground" : "hover:bg-secondary/30 text-muted-foreground"}`}
                >
                  <span className="block text-sm font-bold">+ Nieuw concept</span>
                  <span className="text-xs">Start met een leeg bericht</span>
                </button>
                <div className="max-h-[620px] overflow-y-auto">
                  {filteredPosts.map((post) => (
                    <button
                      key={post.id}
                      onClick={() => setSelectedPostId(post.id)}
                      className={`w-full text-left px-4 py-3 border-b border-border/70 transition-colors ${selectedPostId === post.id ? "bg-primary/10 text-foreground" : "hover:bg-secondary/30 text-muted-foreground"}`}
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary">{post.category}</span>
                      <span className="block text-sm font-bold line-clamp-2">{post.title}</span>
                      <span className="mt-1 inline-flex items-center gap-2 text-[11px] uppercase tracking-wider">
                        <span className="rounded bg-secondary px-2 py-0.5">{statusLabel(post.status)}</span>
                        <span>{post.language.toUpperCase()}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                <article className="bg-card border border-border rounded-lg p-4 md:p-6 racing-stripe-left">
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] mb-5">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Titel</span>
                      <input
                        value={title}
                        onChange={(e) => {
                          setTitle(e.target.value);
                          if (!slug || slug === generateSlug(title)) setSlug(generateSlug(e.target.value));
                        }}
                        className="mt-1 w-full rounded-md border border-border bg-background px-4 py-3 font-heading text-2xl font-black outline-none focus:border-primary"
                        placeholder="Race Recap Spa 27 Mei 2026"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Categorie *</span>
                      <select
                        required
                        value={category}
                        onChange={(e) => setCategory(e.target.value as NewsCategory)}
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-3 text-sm outline-none focus:border-primary"
                      >
                        {NEWS_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="rounded-lg border border-border bg-background/60 overflow-hidden shadow-xl shadow-black/20">
                    <header className="px-6 pt-6 pb-4 border-b border-border/70">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-primary mb-3">{category}</div>
                      <h2 id="article-title-preview" className="article-title-preview font-heading text-4xl md:text-5xl font-black leading-tight">
                        {title ? title : <span aria-hidden="true" className="text-muted-foreground/40">{titlePlaceholder}</span>}
                      </h2>
                      <p className="mt-3 text-xs text-muted-foreground">Bodytekst: 18px · line-height 1.7 · ruimte voor lange raceverslagen, interviews en reviews.</p>
                    </header>

                    {editor && (
                      <>
                        {!editor.state.selection.empty && !editor.isActive("image") && (
                          <div data-bubble-menu="text" className="flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-2xl backdrop-blur">
                          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={`editor-toolbar-button ${editor.isActive("bold") ? "is-active" : ""}`} aria-label="Vet"><Bold className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={`editor-toolbar-button ${editor.isActive("italic") ? "is-active" : ""}`} aria-label="Cursief"><Italic className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={`editor-toolbar-button ${editor.isActive("heading", { level: 2 }) ? "is-active" : ""}`}>H2</button>
                          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={`editor-toolbar-button ${editor.isActive("heading", { level: 3 }) ? "is-active" : ""}`}>H3</button>
                          <button type="button" onClick={() => setTextSize("small")} className={`editor-toolbar-button ${isStyleActive("small") ? "is-active" : ""}`}>S</button>
                          <button type="button" onClick={() => setTextSize("large")} className={`editor-toolbar-button ${isStyleActive("large") ? "is-active" : ""}`}>L</button>
                          <button type="button" onClick={() => setTextColor("orange")} className={`editor-toolbar-button text-orange-400 ${isStyleActive("orange") ? "is-active" : ""}`}>Oranje</button>
                          <button type="button" onClick={setLink} className="editor-toolbar-button" aria-label="Link"><LinkIcon className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={`editor-toolbar-button ${editor.isActive("blockquote") ? "is-active" : ""}`} aria-label="Quote"><Quote className="w-4 h-4" /></button>
                          <button type="button" onClick={clearFormatting} className="editor-toolbar-button" aria-label="Opmaak wissen"><Eraser className="w-4 h-4" /></button>
                          </div>
                        )}

                        {editor.isActive("image") && (
                          <div data-bubble-menu="image" className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card/95 p-2 shadow-2xl backdrop-blur">
                          <span className="mr-2 max-w-[10rem] truncate text-[11px] uppercase tracking-wider text-muted-foreground">Afbeelding {selectedImageAttrs?.width || "100%"}</span>
                          <button type="button" onClick={() => setImageAlignment("left")} className={`editor-toolbar-button ${selectedImageAttrs?.align === "left" ? "is-active" : ""}`} aria-label="Afbeelding links"><AlignLeft className="w-4 h-4" /></button>
                          <button type="button" onClick={() => setImageAlignment("center")} className={`editor-toolbar-button ${!selectedImageAttrs?.align || selectedImageAttrs?.align === "center" ? "is-active" : ""}`} aria-label="Afbeelding midden"><AlignCenter className="w-4 h-4" /></button>
                          <button type="button" onClick={() => setImageAlignment("right")} className={`editor-toolbar-button ${selectedImageAttrs?.align === "right" ? "is-active" : ""}`} aria-label="Afbeelding rechts"><AlignRight className="w-4 h-4" /></button>
                          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                          <button type="button" onClick={() => setImageWidth("33%")} className={`editor-toolbar-button ${selectedImageAttrs?.width === "33%" ? "is-active" : ""}`}>⅓</button>
                          <button type="button" onClick={() => setImageWidth("50%")} className={`editor-toolbar-button ${selectedImageAttrs?.width === "50%" ? "is-active" : ""}`}>½</button>
                          <button type="button" onClick={() => setImageWidth("100%")} className={`editor-toolbar-button ${selectedImageAttrs?.width === "100%" ? "is-active" : ""}`}>Vol</button>
                          <button type="button" onClick={setImageAltText} className="editor-toolbar-button">Alt</button>
                          <button type="button" onClick={setImageCaption} className="editor-toolbar-button">Caption</button>
                          <button type="button" onClick={() => editor.chain().focus().deleteSelection().run()} className="editor-toolbar-button text-destructive" aria-label="Afbeelding verwijderen"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        )}
                      </>
                    )}

                    <div className="border-b border-border bg-secondary/20 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="editor-toolbar-group" aria-label="Tekst">
                          <span className="editor-toolbar-label">Tekst</span>
                          <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} className={`editor-toolbar-button ${editor?.isActive("bold") ? "is-active" : ""}`} aria-label="Vet"><Bold className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} className={`editor-toolbar-button ${editor?.isActive("italic") ? "is-active" : ""}`} aria-label="Cursief"><Italic className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} className={`editor-toolbar-button ${editor?.isActive("heading", { level: 1 }) ? "is-active" : ""}`} aria-label="Kop 1"><Heading1 className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} className={`editor-toolbar-button ${editor?.isActive("heading", { level: 2 }) ? "is-active" : ""}`} aria-label="Kop 2"><Heading2 className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} className={`editor-toolbar-button ${editor?.isActive("heading", { level: 3 }) ? "is-active" : ""}`} aria-label="Kop 3"><Heading3 className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor?.chain().focus().toggleHeading({ level: 4 }).run()} className={`editor-toolbar-button ${editor?.isActive("heading", { level: 4 }) ? "is-active" : ""}`} aria-label="Kop 4"><Heading4 className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor?.chain().focus().toggleBlockquote().run()} className={`editor-toolbar-button ${editor?.isActive("blockquote") ? "is-active" : ""}`} aria-label="Quote"><Quote className="w-4 h-4" /></button>
                        </div>

                        <div className="editor-toolbar-group" aria-label="Lijsten">
                          <span className="editor-toolbar-label">Lijsten</span>
                          <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()} className={`editor-toolbar-button ${editor?.isActive("bulletList") ? "is-active" : ""}`} aria-label="Lijst"><List className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={`editor-toolbar-button ${editor?.isActive("orderedList") ? "is-active" : ""}`} aria-label="Genummerde lijst"><ListOrdered className="w-4 h-4" /></button>
                        </div>

                        <div className="editor-toolbar-group" aria-label="Media">
                          <span className="editor-toolbar-label">Media</span>
                          <label className="editor-toolbar-button cursor-pointer" aria-label="Afbeelding uploaden">
                            <ImagePlus className="w-4 h-4" />
                            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadNewsImage(file).catch((error) => toast.error(error instanceof Error ? error.message : "Upload mislukt")); e.currentTarget.value = ""; }} />
                          </label>
                          <button type="button" onClick={setLink} className="editor-toolbar-button" aria-label="Link"><LinkIcon className="w-4 h-4" /></button>
                        </div>

                        <div className="editor-toolbar-group" aria-label="Layout">
                          <span className="editor-toolbar-label">Layout</span>
                          <button type="button" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} className="editor-toolbar-button" aria-label="Tabel"><Table2 className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor?.chain().focus().setHorizontalRule().run()} className="editor-toolbar-button" aria-label="Scheidingslijn"><Minus className="w-4 h-4" /></button>
                          <button type="button" onClick={() => editor?.chain().focus().toggleCodeBlock().run()} className={`editor-toolbar-button ${editor?.isActive("codeBlock") ? "is-active" : ""}`} aria-label="Code blok"><Code2 className="w-4 h-4" /></button>
                        </div>

                        <div className="editor-toolbar-group" aria-label="Stijl">
                          <span className="editor-toolbar-label">Stijl</span>
                          <button type="button" onClick={() => setTextSize("small")} className={`editor-toolbar-button ${isStyleActive("small") ? "is-active" : ""}`}>Klein</button>
                          <button type="button" onClick={() => setTextSize("normal")} className={`editor-toolbar-button ${isStyleActive("normal") ? "is-active" : ""}`}>Normaal</button>
                          <button type="button" onClick={() => setTextSize("large")} className={`editor-toolbar-button ${isStyleActive("large") ? "is-active" : ""}`}>Groot</button>
                          <button type="button" onClick={() => setTextColor("orange")} className={`editor-toolbar-button text-orange-400 ${isStyleActive("orange") ? "is-active" : ""}`}>Oranje</button>
                          <button type="button" onClick={() => setTextColor("white")} className={`editor-toolbar-button ${isStyleActive("white") ? "is-active" : ""}`}>Wit</button>
                          <button type="button" onClick={clearFormatting} className="editor-toolbar-button" aria-label="Opmaak wissen"><Eraser className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </div>
                    <EditorContent editor={editor} />
                  </div>
                </article>

                <section className="bg-card border border-border rounded-lg p-5">
                  <h3 className="font-heading font-bold text-lg mb-1">Publicatie</h3>
                  <p className="text-sm text-muted-foreground mb-4">Status is nu expliciet: concept en gepland zijn niet zichtbaar, gepubliceerd is live, gearchiveerd blijft bewaard.</p>
                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Status</span>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as NewsStatus)}
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      >
                        <option value="draft">Concept</option>
                        <option value="planned">Gepland</option>
                        <option value="published">Gepubliceerd</option>
                        <option value="archived">Gearchiveerd</option>
                      </select>
                      <span className="mt-1 block text-xs text-muted-foreground">{statusDescription(status)}</span>
                    </label>
                    <label className="block md:col-span-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Korte intro / excerpt</span>
                      <textarea
                        value={excerpt}
                        onChange={(e) => setExcerpt(e.target.value)}
                        rows={3}
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        placeholder="Korte samenvatting voor nieuwskaarten en SEO..."
                      />
                    </label>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => upsertNewsPost.mutate("draft")}
                      disabled={upsertNewsPost.isPending}
                      className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-secondary/50 disabled:opacity-50 transition-colors"
                    >
                      {upsertNewsPost.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Opslaan als concept
                    </button>
                    <button
                      onClick={() => upsertNewsPost.mutate(status)}
                      disabled={upsertNewsPost.isPending}
                      className="inline-flex items-center gap-2 rounded-md border border-primary/50 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
                    >
                      <Save className="w-4 h-4" /> Bijwerken
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
                </section>

                <section className="bg-card border border-border rounded-lg p-5">
                  <h3 className="font-heading font-bold text-lg mb-4">Metadata & SEO</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Slug</span>
                      <input
                        value={slug}
                        onChange={(e) => setSlug(generateSlug(e.target.value))}
                        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        placeholder="race-recap-spa-27-mei-2026"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Taal</span>
                      <select value={language} onChange={(e) => setLanguage(e.target.value as "nl" | "en")} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                        <option value="nl">NL</option>
                        <option value="en">EN</option>
                      </select>
                    </label>
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
                    <label className="block md:col-span-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">SEO beschrijving</span>
                      <textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} maxLength={160} rows={2} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" placeholder="Valt terug op intro" />
                    </label>
                  </div>
                </section>
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
