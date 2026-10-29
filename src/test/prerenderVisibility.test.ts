import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contract voor de geprerenderde route-HTML: precies één kopie van de crawlertekst,
 * en die staat in de zichtbare documentstroom binnen #root.
 *
 * Aanleiding: de generator zette dezelfde inhoud twee keer in het document — één keer
 * in een <noscript> en één keer in een inert/aria-hidden div met de clip-truc — terwijl
 * #root leeg bleef. Crawlers die <noscript> strippen (GPTBot, ClaudeBot,
 * PerplexityBot) zagen daardoor vrijwel niets van de pagina. De inhoud staat nu één
 * keer in #root; de SPA mount met createRoot, dat de container bij de eerste render
 * leegmaakt (geen dubbele weergave, geen hydration-warning).
 *
 * De generator is een script en geen module, dus deze test bewaakt de opbouw in de
 * bron. De echte HTML wordt bij de build gecontroleerd (dist/<route>/index.html).
 */
const generator = readFileSync("scripts/generate-route-html.mjs", "utf8");
const mainTsx = readFileSync("src/main.tsx", "utf8");

describe("prerender — één zichtbare kopie van de crawlertekst", () => {
  it("zet de crawlerinhoud in #root in plaats van ernaast", () => {
    // De markers staan BINNEN #root: een tweede generatorrun stript de oude inhoud en
    // houdt exact <div id="root"></div> over.
    expect(generator).toContain('const routeSeoBlock = `<div id="root">${routeSeoStart}');
    expect(generator).toContain("out.replace(emptyRootPattern, () => routeSeoBlock)");
    expect(generator).toContain("const emptyRootPattern = /<div id=\"root\">\\s*<\\/div>/;");
    expect(generator).toContain("<main data-3sm-prerender>");
  });

  it("laat de verborgen tweede kopie niet terugkomen", () => {
    // Geen noscript-blok en geen sr-only container meer: die twee samen waren de
    // dubbele, onzichtbare kopie. (De legacyRouteSeoStyle-constante blijft staan om
    // oude builds op te ruimen; die wordt niet meer in nieuwe HTML gezet.)
    expect(generator).not.toContain("const noscript = `<noscript>");
    expect(generator).not.toContain("${noscript}");
    expect(generator).not.toContain("<div inert");
    expect(generator).not.toContain('inert aria-hidden="true"');
  });

  it("houdt de crawlerinhoud compleet: h1, intro, links en crawlerlinks", () => {
    expect(generator).toContain("<h1>${escapeHtml(route.h1)}</h1>");
    expect(generator).toContain("<p>${escapeHtml(route.intro)}</p>");
    expect(generator).toContain('aria-label="Belangrijke 3SM links"');
    expect(generator).toContain("${prerenderCrawlerLinks}");
  });

  it("blijft alleen veilig zolang de SPA met createRoot mount", () => {
    // createRoot ruimt de gevulde container op. hydrateRoot zou een exacte match van
    // de markup eisen; in dat geval moet de prerendertekst naar een eigen, zichtbare
    // container naast #root — niet meer in #root zelf.
    expect(mainTsx).toContain("createRoot");
    expect(mainTsx).not.toContain("hydrateRoot");
  });
});
