import { describe, expect, it } from "vitest";
import { parseLapSeconds, parsePaceCsv } from "./csv";

describe("pace CSV parser", () => {
  it("parses clock formatted lap times", () => expect(parseLapSeconds("2:08.420")).toBeCloseTo(128.42));
  it("derives pace statistics from lap data", () => {
    const parsed = parsePaceCsv("lap_times,incidents,stint_minutes\n128.4;128.8;128.2;129.0;128.5;128.6,2,48");
    expect(parsed.validLaps).toBe(6);
    expect(parsed.bestLapSeconds).toBe(128.2);
    expect(parsed.averageLapSeconds).toBeCloseTo(128.583, 2);
  });
  it("rejects incomplete uploads atomically", () => expect(() => parsePaceCsv("name,car\nVincent,Porsche")).toThrow(/ontbreekt/));
});
