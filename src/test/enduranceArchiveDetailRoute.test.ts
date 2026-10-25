import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

/**
 * Contract voor punt 26: doorklik van de archiefkaart naar een racepagina met
 * uitslag, stints en statistieken. De pagina bouwt op wat er al is — de RPC
 * `get_endurance_archive_summary` en de bestaande stints-tabel — en voegt geen
 * schema, migratie of tweede datalaag toe.
 */
describe("endurance archiefdetail (punt 26)", () => {
  it("registreert /endurance/archief/:eventId in de router", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/endurance/archief/:eventId"');
    // De besloten shell blijft de enige toegangspoort tot het archief.
    expect(app).toContain('path="/endurance/*" element={<EndurancePage />}');
  });

  it("maakt van de archiefkaart een echte doorklik en leest de eventId uit de URL", () => {
    const page = read("src/features/endurance/shell/EndurancePage.tsx");
    expect(page).toContain("to={`/endurance/archief/${event.id}`}");
    expect(page).toMatch(/\/\^\\\/endurance\\\/archief\\\/\(\[\^\/\]\+\)\//);
    expect(page).toContain("<ArchiveRacePage");
    // Teruggaan landt op het archief, niet op de lijst met aankomende races.
    expect(page).toContain('navigate("/endurance?section=archief")');
  });

  it("hergebruikt de bestaande RPC en de bestaande stintstabel", () => {
    const dataPage = read("src/features/endurance/archive/ArchiveRacePage.tsx");
    expect(dataPage).toContain("useEnduranceArchiveSummary");
    expect(dataPage).toContain("useEnduranceStints");
    // Geen tweede datalaag: de pagina praat niet zelf met Supabase.
    expect(dataPage).not.toContain("supabase");
    expect(dataPage).not.toMatch(/\bfetch\s*\(/);
    const repository = read("src/features/endurance/repository/archiveRepository.ts");
    expect(repository).toContain('rpc("get_endurance_archive_summary"');
  });

  it("voegt geen DDL of migratie toe voor het archiefdetail", () => {
    const dataPage = read("src/features/endurance/archive/ArchiveRacePage.tsx");
    const detail = read("src/features/endurance/archive/archiveDetail.ts");
    for (const source of [dataPage, detail]) {
      expect(source).not.toMatch(/\b(create|alter|drop)\s+table\b/i);
    }
    // De bestaande archiefmigratie blijft de enige bron van de samenvatting.
    expect(existsSync(join(root, "supabase/migrations/20261025023000_endurance_archive_summary.sql"))).toBe(true);
  });

  it("laat de bestaande driver- en teampopups intact", () => {
    for (const file of ["src/components/preview/DriverModal.tsx", "src/components/preview/TeamModal.tsx"]) {
      expect(existsSync(join(root, file)), `${file} moet blijven bestaan`).toBe(true);
    }
    expect(read("src/pages/StandingsPage.tsx")).toContain("DriverModal");
    expect(read("src/pages/DriversPage.tsx")).toContain("DriverModal");
    expect(read("src/pages/TeamProfilePage.tsx")).toContain("TeamModal");
    // Het archiefdetail vervangt de popups niet door een eigen variant.
    const page = read("src/features/endurance/archive/ArchiveRacePage.tsx");
    expect(page).not.toContain("Modal");
  });
});
