import { describe, expect, it } from "vitest";
import type { EnduranceArchiveTeam } from "../repository/archiveRepository";
import type { EnduranceStintRow } from "../repository/stintsRepository";
import {
  archiveTotals,
  buildStintSegments,
  driverStintTotals,
  drivenStints,
  formatLapTime,
  formatStintDuration,
  groupStintsByTeam,
  rankArchiveTeams,
} from "./archiveDetail";

const team = (overrides: Partial<EnduranceArchiveTeam> = {}): EnduranceArchiveTeam => ({
  team_id: "team-1",
  team_name: "Oranje",
  car_number: "31",
  laps: 100,
  best_lap_seconds: 95.234,
  stops: 3,
  drivers: ["Jaimy"],
  ...overrides,
});

const stint = (overrides: Partial<EnduranceStintRow> = {}): EnduranceStintRow => ({
  id: "stint-1",
  event_id: "event-1",
  team_id: "team-1",
  driver_id: "driver-1",
  original_start_at: "2026-10-24T10:00:00.000Z",
  original_end_at: "2026-10-24T11:00:00.000Z",
  actual_start_at: "2026-10-24T10:00:00.000Z",
  actual_end_at: "2026-10-24T11:00:00.000Z",
  expected_laps: 20,
  fuel_litres: 60,
  tyre_change: false,
  double_stint: false,
  notes: null,
  status: "completed",
  created_at: "2026-10-20T10:00:00.000Z",
  updated_at: "2026-10-24T11:00:00.000Z",
  ...overrides,
});

describe("formatLapTime", () => {
  it("toont een rondetijd als m:ss.hh", () => {
    expect(formatLapTime(95.234)).toBe("1:35.23");
    expect(formatLapTime(59.5)).toBe("0:59.50");
    expect(formatLapTime(3600.5)).toBe("60:00.50");
  });

  it("verzint niets als de meting ontbreekt", () => {
    expect(formatLapTime(null)).toBe("—");
    expect(formatLapTime(undefined)).toBe("—");
    expect(formatLapTime(0)).toBe("—");
    expect(formatLapTime(Number.NaN)).toBe("—");
  });
});

describe("formatStintDuration", () => {
  it("leest als een duur in gewone taal", () => {
    expect(formatStintDuration(48)).toBe("48 min");
    expect(formatStintDuration(60)).toBe("1 u");
    expect(formatStintDuration(92)).toBe("1 u 32 min");
  });

  it("geeft een streepje bij een ontbrekende duur", () => {
    expect(formatStintDuration(0)).toBe("—");
    expect(formatStintDuration(null)).toBe("—");
  });
});

describe("rankArchiveTeams", () => {
  it("rangschikt op rondes en geeft teams zonder telemetrie geen positie", () => {
    const standings = rankArchiveTeams([
      team({ team_id: "a", team_name: "Alpha", laps: 120, best_lap_seconds: 96 }),
      team({ team_id: "b", team_name: "Bravo", laps: 140, best_lap_seconds: 99 }),
      team({ team_id: "c", team_name: "Charlie", laps: 0, best_lap_seconds: null, stops: 0, drivers: [] }),
    ]);
    expect(standings.map((row) => row.teamName)).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(standings.map((row) => row.position)).toEqual([1, 2, null]);
  });

  it("breekt een gelijke stand op de snelste ronde en daarna op naam", () => {
    const standings = rankArchiveTeams([
      team({ team_id: "a", team_name: "Zulu", laps: 50, best_lap_seconds: 97 }),
      team({ team_id: "b", team_name: "Alpha", laps: 50, best_lap_seconds: 97 }),
      team({ team_id: "c", team_name: "Bravo", laps: 50, best_lap_seconds: 95 }),
    ]);
    expect(standings.map((row) => row.teamName)).toEqual(["Bravo", "Alpha", "Zulu"]);
    expect(standings.map((row) => row.position)).toEqual([1, 2, 3]);
  });

  it("laat lege coureurslijsten weg en houdt het startveld intact", () => {
    const standings = rankArchiveTeams([team({ drivers: null as unknown as string[] })]);
    expect(standings).toHaveLength(1);
    expect(standings[0].drivers).toEqual([]);
  });
});

describe("archiveTotals", () => {
  it("telt rondes, stops en unieke coureurs over alle teams", () => {
    const totals = archiveTotals(rankArchiveTeams([
      team({ team_id: "a", laps: 100, stops: 2, best_lap_seconds: 98, drivers: ["Jaimy", "Sam"] }),
      team({ team_id: "b", laps: 90, stops: 3, best_lap_seconds: 95.5, drivers: ["Sam", "Noa"] }),
    ]));
    expect(totals).toEqual({ teams: 2, laps: 190, stops: 5, fastestLapSeconds: 95.5, drivers: 3 });
  });

  it("heeft geen snelste ronde als niemand een tijd neerzette", () => {
    const totals = archiveTotals(rankArchiveTeams([
      team({ laps: 0, stops: 0, best_lap_seconds: null, drivers: [] }),
    ]));
    expect(totals.fastestLapSeconds).toBeNull();
    expect(totals.laps).toBe(0);
  });
});

describe("drivenStints", () => {
  it("laat verlopen planningen weg en rekent met de echte tijden", () => {
    const stints = drivenStints([
      stint({ id: "a" }),
      stint({ id: "b", status: "expired" }),
      stint({
        id: "c",
        actual_start_at: "2026-10-24T11:00:00.000Z",
        actual_end_at: "2026-10-24T11:30:00.000Z",
      }),
    ]);
    expect(stints.map((row) => row.id)).toEqual(["a", "c"]);
    expect(stints.map((row) => row.minutes)).toEqual([60, 30]);
  });

  it("valt terug op de geplande tijd als de werkelijke tijd ontbreekt", () => {
    const [only] = drivenStints([
      stint({ actual_start_at: null, actual_end_at: null, original_start_at: "2026-10-24T10:00:00.000Z", original_end_at: "2026-10-24T10:45:00.000Z" }),
    ]);
    expect(only.minutes).toBe(45);
    expect(only.startAt).toBe("2026-10-24T10:00:00.000Z");
  });

  it("sorteert op starttijd en weigert onbruikbare blokken", () => {
    const stints = drivenStints([
      stint({ id: "laat", actual_start_at: "2026-10-24T12:00:00.000Z", actual_end_at: "2026-10-24T13:00:00.000Z" }),
      stint({ id: "vroeg", actual_start_at: "2026-10-24T10:00:00.000Z", actual_end_at: "2026-10-24T11:00:00.000Z" }),
      stint({ id: "leeg", actual_start_at: "2026-10-24T11:00:00.000Z", actual_end_at: "2026-10-24T11:00:00.000Z" }),
    ]);
    expect(stints.map((row) => row.id)).toEqual(["vroeg", "laat"]);
  });
});

describe("buildStintSegments", () => {
  const window = { startAt: "2026-10-24T10:00:00.000Z", endAt: "2026-10-24T14:00:00.000Z" };
  const nameOf = (id: string) => ({ "driver-1": "Jaimy", "driver-2": "Sam" } as Record<string, string>)[id];

  it("plaatst de stints op de raceklok en laat gaten zien", () => {
    const segments = buildStintSegments(
      drivenStints([
        stint({ id: "a", driver_id: "driver-1", actual_start_at: "2026-10-24T10:00:00.000Z", actual_end_at: "2026-10-24T11:00:00.000Z" }),
        stint({ id: "b", driver_id: "driver-2", actual_start_at: "2026-10-24T12:00:00.000Z", actual_end_at: "2026-10-24T13:00:00.000Z" }),
      ]),
      window,
      nameOf,
    );
    expect(segments.map((segment) => segment.leftPct)).toEqual([0, 50]);
    expect(segments.map((segment) => segment.widthPct)).toEqual([25, 25]);
    expect(segments.map((segment) => segment.driverName)).toEqual(["Jaimy", "Sam"]);
  });

  it("geeft iedere coureur binnen het team een eigen kleur", () => {
    const segments = buildStintSegments(
      drivenStints([
        stint({ id: "a", driver_id: "driver-1", actual_start_at: "2026-10-24T10:00:00.000Z", actual_end_at: "2026-10-24T11:00:00.000Z" }),
        stint({ id: "b", driver_id: "driver-2", actual_start_at: "2026-10-24T11:00:00.000Z", actual_end_at: "2026-10-24T12:00:00.000Z" }),
        stint({ id: "c", driver_id: "driver-1", actual_start_at: "2026-10-24T12:00:00.000Z", actual_end_at: "2026-10-24T13:00:00.000Z" }),
      ]),
      window,
      nameOf,
    );
    expect(segments[0].color).toBe(segments[2].color);
    expect(segments[1].color).not.toBe(segments[0].color);
  });

  it("noemt een coureur zonder profiel niet bij naam", () => {
    const segments = buildStintSegments(drivenStints([stint({ driver_id: "onbekend" })]), window, nameOf);
    expect(segments[0].driverName).toBe("Onbekende coureur");
  });

  it("valt terug op de stintgrenzen als het racevenster ontbreekt", () => {
    const segments = buildStintSegments(
      drivenStints([
        stint({ id: "a", actual_start_at: "2026-10-24T10:00:00.000Z", actual_end_at: "2026-10-24T11:00:00.000Z" }),
        stint({ id: "b", actual_start_at: "2026-10-24T11:00:00.000Z", actual_end_at: "2026-10-24T12:00:00.000Z" }),
      ]),
      { startAt: "", endAt: "" },
      nameOf,
    );
    expect(segments.map((segment) => segment.leftPct)).toEqual([0, 50]);
  });

  it("geeft een lege balk als er geen stints zijn", () => {
    expect(buildStintSegments([], window, nameOf)).toEqual([]);
  });
});

describe("driverStintTotals en groupStintsByTeam", () => {
  const nameOf = (id: string) => ({ "driver-1": "Jaimy", "driver-2": "Sam" } as Record<string, string>)[id];

  it("telt per coureur het aantal stints en de rijtijd", () => {
    const segments = buildStintSegments(
      drivenStints([
        stint({ id: "a", driver_id: "driver-1", actual_start_at: "2026-10-24T10:00:00.000Z", actual_end_at: "2026-10-24T11:00:00.000Z" }),
        stint({ id: "b", driver_id: "driver-2", actual_start_at: "2026-10-24T11:00:00.000Z", actual_end_at: "2026-10-24T11:30:00.000Z" }),
        stint({ id: "c", driver_id: "driver-1", actual_start_at: "2026-10-24T11:30:00.000Z", actual_end_at: "2026-10-24T12:00:00.000Z" }),
      ]),
      { startAt: "2026-10-24T10:00:00.000Z", endAt: "2026-10-24T12:00:00.000Z" },
      nameOf,
    );
    expect(driverStintTotals(segments).map((row) => [row.driverName, row.stints, row.minutes])).toEqual([
      ["Jaimy", 2, 90],
      ["Sam", 1, 30],
    ]);
  });

  it("groepeert de stints per team", () => {
    const grouped = groupStintsByTeam(drivenStints([
      stint({ id: "a", team_id: "team-1" }),
      stint({ id: "b", team_id: "team-2", actual_start_at: "2026-10-24T11:00:00.000Z", actual_end_at: "2026-10-24T12:00:00.000Z" }),
    ]));
    expect([...grouped.keys()]).toEqual(["team-1", "team-2"]);
    expect(grouped.get("team-2")?.map((row) => row.id)).toEqual(["b"]);
  });
});
