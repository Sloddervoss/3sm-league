import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverUpcomingSpecialEvents } from "../../supabase/functions/iracing-special-events-sync/normalize.ts";

const source = readFileSync("supabase/functions/iracing-special-events-sync/index.ts", "utf8");
// Fixture uit de echte stable /special-events/ HTML (structuur behouden).
const stableHtml = readFileSync("src/test/fixtures/iracing-special-events-sample.html", "utf8");

describe("iRacing stable official Special Events source", () => {
  it("runtime gebruikt de stable /special-events/ route, niet de dode WP page-id", () => {
    expect(source).toContain("https://www.iracing.com/special-events/");
    expect(source).not.toContain("wp-json/wp/v2/pages/263677");
    expect(source).not.toContain("calendar_page_id");
  });

  it("parser ontdekt Upcoming events met Cars Competing uit de stable HTML", () => {
    const events = discoverUpcomingSpecialEvents(stableHtml);
    const names = events.map((e) => e.name);
    expect(names).toContain("8 Hours of Indianapolis");
    expect(names).toContain("Suzuka 1000km");
    // cars extrahier uit model-figuren
    const suzuka = events.find((e) => e.name.includes("Suzuka"));
    expect(suzuka?.cars).toBeDefined();
    expect(suzuka!.cars!.length).toBeGreaterThanOrEqual(2);
    // feature-slugs herkenbaar (geen display-naam-gok)
    const slugs = suzuka!.cars!.map((c) => c.sourceKey);
    expect(slugs.some((s) => s.includes("porsche992rgt3") || s.includes("AstonMartinVantage"))).toBe(true);
  });

  it("provenance slaat de nieuwe source URL op", () => {
    expect(source).toContain("calendar_source_url:");
  });
});