import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Deze test bewaakt de geconsolideerde inhaalmigratie voor de Endurance open
// beta. Hij is toegevoegd omdat de bijbehorende SQL-tests wel bestaan, maar
// niet door de gewone testsuite gedraaid worden. Zo kan een latere wijziging
// de migratie niet stilzwijgend uithollen.

const MIGRATIE = "supabase/migrations/20260910210000_endurance_member_beta.sql";
const ROLLBACK = "supabase/rollback/20260910210000_endurance_member_beta.rollback.sql";

describe("endurance open beta — inhaalmigratie", () => {
  it("bestaat als één migratie met bijbehorende rollback", () => {
    expect(existsSync(MIGRATIE)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
  });

  it("houdt de deur dicht: alle ledenschakelaars staan standaard uit", () => {
    const sql = readFileSync(MIGRATIE, "utf8");
    // De tabeldefinitie moet de schakelaars op false zetten. Anders zou het
    // toepassen van de migratie leden meteen toegang geven, in plaats van pas
    // op het moment dat we dat bewust openzetten.
    const tabel = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS public.endurance_runtime_settings"),
                            sql.indexOf("CREATE TABLE IF NOT EXISTS public.endurance_runtime_settings") + 900);
    expect(tabel).toContain("member_access_enabled");
    expect(tabel).toMatch(/member_access_enabled[^,]*DEFAULT false/);
    expect(tabel).toMatch(/member_pairing_enabled[^,]*DEFAULT false/);
    expect(tabel).toMatch(/member_ingest_enabled[^,]*DEFAULT false/);
    expect(tabel).toMatch(/multi_user_realtime_enabled[^,]*DEFAULT false/);
  });

  it("laat concept-races niet lekken naar gewone leden", () => {
    const sql = readFileSync(MIGRATIE, "utf8");
    // Zonder deze regel toetste endurance_can_discover_event alleen visibility
    // en zag elk ingelogd lid een concept-race met visibility 'open'.
    expect(sql).toContain("event.status <> 'draft'::public.endurance_event_status");
    // En de functie moet die regel ook echt bevatten, niet alleen de migratie.
    const idx = sql.lastIndexOf("CREATE OR REPLACE FUNCTION public.endurance_can_discover_event");
    expect(idx).toBeGreaterThan(-1);
    const functie = sql.slice(idx, idx + 1200);
    expect(functie).toContain("event.status <> 'draft'::public.endurance_event_status");
  });

  it("laat de rollback niets slopen dat al bestond", () => {
    const rb = readFileSync(ROLLBACK, "utf8");
    // endurance_replace_draft_stints bestond al vóór deze migratie (de migratie
    // doet CREATE OR REPLACE). De rollback moet hem herstellen, niet droppen.
    expect(rb).not.toContain("DROP FUNCTION IF EXISTS public.endurance_replace_draft_stints");
    expect(rb).toContain("GECORRIGEERD");
  });

  it("laat de Tester-rol in de database met rust", () => {
    const sql = readFileSync(MIGRATIE, "utf8");
    // De rol blijft bestaan; alleen de toekenningen gaan er later uit. Een
    // enum-waarde verwijderen zou bestaande rijen onbruikbaar maken.
    expect(sql).not.toContain("DROP TYPE public.app_role");
    expect(sql).not.toContain("ALTER TYPE public.app_role DROP VALUE");
  });
});
