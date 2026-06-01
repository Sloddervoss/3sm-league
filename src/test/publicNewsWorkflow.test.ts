import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("public news workflow", () => {
  it("adds public news routes and a compact top-level navigation item", () => {
    const app = read("src/App.tsx");
    const navbar = read("src/components/Navbar.tsx");
    const sitemapGenerator = read("scripts/generate-route-html.mjs");

    expect(app).toContain('const NewsPage = lazy(() => import("./pages/NewsPage.tsx"));');
    expect(app).toContain('const NewsDetailPage = lazy(() => import("./pages/NewsDetailPage.tsx"));');
    expect(app).toContain('path="/news"');
    expect(app).toContain('path="/news/:slug"');
    expect(navbar).toContain('{ label: "Nieuws", path: "/news", icon: Newspaper }');
    expect(navbar).not.toContain('label: "News"');
    expect(sitemapGenerator).toContain("path: '/news'");
  });

  it("renders only published news posts in a public overview with article cards", () => {
    expect(existsSync("src/pages/NewsPage.tsx")).toBe(true);
    const page = read("src/pages/NewsPage.tsx");

    expect(page).toContain('from("news_posts")');
    expect(page).toContain('.eq("status", "published")');
    expect(page).toContain('.order("published_at", { ascending: false');
    expect(page).toContain('to={`/news/${post.slug}`}');
    expect(page).toContain("Laatste nieuws");
    expect(page).toContain("author_id");
    expect(page).toContain('from("profiles")');
    expect(page).toContain("authorName");
    expect(page).toContain("Geen nieuwsberichten gevonden");
    expect(page).toContain("hero_image_url");
  });

  it("renders a public detail page from saved editor html with safe article styling", () => {
    expect(existsSync("src/pages/NewsDetailPage.tsx")).toBe(true);
    const page = read("src/pages/NewsDetailPage.tsx");
    const css = read("src/index.css");

    expect(page).toContain('useParams');
    expect(page).toContain('.eq("slug", slug)');
    expect(page).toContain('.eq("status", "published")');
    expect(page).toContain('from("profiles")');
    expect(page).toContain("authorName");
    expect(page).toContain("sanitizeNewsHtml");
    expect(page).toContain("dangerouslySetInnerHTML");
    expect(page).toContain('className="news-article-prose');
    expect(css).toContain(".news-article-prose .news-image-block");
    expect(css).toContain("data-width=\"33%\"");
    expect(css).toContain("width: calc(33.333% - 0.75rem);");
    expect(css).toContain(".news-article-prose table");
  });

  it("keeps public news copy covered by the exact-match EN translation catalog", () => {
    const translations = read("src/i18n/translations.ts");

    [
      'Nieuws',
      'Laatste nieuws',
      'Verhalen uit de paddock, raceverslagen en updates van 3 Stripe Motorsport.',
      'Geen nieuwsberichten gevonden',
      'Terug naar nieuws',
      'Lees artikel',
      'Uitgelicht',
      'Door',
    ].forEach((phrase) => {
      expect(translations).toContain(phrase);
    });
  });
});
