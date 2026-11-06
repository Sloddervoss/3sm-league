/**
 * Een combined serie (één catalogusrij met alle week-slots) werd genormaliseerd
 * vóórdat de slots waren samengevoegd. Daardoor stond de rij op `tbd` en filterde
 * de kalender hem weg — precies wat er met de Nürburgring van 7-8 november gebeurde.
 * Deze test legt vast dat de status volgt uit wat er ná het samenvoegen in staat.
 */
import { discoverCombinedSeriesEvent, type SeriesSeed } from "./normalize.ts";

declare const Deno: {
  test(name: string, test: () => void | Promise<void>): void;
};

const check = (name: string, actual: unknown, expected: unknown) => {
  if (actual !== expected) throw new Error(`${name}: verwacht ${String(expected)}, kreeg ${String(actual)}`);
};

const seed: SeriesSeed = {
  sourceKey: "iracing:2026:nurburgring-endurance-championship",
  year: 2026,
  name: "Nürburgring Endurance Championship",
  seriesName: "Nürburgring Endurance Championship",
  seasonId: 6236,
  seriesId: 275,
  combined: true,
};

const schedule = {
  schedules: [
    {
      race_week_num: 9,
      start_date: "2026-11-07",
      track: { track_name: "Nürburgring Combined", config_name: "Combined", track_id: 252 },
      race_time_descriptors: [
        { session_times: ["2026-11-07T07:00:00Z", "2026-11-07T17:00:00Z"], session_minutes: 240 },
      ],
    },
  ],
};

Deno.test("combined serie met week-slots is exact_slots, niet tbd", async () => {
  const event = await discoverCombinedSeriesEvent(seed, schedule as never);
  if (!event) throw new Error("combined event werd niet opgebouwd");
  check("status", event.availabilityStatus, "exact_slots");
  check("aantal slots", event.slots.length, 2);
  check("startdatum", event.dateStart, "2026-11-07");
  check("einddatum", event.dateEnd, "2026-11-07");
});

Deno.test("combined serie zonder tijden levert niets op in plaats van een lege kaart", async () => {
  const leeg = { schedules: [{ race_week_num: 9, track: { track_name: "Nürburgring Combined" } }] };
  const event = await discoverCombinedSeriesEvent(seed, leeg as never);
  check("leeg", event, null);
});
