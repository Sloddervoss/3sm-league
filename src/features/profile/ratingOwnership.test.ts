import { describe, expect, it } from "vitest";
import {
  canEditRatingsFromSource,
  normalizeRatingSource,
  ownRacingProfilePayload,
  ratingSourceLabel,
} from "./ratingOwnership";

describe("rating-herkomst", () => {
  it("valt terug op 'self' als de kolom leeg of onbekend is", () => {
    expect(normalizeRatingSource(null)).toBe("self");
    expect(normalizeRatingSource(undefined)).toBe("self");
    expect(normalizeRatingSource("")).toBe("self");
    expect(normalizeRatingSource("iets-anders")).toBe("self");
    expect(normalizeRatingSource("self")).toBe("self");
    expect(normalizeRatingSource("imported")).toBe("imported");
  });

  it("geeft alleen bij 'imported' het label van de import", () => {
    expect(ratingSourceLabel("imported")).toBe("uit de import");
    expect(ratingSourceLabel("self")).toBe("zelf ingevuld");
    expect(ratingSourceLabel(null)).toBe("zelf ingevuld");
  });

  it("maakt ratings alleen-lezen zodra de import eigenaar is", () => {
    expect(canEditRatingsFromSource("imported")).toBe(false);
    expect(canEditRatingsFromSource("self")).toBe(true);
    expect(canEditRatingsFromSource(null)).toBe(true);
  });
});

describe("payload voor update_own_racing_profile", () => {
  it("stuurt bij 'self' de ingevulde waarden mee", () => {
    expect(
      ownRacingProfilePayload({
        ratingSource: "self",
        iracingId: " 412301 ",
        iratingInput: "3450",
        safetyRatingInput: " A 4.50 ",
        currentIrating: 2000,
        currentSafetyRating: "B 3.20",
      }),
    ).toStrictEqual({ iracingId: "412301", irating: 3450, safetyRating: "A 4.50" });
  });

  it("leegt irating en safety rating als de coureur ze leeg laat", () => {
    expect(
      ownRacingProfilePayload({
        ratingSource: "self",
        iracingId: "",
        iratingInput: "",
        safetyRatingInput: "   ",
        currentIrating: 2000,
        currentSafetyRating: "B 3.20",
      }),
    ).toStrictEqual({ iracingId: null, irating: null, safetyRating: null });
  });

  it("houdt bij 'imported' de bestaande ratings vast en wijzigt alleen de koppeling", () => {
    expect(
      ownRacingProfilePayload({
        ratingSource: "imported",
        iracingId: "412301",
        // Een gebruiker die in een verouderd formulier nog iets anders had staan:
        // dit mag de geïmporteerde waarde niet overschrijven.
        iratingInput: "900",
        safetyRatingInput: "D 1.00",
        currentIrating: 5100,
        currentSafetyRating: "A 4.99",
      }),
    ).toStrictEqual({ iracingId: "412301", irating: 5100, safetyRating: "A 4.99" });
  });

  it("koppelt ook bij 'imported' een lege iracing_id los", () => {
    expect(
      ownRacingProfilePayload({
        ratingSource: "imported",
        iracingId: "",
        iratingInput: "",
        safetyRatingInput: "",
        currentIrating: 5100,
        currentSafetyRating: "A 4.99",
      }),
    ).toStrictEqual({ iracingId: null, irating: 5100, safetyRating: "A 4.99" });
  });

  it("truncate een decimaal iRating naar een geheel getal", () => {
    expect(
      ownRacingProfilePayload({
        ratingSource: "self",
        iracingId: "",
        iratingInput: "3450.9",
        safetyRatingInput: "",
        currentIrating: null,
        currentSafetyRating: null,
      }).irating,
    ).toBe(3450);
  });

  it("valt bij onleesbare invoer terug op null in plaats van NaN naar de RPC te sturen", () => {
    expect(
      ownRacingProfilePayload({
        ratingSource: "self",
        iracingId: "",
        iratingInput: "abc",
        safetyRatingInput: "",
        currentIrating: null,
        currentSafetyRating: null,
      }).irating,
    ).toBeNull();
  });
});
