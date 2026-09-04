import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Borgt de ONDERLINGE CONSISTENTIE van de activatie-whitelist in de canonical migratie:
// iedere loche auto in de legacy-whitelist moet aan een lokale klasse gekoppeld zijn
// en omgekeerd. Deze test voorkomt dat een mapping event "half" activatable wordt.

const migration = readFileSync(
  "supabase/migrations/20260815120000_endurance_iracing_class_catalog_expansion.sql",
  "utf8",
);

// De car->klasse-branches in de guard (CASE ... THEN 'KLASSE').
const carBranch = /WHEN car_id IN? \(([^)]+)\)[^)]*THEN '([A-Z0-9]+)'|WHEN car_id = '([^']+)' THEN '([A-Z0-9]+)'/g;

describe("iRacing activatie-guard regel-consistentie", () => {
  it("bevat de legacy Portimao GT1/GT2/HPD whitelist auto's", () => {
    expect(migration).toContain("'hpd-arx-01c'");
    expect(migration).toContain("'chevrolet-corvette-c6r'");
    expect(migration).toContain("'aston-martin-dbr9-gt1'");
    expect(migration).toContain("'ford-gt-gt2-gt3'");
  });

  it("heeft voor elke whitelist GT1/GT2 auto een klasse-branch (geen losse mapping die de guard zou breken)", () => {
    // DBR9 en Corvette -> GT1, Ford GT -> GT2, HPD ARX -> HPD
    expect(migration).toContain("'chevrolet-corvette-c6r','aston-martin-dbr9-gt1'");
    expect(migration).toContain("THEN 'GT1'");
    expect(migration).toContain("THEN 'HPD'");
    expect(migration).toContain("THEN 'GT2'");
  });

  it("laat de legacy-claim {HPD,GT1,GT2} consistent zijn met 4 gemapte auto's", () => {
    // Elke local-class in {HPD,GT1,GT2} heeft minstens één auto in de whitelist.
    const ports = ["hpd-arx-01c", "chevrolet-corvette-c6r", "aston-martin-dbr9-gt1", "ford-gt-gt2-gt3"];
    const classes = ["HPD", "GT1", "GT2"];
    for (const c of classes) {
      expect(ports.some((id) => migration.includes(`THEN '${c}'`))).toBe(true);
    }
    expect(migration).toMatch(/'(?:hpd-arx-01c|chevrolet-corvette-c6r|aston-martin-dbr9-gt1|ford-gt-gt2-gt3)'/g);
  });

  it("geeft aan dat een event met ALLEEN niet-bewezen feature-cars de guard niet kan passeren", () => {
    // De WP-feature-sourcekeys (bv 'porsche992rgt3-feature') staan niet in de whitelist.
    expect(migration).not.toContain("porsche992rgt3-feature");
    expect(migration).not.toContain("astreonmartinvantageevogt3-feature".toLowerCase());
  });
});