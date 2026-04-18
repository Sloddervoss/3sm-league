import { describe, it, expect } from "vitest";
import { parseLapMs, formatIRacingLapTime, matchProfileForImportRow } from "./importHelpers";
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
