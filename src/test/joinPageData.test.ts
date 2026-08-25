import { describe, expect, it } from "vitest";
import { shouldShowRegistrationCount, uniqueRegistrationCount } from "@/features/join/data";

describe("join page live-data presentation rules", () => {
  it("verbergt de inschrijvingsteller onder tien en toont hem vanaf tien", () => {
    expect(shouldShowRegistrationCount(null)).toBe(false);
    expect(shouldShowRegistrationCount(0)).toBe(false);
    expect(shouldShowRegistrationCount(9)).toBe(false);
    expect(shouldShowRegistrationCount(10)).toBe(true);
    expect(shouldShowRegistrationCount(24)).toBe(true);
  });

  it("telt effectieve race- en seizoensinschrijvingen samen en past daarna pas de grens toe", () => {
    const direct = Array.from({ length: 9 }, (_, index) => ({ user_id: `race-${index}`, status: "registered" }));
    const season = Array.from({ length: 12 }, (_, index) => ({ user_id: index < 9 ? `race-${index}` : `season-${index}` }));
    const count = uniqueRegistrationCount(direct, season);

    expect(count).toBe(12);
    expect(shouldShowRegistrationCount(count)).toBe(true);
  });

  it("dedupliceert race- en seizoensinschrijvingen en negeert ingetrokken rijen", () => {
    expect(uniqueRegistrationCount(
      [
        { user_id: "race-only", status: "registered" },
        { user_id: "both", status: "registered" },
        { user_id: "withdrawn", status: "withdrawn" },
      ],
      [
        { user_id: "season-only" },
        { user_id: "both" },
      ],
    )).toBe(3);
  });
});
