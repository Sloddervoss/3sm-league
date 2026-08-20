import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const roleValues = readFileSync("supabase/migrations/20260806100000_endurance_alpha_role_values.sql", "utf8");
const roleHelpers = readFileSync("supabase/migrations/20260806101000_endurance_alpha_role_helpers.sql", "utf8");
const pairing = readFileSync("supabase/migrations/20260806104000_endurance_role_pairing.sql", "utf8");
const ingest = readFileSync("supabase/migrations/20260806110000_endurance_ingest_staff.sql", "utf8");
const rls = readFileSync("supabase/migrations/20260806112000_endurance_rls_roles.sql", "utf8");
const participantAccess = readFileSync("supabase/migrations/20260809150000_endurance_participant_access.sql", "utf8");
const auth = readFileSync("src/contexts/AuthContext.tsx", "utf8");
const page = readFileSync("src/features/endurance/shell/EndurancePage.tsx", "utf8");
const navbar = readFileSync("src/components/Navbar.tsx", "utf8");
const vehiclePanel = readFileSync("src/features/endurance/workspace/VehicleVotePanel.tsx", "utf8");
const actorContext = readFileSync("src/features/endurance/core/ActorContext.tsx", "utf8");
const sharedQueries = readFileSync("src/hooks/data/useSharedQueries.ts", "utf8");
const stintPlanner = readFileSync("src/features/endurance/stints/StintPlanner.tsx", "utf8");

describe("endurance alpha-rollen (tester + endurance_manager)", () => {
  it("voegt beide rollen toe vóór de helperfuncties ze gebruiken", () => {
    expect(roleValues).toContain("'tester'");
    expect(roleValues).toContain("'endurance_manager'");
    expect(roleValues).not.toContain("CREATE OR REPLACE FUNCTION");
    expect(roleHelpers).toContain("CREATE OR REPLACE FUNCTION public.is_endurance_manager");
    expect(roleHelpers).toContain("CREATE OR REPLACE FUNCTION public.is_endurance_staff");
  });

  it("laat endurance-ster hun eigen device koppelen via de pairing-RPC", () => {
    expect(pairing).toContain("simhub_create_device_pairing_code");
    expect(pairing).toContain("simhub_exchange_pairing_code");
    expect(pairing).toContain("is_endurance_staff");
  });

  it("verruimt de ingest owner-check naar endurance-ster zodat testers kunnen streamen", () => {
    expect(ingest).toContain("public.is_endurance_staff(v_device.owner_user_id)");
  });

  it("vervangt brede tester-reads door discovery en participant-RLS", () => {
    expect(rls).toContain('"endurance manager all"');
    expect(participantAccess).toContain('DROP POLICY IF EXISTS "endurance staff view"');
    expect(participantAccess).toContain("endurance_can_discover_event");
    expect(participantAccess).toContain("endurance_is_participant");
    expect(participantAccess).toContain('"endurance own registration select"');
    expect(participantAccess).toContain('"endurance own notifications select"');
  });

  it("exposeert de rollen in AuthContext en past ze toe in gates", () => {
    expect(auth).toContain("isTester");
    expect(auth).toContain("isEnduranceManager");
    expect(auth).toContain('roles.has("tester")');
    expect(auth).toContain('roles.has("endurance_manager")');
    expect(page).toContain('const { loading, rolesLoading, user } = useAuth()');
    expect(navbar).toContain("const canUseEndurance = Boolean(user)");
  });

  it("staat endurance-managers toe de definitieve auto te bevestigen (niet alleen super-admin)", () => {
    expect(vehiclePanel).toContain("isSuperAdmin, isEnduranceManager");
    expect(vehiclePanel).toContain("isSuperAdmin || isEnduranceManager");
  });

  it("lost drivernamen op via echte profielen i.p.v. kale id-nummers", () => {
    // ActorContext mag nooit terugvallen op een kale uuid: hij toont echte
    // profielnamen (iRacing-naam primair, profielnaam fallback) aangeleverd via
    // de names-map. De lookup zelf woont in de repository-laag (core blijft
    // datapatform-onschuldig).
    expect(actorContext).toContain("names.get(id)");
    expect(actorContext).toContain("ENDURANCE_TEST_ACTORS.find");
    // public_profiles wordt in de gedeelde site-hook gelezen (iRacing-naam primair).
    expect(sharedQueries).toContain("useDriverNameMap");
    expect(sharedQueries).toContain('.from("public_profiles")');
    expect(sharedQueries).toContain("iracing_name");
    // En de shell levert die map aan de provider door.
    const page2 = readFileSync("src/features/endurance/shell/EndurancePage.tsx", "utf8");
    expect(page2).toContain("useDriverNameMap()");
    expect(page2).toContain("names={profileNames}");
  });

  it("geeft echte drivernamen door aan de stint-tijdlijn i.p.v. een lege persone-lijst", () => {
    // StintPlanner bouwde de tijdlijn ooit met personas={[]}, waardoor elke stint
    // als driver-id-nummer viel op de kale user-id. Nu levert hij personae op
    // basis van de teamleden en displayName (profielnaam). De tijdlijn zelf toont
    // driver?.name ?? driverId en mag nooit leeg gelaten worden.
    expect(stintPlanner).toContain("const personas = useMemo(");
    expect(stintPlanner).toContain("name: displayName(m.user_id)");
    expect(stintPlanner).toContain("personas={personas}");
    expect(stintPlanner).not.toContain("personas={[]}");
  });
});
