import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TITLE_BRAND_SEPARATOR,
  TITLE_MAX,
  assignUniqueNewsArticleTitles,
  buildNewsArticleH1,
  buildNewsArticleTitle,
  buildNewsCategoryTitle,
  buildNewsHubTitle,
  shortenHeadline,
} from "@/lib/seoTitle.mjs";

/**
 * Regressietests op de crawler-facing titels van de nieuwsroutes: de artikelen
 * (/news/<rubriek>/<slug>), de nieuwshub (/news) en de rubriekhubs (/news/<rubriek>).
 *
 * Aanleiding (16 oktober 2026): de nieuwsartikelen gebruikten nog de oude,
 * plaatselijke truncate(post.title, 58) uit de generator. Die knipte een lange kop
 * midden in een meerwoordige naam af en had geen lengtebudget, terwijl de
 * uitslagpagina's al een harde grens van 60 tekens met gerangschikte delen kregen.
 * De nieuwsKOP is het onderwerp van de pagina en kan 90 tekens zijn
 * ('Jaimy Peters pakt de overwinning na spectaculaire raceavond bij 3 Stripe
 * Motorsport'); die wordt nu heel woord voor heel woord ingekort tot de kopregel
 * (h1), en de titel begint met die kopregel — dezelfde behandeling als de
 * uitslagpagina's, waar de h1 de racenaam is.
 *
 * De echte invoer van alle artikelen staat in src/test/fixtures/news-title-inputs.json
 * (kop, rubriek en publicatiedatum uit de BlogPosting-JSON-LD en de h1 van
 * dist/news/<rubriek>/<slug>/index.html). scripts/measure-result-titles.mjs meet
 * dezelfde invoer in 20px Arial-metrics na.
 */

type NewsTitleInput = {
  slug: string;
  category: string;
  headline: string;
  date: string;
};

const realArticles = JSON.parse(
  readFileSync("src/test/fixtures/news-title-inputs.json", "utf8"),
) as NewsTitleInput[];

const titleFor = (article: NewsTitleInput) => buildNewsArticleTitle({
  headline: article.headline,
  category: article.category,
  date: article.date,
});

const findArticle = (slug: string) => {
  const article = realArticles.find((entry) => entry.slug === slug);
  if (!article) throw new Error(`artikel niet gevonden: ${slug}`);
  return article;
};

// Een kopregel is fout afgebroken als er midden in een woord is geknipt: dan staat
// hij niet meer als heel woord-voor-woord-voorvoegsel aan het begin van de kop.
const brokenMidWord = (input: string, output: string) =>
  !input.startsWith(output) && !output.endsWith("…");

const LIVE_HEADLINE = "Jaimy Peters pakt de overwinning na spectaculaire raceavond bij 3 Stripe Motorsport";

describe("seoTitle — nieuwsKOP inkorten op woordgrens", () => {
  it("kapt nooit midden in een woord af en eindigt nooit op een scheidingsteken", () => {
    for (const input of [LIVE_HEADLINE, ...realArticles.map((article) => article.headline)]) {
      for (let max = 12; max <= 200; max += 1) {
        const output = shortenHeadline(input, max);
        expect(brokenMidWord(input, output), `max=${max} gaf "${output}"`).toBe(false);
        expect(output, `max=${max}`).not.toMatch(/[\s·|,;:/\-–—]$/u);
        expect(output.startsWith("…")).toBe(false);
        if (input.length <= max) expect(output).toBe(input);
      }
    }
  });

  it("laat het eerste woord heel als zelfs dat niet binnen de ruimte past", () => {
    const input = "Superlangewoordenreekszonderenigespaciediemetopzetgebeurd en nog meer tekst";
    const output = shortenHeadline(input, 20);
    expect(output).toBe("Superlangewoordenreekszonderenigespaciediemetopzetgebeurd");
    expect(output.length).toBeGreaterThan(20);
  });

  it("zet geen beletselteken: de kopregel is geen afgekapte samenvatting", () => {
    const output = shortenHeadline(LIVE_HEADLINE, TITLE_MAX);
    expect(output).not.toContain("…");
    expect(LIVE_HEADLINE.startsWith(output)).toBe(true);
    expect(output).toBe("Jaimy Peters pakt de overwinning na spectaculaire raceavond");
  });
});

describe("seoTitle — de echte nieuwsartikelen", () => {
  it("houdt elke titel binnen de harde grens van 60 tekens", () => {
    expect(TITLE_MAX).toBe(60);
    const tooLong = realArticles
      .map((article) => ({ slug: article.slug, title: titleFor(article) }))
      .filter(({ title }) => title.length > TITLE_MAX);
    expect(tooLong, `te lang: ${tooLong.map(({ title }) => title).join(" | ")}`).toEqual([]);

    for (const article of realArticles) {
      const title = titleFor(article);
      expect(title).not.toContain("…");
      expect(title).not.toMatch(/[\s·|]$/u);
      // De titel begint met de kopregel en de kopregel is een heel voorvoegsel van
      // de echte kop — er valt nooit een half woord weg.
      expect(title.startsWith(buildNewsArticleH1({ headline: article.headline }))).toBe(true);
      expect(article.headline.startsWith(buildNewsArticleH1({ headline: article.headline }))).toBe(true);
    }
  });

  it("kort de lange kop in tot de kopregel en laat de titel ermee beginnen", () => {
    const article = findArticle("jaimy-peters-pakt-de-overwinning-na-spectaculaire-raceavond-bij-3-stripe-motorsport");
    // De kop is langer dan de harde grens; de kopregel (h1) past en is een voorvoegsel.
    expect(article.headline.length).toBeGreaterThan(TITLE_MAX);
    const h1 = buildNewsArticleH1({ headline: article.headline });
    // Het kopbudget is TITLE_MAX min de merksuffix (' | 3SM', 6 tekens): 54. Het merk
    // staat op elk artikel, dus de kop moet daarvoor wijken — niet andersom.
    expect(h1).toBe("Jaimy Peters pakt de overwinning na spectaculaire");
    expect(h1.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(titleFor(article)).toBe(`${h1}${TITLE_BRAND_SEPARATOR}3SM`);
  });

  it("zet het merk op elk artikel, ook als de kop lang is", () => {
    // Kop van 41 tekens: het merk past erachter, datum en rubriek niet meer.
    expect(titleFor(findArticle("race-recap-gt-master-challenge-cup-race-6")))
      .toBe("Race Recap GT Master Challenge Cup Race 6 | 3SM");
    // Kop van 50 tekens: het merk past er nog achter.
    expect(titleFor(findArticle("strategie-spektakel-en-spanning-tot-aan-de-finish")))
      .toBe("Strategie, spektakel en spanning tot aan de finish | 3SM");
    // Kop van 52 tekens: viel eerder buiten de merkgrens en stond zonder suffix in de
    // HTML en de tab; nu eindigt ook dit artikel op '| 3SM'.
    expect(titleFor(findArticle("ricky-pakt-de-overwinning-na-spectaculaire-wedstrijd")))
      .toBe("Ricky pakt de overwinning na spectaculaire wedstrijd | 3SM");
    for (const article of realArticles) {
      expect(titleFor(article).endsWith(" | 3SM"), article.slug).toBe(true);
      expect(titleFor(article).length).toBeLessThanOrEqual(TITLE_MAX);
    }
  });

  it("geeft 4 unieke artikeltitels en houdt het generator- en SPA-pad gelijk", () => {
    const assigned = assignUniqueNewsArticleTitles(realArticles);
    const titles = assigned.map((entry) => entry.title);

    expect(titles).toHaveLength(4);
    expect(new Set(titles).size).toBe(4);

    // De SPA bouwt de titel per artikel (buildNewsArticleTitle) en weet niets van de
    // andere artikelen. Dat mag alleen goed gaan als de set-brede toewijzing op de
    // echte artikelen nooit hoeft terug te vallen: anders wijkt de tabtitel af van de
    // crawler-HTML.
    expect(assigned.filter((entry) => entry.demoted)).toEqual([]);
    for (const entry of assigned) {
      expect(titleFor(entry)).toBe(entry.title);
      expect(entry.h1).toBe(buildNewsArticleH1({ headline: entry.headline }));
    }
  });

  it("geeft geen ISO-datum in de titel", () => {
    for (const article of realArticles) {
      expect(titleFor(article)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe("seoTitle — de nieuwshub en de rubriekhubs", () => {
  it("bouwt de nieuwshubtitel binnen de 60 tekens, met de h1 als eerste deel", () => {
    const title = buildNewsHubTitle();
    expect(title).toBe("3SM nieuws · raceverslagen en updates");
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(title.startsWith("3SM nieuws")).toBe(true);
  });

  it("bouwt een rubriekhubtitel uit de rubriek, 'nieuws' en het merk", () => {
    const title = buildNewsCategoryTitle({ category: "Race Recaps" });
    expect(title).toBe("Race Recaps · nieuws | 3SM");
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(title.startsWith("Race Recaps")).toBe(true);
    // De h1 van de hub is de rubriek zelf en dus een voorvoegsel van de titel.
    expect(title.startsWith("Race Recaps")).toBe(true);
    // Een lange rubrieknaam kapt niet af: het woord 'nieuws' valt weg als heel deel.
    const long = buildNewsCategoryTitle({ category: "iRacing Nieuws en enduranceverslagen van de redactie" });
    expect(long).not.toContain("…");
    expect(long).not.toMatch(/[\s·|]$/u);
  });

  it("houdt alle nieuwstitels (artikelen + hubs) onderling uniek", () => {
    const assigned = assignUniqueNewsArticleTitles(realArticles);
    const categories = [...new Set(realArticles.map((article) => article.category))];
    const titles = [
      ...assigned.map((entry) => entry.title),
      ...categories.map((category) => buildNewsCategoryTitle({ category })),
      buildNewsHubTitle(),
    ];
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.every((title) => title.length <= TITLE_MAX)).toBe(true);
  });
});

describe("seoTitle — generator en SPA bouwen de nieuwstitel met dezelfde helper", () => {
  const generator = readFileSync("scripts/generate-route-html.mjs", "utf8");
  const detailPage = readFileSync("src/pages/NewsDetailPage.tsx", "utf8");
  const newsPage = readFileSync("src/pages/NewsPage.tsx", "utf8");

  it("gebruikt de gedeelde helper in de generator in plaats van de oude afkapfunctie", () => {
    expect(generator).toContain("from '../src/lib/seoTitle.mjs'");
    expect(generator).toContain("assignUniqueNewsArticleTitles(");
    expect(generator).toContain("buildNewsArticleTitle({");
    expect(generator).toContain("buildNewsArticleH1({");
    expect(generator).toContain("buildNewsCategoryTitle({ category: label })");
    expect(generator).toContain("title: buildNewsHubTitle(),");
    // De h1 van een nieuwsartikel is de korte kopregel, niet de volledige kop.
    expect(generator).toContain("h1: articleHeadline,");
    // De oude, afkappende titelpaden mogen niet terugkomen.
    expect(generator).not.toContain("truncate(post.seo_title || post.title, 58)");
    expect(generator).not.toContain("truncate(`${label} - 3 Stripe Motorsport nieuws`, 58)");
    expect(generator).not.toContain("h1: post.title,");
  });

  it("laat llms.txt, RSS en JSON-LD de helper-kop gebruiken", () => {
    // llms.txt en feed.xml halen hun label via displayTitle uit route.h1 (de korte
    // kopregel); de BlogPosting-kop en de hub-ItemList komen uit dezelfde helper.
    expect(generator).toContain("const displayTitle = (route, fallback) => cleanText(route?.anchorLabel || route?.h1 || route?.title)");
    expect(generator).toContain("data: buildArticleBlogPostingJsonLd(post, articleHeadline)");
    expect(generator).toContain("headline: post.pageTitle || post.headline || post.title,");
  });

  it("laat de SPA dezelfde titel en dezelfde kopregel bouwen als de crawler-HTML", () => {
    expect(detailPage).toContain('from "@/lib/seoTitle.mjs"');
    expect(detailPage).toContain("buildNewsArticleTitle({");
    expect(detailPage).toContain("buildNewsArticleH1({");
    expect(detailPage).toContain("{articleHeadline}");
    expect(detailPage).not.toContain("post.seo_title || `${post.title} - 3 Stripe Motorsport`");

    expect(newsPage).toContain('from "@/lib/seoTitle.mjs"');
    expect(newsPage).toContain("buildNewsCategoryTitle({ category: activeCategoryInfo.label })");
    expect(newsPage).toContain("buildNewsHubTitle()");
    expect(newsPage).not.toContain("`${activeCategoryInfo.label} - Nieuws - 3 Stripe Motorsport`");
  });

  it("meet de nieuwstitels na in het meetrapport", () => {
    const report = readFileSync("scripts/measure-result-titles.mjs", "utf8");
    expect(report).toContain("news-title-inputs.json");
    expect(report).toContain("assignUniqueNewsArticleTitles");
    expect(report).toContain("buildNewsCategoryTitle");
    expect(report).toContain("buildNewsHubTitle");
    expect(report).toContain("PIXELBREEDTE IN 20px — nieuws");
  });
});
