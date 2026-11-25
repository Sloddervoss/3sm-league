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
  it("geeft de vrije hoogte aan het wedstrijdbeeld in plaats van aan een lege pitbenchmark", () => {
    expect(focusCss).not.toContain("clamp(168px, 21dvh, 240px)");
    // De benchmarkrij groeit met de inhoud en het wedstrijdbeeld vult de rest.
    expect(focusCss).toMatch(
      /grid-template-rows:\s*auto auto auto auto minmax\(0, 1fr\) clamp\(150px, 18dvh, 210px\) auto/,
    );
    // Een lege benchmarkhouder (geen gemeten stop) bezet geen rijhoogte.
    expect(focusCss).toMatch(/\.ptp-pit-benchmark:empty\s*{[^}]*display:\s*none/);
  });

  it("zet op lage brede schermen de panelen naast het wedstrijdbeeld in plaats van eronder", () => {
    const start = focusCss.indexOf("@media (max-height: 900px) and (min-width: 1100px)");
    expect(start).toBeGreaterThan(-1);
    const short = focusCss.slice(start);
    expect(short).toMatch(/grid-template-areas:[^;]*"bench panels"[^;]*"main panels"/);
    expect(short).toMatch(/\.ptp-panels\s*{[^}]*height:\s*auto/);
    // Mobiel houdt de gestapelde compositie; de compacte variant mag daar niet gelden.
    expect(short).not.toMatch(/@media \(max-height: 900px\)\s*{/);
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
