import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regressiecontract voor de focusweergave op korte schermen.
 *
 * Aanleiding: op 1280×720 (de capture was 2558×1439, dus 2× DPR) kromp de
 * panelenrij naar 0 px omdat het vaste focusraster meer minimumhoogte nodig had
 * dan het viewport bood. De vijf panelen (pace, fuel, banden, pitstop, mijn
 * sessie) verdwenen daardoor volledig. Daarnaast rekte de timingstabel het
 * scrollgebied van de shell op en stond een gesloten "Meer analyse" toch open.
 *
 * jsdom rekent geen layout, dus dit test de CSS-invarianten die die drie
 * defecten veroorzaakten. De echte meting gebeurt in de browsercontrole.
 */
const focusCss = readFileSync(
  resolve(process.cwd(), "src/features/endurance/pitwall/test-premium/premiumFocus.css"),
  "utf8",
);
const premiumCss = readFileSync(
  resolve(process.cwd(), "src/features/endurance/pitwall/test-premium/testPremium.css"),
  "utf8",
);

describe("pitwall focusweergave past op korte schermen", () => {
  it("legt de timingrij niet meer vast in een clamp die naar 168px kan krimpen", () => {
    expect(focusCss).not.toContain("clamp(168px, 21dvh, 240px)");
    expect(focusCss).toMatch(/grid-template-rows:[^;]*minmax\(170px, 0\.8fr\)[^;]*minmax\(260px, 1\.2fr\)/);
  });

  it("geeft korte viewports een raster dat met de inhoud meegroeit", () => {
    const short = focusCss.slice(focusCss.indexOf("@media (max-height: 900px)"));
    expect(short).not.toBe("");
    expect(short).toMatch(/\.ptp-root\s*{[^}]*height:\s*auto/);
    expect(short).toMatch(/grid-template-rows:[^;]*minmax\(210px, auto\)[^;]*minmax\(220px, auto\)/);
    expect(short).toMatch(/\.ptp-panels\s*{[^}]*height:\s*210px/);
  });

  it("houdt de overflow van de timingstabel binnen het paneel", () => {
    expect(focusCss).toMatch(/\[data-ptp-focus="true"\] \.ptp-timing\s*{[^}]*contain:\s*paint/);
  });

  it("toont de inhoud van een gesloten Meer-analyse niet", () => {
    expect(premiumCss).toMatch(
      /\.ptp-more:not\(\[open\]\) > \.ptp-more-body\s*{[^}]*display:\s*none/,
    );
  });
});
