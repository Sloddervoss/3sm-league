import { Link, useParams } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, Flag, Newspaper, UserRound } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { getMockNewsPost, mockNewsPosts } from "@/lib/mockNewsPosts";
import { articlePath, authorPath, authorSlug, categoryToSlug } from "@/lib/newsTaxonomy";

const STALE = 5 * 60 * 1000;

type PublicNewsPost = {
  id: string;
  slug: string;
  title: string;
  category: string;
  excerpt: string | null;
  content_html: string;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  author_id: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  season_id?: string | null;
  seasonName?: string | null;
  race_id?: string | null;
  raceName?: string | null;
  view_count?: number | null;
  is_featured?: boolean | null;
  published_at: string | null;
  updated_at: string;
};

type AuthorProfile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  avatar_url: string | null;
};

const sanitizeNewsHtml = (html: string) =>
  html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son[a-z]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=(['"])\s*javascript:[^'"]*\2/gi, ' $1="#"');

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const contentContainsImageSrc = (html: string, src: string | null) => {
  if (!html || !src) return false;
  const pattern = new RegExp(`<img\\b[^>]*\\ssrc=(['"])${escapeRegExp(src)}\\1`, "i");
  return pattern.test(html);
};

const formatNewsDate = (value: string | null) => {
  if (!value) return "Nog niet gepubliceerd";
  return new Date(value).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  });
};

const withMockSuffix = (path: string, isMockPreview: boolean) => {
  if (!isMockPreview) return path;
  return `${path}${path.includes("?") ? "&" : "?"}mock=1`;
};

const hydratePostMetadata = async (post: PublicNewsPost | null) => {
  if (!post) return post;
  let authorName: string | null = null;
  let authorAvatarUrl: string | null = null;
  let seasonName: string | null = null;
  let raceName: string | null = null;

  if (post.author_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id,display_name,iracing_name,avatar_url")
      .eq("user_id", post.author_id)
      .maybeSingle();
    const author = profile as AuthorProfile | null;
    authorName = author?.display_name || author?.iracing_name || "3SM redactie";
    authorAvatarUrl = author?.avatar_url || null;
  }

  if (post.season_id) {
    const { data: season } = await supabase.from("leagues").select("id,name,season").eq("id", post.season_id).maybeSingle();
    const item = season as { name: string; season: string | null } | null;
    seasonName = item ? (item.season ? `${item.name} ${item.season}` : item.name) : null;
  }

  if (post.race_id) {
    const { data: race } = await supabase.from("races").select("id,name,track").eq("id", post.race_id).maybeSingle();
    const item = race as { name: string; track: string } | null;
    raceName = item ? `${item.name} — ${item.track}` : null;
  }

  return { ...post, authorName, authorAvatarUrl, seasonName, raceName };
};

const NewsDetailPage = () => {
  const { categorySlug, slug: routeSlug } = useParams();
  const isMockPreview = new URLSearchParams(window.location.search).has("mock");
  const slug = routeSlug || categorySlug;

  const { data: post, isLoading } = useQuery({
    queryKey: ["public-news-post", categorySlug, slug],
    enabled: Boolean(slug),
    staleTime: STALE,
    queryFn: async (): Promise<PublicNewsPost | null> => {
      if (isMockPreview) return getMockNewsPost(slug) as PublicNewsPost | null;

      const { data, error } = await supabase
        .from("news_posts")
        .select("id,slug,title,category,excerpt,content_html,hero_image_url,hero_image_alt,seo_title,seo_description,author_id,season_id,race_id,view_count,is_featured,published_at,updated_at")
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      if (error) throw error;
      return hydratePostMetadata(data as PublicNewsPost | null);
    },
  });

  const { data: relatedPosts = [] } = useQuery({
    queryKey: ["related-news-posts", post?.id, post?.category, post?.season_id],
    enabled: Boolean(post) && !isMockPreview,
    staleTime: STALE,
    queryFn: async (): Promise<PublicNewsPost[]> => {
      if (!post) return [];
      const { data, error } = await supabase
        .from("news_posts")
        .select("id,slug,title,category,excerpt,content_html,hero_image_url,hero_image_alt,author_id,season_id,race_id,view_count,is_featured,published_at,updated_at")
        .eq("status", "published")
        .neq("id", post.id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(8);
      if (error) throw error;
      return (data || []) as PublicNewsPost[];
    },
  });

  const resolvedRelatedPosts = useMemo(() => {
    const source = isMockPreview && post ? mockNewsPosts.filter((item) => item.id !== post.id) : relatedPosts;
    if (!post) return [];
    return [...source]
      .sort((a, b) => {
        const categoryScore = Number(b.category === post.category) - Number(a.category === post.category);
        if (categoryScore) return categoryScore;
        const seasonScore = Number(Boolean(b.season_id && b.season_id === post.season_id)) - Number(Boolean(a.season_id && a.season_id === post.season_id));
        if (seasonScore) return seasonScore;
        return new Date(b.published_at || b.updated_at).getTime() - new Date(a.published_at || a.updated_at).getTime();
      })
      .slice(0, 3);
  }, [isMockPreview, post, relatedPosts]);

  const sanitizedContentHtml = useMemo(() => sanitizeNewsHtml(post?.content_html || ""), [post?.content_html]);
  const showHeroImage = Boolean(post?.hero_image_url && !contentContainsImageSrc(sanitizedContentHtml, post.hero_image_url));

  useEffect(() => {
    if (!post) return;
    const title = post.seo_title || `${post.title} - 3 Stripe Motorsport`;
    const description = post.seo_description || post.excerpt || "Nieuws van 3 Stripe Motorsport.";
    document.title = title;

    const upsertMeta = (selector: string, attr: "name" | "property", key: string, content: string) => {
      let tag = document.head.querySelector(selector) as HTMLMetaElement | null;
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(attr, key);
        document.head.appendChild(tag);
      }
      tag.content = content;
    };

    upsertMeta('meta[name="description"]', "name", "description", description);
    upsertMeta('meta[property="og:title"]', "property", "og:title", title);
    upsertMeta('meta[property="og:description"]', "property", "og:description", description);
    if (post.hero_image_url) upsertMeta('meta[property="og:image"]', "property", "og:image", post.hero_image_url);
  }, [post]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        {isLoading ? (
          <section className="py-12"><div className="container mx-auto px-4 max-w-5xl"><div className="h-96 rounded-lg border border-border bg-card animate-pulse" /></div></section>
        ) : !post ? (
          <section className="py-24">
            <div className="container mx-auto px-4 max-w-3xl text-center">
              <Newspaper className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <h1 className="font-heading text-3xl font-black">Nieuwsbericht niet gevonden</h1>
              <p className="mt-2 text-muted-foreground">Dit artikel is niet gepubliceerd of bestaat niet.</p>
              <Link to="/news" className="mt-6 inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-400 transition-colors"><ChevronLeft className="h-4 w-4" /> Terug naar nieuws</Link>
            </div>
          </section>
        ) : (
          <>
            <section className="border-b border-border bg-gradient-to-b from-card/60 to-background py-10">
              <div className="container mx-auto px-4 max-w-5xl">
                <Link to={isMockPreview ? "/news?mock=1" : `/news/${categoryToSlug(post.category)}`} className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-orange-400 transition-colors"><ChevronLeft className="h-4 w-4" /> Terug naar nieuws</Link>
                {isMockPreview && <div className="mb-6 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-100"><strong>Lokale mock-preview:</strong> dit artikel komt uit nepdata, niet uit Supabase.</div>}
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <Link to={withMockSuffix(`/news/${categoryToSlug(post.category)}`, isMockPreview)} className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-400 hover:text-orange-300">{post.category}</Link>
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4 text-orange-400" /> {formatNewsDate(post.published_at)}</span>
                  {post.authorName && <Link to={withMockSuffix(authorPath(post.authorName), isMockPreview)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-orange-300"><UserRound className="h-4 w-4" /> Door {post.authorName}</Link>}
                  {post.seasonName && <Link to={withMockSuffix(`/news?season=${post.season_id}`, isMockPreview)} className="text-sm text-muted-foreground hover:text-orange-300">Meer nieuws uit dit seizoen: {post.seasonName}</Link>}
                </div>
                <h1 className="font-heading text-4xl font-black leading-tight md:text-6xl">{post.title}</h1>
                {post.excerpt && <p className="mt-5 max-w-4xl text-lg leading-relaxed text-muted-foreground">{post.excerpt}</p>}
              </div>
            </section>

            {showHeroImage && post.hero_image_url && (
              <section className="py-8"><div className="container mx-auto px-4 max-w-6xl"><img src={post.hero_image_url} alt={post.hero_image_alt || post.title} className="max-h-[620px] w-full rounded-xl border border-border object-cover shadow-xl shadow-black/20" loading="eager" /></div></section>
            )}

            <article className="pb-10 pt-4">
              <div className="container mx-auto px-4 max-w-5xl">
                <div className="news-article-prose prose prose-invert max-w-none rounded-xl border border-border bg-card/70 px-5 py-6 text-[18px] leading-[1.78] md:px-10 md:py-10" dangerouslySetInnerHTML={{ __html: sanitizedContentHtml }} />
                {post.race_id && (
                  <div className="mt-6 rounded-xl border border-orange-500/30 bg-gradient-to-r from-orange-500/10 via-card to-card p-5 shadow-lg shadow-black/10">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="mb-1 inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">
                          <Flag className="h-4 w-4" /> Race uitslag
                        </div>
                        {post.raceName && <p className="text-sm text-muted-foreground">{post.raceName}</p>}
                      </div>
                      <Link
                        to={`/results/${post.race_id}`}
                        className="inline-flex items-center justify-center rounded-md bg-orange-500 px-4 py-2 text-sm font-heading font-bold uppercase tracking-wider text-white transition-colors hover:bg-orange-400"
                      >
                        Bekijk hier de race uitslag
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </article>

            {resolvedRelatedPosts.length > 0 && (
              <section className="pb-16">
                <div className="container mx-auto px-4 max-w-5xl">
                  <h2 className="mb-5 font-heading text-2xl font-black uppercase">Gerelateerde artikelen</h2>
                  <div className="grid gap-4 md:grid-cols-3">
                    {resolvedRelatedPosts.map((item) => <Link key={item.id} to={withMockSuffix(articlePath(item), isMockPreview)} className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-orange-500/50 hover:text-orange-300"><span className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">{item.category}</span><span className="font-heading font-bold leading-tight">{item.title}</span></Link>)}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default NewsDetailPage;
