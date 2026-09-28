import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(join(projectRoot, relativePath), "utf8");
}

const ORGANIZATION_ID = "https://3stripemotorsport.cc/#organisatie";

const PROFILE_URLS = [
  "https://discord.gg/H7tZVuzBgT",
  "https://www.instagram.com/3stripemotorsport",
  "https://www.facebook.com/people/3-Stripe-Motorsport/61589158685020/",
];

/** Leest de sameAs-lijst uit een bronbestand, ongeacht of die JSON of JS-notatie is. */
function sameAsUrls(source: string): string[] {
  const block = source.match(/sameAs["']?\s*:\s*\[([\s\S]*?)\]/);
  if (!block) return [];
  return (block[1].match(/https?:\/\/[^"',\s]+/g) || []).map((url) => url.replace(/\/$/, ""));
}

/**
 * De organisatie (3SM) moet overal als één entiteit beschreven staan: hetzelfde
 * @id, dezelfde naam, dezelfde profielen (sameAs) en hetzelfde stichtingsjaar.
 * Zonder die eenheid ziet Google losse, tegenstrijdige beschrijvingen van 3SM en
 * heeft het geen bron om een vermelding aan te koppelen.
 */
describe("site identity structured data", () => {
  const html = readSource("index.html");
  const prerender = readSource("scripts/generate-route-html.mjs");
  const seoLib = readSource("src/lib/seo.ts");

  it("defines the organization with the same @id on every surface", () => {
    for (const source of [html, prerender, seoLib]) {
      expect(source).toContain("SportsOrganization");
    }

    // index.html en de client-side helper houden de letterlijke URL; de
    // prerender bouwt hem op uit SITE_URL.
    expect(html).toContain(ORGANIZATION_ID);
    expect(seoLib).toContain(ORGANIZATION_ID);
    expect(prerender).toContain("const ORGANIZATION_ID = `${SITE_URL}/#organisatie`");
    expect(prerender).toContain("@id': ORGANIZATION_ID");
  });

  it("lists exactly the three official profiles in sameAs", () => {
    for (const [name, source] of Object.entries({ html, prerender, seoLib })) {
      const urls = sameAsUrls(source);
      expect(urls, `${name} sameAs`).toEqual(
        expect.arrayContaining(PROFILE_URLS.map((url) => url.replace(/\/$/, ""))),
      );
      expect(urls, `${name} sameAs mag geen andere profielen bevatten`).toHaveLength(PROFILE_URLS.length);
    }
  });

  it("keeps the founding year, area and organisation description consistent", () => {
    for (const [name, source] of Object.entries({ html, prerender, seoLib })) {
      expect(source, name).toMatch(/foundingDate["']?\s*[:=]\s*['"]2026['"]/);
      expect(source, name).toContain("Nederlandse iRacing league en community");
      expect(source, name).toContain("Nederland");
    }
  });

  it("reuses the shared organization node instead of new bare copies", () => {
    // Vijf plekken in de prerender: webpage-about, webpage-publisher,
    // website-publisher en de twee organizers (kalender en uitslagen).
    const usages = prerender.split("organizationJsonLd()").length - 1;
    expect(usages).toBeGreaterThanOrEqual(5);
    expect(prerender).not.toContain("sport: 'Sim racing',\n        url: SITE_URL,");
    expect(readSource("src/pages/ResultsPage.tsx")).toContain("siteOrganizationJsonLd(siteUrl)");
  });
});
