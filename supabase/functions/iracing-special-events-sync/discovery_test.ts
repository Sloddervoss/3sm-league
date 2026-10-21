/**
 * De synchronisatie mag niet blijven hangen op het seizoen dat in de configuratie
 * staat. Zodra iRacing een nieuw seizoen start hoort daarbij een nieuw
 * `season_id`; deze functie zoekt dat op via de `seriesId` uit de kaart.
 *
 * De testgevallen volgen de vorm die het endpoint in productie echt teruggeeft:
 * `/data/series/seasons` zonder parameters bevat per serie alleen het seizoen dat
 * nu loopt. Het oude, in de kaart vastgelegde nummer staat daar dus NIET in — dat
 * is precies het scenario waarin de functie iets moet doen.
 *
 * Elke keuzetest verwacht een ander nummer dan het vaste: een implementatie die
 * niets doet (`return mappedSeasonId`) zakt daardoor op elke keuzetest.
 */
import { resolveCurrentSeriesSeasonId } from "./discovery.ts";

const check = (name: string, actual: unknown, expected: unknown) => {
  if (actual !== expected) {
    throw new Error(`${name}: verwacht ${String(expected)}, kreeg ${String(actual)}`);
  }
};

const season = (
  season_id: number,
  series_id: number,
  season_year: number,
  season_quarter: number,
  active: boolean,
) => ({ season_id, series_id, season_year, season_quarter, season_name: `Seizoen ${season_id}`, active });

Deno.test("volgt het nieuwe seizoen als het oude niet meer in de lijst staat (de productievorm)", () => {
  // Dit is wat iRacing teruggeeft zodra seizoen 4 loopt: alleen 6483 voor serie 331.
  const seasons = [season(6483, 331, 2026, 4, true)];
  check("productievorm", resolveCurrentSeriesSeasonId(6307, 331, seasons), 6483);
});

Deno.test("volgt het nieuwe seizoen ook naast andere series in dezelfde lijst", () => {
  const seasons = [
    season(6486, 419, 2026, 4, true),
    season(6483, 331, 2026, 4, true),
    season(6450, 451, 2026, 4, true),
  ];
  check("tussen andere series", resolveCurrentSeriesSeasonId(6307, 331, seasons), 6483);
});

Deno.test("kiest het actieve seizoen als de lijst ook een niet-actief seizoen bevat", () => {
  const seasons = [season(6307, 331, 2026, 3, false), season(6483, 331, 2026, 4, true)];
  check("actief wint", resolveCurrentSeriesSeasonId(6307, 331, seasons), 6483);
});

Deno.test("kiest op jaar en kwartaal, niet op het season_id", () => {
  // Het hoogste nummer hoort hier bij het OUDERE seizoen; de keuze moet op rang gaan.
  const seasons = [season(9000, 331, 2026, 3, true), season(5000, 331, 2026, 4, true)];
  check("rang boven id", resolveCurrentSeriesSeasonId(9000, 331, seasons), 5000);
});

Deno.test("werkt ook als het active-veld ontbreekt", () => {
  const seasons = [{ season_id: 6483, series_id: 331, season_year: 2026, season_quarter: 4, season_name: "S4" }];
  check("zonder active", resolveCurrentSeriesSeasonId(6307, 331, seasons), 6483);
});

Deno.test("geeft een nummer terug, ook als iRacing strings levert", () => {
  const seasons = [{ season_id: "6483", series_id: "331", season_year: "2026", season_quarter: "4" }];
  const result = resolveCurrentSeriesSeasonId(6307, 331, seasons as never);
  check("getal", result, 6483);
  check("type", typeof result, "number");
});

Deno.test("valt terug als de serie niet in de lijst staat", () => {
  const seasons = [season(6483, 999, 2026, 4, true)];
  check("andere serie", resolveCurrentSeriesSeasonId(6307, 331, seasons), 6307);
});

Deno.test("valt terug als de seriesId ontbreekt of onbruikbaar is", () => {
  const seasons = [season(6483, 331, 2026, 4, true)];
  check("undefined", resolveCurrentSeriesSeasonId(6307, undefined, seasons), 6307);
  check("null", resolveCurrentSeriesSeasonId(6307, null, seasons), 6307);
  check("nul", resolveCurrentSeriesSeasonId(6307, 0, seasons), 6307);
  check("tekst", resolveCurrentSeriesSeasonId(6307, "geen nummer" as never, seasons), 6307);
});

Deno.test("valt terug bij een lege lijst", () => {
  check("leeg", resolveCurrentSeriesSeasonId(6307, 331, []), 6307);
});

Deno.test("slaat rijen zonder bruikbaar season_id over", () => {
  const seasons = [
    { season_id: null, series_id: 331, season_year: 2026, season_quarter: 4 },
    { season_id: 0, series_id: 331, season_year: 2026, season_quarter: 4 },
    season(6483, 331, 2026, 4, true),
  ];
  check("ongeldige rijen", resolveCurrentSeriesSeasonId(6307, 331, seasons as never), 6483);
});
