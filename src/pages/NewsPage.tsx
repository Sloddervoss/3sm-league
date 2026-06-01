import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarDays, ChevronRight, Flame, Newspaper, Search, Sparkles } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { mockNewsPosts } from "@/lib/mockNewsPosts";
import {
  NEWS_CATEGORIES,
  articlePath,
  authorPath,
  categoryBySlug,
  categorySlugToLabel,
  categoryToSlug,
  filterNewsPosts,
} from "@/lib/newsTaxonomy";

const STALE = 5 * 60 * 1000;

type PublicNewsPost = {
  id: string;
  slug: string;
  title: string;
  category: string;
  excerpt: string | null;
  content_html?: string | null;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  author_id: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  season_id?: string | null;
  seasonName?: string | null;
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

const fetchAuthorNames = async (authorIds: Array<string | null>) => {
  const ids = Array.from(new Set(authorIds.filter(Boolean))) as string[];
  if (!ids.length) return new Map<string, { name: string; avatar: string | null }>();

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,display_name,iracing_name,avatar_url")
    .in("user_id", ids);
  if (error) return new Map<string, { name: string; avatar: string | null }>();

  return new Map(
    ((data || []) as AuthorProfile[]).map((profile) => [
      profile.user_id,
      {
        name: profile.display_name || profile.iracing_name || "3SM redactie",
        avatar: profile.avatar_url,
      },
    ]),
  );
};

const fetchSeasonNames = async (seasonIds: Array<string | null | undefined>) => {
  const ids = Array.from(new Set(seasonIds.filter(Boolean))) as string[];
  if (!ids.length) return new Map<string, string>();

  const { data, error } = await supabase.from("leagues").select("id,name,season").in("id", ids);
  if (error) return new Map<string, string>();
  return new Map(((data || []) as Array<{ id: string; name: string; season: string | null }>).map((season) => [season.id, season.season ? `${season.name} ${season.season}` : season.name]));
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

const NewsCard = ({ post, isMockPreview }: { post: PublicNewsPost; isMockPreview: boolean }) => {
  const path = withMockSuffix(articlePath(post), isMockPreview);
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-lg shadow-black/10 transition-all duration-300 hover:-translate-y-1 hover:border-orange-500/50 hover:shadow-orange-950/20">
      <Link to={path} className="block aspect-[16/9] overflow-hidden bg-secondary/30">
        {post.hero_image_url ? (
          <img src={post.hero_image_url} alt={post.hero_image_alt || post.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center"><Newspaper className="h-10 w-10 text-muted-foreground/30" /></div>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
          <Link to={withMockSuffix(`/news/${categoryToSlug(post.category)}`, isMockPreview)} className="rounded-full border border-orange-500/25 bg-orange-500/10 px-2.5 py-1 text-orange-400 hover:border-orange-400 hover:text-orange-300">{post.category}</Link>
          <span>·</span>
          <span>{formatNewsDate(post.published_at)}</span>
        </div>
        <h2 className="font-heading text-xl font-black leading-tight">
          <Link to={path} className="hover:text-orange-400 transition-colors">{post.title}</Link>
        </h2>
        {post.excerpt && <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{post.excerpt}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
          {post.authorName ? <Link to={withMockSuffix(authorPath(post.authorName), isMockPreview)} className="text-xs font-semibold text-muted-foreground hover:text-orange-300">Door {post.authorName}</Link> : <span />}
          <Link to={path} className="inline-flex items-center gap-1.5 text-xs font-heading font-bold uppercase tracking-wider text-orange-400 hover:text-orange-300">
            Lees artikel <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </article>
  );
};

const NewsPage = () => {
  const { categorySlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const isMockPreview = searchParams.has("mock");
  const queryCategorySlug = searchParams.get("category");
  const activeCategory = categorySlugToLabel(categorySlug) || categorySlugToLabel(queryCategorySlug);
  const activeCategoryInfo = categoryBySlug(categorySlug || queryCategorySlug);
  const searchQuery = searchParams.get("q") || "";
  const activeSeasonId = searchParams.get("season");

  useEffect(() => {
    const title = activeCategoryInfo ? `${activeCategoryInfo.label} - Nieuws - 3 Stripe Motorsport` : "Nieuws - 3 Stripe Motorsport";
    const description = activeCategoryInfo?.description || "Lees het laatste nieuws van 3 Stripe Motorsport: verhalen uit de paddock, raceverslagen en updates van de iRacing league.";
    document.title = title;
    let tag = document.head.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!tag) {
      tag = document.createElement("meta");
      tag.name = "description";
      document.head.appendChild(tag);
    }
    tag.content = description;
  }, [activeCategoryInfo]);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["public-news-posts"],
    staleTime: STALE,
    enabled: !isMockPreview,
    queryFn: async (): Promise<PublicNewsPost[]> => {
      const { data, error } = await supabase
        .from("news_posts")
        .select("id,slug,title,category,excerpt,content_html,hero_image_url,hero_image_alt,author_id,season_id,view_count,is_featured,published_at,updated_at")
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const posts = (data || []) as PublicNewsPost[];
      const authorNames = await fetchAuthorNames(posts.map((post) => post.author_id));
      const seasonNames = await fetchSeasonNames(posts.map((post) => post.season_id));
      return posts.map((post) => {
        const author = post.author_id ? authorNames.get(post.author_id) : null;
        return {
          ...post,
          authorName: author?.name || null,
          authorAvatarUrl: author?.avatar || null,
          seasonName: post.season_id ? seasonNames.get(post.season_id) : null,
        };
      });
    },
  });

  const visiblePosts = isMockPreview ? mockNewsPosts : posts;
  const activeSeasonName = useMemo(() => {
    if (!activeSeasonId) return null;
    return visiblePosts.find((post) => post.season_id === activeSeasonId)?.seasonName || "dit seizoen";
  }, [activeSeasonId, visiblePosts]);
  const filteredPosts = useMemo(() => filterNewsPosts(visiblePosts, activeCategory, searchQuery, activeSeasonId), [visiblePosts, activeCategory, searchQuery, activeSeasonId]);
  const availableCategories = useMemo(
    () => NEWS_CATEGORIES.filter((category) => visiblePosts.some((post) => post.category === category.label)),
    [visiblePosts]
  );
  const popularPosts = useMemo(() => [...visiblePosts].sort((a, b) => (b.view_count || 0) - (a.view_count || 0)).slice(0, 3), [visiblePosts]);
  const featured = filteredPosts.find((post) => post.is_featured) || filteredPosts[0];
  const archive = featured ? filteredPosts.filter((post) => post.id !== featured.id) : [];

  const updateSearch = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set("q", value);
    else next.delete("q");
    setSearchParams(next, { replace: true });
  };

  const clearSeasonFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("season");
    setSearchParams(next, { replace: true });
  };

  const filterPath = (slug: string | null) => {
    const suffix = isMockPreview ? "?mock=1" : "";
    return slug ? `/news/${slug}${suffix}` : `/news${suffix}`;
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <section className="border-b border-border bg-gradient-to-b from-card/70 to-background py-12">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <Newspaper className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">3SM redactie</span>
            </div>
            <h1 className="font-heading text-4xl md:text-5xl font-black uppercase">{activeCategoryInfo?.label || "Nieuws"}</h1>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              {activeCategoryInfo?.description || "Verhalen uit de paddock, raceverslagen en updates van 3 Stripe Motorsport."}
            </p>
          </div>
        </section>

        <section className="py-10">
          <div className="container mx-auto px-4 max-w-7xl">
            {isMockPreview && (
              <div className="mb-6 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-100">
                <strong>Lokale mock-preview:</strong> 1 nepbericht per nieuwscategorie. Dit gebruikt geen database en wordt niet gedeployed.
              </div>
            )}

            <div className="mb-8 rounded-xl border border-border bg-card/80 p-4 shadow-lg shadow-black/10">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => navigate(filterPath(null))} className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition-colors ${!activeCategory ? "border-orange-500 bg-orange-500 text-white" : "border-border bg-secondary/40 text-muted-foreground hover:border-orange-500/50 hover:text-orange-300"}`}>Alles</button>
                  {availableCategories.map((category) => (
                    <button key={category.slug} onClick={() => navigate(filterPath(category.slug))} className={`rounded-full border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition-colors ${activeCategory === category.label ? "border-orange-500 bg-orange-500 text-white" : "border-border bg-secondary/40 text-muted-foreground hover:border-orange-500/50 hover:text-orange-300"}`}>{category.label}</button>
                  ))}
                </div>
                <label className="relative min-w-full lg:min-w-[320px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input value={searchQuery} onChange={(event) => updateSearch(event.target.value)} placeholder="Zoek nieuws..." className="w-full rounded-lg border border-border bg-background/70 py-2.5 pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-orange-500" />
                </label>
              </div>
              {activeSeasonId && (
                <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-orange-500/20 bg-orange-500/5 px-4 py-3 text-sm text-muted-foreground">
                  <span>
                    Filter actief: <strong className="text-orange-300">meer nieuws uit {activeSeasonName}</strong>
                  </span>
                  <button type="button" onClick={clearSeasonFilter} className="text-xs font-black uppercase tracking-[0.16em] text-orange-400 hover:text-orange-300">
                    Toon alle seizoenen
                  </button>
                </div>
              )}
            </div>

            {isLoading && !isMockPreview ? (
              <div className="grid gap-4 md:grid-cols-3">
                {[1, 2, 3].map((item) => <div key={item} className="h-64 rounded-lg border border-border bg-card animate-pulse" />)}
              </div>
            ) : !filteredPosts.length ? (
              <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
                <Newspaper className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
                <h2 className="font-heading text-2xl font-black">Geen nieuwsberichten gevonden</h2>
                <p className="mt-2 text-sm text-muted-foreground">Pas je zoekterm of categorie aan om meer artikelen te zien.</p>
              </div>
            ) : (
              <div className="space-y-10">
                {featured && (
                  <motion.article initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-xl border border-orange-500/20 bg-card shadow-xl shadow-black/15">
                    <div className="h-0.5 bg-gradient-racing" />
                    <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
                      <Link to={withMockSuffix(articlePath(featured), isMockPreview)} className="group relative min-h-[260px] overflow-hidden bg-secondary/30 lg:min-h-[430px]">
                        {featured.hero_image_url ? <img src={featured.hero_image_url} alt={featured.hero_image_alt || featured.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="eager" /> : <div className="flex h-full min-h-[260px] items-center justify-center bg-gradient-to-br from-secondary to-background"><Newspaper className="h-16 w-16 text-muted-foreground/30" /></div>}
                        <div className="absolute inset-0 bg-gradient-to-t from-background/75 via-transparent to-transparent" />
                      </Link>
                      <div className="flex flex-col justify-center p-6 md:p-8">
                        <div className="mb-4 flex flex-wrap items-center gap-3">
                          <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-400"><Sparkles className="h-3 w-3" /> Uitgelicht</span>
                          <Link to={withMockSuffix(`/news/${categoryToSlug(featured.category)}`, isMockPreview)} className="rounded-full border border-border bg-secondary/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground hover:text-orange-300">{featured.category}</Link>
                        </div>
                        <h2 className="font-heading text-3xl font-black leading-tight md:text-4xl"><Link to={withMockSuffix(articlePath(featured), isMockPreview)} className="hover:text-orange-400 transition-colors">{featured.title}</Link></h2>
                        {featured.excerpt && <p className="mt-4 text-muted-foreground leading-relaxed">{featured.excerpt}</p>}
                        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
                          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4 text-orange-400" /> {formatNewsDate(featured.published_at)}</span>
                          {featured.authorName && <Link to={withMockSuffix(authorPath(featured.authorName), isMockPreview)} className="text-sm text-muted-foreground hover:text-orange-300">Door {featured.authorName}</Link>}
                          <Link to={withMockSuffix(articlePath(featured), isMockPreview)} className="inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-4 py-2 text-xs font-heading font-bold uppercase tracking-wider text-white hover:bg-orange-400 transition-colors">Lees artikel <ChevronRight className="h-4 w-4" /></Link>
                        </div>
                      </div>
                    </div>
                  </motion.article>
                )}

                {popularPosts.length > 0 && !activeCategory && !searchQuery && (
                  <aside className="rounded-xl border border-border bg-card/70 p-5">
                    <div className="mb-4 flex items-center gap-2"><Flame className="h-4 w-4 text-orange-500" /><span className="text-xs font-black uppercase tracking-[0.25em] text-orange-500">Populair deze week</span></div>
                    <div className="grid gap-3 md:grid-cols-3">
                      {popularPosts.map((post) => <Link key={post.id} to={withMockSuffix(articlePath(post), isMockPreview)} className="rounded-lg border border-border bg-background/40 p-4 text-sm font-semibold hover:border-orange-500/50 hover:text-orange-300">{post.title}</Link>)}
                    </div>
                  </aside>
                )}

                {archive.length > 0 && (
                  <div>
                    <div className="mb-4 flex items-center gap-2"><Newspaper className="h-4 w-4 text-orange-500" /><span className="text-xs font-black uppercase tracking-[0.25em] text-orange-500">Laatste nieuws</span></div>
                    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">{archive.map((post) => <NewsCard key={post.id} post={post} isMockPreview={isMockPreview} />)}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default NewsPage;
