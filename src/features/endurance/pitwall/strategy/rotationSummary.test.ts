import { describe, expect, it } from "vitest";
import { rotationSummaryLine, summariseRotation } from "./rotationSummary";

const drivers = [
  { id: "a", name: "Anna" },
  { id: "b", name: "Bram" },
  { id: "c", name: "Cas" },
];

describe("summariseRotation", () => {
  it("keurt een gelijke verdeling goed", () => {
    const s = summariseRotation({
      drivers,
      totalMinutes: 360,
      stints: [
        { driverId: "a", startMinute: 0, endMinute: 120 },
        { driverId: "b", startMinute: 120, endMinute: 240 },
        { driverId: "c", startMinute: 240, endMinute: 360 },
      ],
    });
    expect(s.reasonCode).toBe("ok");
    expect(s.perDriver.map((d) => d.minutes)).toEqual([120, 120, 120]);
    expect(s.unassignedMinutes).toBe(0);
  });

  it("ziet het als iemand onder het minimumdeel blijft", () => {
    const s = summariseRotation({
      drivers,
      totalMinutes: 360,
      stints: [
        { driverId: "a", startMinute: 0, endMinute: 170 },
        { driverId: "b", startMinute: 170, endMinute: 340 },
        { driverId: "c", startMinute: 340, endMinute: 360 },
      ],
    });
    expect(s.reasonCode).toBe("fair_share_violated");
    expect(s.minimumMinutes).toBe(30);
    expect(s.perDriver.find((d) => d.id === "c")!.belowMinimum).toBe(true);
    expect(rotationSummaryLine(s, 360)).toContain("Cas (20 min)");
  });

  it("telt dubbel gereden tijd bij dezelfde coureur op", () => {
    const s = summariseRotation({
      drivers,
      totalMinutes: 360,
      stints: [
        { driverId: "a", startMinute: 0, endMinute: 60 },
        { driverId: "b", startMinute: 60, endMinute: 120 },
        { driverId: "a", startMinute: 120, endMinute: 180 },
      ],
    });
    expect(s.perDriver.find((d) => d.id === "a")!.minutes).toBe(120);
    expect(s.unassignedMinutes).toBe(180);
    // Cas heeft nog niets gereden, dus de regel noemt eerst de harde grens.
    expect(rotationSummaryLine(s, 360)).toContain("Onder het minimumdeel");
  });

  it("negeert een stint van iemand die niet in de auto zit", () => {
    const s = summariseRotation({
      drivers,
      totalMinutes: 120,
      stints: [{ driverId: "onbekend", startMinute: 0, endMinute: 120 }],
    });
    expect(s.unassignedMinutes).toBe(120);
    expect(s.perDriver.every((d) => d.minutes === 0)).toBe(true);
  });

  it("zegt het als er geen coureurs of geen duur is", () => {
    expect(summariseRotation({ drivers: [], totalMinutes: 360, stints: [] }).reasonCode).toBe("no_drivers");
    expect(summariseRotation({ drivers, totalMinutes: 0, stints: [] }).reasonCode).toBe("no_duration");
  });
});
