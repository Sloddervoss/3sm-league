import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  DESCRIPTION_PROMISE_MAX,
  TITLE_HARD_MAX,
  TITLE_TARGET_MAX,
  buildRaceResultDescription,
  buildRaceResultTitle,
  buildRankedTitle,
  formatDateNl,
  truncate,
} from "@/lib/seoTitle.mjs";

/**
 * Regressietests op de crawler-facing titels en omschrijvingen van de
 * uitslagpagina's, plus de tabtitel in de SPA.
 *
 * Aanleiding (gemeten op de live site, 15 oktober):
 *   - 'Uitslag Race 3 · 7 oktober 2026 · Daytona International…' en
 *     '… · Circuit de…', '… · Tsukuba Circuit - 2000 -…': de afkapfunctie brak de
 *     circuitnaam af tot een nietszeggend stuk en liet losse streepjes staan. Van
 *     de 43 gegenereerde uitslagroutes verloren er 31 de volledige circuitnaam.
 *   - '…klasseringen, rondes,…' en 'Bekijk de … op Okayam…' in de omschrijvingen.
 *   - ISO-datums ('op 2026-10-01') in plaats van woorden.
 *
 * De reparatie: titels worden uit gerangschikte delen opgebouwd en er vallen
 * HELE delen van achteren af; er wordt nooit binnen een deel geknipt.
 */

// De echte, gemeten teksten van de live site.
const LIVE_TITLE = "Uitslag Race 3 · 7 oktober 2026 · Circuit de Spa-Francorchamps - Grand Prix · GT3";
const LIVE_NEWS_TITLE = "Jaimy Peters pakt de overwinning na spectaculaire inhaalrace op Okayama International Circuit";
const LIVE_DESCRIPTION =
  "Bekijk de GT3 iRacing race-uitslag van Race 3 op Okayama International Circuit op 2026-10-01: klasseringen, rondes, podium en racegegevens van 3SM.";

// Een afkap is fout als er midden in een woord is geknipt: dan staan er aan
// beide kanten van de knip woordtekens. Knippen vóór een dubbele punt of streepje
// is wel goed (daar eindigt een woord netjes).
const endsInTheMiddleOfAWord = (input: string, output: string) => {
  if (!output.endsWith("…")) return false;
  const kept = output.slice(0, -1);
  if (!input.startsWith(kept)) return true;
  const next = input[kept.length] ?? "";
  const last = kept[kept.length - 1] ?? "";
  return /[A-Za-z0-9]/.test(next) && /[A-Za-z0-9]/.test(last);
};

describe("seoTitle — afkappen op woordgrens", () => {
  it("kapt nooit midden in een woord af, bij geen enkele grens", () => {
    for (const input of [LIVE_TITLE, LIVE_NEWS_TITLE, LIVE_DESCRIPTION]) {
      for (let max = 12; max <= 200; max += 1) {
        const output = truncate(input, max);
        expect(endsInTheMiddleOfAWord(input, output), `max=${max} gaf "${output}"`).toBe(false);
      }
    }
  });

  it("eindigt nooit op een scheidingsteken en zet geen beletselteken als er niets is weggelaten", () => {
    for (const input of [LIVE_TITLE, LIVE_NEWS_TITLE, LIVE_DESCRIPTION]) {
      for (let max = 12; max <= 200; max += 1) {
        const output = truncate(input, max);
        expect(output, `max=${max}`).not.toMatch(/[\s·|,;:/\-–—]…$/u);
        expect(output.startsWith("…")).toBe(false);
        if (input.length <= max) {
          // Niets weggelaten: dan ook geen beletselteken.
          expect(output).toBe(input);
        } else {
          expect(output.endsWith("…")).toBe(true);
          expect(output.length).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it("laat de circuitnaam niet als 'Circuit de…' of '… -…' staan", () => {
    // De oude functie liet hier 'Circuit de Spa-Francorchamps -…' achter: het
    // halve woord ('Gra') werd weggehaald, maar het streepje ervoor bleef als
    // laatste teken staan. De knip hoort op het laatste hele woord te vallen,
    // zonder los scheidingsteken erachter.
    const output = truncate(LIVE_TITLE, 70);
    expect(output).toBe("Uitslag Race 3 · 7 oktober 2026 · Circuit de Spa-Francorchamps…");
    expect(output).not.toMatch(/[-–—·|]\s*…$/u);
    expect(output.endsWith("…")).toBe(true);
    expect(LIVE_TITLE.startsWith(output.slice(0, -1))).toBe(true);
    // Het volgende teken in de oorspronkelijke tekst is een spatie: hele woorden.
    expect(LIVE_TITLE[output.length - 1]).toBe(" ");
  });

  it("laat het eerste woord heel als het niet binnen de ruimte past", () => {
    const input = "Superlangewoordenreekszonderenigespaciediemetopzetgebeurd en nog meer tekst";
    const output = truncate(input, 20);
    expect(endsInTheMiddleOfAWord(input, output)).toBe(false);
    expect(output).toBe("Superlangewoordenreekszonderenigespaciediemetopzetgebeurd…");
  });

  it("laat één lang woord zonder spaties ongemoeid in plaats van het te halveren", () => {
    const input = "Superlangewoordenreekszonderenigespaciediemetopzetgebeurd";
    expect(truncate(input, 20)).toBe(input);
  });
});

describe("seoTitle — titel uit gerangschikte delen", () => {
  it("bouwt de voorbeeldtitel uit het besluit: race · circuit · klasse · datum", () => {
    const title = buildRaceResultTitle({
      raceName: "Race 3",
      circuit: "Daytona International Speedway",
      carClass: "GT3",
      date: "2026-10-07T19:00:00+00:00",
    });

    expect(title).toBe("Uitslag Race 3 · Daytona International Speedway · GT3 · 7 okt 2026");
    expect(title).not.toContain("…");
  });

  it("laat de datum vallen zodra de titel te lang wordt, en daarna de klasse — nooit het circuit", () => {
    const circuit = "Circuit de Spa-Francorchamps - Grand Prix";
    const parts = ["Uitslag Race 3", circuit, "GT3", "7 okt 2026"];

    const withDate = buildRankedTitle(parts);
    const totalLength = parts.join(" · ").length;
    expect(totalLength).toBeGreaterThan(TITLE_HARD_MAX);
    // De datum is het eerste dat sneuvelt; het circuit en de klasse blijven staan.
    expect(withDate).toBe(`Uitslag Race 3 · ${circuit} · GT3`);
    expect(withDate).not.toContain("7 okt 2026");
    expect(withDate).toContain(circuit);
    expect(withDate.length).toBeLessThanOrEqual(TITLE_HARD_MAX);

    const veryLongCircuit = "Circuit de Spa-Francorchamps - Grand Prix - Endurance Layout";
    const squeezed = buildRankedTitle(["Uitslag Race 3", veryLongCircuit, "GT3", "7 okt 2026"]);
    // Nu valt ook de klasse af, maar het circuit blijft — heel.
    expect(squeezed).toBe(`Uitslag Race 3 · ${veryLongCircuit}`);
  });

  it("neemt alleen hele delen over, nooit een stukje van een deel", () => {
    const circuit = "Okayama International Circuit - Full Course";
    const parts = ["Uitslag Race 3", circuit, "LMP2", "1 okt 2026"];
    const title = buildRankedTitle(parts);

    expect(title).not.toContain("…");
    for (const part of title.split(" · ")) {
      expect(parts).toContain(part);
    }
    expect(title.endsWith("·")).toBe(false);
  });

  it("stopt het circuit niet achter de streeflengte weg en laat het merk als eerste vallen", () => {
    const short = buildRankedTitle(["Uitslag Race 1", "Spa", "GT3"], { brand: "3SM" });
    expect(short).toBe("Uitslag Race 1 · Spa · GT3 | 3SM");
    expect(short.length).toBeLessThanOrEqual(TITLE_TARGET_MAX);

    const long = buildRankedTitle(
      ["Uitslag Race 3", "Daytona International Speedway", "GT3", "7 okt 2026"],
      { brand: "3SM" },
    );
    // Het merk past niet meer binnen de streefband en sneuvelt; het circuit blijft.
    expect(long).toBe("Uitslag Race 3 · Daytona International Speedway · GT3 · 7 okt 2026");
    expect(long).not.toContain("| 3SM");
  });
});

describe("seoTitle — datums in woorden", () => {
  it("schrijft de datum in Nederlandse woorden, nooit als ISO", () => {
    expect(formatDateNl("2026-10-07T19:00:00+00:00")).toBe("7 okt 2026");
    expect(formatDateNl("2026-10-01")).toBe("1 okt 2026");
    expect(formatDateNl("2026-03-08T09:30:00Z")).toBe("8 mrt 2026");
    expect(formatDateNl("2026-05-21", { style: "long" })).toBe("21 mei 2026");
    expect(formatDateNl("2026-10-07", { style: "long" })).toBe("7 oktober 2026");
    expect(formatDateNl("geen datum")).toBeNull();
    expect(formatDateNl(null)).toBeNull();
  });

  it("geeft titel en omschrijving nooit een ISO-datum mee", () => {
    const race = {
      raceName: "Race 3",
      circuit: "Okayama International Circuit",
      carClass: "LMP2",
      leagueName: "GT3 Endurance Seizoen 2026",
      date: "2026-10-01T19:00:00+00:00",
    };

    expect(buildRaceResultTitle(race)).toBe("Uitslag Race 3 · Okayama International Circuit · LMP2 · 1 okt 2026");
    expect(buildRaceResultTitle(race)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(buildRaceResultDescription(race)).toContain("1 okt 2026");
    expect(buildRaceResultDescription(race)).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    // Ook wanneer de datum moet wijken (lang circuit) komt er geen ISO-datum
    // voor in de plaats: de titel laat de datum dan gewoon weg.
    const longCircuit = { ...race, circuit: "Okayama International Circuit - Full Course" };
    expect(buildRaceResultTitle(longCircuit)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(buildRaceResultTitle(longCircuit)).toBe("Uitslag Race 3 · Okayama International Circuit - Full Course · LMP2");
  });
});

describe("seoTitle — twee races op hetzelfde circuit blijven te onderscheiden", () => {
  const base = { raceName: "Race 3", carClass: "GT3", date: "2026-10-07T19:00:00+00:00" };

  it("onderscheidt twee Daytona-races met een andere circuitvariant (het oude afkapprobleem)", () => {
    const roadCourse = buildRaceResultTitle({ ...base, circuit: "Daytona International Speedway - Road Course" });
    const oval = buildRaceResultTitle({ ...base, circuit: "Daytona International Speedway - Oval" });

    expect(roadCourse).not.toBe(oval);
    // De variant is precies het deel dat vroeger werd afgeknipt.
    expect(roadCourse).toContain("Daytona International Speedway - Road Course");
    expect(oval).toContain("Daytona International Speedway - Oval");
    expect(roadCourse).not.toContain("…");
    expect(oval).not.toContain("…");
  });

  it("onderscheidt twee races op hetzelfde circuit met een andere datum", () => {
    const first = buildRaceResultTitle({
      ...base, circuit: "Daytona International Speedway", date: "2026-10-07T19:00:00+00:00",
    });
    const second = buildRaceResultTitle({
      ...base, circuit: "Daytona International Speedway", date: "2026-10-14T19:00:00+00:00",
    });

    // Twee races op Daytona, allebei 'Race 3' in GT3: het racenummer, de klasse
    // én het circuit zijn gelijk, dus de datum moet het verschil maken.
    expect(first).not.toBe(second);
    expect(first).toContain("7 okt 2026");
    expect(second).toContain("14 okt 2026");
  });
});

describe("seoTitle — omschrijving van een uitslagpagina", () => {
  it("is 150-160 tekens met een belofte die vooraan op zichzelf staat", () => {
    const description = buildRaceResultDescription({
      raceName: "Race 3",
      circuit: "Daytona International Speedway",
      carClass: "GT3",
      leagueName: "3SM GT3 Sprint Seizoen 2026",
      date: "2026-10-07T19:00:00+00:00",
    });

    expect(description.length).toBeGreaterThanOrEqual(150);
    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    // De eerste zin is de belofte; die moet binnen ~70 tekens compleet zijn.
    const firstSentenceEnd = description.indexOf(". ") + 1;
    expect(firstSentenceEnd).toBeGreaterThan(0);
    expect(firstSentenceEnd).toBeLessThanOrEqual(DESCRIPTION_PROMISE_MAX);
    expect(description.startsWith("Bekijk de race-uitslag van Race 3 op Daytona International Speedway.")).toBe(true);
    expect(description.endsWith(".")).toBe(true);
    expect(description).not.toContain("…");
  });

  it("blijft onder de bovengrens en knipt ook dan niet midden in een woord", () => {
    const description = buildRaceResultDescription({
      raceName: "Race 3",
      circuit: "Circuit de Spa-Francorchamps - Grand Prix - Endurance Layout Met Een Zeer Lange Naam",
      carClass: "LMP2 GTP",
      leagueName: "Endurance Kampioenschap Seizoen 2026",
      date: "2026-10-07T19:00:00+00:00",
    });

    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(endsInTheMiddleOfAWord(description, description)).toBe(false);
    expect(description).not.toMatch(/[\s·|,;:/\-–—]…$/u);
  });

  it("valt voor elke echte racevorm binnen 150-160 tekens", () => {
    // Namen uit de werkelijk gegenereerde uitslagpagina's: van kort (Hungaroring)
    // tot lang (Spa-Francorchamps - Grand Prix Pits, Nürburgring Nordschleife).
    const races = [
      { raceName: "Race 1", circuit: "Hungaroring", carClass: "GT3", leagueName: "GT Master Challenge Cup", date: "2026-09-09T18:30:00+00:00" },
      { raceName: "Race 2", circuit: "Okayama International Circuit - Full Course", carClass: "GT3", leagueName: "GT Master Challenge Cup", date: "2026-04-15T18:30:00+00:00" },
      { raceName: "Saturday fun day race 1", circuit: "Circuit de Spa-Francorchamps - Grand Prix Pits", carClass: null, leagueName: null, date: "2026-03-21T20:00:00+00:00" },
      { raceName: "Green Hell", circuit: "Nürburgring Nordschleife - Industriefahrten", carClass: null, leagueName: "3SM GT3 Free Track Challenge", date: "2026-06-04T19:00:00+00:00" },
      { raceName: "Zandvoort", circuit: "Circuit Park Zandvoort", carClass: null, leagueName: null, date: "2026-06-21T19:00:00+00:00" },
      { raceName: "Race 12", circuit: "Circuit de Spa-Francorchamps - Grand Prix Pits", carClass: "GT3", leagueName: "GT Master Challenge Cup", date: "2026-09-02T19:00:00+00:00" },
    ];

    for (const race of races) {
      const description = buildRaceResultDescription(race);
      expect(description.length, description).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
      expect(description.length, description).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(description.endsWith(".")).toBe(true);
      expect(description).not.toContain("…");
      expect(description).not.toMatch(/[\s·|,;:/\-–—]$/u);
      expect(description.startsWith("Bekijk de race-uitslag van")).toBe(true);
    }
  });

  it("geeft geen zin zonder de uitslagpagina zelf", () => {
    // De omschrijving belooft alleen wat de pagina ook toont: klasseringen,
    // rondes, punten, podium en de snelste ronden.
    const description = buildRaceResultDescription({
      raceName: "Race 3",
      circuit: "Daytona International Speedway",
      carClass: "GT3",
      leagueName: "3SM GT3 Sprint Seizoen 2026",
      date: "2026-10-07T19:00:00+00:00",
    });

    expect(description).toMatch(/klasseringen|rondes|podium/);
    expect(description).not.toMatch(/koop|korting|nieuwsbrief/i);
  });
});

describe("seoTitle — dezelfde helper in de crawler-HTML en in de SPA", () => {
  it("laat de generator en de detailpagina de gedeelde helper gebruiken", () => {
    const generator = readFileSync("scripts/generate-route-html.mjs", "utf8");
    const detailPage = readFileSync("src/pages/RaceDetailPage.tsx", "utf8");

    expect(generator).toContain("from '../src/lib/seoTitle.mjs'");
    expect(generator).toContain("buildRaceResultTitle({");
    expect(generator).toContain("buildRaceResultDescription({");
    // De oude, eigen afkapfunctie mag niet terugkomen.
    expect(generator).not.toContain("slice(0, max - 1)");

    expect(detailPage).toContain('from "@/lib/seoTitle.mjs"');
    expect(detailPage).toContain("buildRaceResultTitle({");
    // De oude, afwijkende tabtitel mag niet terugkomen.
    expect(detailPage).not.toContain("${race.name} uitslag - 3 Stripe Motorsport");
  });
});
