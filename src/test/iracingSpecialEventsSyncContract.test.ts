import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("supabase/functions/iracing-special-events-sync/index.ts", "utf8");
const normalizer = readFileSync("supabase/functions/iracing-special-events-sync/normalize.ts", "utf8");
const config = readFileSync("supabase/config.toml", "utf8");

describe("iRacing Special Events sync security contract", () => {
  it("gebruikt dedicated scheduler-token of een geverifieerde super_admin", () => {
    expect(source).toContain('Deno.env.get("ENDURANCE_IRACING_SYNC_TOKEN")');
    expect(source).toContain('row.role === "super_admin"');
    expect(source).toContain("auth.auth.getUser(token)");
    expect(source).not.toMatch(/token\s*===\s*serviceKey/);
    expect(config).toMatch(/\[functions\.iracing-special-events-sync\]\s+verify_jwt = false/);
  });

  it("hergebruikt uitsluitend de gedeelde server-side iRacing-client", () => {
    expect(source).toContain('from "../_shared/iracingClient.ts"');
    expect(source).toContain("createIRacingClient()");
    expect(source).not.toContain("IRACING_PASSWORD");
  });

  it("maakt zichtbare runstatussen en behoudt oude slots bij partial failures", () => {
    for (const status of ["running", "success", "partial", "failed"]) expect(source).toContain(`"${status}"`);
    expect(source).toContain("Partial failures verwijderen of deactiveren dus nooit oude goede slots");
    expect(source).toContain("active: misses < 2");
    expect(source).toContain('calendarHtml && normalized.availabilityStatus === "exact_slots"');
    expect(source).toContain("existing?.source_payload");
    expect(source).toContain('eq("iracing_catalog_slot_id", candidate.id)');
    expect(source).not.toMatch(/\.delete\(\).*endurance_iracing_event_slots/s);
    expect(source).toContain('runError?.code === "23505"');
  });

  it("upsert idempotent op source_key en catalog_event_id/source_slot_key", () => {
    expect(source).toContain('onConflict: "source_key"');
    expect(source).toContain('onConflict: "catalog_event_id,source_slot_key"');
    expect(normalizer).toContain("sourceSlotKey:");
    expect(normalizer).toContain("sourceHash:");
  });

  it("redigeert secrets en retourneert alleen status/tellingen/tijd", () => {
    expect(source).toContain("[REDACTED]");
    expect(source).toContain("events_seen");
    expect(source).toContain("finished_at");
    expect(source).not.toMatch(/json\(\{[^}]*error_summary/s);
  });

  it("ontdekt alle officiële Upcoming Events maar haalt slots alleen voor expliciete mappings", () => {
    expect(source).toContain("discoverUpcomingSpecialEvents(calendarHtml)");
    expect(source).toContain("mappingBySourceKey");
    expect(source).toMatch(/await \(await dataClient\(\)\)\.fetchData\(`\/data\/series\/season_schedule/);
    expect(source).toContain("clientPromise ??= createIRacingClient()");
    expect(source).toContain("clientPromise = null");
    expect(source).toContain(": null;");
    expect(source).toContain("local_class_ids: entry?.localClassIds ?? []");
    expect(source).toContain("exact times pending explicit season mapping");
    expect(source).toContain("ENDURANCE_IRACING_SEASON_MAP_JSON");
    expect(source).toContain("https://www.iracing.com/wp-json/wp/v2/pages/263677");
    expect(normalizer).toContain("Officiële Upcoming/Completed-eventgrenzen ontbreken");
    expect(source).toContain("season_schedule?season_id=");
  });

  it("verwerkt gewone endurance-series per individuele race via discoverSeriesRaces", () => {
    expect(source).toContain('entry.kind === "series"');
    expect(source).toContain("discoverSeriesRaces");
    expect(source).toContain("seriesName:");
    expect(normalizer).toContain("discoverSeriesRaces");
    expect(normalizer).toContain("Ongeldige serieseason-id");
    expect(normalizer).toContain("sourceSlug(row.track.track_name)");
    expect(normalizer).toContain("dateEnd");
  });

  it("importeert losse special events uitsluitend uit Vincents gemapte lijst", () => {
    expect(source).toContain("if (!entry) continue;");
    expect(source).toContain("Onbekende/ongemapte events worden niet geïmporteerd");
  });
});
