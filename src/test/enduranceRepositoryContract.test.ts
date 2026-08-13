import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const repositoryRoot = join(root, "src/features/endurance/repository");
const walk = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
  const path = join(directory, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const repositoryFiles = walk(repositoryRoot).filter((path) => /\.ts$/.test(path));

describe("endurance repository data-access contract (Fase 3)", () => {
  it("alle repository-bestanden refereren uitsluitend endurance_*-tabellen", () => {
    for (const file of repositoryFiles) {
      const source = readFileSync(file, "utf8");
      // Alle .from("...") oproepen mogen alleen endurance_*-namen bevatten.
      const fromCalls = [...source.matchAll(/\.from\(\s*"([^"]+)"/g)].map((m) => m[1]);
      for (const table of fromCalls) {
        expect(table.startsWith("endurance_"), `${file} referert "${table}" — alleen endurance_* toegestaan`).toBe(true);
      }
    }
  });

  it("bevat geen RAW SQL, ongeautoriseerde RPC, fetch() of non-endurance client access", () => {
    const combined = repositoryFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    // Atomische Endurance-RPC's blijven binnen dezelfde repositorygrens expliciet toegestaan.
    const rpcCalls = [...combined.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((match) => match[1]);
    expect(rpcCalls).toContain("endurance_activate_iracing_slot");
    expect(rpcCalls.every((rpc) => [
      "endurance_replace_draft_stints",
      "endurance_apply_stint_updates",
      "endurance_activate_iracing_slot",
    ].includes(rpc))).toBe(true);
    expect(combined).not.toMatch(/\bfetch\s*\(/);
    expect(combined).not.toMatch(/\bXMLHttpRequest\b/);
    expect(combined).not.toMatch(/POSTGREST/);
    // ELKE from-call is een literale endurance_*-string.
    const nonLiteral = [...combined.matchAll(/\.from\(\s*[^"`]/g)];
    expect(nonLiteral).toHaveLength(0);
  });

  it("alle vier repositories gebruiken een expliciete endurance_-tabel", () => {
    const combined = repositoryFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    for (const table of [
      "endurance_events", "endurance_registrations", "endurance_teams",
      "endurance_team_members", "endurance_stints",
    ]) {
      expect(combined).toContain(`"${table}"`);
    }
  });
});
