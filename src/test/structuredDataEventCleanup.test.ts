import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(join(projectRoot, relativePath), "utf8");
}

describe("structured data event cleanup", () => {
  it("does not inject Google Event/SportsEvent markup for online iRacing result pages", () => {
    const sources = [
      readSource("src/pages/ResultsPage.tsx"),
      readSource("src/pages/RaceDetailPage.tsx"),
    ].join("\n");

    expect(sources).not.toContain("SportsEvent");
    expect(sources).not.toContain("eventStatus");
    expect(sources).not.toContain("VirtualLocation");
  });

  it("keeps result archive structured data focused on result web pages and 3SM as a sports organization", () => {
    const resultsPage = readSource("src/pages/ResultsPage.tsx");

    expect(resultsPage).toContain('"@type": "ItemList"');
    expect(resultsPage).toContain('"@type": "WebPage"');
    expect(resultsPage).toContain('"@type": "SportsOrganization"');
    expect(resultsPage).toContain('sport: "Sim racing"');
    expect(resultsPage).toContain('name: language === "en" ? "3 Stripe Motorsport race results"');
    expect(resultsPage).toContain('inLanguage: language === "en" ? "en" : "nl"');
    expect(resultsPage).toContain("[language, races, winners]");
  });

  it("generates explicit named breadcrumb WebPage items for crawler HTML", () => {
    const generator = readSource("scripts/generate-route-html.mjs");

    expect(generator).toContain("const breadcrumbItem = (position, name, path) => ({");
    expect(generator).toContain("'@type': 'WebPage'");
    expect(generator).toContain("'@id': absoluteUrl(path)");
    expect(generator).toContain("url: absoluteUrl(path)");
    expect(generator).toContain("name,");
    expect(generator).toContain("breadcrumbItem(2, 'Race-uitslagen', '/results')");
    expect(generator).toContain("breadcrumbItem(2, 'Nieuws', '/news')");
  });

  it("generates crawler-visible real results hub content and ItemList JSON-LD from completed race data", () => {
    const generator = readSource("scripts/generate-route-html.mjs");

    expect(generator).toContain("buildResultsHubCrawlerHtml");
    expect(generator).toContain("Laatste race-uitslag");
    expect(generator).toContain("Race archief");
    expect(generator).toContain("buildResultsHubItemListJsonLd");
    expect(generator).toContain("results-itemlist-jsonld");
    expect(generator).toContain("resultsRoute.crawlerHtml = buildResultsHubCrawlerHtml(resultsHubSummaries)");
  });
});
