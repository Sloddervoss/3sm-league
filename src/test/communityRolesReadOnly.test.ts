import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Rollen horen op één plek toegewezen te worden. De community-module toonde
// dezelfde rolknoppen als de rollenpagina, maar dan met een onvolledige lijst
// (alleen admin/steward/editor) en met knoppen die voor een gewone admin
// uitgeschakeld stonden. Deze test houdt die scheiding vast.

const community = readFileSync("src/features/control-room/community/CommunityModule.tsx", "utf8");
const roles = readFileSync("src/features/control-room/roles/RolesRightsModule.tsx", "utf8");

describe("community-module — rollen alleen weergeven", () => {
  it("wijzigt zelf geen rollen meer", () => {
    expect(community).not.toContain("admin_grant_role");
    expect(community).not.toContain("admin_revoke_role");
    expect(community).not.toContain("changeRole");
  });

  it("toont de rollen als badges in plaats van knoppen", () => {
    // Geen toevoeg-knoppen meer: het label begon met "+ ".
    expect(community).not.toContain("`+ ${roleLabel(role)}`");
    expect(community).toContain("geen site-rollen");
    expect(community).toContain("Site-rollen (alleen weergave)");
  });

  it("kent ook de endurance-managerrol bij het tonen", () => {
    // De lijst was incompleet: endurance_manager ontbrak, waardoor het beeld
    // van iemands rechten hier nooit volledig kon zijn.
    expect(community).toContain("endurance_manager: \"Endurance-manager\"");
  });

  it("verwijst voor het wijzigen naar de rollenpagina", () => {
    expect(community).toContain("Rollen &amp; rechten");
  });

  it("maakt onderscheid tussen een coureur verwijderen en een rol intrekken", () => {
    expect(community).toContain("niet hetzelfde als een rol intrekken");
    // De prullenbak blijft de gebruiker verwijderen via de bestaande RPC.
    expect(community).toContain("admin_delete_user");
  });

  it("laat de rollenpagina nog steeds het enige toewijspunt zijn", () => {
    expect(roles).toContain("admin_grant_role");
    expect(roles).toContain("admin_revoke_role");
    expect(roles).toContain("endurance_manager");
  });
});
