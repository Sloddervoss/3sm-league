/**
 * De synchronisatie mag niet blijven hangen op het seizoen dat in de configuratie
 * staat. Zodra iRacing een nieuw seizoen start hoort daarbij een nieuw
 * `season_id`; deze functie zoekt dat op. Valt er niets te kiezen, dan moet het
 * vaste nummer ongewijzigd terugkomen — een werkende koppeling mag nooit breken.
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

Deno.test("kiest het actieve seizoen binnen dezelfde serie", () => {
  const seasons = [
    season(6307, 331, 2026, 3, false),
    season(6350, 331, 2026, 4, true),
    season(6200, 331, 2025, 4, false),
  ];
  check("actief seizoen", resolveCurrentSeriesSeasonId(6307, seasons), 6350);
});

Deno.test("negeert een actief seizoen van een andere serie", () => {
  const seasons = [
    season(6307, 331, 2026, 3, false),
    season(9999, 999, 2026, 4, true),
  ];
  check("andere serie", resolveCurrentSeriesSeasonId(6307, seasons), 6307);
});

Deno.test("valt terug op het vaste nummer als er geen actief seizoen is", () => {
  const seasons = [season(6307, 331, 2026, 3, false), season(6350, 331, 2026, 4, false)];
  check("geen actief", resolveCurrentSeriesSeasonId(6307, seasons), 6307);
});

Deno.test("kiest het nieuwste als er meerdere actief staan", () => {
  const seasons = [
    season(6307, 331, 2026, 3, true),
    season(6350, 331, 2026, 4, true),
    season(6100, 331, 2025, 4, true),
  ];
  check("nieuwste actieve", resolveCurrentSeriesSeasonId(6307, seasons), 6350);
});

Deno.test("valt terug als het gekoppelde seizoen niet in de lijst staat", () => {
  const seasons = [season(6350, 331, 2026, 4, true)];
  check("onbekend seizoen", resolveCurrentSeriesSeasonId(6307, seasons), 6307);
});

Deno.test("valt terug bij een lege of onverwachte lijst", () => {
  check("leeg", resolveCurrentSeriesSeasonId(6307, []), 6307);
  check("lege velden", resolveCurrentSeriesSeasonId(6307, [{ season_id: 6307 } as never]), 6307);
});

Deno.test("een officieel seizoen met active=false telt niet mee", () => {
  const seasons = [
    season(6307, 331, 2026, 3, false),
    { ...season(6350, 331, 2026, 4, true), official: false },
  ];
  check("niet-officieel", resolveCurrentSeriesSeasonId(6307, seasons), 6307);
});
