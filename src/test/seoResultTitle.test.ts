import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  DESCRIPTION_PROMISE_MAX,
  TITLE_BRAND_MAX,
  TITLE_MAX,
  assignUniqueRaceResultTitles,
  buildRaceResultDescription,
  buildRaceResultTitle,
  raceResultTitleCandidates,
  formatDateNl,
  splitCircuit,
  titleish,
  truncate,
} from "@/lib/seoTitle.mjs";

/**
 * Regressietests op de crawler-facing titels en omschrijvingen van de
 * uitslagpagina's, plus de tabtitel in de SPA.
 *
 * Aanleiding (15 oktober 2026): de uitslagtitels waren veel te lang. Gemeten over de
 * 44 echt gegenereerde uitslagroutes: gemiddeld 63,8 tekens en maximaal 80 tekens.
 * Google kapt de titellink in de SERP af op PIXELBREEDTE, niet op tekens: niets boven
 * 577px werd ooit volledig getoond en boven 600px werd nooit iets getoond zoals het
 * er stond. In 20px Arial-metrics (de corpsgrootte van de titellink) was de titel van
 * 'Saturday fun day race 1' op Spa 802px.
 *
 * De reparatie: harde grens van TITLE_MAX tekens, gerangschikte delen (racenaam,
 * circuit, datum, klasse, merk) en een titel die per set uniek wordt toegewezen.
 * De echte invoer van alle 44 routes staat in
 * src/test/fixtures/result-title-inputs.json (overgenomen uit de SportsEvent-JSON-LD
 * en de h1 van dist/results/<id>/index.html). scripts/measure-result-titles.mjs meet
 * dezelfde invoer in pixels na.
 */

type RaceTitleInput = {
  id: string;
  raceName: string;
  circuit: string;
  carClass: string | null;
  date: string;
};

const realRaces = JSON.parse(
  readFileSync("src/test/fixtures/result-title-inputs.json", "utf8"),
) as RaceTitleInput[];

const titleFor = (race: RaceTitleInput) => buildRaceResultTitle({
  raceName: race.raceName,
  circuit: race.circuit,
  carClass: race.carClass,
  date: race.date,
});

// Zoeken op naam én circuit: 'Race 1' en 'daytona' komen in de echte set meer dan
// eens voor, dus een naam alleen is geen eenduidige sleutel.
const findRace = (raceName: string, circuit: string) => {
  const race = realRaces.find((entry) => entry.raceName === raceName && entry.circuit === circuit);
  if (!race) throw new Error(`race niet gevonden: ${raceName} op ${circuit}`);
  return race;
};

const withBrandRemoved = (title: string) => title.replace(/ \| 3SM$/, "");

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

const LIVE_NEWS_TITLE = "Jaimy Peters pakt de overwinning na spectaculaire inhaalrace op Okayama International Circuit";
const LIVE_DESCRIPTION =
  "Bekijk de GT3 iRacing race-uitslag van Race 3 op Okayama International Circuit op 2026-10-01: klasseringen, rondes, podium en racegegevens van 3SM.";

describe("seoTitle — afkappen op woordgrens", () => {
  it("kapt nooit midden in een woord af, bij geen enkele grens", () => {
    for (const input of [LIVE_NEWS_TITLE, LIVE_DESCRIPTION, ...realRaces.map(titleFor)]) {
      for (let max = 12; max <= 200; max += 1) {
        const output = truncate(input, max);
        expect(endsInTheMiddleOfAWord(input, output), `max=${max} gaf "${output}"`).toBe(false);
      }
    }
  });

  it("eindigt nooit op een scheidingsteken en zet geen beletselteken als er niets is weggelaten", () => {
    for (const input of [LIVE_NEWS_TITLE, LIVE_DESCRIPTION]) {
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
    const output = truncate("Uitslag Race 3 · 7 oktober 2026 · Circuit de Spa-Francorchamps - Grand Prix · GT3", 70);
    expect(output).toBe("Uitslag Race 3 · 7 oktober 2026 · Circuit de Spa-Francorchamps…");
    expect(output).not.toMatch(/[-–—·|]\s*…$/u);
    expect(output.endsWith("…")).toBe(true);
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

describe("seoTitle — de 44 echte uitslagtitels", () => {
  it("houdt elke titel binnen de harde grens van 60 tekens", () => {
    expect(TITLE_MAX).toBe(60);
    const tooLong = realRaces
      .map((race) => ({ race: race.raceName, title: titleFor(race) }))
      .filter(({ title }) => title.length > TITLE_MAX);

    expect(tooLong, `te lang: ${tooLong.map(({ title }) => title).join(" | ")}`).toEqual([]);
    // Geen beletselteken en geen los scheidingsteken: er wordt nooit geknipt, er
    // vallen alleen hele delen weg.
    for (const race of realRaces) {
      const title = titleFor(race);
      expect(title).not.toContain("…");
      expect(title).not.toMatch(/[\s·|-]$/u);
      expect(title.startsWith(titleish(race.raceName))).toBe(true);
    }
  });

  it("levert 44 unieke titels en houdt het generator- en SPA-pad gelijk", () => {
    const assigned = assignUniqueRaceResultTitles(realRaces);
    const titles = assigned.map((entry) => entry.title);

    expect(titles).toHaveLength(44);
    expect(new Set(titles).size).toBe(44);

    // De SPA bouwt de titel per race (buildRaceResultTitle) en weet niets van de
    // andere races. Dat mag alleen goed gaan als de set-brede toewijzing op de echte
    // routes nooit een race hoeft terug te zetten: anders wijkt de tabtitel af van de
    // crawler-HTML. Op deze 44 routes is dat verschil nul.
    expect(assigned.filter((entry) => entry.demoted)).toEqual([]);
    for (const entry of assigned) {
      expect(titleFor(entry)).toBe(entry.title);
    }
  });

  it("laat zien wat er per race overblijft (steekproeven uit de echte set)", () => {
    // Langste racenaam uit de set: het circuit blijft, de 'Grand Prix Pits'-variant
    // sneuvelt en het merk past er nog net achter.
    expect(titleFor(findRace("Saturday fun day race 1", "Circuit de Spa-Francorchamps - Grand Prix Pits")))
      .toBe("Saturday fun day race 1 · Circuit de Spa-Francorchamps");
    // Langste circuitnaam: de datum en de klasse passen niet meer, het circuit (met
    // variant, want dat onderscheidt de twee VIR-varianten) wel.
    expect(titleFor(findRace("Race 7", "Virginia International Raceway - Full Course")))
      .toBe("Race 7 · Virginia International Raceway - Full Course · GT3");
    // Past de hele circuitnaam niet, dan zakt de titel naar de BASIS van het circuit
    // en houdt de datum — precies het deel dat deze race onderscheidt van de race op
    // dezelfde baan in 2008.
    expect(titleFor(findRace("daytona", "Daytona International Speedway - Road Course - 2008")))
      .toBe("Daytona · Daytona International Speedway · 3 aug 2026");
    // Langste titel van de set (58): de Speed Circuit - Medium-variant past en er is
    // geen ruimte meer voor het merk.
    expect(titleFor(findRace("navarra gt3", "Circuito de Navarra - Speed Circuit - Medium")))
      .toBe("Navarra gt3 · Circuito de Navarra - Speed Circuit - Medium");
    // Kort genoeg voor alles: racenaam, circuit, datum en merk.
    expect(titleFor(findRace("Race 1", "Hungaroring"))).toBe("Race 1 · Hungaroring · 9 sep 2026 | 3SM");

    // De twee races met dezelfde naam op dezelfde baan blijven uit elkaar te houden.
    const sameCircuit = realRaces.filter((race) => race.raceName === "daytona").map(titleFor);
    expect(new Set(sameCircuit).size).toBe(sameCircuit.length);
  });

  it("blijft onder de OUDE lengte: geen enkele titel is nog zo lang als het slechtste voorbeeld", () => {
    const longest = Math.max(...realRaces.map((race) => titleFor(race).length));
    const oldLongest = Math.max(
      ...realRaces.map((race) => `Uitslag ${titleish(race.raceName)} op ${race.circuit}`.length),
    );
    expect(longest).toBeLessThanOrEqual(TITLE_MAX);
    expect(longest).toBeLessThan(oldLongest);
  });
});

describe("seoTitle — rangorde van de titeldelen", () => {
  const base = { raceName: "Race 3", circuit: "Hungaroring", carClass: "GT3", date: "2026-09-09" };

  it("zet de racenaam vooraan en heeft geen 'Uitslag'-voorloop meer", () => {
    const title = titleFor({ id: "x", ...base });
    expect(title).toBe("Race 3 · Hungaroring · 9 sep 2026 · GT3 | 3SM");
    expect(title.startsWith("Race 3")).toBe(true);
    expect(title).not.toContain("Uitslag ");
  });

  it("laat de klasse eerder vallen dan de datum", () => {
    // Precies te krap voor 'Race 3 · Hungaroring · 9 sep 2026 · GT3' (39 tekens):
    // de klasse sneuvelt, de datum blijft.
    const squeezed = buildRaceResultTitle(base, { max: 38 });
    expect(squeezed).toBe("Race 3 · Hungaroring · 9 sep 2026");
    expect(squeezed.length).toBeLessThanOrEqual(38);
    expect(squeezed).not.toContain("GT3");

    // En de klasse komt nooit alleen te staan als de datum nog past.
    const candidates = raceResultTitleCandidates(base, { max: 60 });
    expect(candidates.indexOf("Race 3 · Hungaroring · GT3")).toBeGreaterThan(
      candidates.indexOf("Race 3 · Hungaroring · 9 sep 2026"),
    );
  });

  it("laat de circuitvariant eerder sneuvelen dan de datum, en de datum eerder dan de basis", () => {
    const race = {
      raceName: "Race 12",
      circuit: "Circuit de Spa-Francorchamps - Grand Prix Pits",
      carClass: "GT3",
      date: "2026-09-02",
    };
    // Circuit met variant past, maar dan is er geen ruimte meer voor datum en klasse:
    // die twee vallen weg, de variant blijft.
    expect(buildRaceResultTitle(race)).toBe("Race 12 · Circuit de Spa-Francorchamps - Grand Prix Pits");

    // En zakt het hele circuit niet binnen de grens, dan blijft de BASIS staan.
    const daytona2008 = buildRaceResultTitle({
      raceName: "daytona",
      circuit: "Daytona International Speedway - Road Course - 2008",
      date: "2026-08-03",
    });
    expect(daytona2008).toBe("Daytona · Daytona International Speedway · 3 aug 2026");
    expect(daytona2008).not.toContain("Road Course");
  });

  it("houdt het merk achteraan en laat het vallen zodra de titel te lang wordt", () => {
    expect(TITLE_BRAND_MAX).toBeLessThan(TITLE_MAX);
    const short = buildRaceResultTitle(base);
    expect(short.endsWith("| 3SM")).toBe(true);
    expect(short.length).toBeLessThanOrEqual(TITLE_BRAND_MAX);

    // Deze titel is zelf al 59 tekens: met het merk erbij zou hij over de grens gaan.
    const long = buildRaceResultTitle({
      raceName: "Race 7",
      circuit: "Virginia International Raceway - Full Course",
      carClass: "GT3",
      date: "2026-06-24",
    });
    expect(long).toBe("Race 7 · Virginia International Raceway - Full Course · GT3");
    expect(long).not.toContain("| 3SM");
    // Het merk mag alleen het merk kosten: de inhoud is hier niet korter geworden —
    // de titel is precies de rijkste vorm, en met het merk erbij zou hij te breed zijn.
    const [richest] = raceResultTitleCandidates({
      raceName: "Race 7",
      circuit: "Virginia International Raceway - Full Course",
      carClass: "GT3",
      date: "2026-06-24",
    });
    expect(withBrandRemoved(long)).toBe(richest);
    expect(`${richest} | 3SM`.length).toBeGreaterThan(TITLE_BRAND_MAX);
  });

  it("kapt nooit: bij een krappe grens houdt het laatste redmiddel de racenaam heel", () => {
    const candidates = raceResultTitleCandidates(
      { raceName: "Night Race GT3 Showdown", circuit: "Circuit de Spa-Francorchamps", date: "2026-04-05" },
      { max: 30 },
    );
    expect(candidates[candidates.length - 1]).toBe("Night Race GT3 Showdown");
    expect(candidates.every((title) => title.length <= 30 || title === "Night Race GT3 Showdown")).toBe(true);
  });
});

describe("seoTitle — unieke titels binnen de set", () => {
  it("schuift een botsende titel door naar het deel dat de twee races onderscheidt", () => {
    const first = { id: "a", raceName: "Race 3", circuit: "Daytona International Speedway - Road Course", carClass: "GT3", date: "2026-10-07" };
    const second = { ...first, id: "b", date: "2026-10-14" };

    const [a, b] = assignUniqueRaceResultTitles([first, second]);
    expect(a.title).toBe("Race 3 · Daytona International Speedway - Road Course · GT3");
    expect(a.demoted).toBe(false);
    // De klasse en de datum passen hier niet meer naast; de circuitvorm blijft heel.
    expect(b.title).toBe("Race 3 · Daytona International Speedway - Road Course");
    expect(b.demoted).toBe(true);
    expect(b.richest).toBe(a.title);
    expect(a.title).not.toBe(b.title);
  });

  it("onderscheidt twee races op dezelfde baan met een andere circuitvariant", () => {
    const roadCourse = findRace("daytona", "Daytona International Speedway - Road Course");
    const oval2008 = findRace("daytona", "Daytona International Speedway - Road Course - 2008");

    const titles = assignUniqueRaceResultTitles([roadCourse, oval2008]).map((entry) => entry.title);
    expect(new Set(titles).size).toBe(2);
    // De race zonder jaartal in de circuitnaam houdt de hele naam (met variant).
    expect(titles.some((title) => title === "Daytona · Daytona International Speedway - Road Course")).toBe(true);
    // De 2008-race past niet meer met de hele naam en houdt de BASIS plus de datum,
    // die hem van de andere Daytona-race onderscheidt.
    expect(titles.some((title) => title === "Daytona · Daytona International Speedway · 3 aug 2026")).toBe(true);
  });
});

describe("seoTitle — het circuit splitsen in basis en variant", () => {
  it("splitst op een omstreken streepje, niet op een streepje in de naam", () => {
    expect(splitCircuit("Daytona International Speedway - Road Course")).toEqual({
      base: "Daytona International Speedway",
      variant: "Road Course",
    });
    expect(splitCircuit("Daytona International Speedway - Road Course - 2008")).toEqual({
      base: "Daytona International Speedway",
      variant: "Road Course - 2008",
    });
    expect(splitCircuit("Circuit de Spa-Francorchamps")).toEqual({
      base: "Circuit de Spa-Francorchamps",
      variant: "",
    });
    expect(splitCircuit("Nürburgring Nordschleife – Industriefahrten")).toEqual({
      base: "Nürburgring Nordschleife",
      variant: "Industriefahrten",
    });
    expect(splitCircuit(null)).toEqual({ base: "", variant: "" });
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

    expect(buildRaceResultTitle(race)).toBe("Race 3 · Okayama International Circuit · 1 okt 2026 · LMP2");
    expect(buildRaceResultTitle(race)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(buildRaceResultDescription(race)).toContain("1 okt 2026");
    expect(buildRaceResultDescription(race)).not.toMatch(/\d{4}-\d{2}-\d{2}/);

    // Ook wanneer de datum moet wijken (lang circuit) komt er geen ISO-datum voor in
    // de plaats: de titel laat de datum dan gewoon weg.
    const longCircuit = { ...race, circuit: "Okayama International Circuit - Full Course" };
    expect(buildRaceResultTitle(longCircuit)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
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
    for (const race of realRaces) {
      const description = buildRaceResultDescription({ ...race, leagueName: null });
      expect(description.length, description).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
      expect(description.length, description).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(description.endsWith(".")).toBe(true);
      expect(description).not.toContain("…");
      expect(description).not.toMatch(/[\s·|,;:/\-–—-]$/u);
      expect(description.startsWith("Bekijk de race-uitslag van")).toBe(true);
    }
  });

  it("geeft geen zin zonder de uitslagpagina zelf", () => {
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

describe("seoTitle — h1 en het circuit als eigen kop in de crawler-HTML", () => {
  const generator = readFileSync("scripts/generate-route-html.mjs", "utf8");

  it("zet de racenaam als h1 en het circuit als h2", () => {
    expect(generator).toContain("h1: raceName,");
    expect(generator).toContain("h2: trackName ? `Circuit: ${trackName}` : null,");
    // De lange h1 van vroeger ('Uitslag X op Y (Z)') mag niet terugkomen.
    expect(generator).not.toContain("h1: `Uitslag ${raceName}");
  });

  it("herhaalt de koptekst niet drie keer in hetzelfde document", () => {
    // Eerst stond de volledige titeltekst in de broodkruimel, in een <p><strong> én
    // als h1 in de noscript. Routes met een eigen subkop zetten die kop nu één keer,
    // als h2, in plaats van de herhaalde titeltekst.
    expect(generator).toContain("const prerenderSubheading = route.h2 ?");
    expect(generator).toContain("<h2>${escapeHtml(route.h2)}</h2>");
    expect(generator).not.toContain("        <p><strong>${escapeHtml(route.h1)}</strong></p>\n        <p>${escapeHtml(route.intro)}</p>");
    expect(generator).toContain("const prerenderSubheading = route.h2 ?");
  });

  it("houdt elke h1 kort: geen racenaam uit de echte set komt boven de 30 tekens", () => {
    const lengths = realRaces.map((race) => titleish(race.raceName).length);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(30);
    // En de titel begint met de h1, zodat een SERP-titel uit de h1 nog steeds klopt
    // met wat de titel belooft.
    for (const race of realRaces) {
      expect(titleFor(race).startsWith(titleish(race.raceName))).toBe(true);
    }
  });
});

describe("seoTitle — dezelfde helper in de crawler-HTML en in de SPA", () => {
  it("laat de generator en de detailpagina de gedeelde helper gebruiken", () => {
    const generator = readFileSync("scripts/generate-route-html.mjs", "utf8");
    const detailPage = readFileSync("src/pages/RaceDetailPage.tsx", "utf8");

    expect(generator).toContain("from '../src/lib/seoTitle.mjs'");
    expect(generator).toContain("buildRaceResultTitle({");
    expect(generator).toContain("buildRaceResultDescription({");
    // De set-brede, unieke toewijzing hoort in de generator te zitten.
    expect(generator).toContain("assignUniqueRaceResultTitles(completedRacesWithPublicProfiles.map(");
    // De oude, eigen afkapfunctie mag niet terugkomen.
    expect(generator).not.toContain("slice(0, max - 1)");

    expect(detailPage).toContain('from "@/lib/seoTitle.mjs"');
    expect(detailPage).toContain("buildRaceResultTitle({");
    // De oude, afwijkende tabtitel mag niet terugkomen.
    expect(detailPage).not.toContain("${race.name} uitslag - 3 Stripe Motorsport");
  });
});
