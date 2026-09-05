import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const enduranceRoot = "src/features/endurance";
const walk = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const allEnduranceFiles = walk(enduranceRoot).filter((path) => /\.[jt]sx?$/.test(path));
const enduranceSource = allEnduranceFiles.map((path) => readFileSync(path, "utf8")).join("\n");

// De centrale relay-integratie is bewust het enige Supabase-touchpoint van het
// lokale Race Control-pad (device-based). Daarnaast is de data-laag (repository/)
// expliciet de geëxpliciteerde Supabase-toegang van Fase 3: die IMPORTER supaabase
// by design. De planning-kern (core/, alles behalve relay + repository) blijft
// falende-closed geïsoleerd en mag geen data-platform-ontsnapping zijn.
const relayFile = "src/features/endurance/race-control/SimHubTelemetryPanel.tsx";
const dataAccessRoot = "src/features/endurance/repository";
const coreSource = allEnduranceFiles
  .filter((path) => path.replace(/\\/g, "/") !== relayFile && !path.replace(/\\/g, "/").startsWith(dataAccessRoot))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

describe("endurance integration and isolation (super-admin-only canary)", () => {
  it("is a super-admin-only project: gate op route, menu en footer", () => {
    const page = readFileSync("src/features/endurance/shell/EndurancePage.tsx", "utf8");
    const navbar = readFileSync("src/components/Navbar.tsx", "utf8");
    const footer = readFileSync("src/components/Footer.tsx", "utf8");
    const app = readFileSync("src/App.tsx", "utf8");
    // Route-guard: alleen super-admin renders de content; anders redirect/weigering.
    expect(page).toContain("isSuperAdmin");
    expect(page).toContain('Navigate to="/auth?redirect=/endurance"');
    // Menu/footer-link uitsluitend voor super-admin, niet op een DEV-vlag.
    expect(navbar).toContain("isSuperAdmin");
    expect(navbar).toContain("Endurance");
    expect(footer).toContain("isSuperAdmin");
    expect(app).toContain('path="/endurance/*"');
    // Geen dev-only vlag meer als toegangsmechanisme voor livegang.
    expect(enduranceSource).not.toContain("localEnduranceMvp");
    expect(navbar).not.toMatch(/VITE_ENDURANCE_LOCAL_MVP/);
    expect(footer).not.toMatch(/VITE_ENDURANCE_LOCAL_MVP/);
  });

  it("keeps the planning core free of data-platform escape hatches", () => {
    // Kernel/planning mag nooit netwerk of het Supabase-datapatform aanraken buiten de relay-panel.
    for (const forbidden of ["@/integrations/supabase", "@supabase/supabase-js", "supabase.from(", "supabase.functions", "supabase.channel", "fetch(", "XMLHttpRequest", "new WebSocket", "sendBeacon("]) {
      expect(coreSource).not.toContain(forbidden);
    }
  });

  it("scopes the central SimHub relay to the telemetry panel only", () => {
    const relay = readFileSync(relayFile, "utf8");
    expect(relay).toContain('listCentralSimHubDevices');
    expect(relay).toContain('readCentralSimHubTelemetry');
    // Intrekken/pairing blijft op de gecentraliseerde pairingpagina (super-admin canary),
    // niet op het Race-Control-pad.
    expect(relay).not.toContain("revokeCentralSimHubDevice");
  });

  it("contains mobile-safe overflow and stacked layout contracts", () => {
    expect(enduranceSource).toContain("overflow-x-auto");
    expect(enduranceSource).toContain("min-w-[720px]");
    expect(enduranceSource).toContain("sm:grid-cols");
    expect(enduranceSource).toContain("data-no-translate");
  });
});
