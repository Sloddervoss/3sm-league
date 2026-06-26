import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Newspaper } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { articlePath } from "@/lib/newsTaxonomy";
import { mockNewsPosts } from "@/lib/mockNewsPosts";

type HomeNewsPost = {
  id: string;
  slug: string;
  title: string;
  category: string;
  excerpt: string | null;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  author_id: string | null;
  season_id?: string | null;
  view_count?: number | null;
  is_featured?: boolean | null;
  published_at: string | null;
  updated_at: string;
};

const formatDate = (value: string | null) => {
  if (!value) return "Net geplaatst";
  return new Date(value).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Amsterdam",
  });
};

const fallbackPosts: HomeNewsPost[] = mockNewsPosts.slice(0, 3).map((post) => ({
  id: post.id,
  slug: post.slug,
  title: post.title,
  category: post.category,
  excerpt: post.excerpt,
  hero_image_url: post.hero_image_url,
  hero_image_alt: post.hero_image_alt,
  author_id: post.author_id,
  season_id: post.season_id,
  view_count: post.view_count,
  is_featured: post.is_featured,
  published_at: post.published_at,
  updated_at: post.updated_at,
}));

const HomeNewsSection = () => {
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["home-news-section-posts"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<HomeNewsPost[]> => {
      const { data, error } = await supabase
        .from("news_posts")
        .select("id,slug,title,category,excerpt,hero_image_url,hero_image_alt,author_id,season_id,view_count,is_featured,published_at,updated_at")
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return (data || []) as HomeNewsPost[];
    },
  });

  const visiblePosts = posts.length ? posts : fallbackPosts;
  const featured = visiblePosts.find((post) => post.is_featured) || visiblePosts[0];
  const sidePosts = visiblePosts.filter((post) => post.id !== featured?.id).slice(0, 2);

  if (!featured && isLoading) {
    return (
      <section className="py-12 bg-background">
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="h-80 rounded-3xl bg-card/50 animate-pulse" />
        </div>
      </section>
    );
  }

  if (!featured) return null;

  return (
    <section className="relative bg-background py-10 md:py-12">
      <div className="absolute inset-x-0 top-0 h-32 pointer-events-none bg-gradient-to-b from-orange-500/[0.035] to-transparent" />
      <div className="container mx-auto px-4 max-w-7xl relative">
        <div className="mb-7 flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.24em] text-orange-500">
              <Newspaper className="w-4 h-4" /> Nieuws
            </div>
            <h2 className="mt-2 font-heading text-3xl md:text-4xl font-black uppercase leading-none text-white">
              Uit de paddock
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-300">
              Updates, raceverslagen en verhalen uit de 3SM community.
            </p>
          </div>
          <Link to="/news" className="hidden sm:inline-flex items-center gap-1 text-xs font-bold text-gray-400 hover:text-orange-400 transition-colors">
            Alle nieuwsberichten <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="rounded-[1.5rem] bg-card/38 p-3 md:p-4 shadow-2xl shadow-black/12 ring-1 ring-white/[0.045]">
          <div className="grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
            <Link
              to={articlePath(featured)}
              className="group relative min-h-[330px] overflow-hidden rounded-[1.25rem] bg-secondary/60 block ring-1 ring-white/[0.05] transition duration-300 hover:ring-orange-500/25"
            >
              {featured.hero_image_url ? (
                <img
                  src={featured.hero_image_url}
                  alt={featured.hero_image_alt || featured.title}
                  className="absolute inset-0 h-full w-full object-cover opacity-58 saturate-75 transition-transform duration-700 group-hover:scale-[1.035]"
                  loading="lazy"
                />
              ) : (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_22%,rgba(249,115,22,0.20),transparent_28%),linear-gradient(135deg,rgba(249,115,22,0.12),rgba(15,18,24,0.96))]" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/16" />
              <div className="absolute inset-x-0 bottom-0 h-[72%] bg-[radial-gradient(ellipse_at_bottom_left,rgba(0,0,0,0.94),rgba(0,0,0,0.66)_50%,transparent_84%)]" />
              <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/82 via-black/42 to-transparent" />
              <div className="absolute left-5 right-5 bottom-5 z-10">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-orange-300">
                  <span>{featured.category}</span>
                  <span className="text-gray-500">·</span>
                  <span className="text-gray-300">{formatDate(featured.published_at)}</span>
                </div>
                <h3 className="font-heading text-2xl md:text-3xl font-black leading-[1.02] text-white max-w-2xl group-hover:text-orange-200 transition-colors">
                  {featured.title}
                </h3>
                {featured.excerpt && (
                  <p className="mt-3 max-w-2xl line-clamp-2 text-sm text-gray-300 leading-relaxed">
                    {featured.excerpt}
                  </p>
                )}
                <div className="mt-5 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-heading font-black uppercase tracking-wider text-white shadow-lg shadow-orange-950/20">
                  Lees artikel <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            </Link>

            <div className="grid gap-4">
              {sidePosts.map((post) => (
                <Link
                  key={post.id}
                  to={articlePath(post)}
                  className="group grid min-h-[224px] grid-cols-1 items-center gap-5 rounded-[1.35rem] bg-background/42 p-6 ring-1 ring-white/[0.045] transition hover:bg-secondary/36 hover:ring-orange-500/18 sm:grid-cols-[155px_1fr] sm:gap-8 md:p-8"
                >
                  <div className="h-44 overflow-hidden rounded-2xl bg-secondary/70 ring-1 ring-white/[0.06] sm:h-[150px]">
                    {post.hero_image_url ? (
                      <img src={post.hero_image_url} alt={post.hero_image_alt || post.title} className="h-full w-full object-cover opacity-75 transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                    ) : (
                      <div className="grid h-full place-items-center text-2xl">🏁</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-orange-400">
                      {post.category} <span className="text-gray-500">·</span> <span className="text-gray-400">{formatDate(post.published_at)}</span>
                    </div>
                    <h4 className="font-heading text-lg font-black leading-tight text-white group-hover:text-orange-300 transition-colors">
                      {post.title}
                    </h4>
                    {post.excerpt && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-gray-300">{post.excerpt}</p>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <Link to="/news" className="mt-5 flex sm:hidden items-center justify-center gap-1 rounded-xl bg-card/70 px-4 py-3 text-xs font-bold text-gray-300 hover:text-orange-400 transition-colors ring-1 ring-white/[0.06]">
          Alle nieuwsberichten <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    </section>
  );
};

export default HomeNewsSection;
