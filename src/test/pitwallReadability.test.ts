import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Regressiecontract voor de leesbaarheidslaag van de premium Pitwall.
 *
 * Aanleiding: op een 2560×1440-monitor stonden labels, metadata en tabelcellen
 * op 6,5–10 px en haalde de gedempte kleur 4,0:1. De focusweergave loste dat op
 * door nog kleiner te typen. Deze test bewaakt de ondergrens en de
 * layoutkeuzes die daarbij horen: vaste minimummaten en scrollen, niet krimpen.
 *
 * jsdom rekent geen layout; de echte meting staat in
 * `scripts/pitwall-readability-browser.mjs` en het rapport daarvan.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const readability = read("src/features/endurance/pitwall/test-premium/pitwallReadability.css");
const view = read("src/features/endurance/pitwall/test-premium/PitwallPremiumView.tsx");

const luminance = (hex: string) => {
  const n = hex.replace("#", "");
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(Number.parseInt(n.slice(0, 2), 16)) +
    0.7152 * channel(Number.parseInt(n.slice(2, 4), 16)) +
    0.0722 * channel(Number.parseInt(n.slice(4, 6), 16));
};
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

describe("premium pitwall leesbaarheid", () => {
  it("laadt de leesbaarheidslaag na de bestaande premium- en focuslaag", () => {
    const focus = view.indexOf('import "./premiumFocus.css"');
    const layer = view.indexOf('import "./pitwallReadability.css"');
    expect(focus).toBeGreaterThan(-1);
    expect(layer).toBeGreaterThan(focus);
  });

  it("zet geen tekst meer onder 14 px in de leesbaarheidslaag", () => {
    const sizes = [...readability.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThan(40);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
  });

  it("houdt de sleutellabels op 15 px en de coureursnaam op 15,5 px", () => {
    expect(readability).toMatch(/--ptp-read-label:\s*14px/);
    expect(readability).toMatch(/--ptp-read-key:\s*15px/);
    expect(readability).toMatch(/\.ptp-timing-table thead th[^}]*font-size:\s*15px/);
    expect(readability).toMatch(/\.ptp-pit\s*\{[^}]*font-size:\s*14px/);
    expect(readability).toMatch(/\.ptp-col-sector\s*\{[^}]*font-size:\s*14px/);
    // Coureursnamen waren al leesbaar en blijven precies even groot.
    expect(readability).toMatch(/\.ptp-driver-name\s*\{[^}]*font-size:\s*15\.5px/);
  });

  it("geeft brandstof, banden en kaartnotities dezelfde 14–15 px-ondergrens", () => {
    expect(readability).toMatch(/\[data-pitwall-slot="fuel"\] p\.text-\\\[12px\\\][^}]*font-size:\s*15px/);
    expect(readability).toMatch(/\[data-pitwall-tyre-corner\] > p:first-child[^}]*font-size:\s*15px/);
    expect(readability).toMatch(/:is\(\.text-\\\[8px\\\], \.text-\\\[9px\\\][^}]*font-size:\s*14px/);
  });

  it("geeft de bredere timingkolommen en 1280-KPI's een eigen layout", () => {
    expect(readability).toMatch(/col\.ptp-col-driver\s*\{\s*width:\s*200px/);
    expect(readability).toMatch(/col\.ptp-col-gap\s*\{\s*width:\s*106px/);
    expect(readability).toMatch(/@media \(min-width: 1081px\) and \(max-width: 1399px\)[\s\S]*?grid-template-columns:\s*minmax\(0, 4fr\) minmax\(0, 6fr\) minmax\(0, 8fr\)/);
  });

  it("houdt de gedempte kleuren boven 4,5:1 op de donkerste panelen", () => {
    for (const token of ["#9aa9b8", "#8b9bad", "#7c8b9b"]) {
      expect(contrast(token, "#0d1218")).toBeGreaterThanOrEqual(4.5);
      // De eigen-rij van de timing heeft een warme, iets lichtere bodem.
      expect(contrast(token, "#24170e")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("geeft de focusrij een minimum in plaats van een vaste krimpende hoogte", () => {
    expect(readability).toMatch(/grid-template-rows:[^;]*minmax\(310px, 1fr\)[^;]*minmax\(300px, 22dvh\)/);
    expect(readability).toMatch(/min-height:\s*300px/);
    expect(readability).toMatch(/grid-auto-rows:\s*minmax\(0, 1fr\)/);
  });

  it("laat de vijf panelen op een smalle focusviewport naar drie kolommen wikkelen", () => {
    expect(readability).toMatch(/@media \(max-width: 1400px\)[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    // Op een breed maar laag scherm blijven beeld en panelen alleen naast
    // elkaar staan als er echt ruimte is; 1280–1400 px stapelt.
    expect(readability).toMatch(/max-height: 900px\) and \(min-width: 1100px\) and \(max-width: 1499px\)/);
  });

  it("geeft de gedeelde meekijkstand vier gelijke panelen zonder lege vijfde kolom", () => {
    expect(view).toContain("data-ptp-panel-count={readOnly ? 4 : 5}");
    expect(readability).toMatch(/\[data-ptp-panel-count="4"\]\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  });

  it("kapt de eigen coureursnaam niet meer af en laat de metarij op inhoud passen", () => {
    expect(readability).toMatch(/\[data-pitwall-slot="own-car"\] > p\.truncate\s*\{[^}]*white-space:\s*normal/);
    expect(readability).toMatch(/\.ptp-meta dd\s*\{[^}]*max-width:\s*280px/);
  });

  it("houdt de paneelrij hoog genoeg voor 14–15 px-kaarttekst", () => {
    expect(readability).toMatch(/grid-auto-rows:\s*minmax\(320px, auto\)/);
  });

  it("houdt de deelstrook in focus bereikbaar maar compact", () => {
    const personal = read("src/pages/PersonalPitwallPage.tsx");
    // Bestaand contract: de deelbediening blijft ook in focus in dezelfde boom.
    expect(personal).toMatch(/<ShareBar/);
    expect(readability).toMatch(/\.pp-share \.pp-share-state\s*\{[^}]*font-size:\s*14px/);
    expect(readability).toMatch(/\.pp-share \.pp-share-primary:disabled\s*\{[^}]*color:\s*#f4e7db/);
    // Focus: één bedieningsregel, kop en knop blijven zichtbaar.
    expect(readability).toMatch(/\[data-ptp-focus="true"\]\[data-pitwall-personal\] \.pp-share\s*\{[^}]*display:\s*flex/);
  });
});
