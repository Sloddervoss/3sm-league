import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/ResultsPage.tsx", "utf8");

describe("results visual alignment contract", () => {
  it("preserves the existing public data and interaction contracts", () => {
    for (const marker of [
      '.from("races")',
      '.from("race_results")',
      '.from("public_profiles")',
      '["completed-races"]',
      '["race-winners"]',
      '["race-results-detail", raceId]',
      'searchParams.get("race")',
      'setSearchParams(nextParams, { replace: false })',
      'to={`/results/${latestRace.id}/`}',
      'to={`/results/${race.id}/`}',
      '<ExpandedRaceContent raceId={race.id} />',
      'results-itemlist-jsonld',
    ]) expect(source).toContain(marker);
  });

  it("preserves every existing results surface and action", () => {
    for (const label of [
      "UITSLAGEN",
      "Laatste Uitslag",
      "Podium",
      "Highlights",
      "Snelste ronde",
      "Cleanste rit",
      "Details & delen",
      "Snelle uitslag",
      "Race Archief",
      "Alle afgeronde races",
      "Winnaar",
      "Ronden",
      "Beste ronde",
      "Incidenten",
    ]) expect(source).toContain(label);
  });

  it("uses the shared dark technical 3SM styling language", () => {
    for (const marker of [
      'bg-[#080a0f]',
      "max-w-7xl",
      "rounded-[1.8rem]",
      "rounded-[1.4rem]",
      "ring-white/[0.07]",
      "bg-orange-500/10",
      "text-orange-400",
    ]) expect(source).toContain(marker);
  });
});
