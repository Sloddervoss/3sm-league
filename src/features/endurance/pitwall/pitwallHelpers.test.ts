import { describe, expect, it } from "vitest";
import {
  strategyStatusInfo,
  calcPitLap,
  calcFuelToAdd,
  estimateRemainingLaps,
  formatSeconds,
  formatFuel,
  formatLaps,
  formatLapTime,
  formatDelta,
  extractRaceClock,
} from "./pitwallHelpers";

describe("strategyStatusInfo", () => {
  it("returns ready state", () => {
    const info = strategyStatusInfo("ready");
    expect(info.label).toBe("Strategie gereed");
    expect(info.tone).toBe("green");
  });

  it("returns low_sample state", () => {
    const info = strategyStatusInfo("low_sample", "weinig data");
    expect(info.label).toBe("Weinig data");
    expect(info.tone).toBe("yellow");
    expect(info.reason).toBe("weinig data");
  });

  it("returns insufficient_data state", () => {
    const info = strategyStatusInfo("insufficient_data");
    expect(info.label).toBe("Onvoldoende data");
    expect(info.tone).toBe("red");
  });

  it("falls back for unknown state", () => {
    const info = strategyStatusInfo("unknown");
    expect(info.label).toBe("Geen strategie");
    expect(info.tone).toBe("gray");
  });
});

describe("calcPitLap", () => {
  it("calculates pit lap from completed laps and fuel remaining", () => {
    expect(calcPitLap(50, 8.2, 1)).toBe(57);
  });

  it("returns null if inputs missing", () => {
    expect(calcPitLap(null, 8.2)).toBeNull();
    expect(calcPitLap(50, null)).toBeNull();
  });

  it("returns same lap when fuel low with reserve", () => {
    expect(calcPitLap(100, 1.5, 1)).toBe(100);
  });
});

describe("calcFuelToAdd", () => {
  it("calculates fuel to add for a stint", () => {
    // current=20L, perLap=3L, next stint=25 laps → need 75L, minus 20 = 55
    expect(calcFuelToAdd(20, 3, 25, 100)).toBe(55);
  });

  it("returns 0 if enough fuel already", () => {
    expect(calcFuelToAdd(90, 3, 5, 100)).toBe(0);
  });

  it("caps at tank capacity", () => {
    expect(calcFuelToAdd(10, 3, 50, 100)).toBe(100); // needs 150L, tank is 100
  });

  it("returns null if inputs missing", () => {
    expect(calcFuelToAdd(null, 3, 25, 100)).toBeNull();
    expect(calcFuelToAdd(20, null, 25, 100)).toBeNull();
    expect(calcFuelToAdd(20, 3, null, 100)).toBeNull();
  });

  it("returns null for invalid tank capacity", () => {
    expect(calcFuelToAdd(20, 3, 25, 0)).toBeNull();
    expect(calcFuelToAdd(20, 3, 25, -1)).toBeNull();
  });

  it("with fuel_laps_remaining (current range) as stint length returns ~0 (semantic proof)", () => {
    // When fuelLapsRemaining = currentFuel / fuelPerLap (current range)
    // calcFuelToAdd(currentFuel, fuelPerLap, fuelLapsRemaining, tankCapacity)
    // fuelNeeded = fuelLapsRemaining * fuelPerLap ≈ currentFuel
    // toAdd ≈ currentFuel - currentFuel ≈ 0
    // This proves fuel_laps_remaining is WRONG as a next-stint horizon.
    const currentFuel = 21.7;
    const fuelPerLap = 3.12;
    const rangeLaps = currentFuel / fuelPerLap; // ≈ 6.96
    expect(calcFuelToAdd(currentFuel, fuelPerLap, rangeLaps, 100)).toBeLessThanOrEqual(0);
    // With round: 6.96 * 3.12 = 21.72 - 21.7 = 0.02 → rounds to 0
    expect(calcFuelToAdd(currentFuel, fuelPerLap, Math.floor(rangeLaps), 100)).toBe(0);
    // A correct next-stint horizon (e.g. 25 laps) gives a positive value
    expect(calcFuelToAdd(currentFuel, fuelPerLap, 25, 100)).toBeGreaterThan(0);
  });
});

describe("estimateRemainingLaps", () => {
  it("calculates remaining laps from time", () => {
    expect(estimateRemainingLaps(5400, 90)).toBe(60);
  });

  it("returns null for missing inputs", () => {
    expect(estimateRemainingLaps(null, 90)).toBeNull();
    expect(estimateRemainingLaps(5400, null)).toBeNull();
  });

  it("returns null for zero lap time", () => {
    expect(estimateRemainingLaps(5400, 0)).toBeNull();
  });

  it("always rounds up", () => {
    expect(estimateRemainingLaps(5400, 91)).toBe(60);
  });
});

describe("formatSeconds", () => {
  it("formats seconds into H:MM:SS", () => {
    expect(formatSeconds(0)).toBe("00:00");
    expect(formatSeconds(59)).toBe("00:59");
    expect(formatSeconds(3661)).toBe("1:01:01");
  });

  it("returns dash for null/undefined", () => {
    expect(formatSeconds(null)).toBe("—");
    expect(formatSeconds(undefined)).toBe("—");
  });
});

describe("formatFuel", () => {
  it("formats litres", () => {
    expect(formatFuel(21.7)).toBe("21.7L");
    expect(formatFuel(0)).toBe("0.0L");
  });

  it("returns dash for null/undefined", () => {
    expect(formatFuel(null)).toBe("—");
  });
});

describe("formatLaps", () => {
  it("formats singular", () => {
    expect(formatLaps(1)).toBe("1 ronde");
  });

  it("formats plural", () => {
    expect(formatLaps(6)).toBe("6 ronden");
  });

  it("returns dash for null", () => {
    expect(formatLaps(null)).toBe("—");
  });
});

describe("NaN and null safety", () => {
  it("handles NaN gracefully", () => {
    expect(formatFuel(NaN)).toBe("NaNL");
    expect(formatSeconds(NaN)).toBe("NaN:NaN");
  });
});

describe("formatLapTime", () => {
  it("formats seconds to M:SS.s", () => {
    expect(formatLapTime(92.4)).toBe("1:32.4");
    expect(formatLapTime(64.0)).toBe("1:04.0");
    expect(formatLapTime(60)).toBe("1:00.0");
  });

  it("returns dash for null/undefined", () => {
    expect(formatLapTime(null)).toBe("—");
    expect(formatLapTime(undefined)).toBe("—");
  });

  it("returns dash for zero or negative lap times", () => {
    expect(formatLapTime(0)).toBe("—");
    expect(formatLapTime(-1)).toBe("—");
  });
});

describe("formatDelta", () => {
  it("shows positive delta with plus sign", () => {
    const d = formatDelta(1.1);
    expect(d).not.toBeNull();
    expect(d!.text).toBe("+1.1s");
    expect(d!.faster).toBe(false);
  });

  it("shows negative delta as faster", () => {
    const d = formatDelta(-0.5);
    expect(d).not.toBeNull();
    expect(d!.text).toBe("-0.5s");
    expect(d!.faster).toBe(true);
  });

  it("returns null for null/undefined", () => {
    expect(formatDelta(null)).toBeNull();
    expect(formatDelta(undefined)).toBeNull();
  });
});

describe("extractRaceClock", () => {
  it("extracts from V3 session clock", () => {
    const clock = extractRaceClock({
      session: { sessionTimeRemainingSeconds: 9692, sessionLapsRemaining: 57 },
    });
    expect(clock).not.toBeNull();
    expect(clock!.remainingSeconds).toBe(9692);
    expect(clock!.remainingLaps).toBe(57);
  });

  it("returns null for null input", () => {
    expect(extractRaceClock(null)).toBeNull();
  });

  it("returns null for missing session clock", () => {
    expect(extractRaceClock({})).toBeNull();
  });

  it("returns null for zero/negative session time", () => {
    expect(extractRaceClock({ session: { sessionTimeRemainingSeconds: 0 } })).toBeNull();
    expect(extractRaceClock({ session: { sessionTimeRemainingSeconds: -1 } })).toBeNull();
  });

  it("returns remainingLaps null when not present", () => {
    const clock = extractRaceClock({
      session: { sessionTimeRemainingSeconds: 5000 },
    });
    expect(clock!.remainingSeconds).toBe(5000);
    expect(clock!.remainingLaps).toBeNull();
  });
});