import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const alpha = readFileSync("supabase/migrations/20260806_endurance_alpha_roles.sql", "utf8");
const pairing = readFileSync("supabase/migrations/20260806_endurance_role_pairing.sql", "utf8");
const ingest = readFileSync("supabase/migrations/20260806_endurance_ingest_staff.sql", "utf8");
const rls = readFileSync("supabase/migrations/20260806_endurance_rls_roles.sql", "utf8");
const auth = readFileSync("src/contexts/AuthContext.tsx", "utf8");
const page = readFileSync("src/features/endurance/shell/EndurancePage.tsx", "utf8");
const navbar = readFileSync("src/components/Navbar.tsx", "utf8");

describe("endurance alpha-rollen (tester + endurance_manager)", () => {
  it("voegt beide rollen additief toe aan app_role", () => {
    expect(alpha).toContain("'tester'");
    expect(alpha).toContain("'endurance_manager'");
    expect(alpha).toContain("CREATE OR REPLACE FUNCTION public.is_endurance_manager");
    expect(alpha).toContain("CREATE OR REPLACE FUNCTION public.is_endurance_staff");
  });

  it("laat endurance-ster hun eigen device koppelen via de pairing-RPC", () => {
    expect(pairing).toContain("simhub_create_device_pairing_code");
    expect(pairing).toContain("simhub_exchange_pairing_code");
    expect(pairing).toContain("is_endurance_staff");
  });

  it("verruimt de ingest owner-check naar endurance-ster zodat testers kunnen streamen", () => {
    expect(ingest).toContain("public.is_endurance_staff(v_device.owner_user_id)");
  });

  it("geeft endurance_manager beheer en tester view/participatie in de RLS", () => {
    expect(rls).toContain('"endurance manager all"');
    expect(rls).toContain("is_endurance_manager(auth.uid())");
    expect(rls).toContain('"endurance staff view"');
    expect(rls).toContain("is_endurance_staff(auth.uid())");
    expect(rls).toContain('"endurance staff own registration"');
    expect(rls).toContain('"endurance staff own availability"');
  });

  it("exposeert de rollen in AuthContext en past ze toe in gates", () => {
    expect(auth).toContain("isTester");
    expect(auth).toContain("isEnduranceManager");
    expect(auth).toContain('roles.has("tester")');
    expect(auth).toContain('roles.has("endurance_manager")');
    expect(page).toContain("isSuperAdmin || isTester || isEnduranceManager");
    expect(navbar).toContain("canUseEndurance");
  });
});
