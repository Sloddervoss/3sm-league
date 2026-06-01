import { Link, useParams } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, Newspaper } from "lucide-react";
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
  content_html: string;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  seo_title: string | null;
  seo_description: string | null;
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

const sanitizeNewsHtml = (html: string) =>
  html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son[a-z]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=(['"])\s*javascript:[^'"]*\2/gi, ' $1="#"');

const formatNewsDate = (value: string | null) => {
  if (!value) return "Nog niet gepubliceerd";
  return new Date(value).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Amsterdam",
  });
};

const NewsDetailPage = () => {
  const { slug } = useParams();

  const { data: post, isLoading } = useQuery({
    queryKey: ["public-news-post", slug],
    enabled: Boolean(slug),
    staleTime: STALE,
    queryFn: async (): Promise<PublicNewsPost | null> => {
      const { data, error } = await supabase
        .from("news_posts")
        .select("id,slug,title,category,excerpt,content_html,hero_image_url,hero_image_alt,seo_title,seo_description,author_id,published_at,updated_at")
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      if (error) throw error;
      const post = data as PublicNewsPost | null;
      if (!post?.author_id) return post;

      const { data: profile } = await supabase
        .from("profiles")
        .select("user_id,display_name,iracing_name")
        .eq("user_id", post.author_id)
        .maybeSingle();
      const author = profile as AuthorProfile | null;
      return {
        ...post,
        authorName: author?.display_name || author?.iracing_name || "3SM redactie",
      };
    },
  });

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
          <section className="py-12">
            <div className="container mx-auto px-4 max-w-4xl">
              <div className="h-96 rounded-lg border border-border bg-card animate-pulse" />
            </div>
          </section>
        ) : !post ? (
          <section className="py-24">
            <div className="container mx-auto px-4 max-w-3xl text-center">
              <Newspaper className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <h1 className="font-heading text-3xl font-black">Nieuwsbericht niet gevonden</h1>
              <p className="mt-2 text-muted-foreground">Dit artikel is niet gepubliceerd of bestaat niet.</p>
              <Link to="/news" className="mt-6 inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-400 transition-colors">
                <ChevronLeft className="h-4 w-4" /> Terug naar nieuws
              </Link>
            </div>
          </section>
        ) : (
          <>
            <section className="border-b border-border bg-gradient-to-b from-card/60 to-background py-10">
              <div className="container mx-auto px-4 max-w-5xl">
                <Link to="/news" className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-orange-400 transition-colors">
                  <ChevronLeft className="h-4 w-4" /> Terug naar nieuws
                </Link>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-400">{post.category}</span>
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="h-4 w-4 text-orange-400" /> {formatNewsDate(post.published_at)}
                  </span>
                  {post.authorName && <span className="text-sm text-muted-foreground">Door {post.authorName}</span>}
                </div>
                <h1 className="font-heading text-4xl font-black leading-tight md:text-6xl">{post.title}</h1>
                {post.excerpt && <p className="mt-5 max-w-3xl text-lg leading-relaxed text-muted-foreground">{post.excerpt}</p>}
              </div>
            </section>

            {post.hero_image_url && (
              <section className="py-8">
                <div className="container mx-auto px-4 max-w-5xl">
                  <img
                    src={post.hero_image_url}
                    alt={post.hero_image_alt || post.title}
                    className="max-h-[520px] w-full rounded-lg border border-border object-cover"
                    loading="eager"
                  />
                </div>
              </section>
            )}

            <article className="pb-16 pt-4">
              <div className="container mx-auto px-4 max-w-4xl">
                <div
                  className="news-article-prose prose prose-invert max-w-none rounded-lg border border-border bg-card/70 px-5 py-6 text-[18px] leading-[1.75] md:px-8 md:py-8"
                  dangerouslySetInnerHTML={{ __html: sanitizeNewsHtml(post.content_html) }}
                />
              </div>
            </article>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default NewsDetailPage;
