import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("public news workflow", () => {
  it("adds SEO-friendly public news routes and a compact top-level navigation item", () => {
    const app = read("src/App.tsx");
    const navbar = read("src/components/Navbar.tsx");
    const sitemapGenerator = read("scripts/generate-route-html.mjs");

    expect(app).toContain('const NewsPage = lazy(() => import("./pages/NewsPage.tsx"));');
    expect(app).toContain('const NewsDetailPage = lazy(() => import("./pages/NewsDetailPage.tsx"));');
    expect(app).toContain('const NewsAuthorPage = lazy(() => import("./pages/NewsAuthorPage.tsx"));');
    expect(app).toContain('path="/news"');
    expect(app).toContain('path="/news/author/:authorSlug"');
    expect(app).toContain('path="/news/:categorySlug/:slug"');
    expect(app).toContain('path="/news/:categorySlug"');
    expect(app).toContain('path="/news/:slug"');
    expect(navbar).toContain('{ label: "Nieuws", path: "/news/", icon: Newspaper }');
    expect(navbar).not.toContain('label: "News"');
    expect(sitemapGenerator).toContain("path: '/news'");
  });

  it("renders only published news posts in a public overview with article cards", () => {
    expect(existsSync("src/pages/NewsPage.tsx")).toBe(true);
    const page = read("src/pages/NewsPage.tsx");

    expect(page).toContain('from("news_posts")');
    expect(page).toContain('.eq("status", "published")');
    expect(page).toContain('.order("published_at", { ascending: false');
    expect(page).toContain("articlePath(post)");
    expect(page).toContain("NEWS_CATEGORIES");
    expect(page).toContain("categorySlugToLabel");
    expect(page).toContain("searchQuery");
    expect(page).toContain("activeSeasonId");
    expect(page).toContain("clearSeasonFilter");
    expect(page).toContain('path.includes("?") ? "&" : "?"');
    expect(page).toContain("filteredPosts");
    expect(page).toContain("availableCategories");
    expect(page).toContain("visiblePosts.some((post) => post.category === category.label)");
    expect(page).toContain("Populair deze week");
    expect(page).toContain("Laatste nieuws");
    expect(page).toContain("author_id");
    expect(page).toContain("is_featured");
    expect(page).toContain('from("public_profiles")');
    expect(page).toContain("authorName");
    expect(page).toContain("Geen nieuwsberichten gevonden");
    expect(page).toContain("hero_image_url");
  });

  it("renders a public detail page from saved editor html with safe article styling", () => {
    expect(existsSync("src/pages/NewsDetailPage.tsx")).toBe(true);
    const page = read("src/pages/NewsDetailPage.tsx");
    const css = read("src/index.css");

    expect(page).toContain('useParams');
    expect(page).toContain('categorySlug');
    expect(page).toContain('.eq("slug", slug)');
    expect(page).toContain('.eq("status", "published")');
    expect(page).toContain('from("public_profiles")');
    expect(page).toContain("authorName");
    expect(page).toContain("authorSlug");
    expect(page).toContain("season_id");
    expect(page).toContain("race_id");
    expect(page).toContain('to={`/results/${post.race_id}/`}');
    expect(page).toContain("Bekijk hier de race uitslag");
    expect(page).toContain("relatedPosts");
    expect(page).toContain("is_featured");
    expect(page).toContain("Gerelateerde artikelen");
    expect(page).toContain("Meer nieuws uit dit seizoen");
    expect(page).toContain('categoryToSlug(post.category) === "race-recaps"');
    expect(page).toContain('to="/meedoen/"');
    expect(page).toContain("Zelf meerijden?");
    expect(page).toContain("Bekijk hoe je meedoet");
    expect(page).toContain("sanitizeNewsHtml");
    expect(page).toContain("dangerouslySetInnerHTML");
    expect(page).toContain('className="news-article-prose');
    expect(page).toContain("max-w-5xl");
    expect(page).toContain("contentContainsImageSrc");
    expect(page).toContain("showHeroImage");
    expect(page).toContain("sanitizedContentHtml");
    expect(css).toContain(".news-article-prose .news-image-block");
    expect(css).toContain("data-width=\"33%\"");
    expect(css).toContain("width: calc(33.333% - 0.75rem);");
    expect(css).toContain(".news-article-prose p");
    expect(css).toContain("white-space: pre-wrap;");
    expect(css).toContain("margin: 0 0 1.1rem;");
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
      'Race uitslag',
      'Bekijk hier de race uitslag',
      'Door',
    ].forEach((phrase) => {
      expect(translations).toContain(phrase);
    });
  });

  it("can refresh dynamic news SEO routes without rebuilding hashed assets", () => {
    const generator = read("scripts/generate-route-html.mjs");
    const refreshScript = read("scripts/refresh-dynamic-seo.mjs");
    const pkg = read("package.json");

    expect(generator).toContain(".route-html-manifest.json");
    expect(generator).toContain("cleanupStaleGeneratedRoutes");
    expect(generator).toContain("dynamicRoutes: dynamicRoutes.map((route) => route.path)");
    expect(refreshScript).toContain("generate-route-html.mjs");
    expect(refreshScript).toContain("const copyFileIfChanged");
    expect(refreshScript).toContain("readFileSync(left).equals(readFileSync(right))");
    expect(refreshScript).toContain("copyFileIfChanged(join(distDir, 'sitemap.xml'), join(webroot, 'sitemap.xml'))");
    expect(refreshScript).toContain("rmSync(routeDirectoryPath(stalePath, webroot)");
    expect(pkg).toContain('"seo:refresh": "node scripts/refresh-dynamic-seo.mjs"');
  });

  it("keeps crawler metadata and internal links on trailing-slash canonical URLs", () => {
    const generator = read("scripts/generate-route-html.mjs");

    expect(generator).toContain("const canonicalPath = (path) =>");
    expect(generator).toContain("const absoluteUrl = (path) => `${SITE_URL}${canonicalPath(path)}`;");
    expect(generator).toContain("title: 'iRacing racekalender Nederland | 3SM'");
    expect(generator).toContain("Bekijk de 3SM iRacing racekalender: aankomende races");
    expect(generator).toContain("3 Stripe Motorsport is een Nederlandse iRacing league en community, ontstaan in Nederland");
    expect(generator).toContain("Echte kalender- en uitslagdata");
    expect(generator).toContain("solo of met een eigen team rijden");
    expect(generator).toContain("GT3 is momenteel de belangrijkste klasse");
    expect(generator).toContain("endurance-events is actief in ontwikkeling");
    expect(generator).toContain("Hard racen. Slim racen. Respectvol racen.");
    expect(generator).toContain("const isRaceRecap = categorySlug === 'race-recaps'");
    expect(generator).toContain("...(isRaceRecap ? [['/meedoen', 'Zelf meerijden? Bekijk hoe je meedoet']] : [])");
    expect(generator).toContain("buildCalendarHubCrawlerHtml");
    expect(generator).toContain("Eerstvolgende 3SM race");
    expect(generator).toContain("Aankomende races");
    expect(generator).toContain("buildCalendarHubItemListJsonLd");
    expect(generator).toContain("title: 'iRacing uitslagen & standings | 3SM'");
    expect(generator).toContain("Bekijk 3SM iRacing uitslagen met winnaars, podiums");
    expect(generator).toContain("buildResultsHubCrawlerHtml");
    expect(generator).toContain("Laatste race-uitslag");
    expect(generator).toContain("Details & delen");
    expect(generator).toContain("Race archief");
    expect(generator).toContain("<loc>${absoluteUrl(route.path)}</loc>");
    expect(generator).toContain("<li><a href=\"${absoluteUrl(href)}\">");
  });

  it("centralizes category taxonomy, author pages and season metadata for the expanded platform", () => {
    expect(existsSync("src/lib/newsTaxonomy.ts")).toBe(true);
    expect(existsSync("src/pages/NewsAuthorPage.tsx")).toBe(true);
    const taxonomy = read("src/lib/newsTaxonomy.ts");
    const authorPage = read("src/pages/NewsAuthorPage.tsx");
    const editor = read("src/pages/NewsEditorPage.tsx");
    const migration = read("supabase/migrations/20260601140000_news_platform_metadata.sql");

    expect(taxonomy).toContain("slug: \"reviews\"");
    expect(taxonomy).toContain("categoryToSlug");
    expect(taxonomy).toContain("categorySlugToLabel");
    expect(taxonomy).toContain("articlePath");
    expect(taxonomy).toContain("filterNewsPosts");
    expect(taxonomy).toContain("authorPath");
    expect(authorPage).toContain('to={`/news/${categoryToSlug(post.category)}/${post.slug}');
    expect(authorPage).toContain("Alle artikelen van deze auteur");
    expect(editor).toContain("season_id");
    expect(editor).toContain("race_id");
    expect(editor).toContain("is_featured");
    expect(editor).toContain("Uitlichten op nieuwsoverzicht");
    expect(editor).toContain('from("leagues")');
    expect(editor).toContain('from("races")');
    expect(editor).toContain("Seizoen");
    expect(editor).toContain("Race uitslag");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS season_id UUID");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS view_count INTEGER");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS is_featured BOOLEAN");
    expect(migration).toContain("idx_news_posts_is_featured");
    expect(migration).toContain("idx_news_posts_season_id");

    const raceLinkMigration = read("supabase/migrations/20260611120000_news_race_link.sql");
    expect(raceLinkMigration).toContain("ADD COLUMN IF NOT EXISTS race_id UUID");
    expect(raceLinkMigration).toContain("REFERENCES public.races(id) ON DELETE SET NULL");
    expect(raceLinkMigration).toContain("idx_news_posts_race_id");
  });
});
