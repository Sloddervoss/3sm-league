import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Canonicaal slot-identiteit voor combined endurance-series (bv Nürburgring EC):
// het importer genereert per racemoment EEN sourceSlotKey in `week:`-formaat
// (`<serie>:week<N>:<YYYYMMDDHHMMSS>`), gelabeld. Het oude pad liet daarnaast
// ISO-`<serie>:<ISO-timestamp>` orphan-rijen achter (zelfde start, geen label),
// die door de UNIQUE (catalog_event_id, source_slot_key) NIET als conflict werden
// gevangen en zo "16 i.p.v. 8" officiële sloten deden lijken. Deze bron-definitie
// borgt dat het week-formaat canonicaal is.

const normalize = readFileSync(
  "supabase/functions/iracing-special-events-sync/normalize.ts",
  "utf8",
);
const index = readFileSync(
  "supabase/functions/iracing-special-events-sync/index.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260813120000_endurance_iracing_event_catalog.sql",
  "utf8",
);

describe("iRacing combined-series slot canonical identity", () => {
  it("kanoniek: combined-slot gebruikt week:sleutel met label", () => {
    expect(normalize).toMatch(/sourceSlotKey: `\$\{seriesSeed\.sourceKey\}:week\$\{week\}:\$\{timeTag\}`/);
    expect(normalize).toContain("label: formatWeekLabel(");
  });

  it("UNIQUE-protectie is op (catalog_event_id, source_slot_key)", () => {
    expect(migration).toContain("UNIQUE (catalog_event_id, source_slot_key)");
    // importer upsert op die key-vorm zodat dezelfde source_slot_key geen duplicate row wordt
    expect(index).toContain('onConflict: "catalog_event_id,source_slot_key"');
  });

  it("robust: special-events-loop skipt series-buckets (geen nieuwe ISO-orphans)", () => {
    // Sinds de catalog-bucket-fix doet de special-events-loop kind=series niet meer.
    expect(index).toContain('if (entry.kind === "series") continue;');
  });

  it("eenzelfde starttijd over twee key-varianten = duplicate van één canonical slot", () => {
    // ISo-orphan-key zonder :week heeft géén label; de week-variant wel.
    const isoKey = "iracing:2026:nurburgring-endurance-championship:2026-10-10T07:00:00.000Z";
    const wkKey = "iracing:2026:nurburgring-endurance-championship:week8:20261010070000";
    expect(isoKey).not.toMatch(/:week\d+:/);
    expect(wkKey).toMatch(/:week\d+:/);
    // Beide verwijzen naar dezelfde session_start (07:00 UTC). De week-vorm is canonical
    // (gelabeld); de ISO-vorm is de gedupliceerde orphan.
    expect(isoKey).not.toContain("week8");
    expect(wkKey).toContain("week8");
    expect(isoKey).toContain("2026-10-10T07:00");
    expect(wkKey).toContain("20261010070000");
  });
});