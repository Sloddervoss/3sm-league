import { describe, it, expect } from "vitest";
import { parseLapMs, formatIRacingLapTime, matchProfileForImportRow, parseCsvRows, parseIRacingJsonRows } from "./importHelpers";
import type { ImportRow, ProfileRow } from "./importHelpers";

// ---------------------------------------------------------------------------
// parseLapMs
// ---------------------------------------------------------------------------

describe("parseLapMs", () => {
  it('parses "1:23.456"', () => expect(parseLapMs("1:23.456")).toBe(83456));
  it('parses "1:23,456" (comma separator)', () => expect(parseLapMs("1:23,456")).toBe(83456));
  it('parses "0:59.9" — single-digit ms padded to 900', () => expect(parseLapMs("0:59.9")).toBe(59900));
  it('returns Infinity for "bad"', () => expect(parseLapMs("bad")).toBe(Infinity));
  it('returns Infinity for ""', () => expect(parseLapMs("")).toBe(Infinity));
});

// ---------------------------------------------------------------------------
// formatIRacingLapTime
// iRacing stores time in ten-thousandths of a second; divide by 10 → ms.
// ---------------------------------------------------------------------------

describe("formatIRacingLapTime", () => {
  it("returns '' for 0", () => expect(formatIRacingLapTime(0)).toBe(""));
  it("returns '' for -1", () => expect(formatIRacingLapTime(-1)).toBe(""));

  it('formats 1:14.321 (input 743210)', () => {
    // 74321 ms → 1 min, 14 sec, 321 ms
    expect(formatIRacingLapTime(743210)).toBe("1:14.321");
  });

  it('formats sub-minute lap 0:59.100 (input 591000)', () => {
    // 59100 ms → 0 min, 59 sec, 100 ms
    expect(formatIRacingLapTime(591000)).toBe("0:59.100");
  });
});

// ---------------------------------------------------------------------------
// matchProfileForImportRow
// ---------------------------------------------------------------------------

const makeRow = (overrides: Partial<ImportRow> = {}): ImportRow => ({
  position: 1,
  display_name: "Alice",
  laps: 10,
  best_lap: "1:23.456",
  incidents: 0,
  fastest_lap: false,
  ...overrides,
});

const makeProfile = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  user_id: "uid-1",
  display_name: "Alice",
  iracing_name: null,
  iracing_id: null,
  ...overrides,
});

describe("matchProfileForImportRow", () => {
  it("matches by iracing_cust_id / iracing_id", () => {
    const profiles: ProfileRow[] = [
      makeProfile({ user_id: "uid-cust", display_name: "Somebody Else", iracing_id: 12345 }),
    ];
    const row = makeRow({ display_name: "Nobody", iracing_cust_id: "12345" });
    expect(matchProfileForImportRow(row, profiles)?.user_id).toBe("uid-cust");
  });

  it("falls back to display_name match", () => {
    const profiles: ProfileRow[] = [
      makeProfile({ user_id: "uid-name", display_name: "Alice", iracing_id: null }),
    ];
    expect(matchProfileForImportRow(makeRow(), profiles)?.user_id).toBe("uid-name");
  });

  it("falls back to iracing_name match", () => {
    const profiles: ProfileRow[] = [
      makeProfile({ user_id: "uid-iname", display_name: null, iracing_name: "Alice" }),
    ];
    expect(matchProfileForImportRow(makeRow(), profiles)?.user_id).toBe("uid-iname");
  });

  it("is case-insensitive for display_name", () => {
    const profiles: ProfileRow[] = [
      makeProfile({ display_name: "ALICE" }),
    ];
    expect(matchProfileForImportRow(makeRow({ display_name: "alice" }), profiles)).toBeDefined();
  });

  it("is case-insensitive for iracing_name", () => {
    const profiles: ProfileRow[] = [
      makeProfile({ display_name: null, iracing_name: "ALICE" }),
    ];
    expect(matchProfileForImportRow(makeRow({ display_name: "alice" }), profiles)).toBeDefined();
  });

  it("returns undefined when nothing matches", () => {
    const profiles: ProfileRow[] = [
      makeProfile({ display_name: "Bob", iracing_name: "bob123", iracing_id: 999 }),
    ];
    expect(matchProfileForImportRow(makeRow({ display_name: "Charlie" }), profiles)).toBeUndefined();
  });

  it("matches by custId when that matching profile is encountered first", () => {
    const byName: ProfileRow = makeProfile({ user_id: "uid-name", display_name: "Alice", iracing_id: null });
    const byCust: ProfileRow = makeProfile({ user_id: "uid-cust", display_name: "Other", iracing_id: 42 });
    const row = makeRow({ display_name: "Alice", iracing_cust_id: "42" });
    // Single-pass find: whichever profile satisfies (custId || display_name || iracing_name)
    // first in the array wins. No global custId priority — array order matters.
    expect(matchProfileForImportRow(row, [byCust, byName])?.user_id).toBe("uid-cust");
  });

  it("returns undefined for empty profiles array", () => {
    expect(matchProfileForImportRow(makeRow(), [])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseCsvRows
// ---------------------------------------------------------------------------

const IRACING_HEADER = "Fin Pos,Cust ID,Display Name,Laps Comp,Fastest Lap Time,Inc,New iRating,New License Level,New License Sub-Level";

function makeIRacingCsvRow(fields: {
  pos?: number; custId?: number; name?: string;
  laps?: number; lapTime?: string; inc?: number;
  irating?: number; licLevel?: number; licSub?: number;
}, idx = 0) {
  return [
    fields.pos ?? idx + 1,
    fields.custId ?? 10000 + idx,
    fields.name ?? `Driver ${idx + 1}`,
    fields.laps ?? 10,
    fields.lapTime ?? "1:30.000",
    fields.inc ?? 0,
    fields.irating ?? "",
    fields.licLevel ?? "",
    fields.licSub ?? "",
  ].join(",");
}

describe("parseCsvRows", () => {
  it("returns error for empty string", () => {
    expect(parseCsvRows("")).toEqual({ error: "CSV lijkt leeg" });
  });

  it("returns error for single line", () => {
    expect(parseCsvRows(IRACING_HEADER)).toEqual({ error: "CSV lijkt leeg" });
  });

  it("returns error when no valid rows parsed", () => {
    const csv = `${IRACING_HEADER}\n,,`;
    expect(parseCsvRows(csv)).toEqual({ error: "Geen geldige rijen gevonden in CSV" });
  });

  it("parses a minimal valid row", () => {
    const csv = [IRACING_HEADER, makeIRacingCsvRow({ pos: 1, name: "Alice", laps: 15 })].join("\n");
    const result = parseCsvRows(csv);
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(1);
    expect(result.rows![0]).toMatchObject({ position: 1, display_name: "Alice", laps: 15 });
  });

  it("parses CustID into iracing_cust_id", () => {
    const csv = [IRACING_HEADER, makeIRacingCsvRow({ custId: 99999, name: "Bob" })].join("\n");
    const result = parseCsvRows(csv);
    expect(result.rows![0].iracing_cust_id).toBe("99999");
  });

  it("parses iRating / license columns", () => {
    const csv = [IRACING_HEADER, makeIRacingCsvRow({ irating: 2500, licLevel: 20, licSub: 350 })].join("\n");
    const result = parseCsvRows(csv);
    expect(result.rows![0]).toMatchObject({ new_irating: 2500, new_license_level: 20, new_license_sub_level: 350 });
  });

  it("marks fastest_lap on the driver with the lowest lap time", () => {
    const csv = [
      IRACING_HEADER,
      makeIRacingCsvRow({ pos: 1, name: "Alice", lapTime: "1:30.000" }, 0),
      makeIRacingCsvRow({ pos: 2, name: "Bob",   lapTime: "1:28.500" }, 1),
      makeIRacingCsvRow({ pos: 3, name: "Carol",  lapTime: "1:31.000" }, 2),
    ].join("\n");
    const result = parseCsvRows(csv);
    expect(result.rows!.find(r => r.display_name === "Bob")?.fastest_lap).toBe(true);
    expect(result.rows!.find(r => r.display_name === "Alice")?.fastest_lap).toBe(false);
  });

  it("skips rows with fewer than 3 columns", () => {
    const csv = `${IRACING_HEADER}\n1,12345,Alice,10,1:30.000,0\ngarbage\n2,12346,Bob,10,1:31.000,0`;
    const result = parseCsvRows(csv);
    expect(result.rows).toHaveLength(2);
  });

  it("skips header lines before the actual header", () => {
    const csv = `iRacing Race Results Export\n\n${IRACING_HEADER}\n${makeIRacingCsvRow({ name: "Alice" })}`;
    const result = parseCsvRows(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows![0].display_name).toBe("Alice");
  });
});

// ---------------------------------------------------------------------------
// parseIRacingJsonRows
// ---------------------------------------------------------------------------

function makeIRacingJson(sessionResults: object[], wrap = false) {
  const payload = { session_results: sessionResults };
  return JSON.stringify(wrap ? { data: payload } : payload);
}

function makeJsonResult(overrides: Partial<{
  finish_position: number; display_name: string; cust_id: number;
  laps_complete: number; best_lap_time: number; incidents: number;
  newi_rating: number; reason_out_id: number; reason_out: string;
  car_name: string; livery: { car_name: string };
}> = {}) {
  return {
    finish_position: 0,
    display_name: "Alice",
    cust_id: 12345,
    laps_complete: 10,
    best_lap_time: 743210,
    incidents: 0,
    ...overrides,
  };
}

const RACE_SESSION = { simsession_type: 6, simsession_type_name: "Race", results: [makeJsonResult()] };

describe("parseIRacingJsonRows", () => {
  it("returns error for invalid JSON", () => {
    expect(parseIRacingJsonRows("not json")).toEqual({ error: "Ongeldig JSON bestand" });
  });

  it("returns error when session_results is empty", () => {
    expect(parseIRacingJsonRows(makeIRacingJson([]))).toEqual({
      error: "Geen Race sessie gevonden in JSON — controleer of het een iRacing event result JSON is",
    });
  });

  it("returns error when race session has no results", () => {
    const json = makeIRacingJson([{ simsession_type: 6, results: [] }]);
    expect(parseIRacingJsonRows(json)).toEqual({ error: "Geen resultaten gevonden in Race sessie" });
  });

  it("finds race session by simsession_type === 6", () => {
    const json = makeIRacingJson([
      { simsession_type: 4, results: [makeJsonResult({ display_name: "Wrong" })] },
      { simsession_type: 6, results: [makeJsonResult({ display_name: "Correct" })] },
    ]);
    const result = parseIRacingJsonRows(json);
    expect(result.rows![0].display_name).toBe("Correct");
  });

  it("accepts json wrapped in .data", () => {
    const json = makeIRacingJson([RACE_SESSION], true);
    const result = parseIRacingJsonRows(json);
    expect(result.error).toBeUndefined();
    expect(result.rows).toHaveLength(1);
  });

  it("parses driver fields correctly", () => {
    const json = makeIRacingJson([{
      simsession_type: 6,
      results: [makeJsonResult({ finish_position: 0, display_name: "Alice", cust_id: 42, laps_complete: 15, incidents: 3, newi_rating: 2400 })],
    }]);
    const result = parseIRacingJsonRows(json);
    expect(result.rows![0]).toMatchObject({
      position: 1,
      display_name: "Alice",
      iracing_cust_id: "42",
      laps: 15,
      incidents: 3,
      new_irating: 2400,
    });
  });

  it("marks fastest_lap on driver with lowest best_lap_time", () => {
    const json = makeIRacingJson([{
      simsession_type: 6,
      results: [
        makeJsonResult({ finish_position: 0, cust_id: 1, display_name: "Alice", best_lap_time: 743210 }),
        makeJsonResult({ finish_position: 1, cust_id: 2, display_name: "Bob",   best_lap_time: 740000 }),
      ],
    }]);
    const result = parseIRacingJsonRows(json);
    expect(result.rows!.find(r => r.display_name === "Bob")?.fastest_lap).toBe(true);
    expect(result.rows!.find(r => r.display_name === "Alice")?.fastest_lap).toBe(false);
  });

  it("flags DNF when reason_out_id !== 0", () => {
    const json = makeIRacingJson([{
      simsession_type: 6,
      results: [makeJsonResult({ reason_out_id: 5, laps_complete: 10 })],
    }]);
    expect(parseIRacingJsonRows(json).rows![0].dnf).toBe(true);
  });

  it("flags DNF when laps < maxLaps", () => {
    const json = makeIRacingJson([{
      simsession_type: 6,
      results: [
        makeJsonResult({ finish_position: 0, cust_id: 1, display_name: "Alice", laps_complete: 10 }),
        makeJsonResult({ finish_position: 1, cust_id: 2, display_name: "Bob",   laps_complete: 7, reason_out_id: 0 }),
      ],
    }]);
    const result = parseIRacingJsonRows(json);
    expect(result.rows!.find(r => r.display_name === "Bob")?.dnf).toBe(true);
    expect(result.rows!.find(r => r.display_name === "Alice")?.dnf).toBe(false);
  });

  it("uses livery.car_name as fallback when car_name absent", () => {
    const json = makeIRacingJson([{
      simsession_type: 6,
      results: [makeJsonResult({ livery: { car_name: "Porsche 911 GT3 R" } })],
    }]);
    expect(parseIRacingJsonRows(json).rows![0].car_name).toBe("Porsche 911 GT3 R");
  });

  it("formats best_lap_time with formatIRacingLapTime", () => {
    const json = makeIRacingJson([{
      simsession_type: 6,
      results: [makeJsonResult({ best_lap_time: 743210 })],
    }]);
    expect(parseIRacingJsonRows(json).rows![0].best_lap).toBe("1:14.321");
  });
});
