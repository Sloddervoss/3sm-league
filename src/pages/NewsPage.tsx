import { Link } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { CalendarDays, ChevronRight, Newspaper, Sparkles } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";

const STALE = 5 * 60 * 1000;

type PublicNewsPost = {
  id: string;
  slug: string;
  title: string;
  category: string;
  excerpt: string | null;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  author_id: string | null;
  authorName?: string | null;
  published_at: string | null;
  updated_at: string;
};

type AuthorProfile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
};

const fetchAuthorNames = async (authorIds: Array<string | null>) => {
  const ids = Array.from(new Set(authorIds.filter(Boolean))) as string[];
  if (!ids.length) return new Map<string, string>();

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,display_name,iracing_name")
    .in("user_id", ids);
  if (error) return new Map<string, string>();

  return new Map(
    ((data || []) as AuthorProfile[]).map((profile) => [
      profile.user_id,
      profile.display_name || profile.iracing_name || "3SM redactie",
    ]),
  );
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

const NewsPage = () => {
  useEffect(() => {
    document.title = "Nieuws - 3 Stripe Motorsport";
    const description = "Lees het laatste nieuws van 3 Stripe Motorsport: verhalen uit de paddock, raceverslagen en updates van de iRacing league.";
    let tag = document.head.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!tag) {
      tag = document.createElement("meta");
      tag.name = "description";
      document.head.appendChild(tag);
    }
    tag.content = description;
  }, []);

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["public-news-posts"],
    staleTime: STALE,
    queryFn: async (): Promise<PublicNewsPost[]> => {
      const { data, error } = await supabase
        .from("news_posts")
        .select("id,slug,title,category,excerpt,hero_image_url,hero_image_alt,author_id,published_at,updated_at")
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const posts = (data || []) as PublicNewsPost[];
      const authorNames = await fetchAuthorNames(posts.map((post) => post.author_id));
      return posts.map((post) => ({
        ...post,
        authorName: post.author_id ? authorNames.get(post.author_id) : null,
      }));
    },
  });

  const featured = posts[0];
  const archive = posts.slice(1);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <section className="border-b border-border bg-gradient-to-b from-card/60 to-background py-12">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 mb-2">
              <Newspaper className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-[0.15em]">3SM</span>
            </div>
            <h1 className="font-heading text-4xl md:text-5xl font-black uppercase">Nieuws</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Verhalen uit de paddock, raceverslagen en updates van 3 Stripe Motorsport.
            </p>
          </div>
        </section>

        <section className="py-12">
          <div className="container mx-auto px-4 max-w-7xl">
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-3">
                {[1, 2, 3].map((item) => <div key={item} className="h-64 rounded-lg border border-border bg-card animate-pulse" />)}
              </div>
            ) : !posts.length ? (
              <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
                <Newspaper className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
                <h2 className="font-heading text-2xl font-black">Geen nieuwsberichten gevonden</h2>
                <p className="mt-2 text-sm text-muted-foreground">Zodra er artikelen gepubliceerd zijn, verschijnen ze hier.</p>
              </div>
            ) : (
              <div className="space-y-10">
                {featured && (
                  <motion.article
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="overflow-hidden rounded-lg border border-orange-500/20 bg-card"
                  >
                    <div className="h-0.5 bg-gradient-racing" />
                    <div className="grid gap-0 lg:grid-cols-[1.15fr_0.85fr]">
                      <Link to={`/news/${featured.slug}`} className="group relative min-h-[260px] overflow-hidden bg-secondary/30 lg:min-h-[390px]">
                        {featured.hero_image_url ? (
                          <img
                            src={featured.hero_image_url}
                            alt={featured.hero_image_alt || featured.title}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            loading="eager"
                          />
                        ) : (
                          <div className="flex h-full min-h-[260px] items-center justify-center bg-gradient-to-br from-secondary to-background">
                            <Newspaper className="h-16 w-16 text-muted-foreground/30" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-background/75 via-transparent to-transparent" />
                      </Link>
                      <div className="flex flex-col justify-center p-6 md:p-8">
                        <div className="mb-4 flex flex-wrap items-center gap-3">
                          <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">
                            <Sparkles className="h-3 w-3" /> Uitgelicht
                          </span>
                          <span className="rounded-full border border-border bg-secondary/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{featured.category}</span>
                        </div>
                        <h2 className="font-heading text-3xl font-black leading-tight md:text-4xl">
                          <Link to={`/news/${featured.slug}`} className="hover:text-orange-400 transition-colors">{featured.title}</Link>
                        </h2>
                        {featured.excerpt && <p className="mt-4 text-muted-foreground leading-relaxed">{featured.excerpt}</p>}
                        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
                          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                            <CalendarDays className="h-4 w-4 text-orange-400" /> {formatNewsDate(featured.published_at)}
                          </span>
                          {featured.authorName && <span className="text-sm text-muted-foreground">Door {featured.authorName}</span>}
                          <Link to={`/news/${featured.slug}`} className="inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-4 py-2 text-xs font-heading font-bold uppercase tracking-wider text-white hover:bg-orange-400 transition-colors">
                            Lees artikel <ChevronRight className="h-4 w-4" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </motion.article>
                )}

                {archive.length > 0 && (
                  <div>
                    <div className="mb-4 flex items-center gap-2">
                      <Newspaper className="h-4 w-4 text-orange-500" />
                      <span className="text-xs font-black uppercase tracking-[0.25em] text-orange-500">Laatste nieuws</span>
                    </div>
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                      {archive.map((post) => (
                        <article key={post.id} className="group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-orange-500/40">
                          <Link to={`/news/${post.slug}`} className="block aspect-[16/9] overflow-hidden bg-secondary/30">
                            {post.hero_image_url ? (
                              <img src={post.hero_image_url} alt={post.hero_image_alt || post.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
                            ) : (
                              <div className="flex h-full items-center justify-center"><Newspaper className="h-10 w-10 text-muted-foreground/30" /></div>
                            )}
                          </Link>
                          <div className="p-5">
                            <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                              <span className="text-orange-400">{post.category}</span>
                              <span>·</span>
                              <span>{formatNewsDate(post.published_at)}</span>
                              {post.authorName && <><span>·</span><span>Door {post.authorName}</span></>}
                            </div>
                            <h2 className="font-heading text-xl font-black leading-tight">
                              <Link to={`/news/${post.slug}`} className="hover:text-orange-400 transition-colors">{post.title}</Link>
                            </h2>
                            {post.excerpt && <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{post.excerpt}</p>}
                            <Link to={`/news/${post.slug}`} className="mt-5 inline-flex items-center gap-1.5 text-xs font-heading font-bold uppercase tracking-wider text-orange-400 hover:text-orange-300">
                              Lees artikel <ChevronRight className="h-4 w-4" />
                            </Link>
                          </div>
                        </article>
                      ))}
                    </div>
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
