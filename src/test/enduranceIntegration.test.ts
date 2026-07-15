import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const enduranceRoot = "src/features/endurance";
const walk = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const enduranceSource = walk(enduranceRoot).filter((path) => /\.[jt]sx?$/.test(path)).map((path) => readFileSync(path, "utf8")).join("\n");

describe("endurance integration and isolation", () => {
  it("has a fail-closed local route and no network/data-platform escape hatch", () => {
    expect(enduranceSource).toContain('VITE_ENDURANCE_LOCAL_MVP === "true"');
    expect(enduranceSource).toContain('"3stripemotorsport.cc"');
    for (const forbidden of ["@/integrations/supabase", "@supabase/supabase-js", "supabase.from(", "supabase.functions", "fetch(", "XMLHttpRequest", "new WebSocket", "sendBeacon("]) {
      expect(enduranceSource).not.toContain(forbidden);
    }
  });

  it("skips global Supabase auth reads on the explicit local Endurance route", () => {
    const auth = readFileSync("src/contexts/AuthContext.tsx", "utf8");
    const localGuard = auth.indexOf("if (localEnduranceMvp)");
    const sessionRead = auth.indexOf("supabase.auth.getSession()");
    expect(localGuard).toBeGreaterThan(-1);
    expect(sessionRead).toBeGreaterThan(localGuard);
  });

  it("keeps the route and shell entry points dev-flagged", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const navbar = readFileSync("src/components/Navbar.tsx", "utf8");
    const footer = readFileSync("src/components/Footer.tsx", "utf8");
    expect(app).toContain('path="/endurance/*"');
    expect(navbar).toContain("VITE_ENDURANCE_LOCAL_MVP");
    expect(footer).toContain("VITE_ENDURANCE_LOCAL_MVP");
    expect(navbar).toContain('const showDesktop = "2xl:flex"');
  });

  it("contains mobile-safe overflow and stacked layout contracts", () => {
    expect(enduranceSource).toContain("overflow-x-auto");
    expect(enduranceSource).toContain("min-w-[720px]");
    expect(enduranceSource).toContain("sm:grid-cols");
    expect(enduranceSource).toContain("data-no-translate");
  });
});
