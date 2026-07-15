import { describe, expect, it } from "vitest";
import { utcToZonedInput, zonedInputToUtc } from "./time";

describe("Amsterdam timezone conversion", () => {
  it("stores summer time as UTC", () => {
    expect(zonedInputToUtc("2026-07-25T13:00")).toBe("2026-07-25T11:00:00.000Z");
    expect(utcToZonedInput("2026-07-25T11:00:00.000Z")).toBe("2026-07-25T13:00");
  });

  it("stores winter time as UTC", () => {
    expect(zonedInputToUtc("2026-12-10T13:00")).toBe("2026-12-10T12:00:00.000Z");
  });

  it("rejects a nonexistent DST wall-clock time", () => {
    expect(() => zonedInputToUtc("2026-03-29T02:30")).toThrow(/bestaat niet/);
  });
});
