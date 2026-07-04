import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Newspaper, UserRound } from "lucide-react";
import Navbar from "@/components/Navbar";
import StickyRaceBar from "@/components/StickyRaceBar";
import Footer from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { mockNewsPosts } from "@/lib/mockNewsPosts";
import { authorSlug, categoryToSlug } from "@/lib/newsTaxonomy";

const STALE = 5 * 60 * 1000;

type AuthorNewsPost = {
  id: string;
  slug: string;
  title: string;
  category: string;
  excerpt: string | null;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  author_id: string | null;
  authorName?: string | null;
  authorAvatarUrl?: string | null;
  published_at: string | null;
  updated_at: string;
};

type AuthorProfile = {
  user_id: string;
  display_name: string | null;
  iracing_name: string | null;
  avatar_url: string | null;
};

const formatNewsDate = (value: string | null) => {
  if (!value) return "Nog niet gepubliceerd";
  return new Date(value).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
};

const NewsAuthorPage = () => {
  const { authorSlug: routeAuthorSlug } = useParams();
  const [searchParams] = useSearchParams();
  const isMockPreview = searchParams.has("mock");

  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["news-author-posts", routeAuthorSlug],
    staleTime: STALE,
    enabled: !isMockPreview,
    queryFn: async (): Promise<AuthorNewsPost[]> => {
      const { data, error } = await supabase
        .from("news_posts")
        .select("id,slug,title,category,excerpt,hero_image_url,hero_image_alt,author_id,published_at,updated_at")
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      const newsPosts = (data || []) as AuthorNewsPost[];
      const authorIds = Array.from(new Set(newsPosts.map((post) => post.author_id).filter(Boolean))) as string[];
      if (!authorIds.length) return newsPosts;
      const { data: profiles } = await supabase.from("profiles").select("user_id,display_name,iracing_name,avatar_url").in("user_id", authorIds);
      const profileMap = new Map(((profiles || []) as AuthorProfile[]).map((profile) => [profile.user_id, profile]));
      return newsPosts.map((post) => {
        const profile = post.author_id ? profileMap.get(post.author_id) : null;
        const name = profile?.display_name || profile?.iracing_name || "3SM redactie";
        return { ...post, authorName: name, authorAvatarUrl: profile?.avatar_url || null };
      });
    },
  });

  const visiblePosts = useMemo(() => {
    const source = isMockPreview ? mockNewsPosts : posts;
    return source.filter((post) => authorSlug(post.authorName) === routeAuthorSlug);
  }, [isMockPreview, posts, routeAuthorSlug]);

  const author = visiblePosts[0];
  const authorName = author?.authorName || "3SM redactie";
  const avatar = author?.authorAvatarUrl;

  useEffect(() => {
    document.title = `${authorName} - Nieuws auteur - 3 Stripe Motorsport`;
    let tag = document.head.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    if (!tag) {
      tag = document.createElement("meta");
      tag.name = "description";
      document.head.appendChild(tag);
    }
    tag.content = `Alle nieuwsartikelen van ${authorName} op 3 Stripe Motorsport.`;
  }, [authorName]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <StickyRaceBar />
      <main className="pt-[108px]">
        <section className="border-b border-border bg-gradient-to-b from-card/70 to-background py-12">
          <div className="container mx-auto px-4 max-w-6xl">
            <Link to={isMockPreview ? "/news?mock=1" : "/news"} className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-orange-400"><ChevronLeft className="h-4 w-4" /> Terug naar nieuws</Link>
            <div className="flex flex-col gap-5 md:flex-row md:items-center">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-orange-500/30 bg-secondary">
                {avatar ? <img src={avatar} alt={authorName} className="h-full w-full object-cover" /> : <UserRound className="h-10 w-10 text-muted-foreground" />}
              </div>
              <div>
                <span className="text-xs font-black uppercase tracking-[0.22em] text-orange-400">Auteur</span>
                <h1 className="font-heading text-4xl font-black uppercase">{authorName}</h1>
                <p className="mt-2 max-w-2xl text-muted-foreground">Alle artikelen van deze auteur binnen 3 Stripe Motorsport.</p>
              </div>
            </div>
          </div>
        </section>
        <section className="py-10">
          <div className="container mx-auto px-4 max-w-6xl">
            {isLoading ? <div className="h-64 rounded-lg border border-border bg-card animate-pulse" /> : visiblePosts.length ? (
              <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {visiblePosts.map((post) => (
                  <article key={post.id} className="overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-orange-500/50">
                    <Link to={`/news/${categoryToSlug(post.category)}/${post.slug}/${isMockPreview ? "?mock=1" : ""}`} className="block aspect-[16/9] overflow-hidden bg-secondary/30">
                      {post.hero_image_url ? <img src={post.hero_image_url} alt={post.hero_image_alt || post.title} className="h-full w-full object-cover transition-transform duration-500 hover:scale-105" /> : <div className="flex h-full items-center justify-center"><Newspaper className="h-10 w-10 text-muted-foreground/30" /></div>}
                    </Link>
                    <div className="p-5">
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">{post.category} · {formatNewsDate(post.published_at)}</span>
                      <h2 className="mt-3 font-heading text-xl font-black leading-tight"><Link to={`/news/${categoryToSlug(post.category)}/${post.slug}/${isMockPreview ? "?mock=1" : ""}`} className="hover:text-orange-400">{post.title}</Link></h2>
                      {post.excerpt && <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{post.excerpt}</p>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card px-6 py-16 text-center"><Newspaper className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" /><h2 className="font-heading text-2xl font-black">Geen artikelen gevonden</h2><p className="mt-2 text-sm text-muted-foreground">Deze auteur heeft nog geen gepubliceerde artikelen.</p></div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default NewsAuthorPage;
