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

  it("bevat geen RAW SQL, non-endurance .rpc(, fetch() of non-endurance client access", () => {
    const combined = repositoryFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    // Word-boundary guards om niet te matchen op `expected_*` kolommen.
    // Alleen endurance_-RPC's zijn toegestaan (atomic stint writes etc.); elke
    // andere .rpc( is verboden zodat het endurance-datalaag-contract geldig blijft.
    const rpcCalls = [...combined.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const fn of rpcCalls) {
      expect(fn.startsWith("endurance_"), `.rpc(${fn}) — alleen endurance_* RPC's toegestaan`).toBe(true);
    }
    // Geen dynamische .rpc(: argument moet een literale string zijn.
    expect(combined).not.toMatch(/\.rpc\(\s*[^"`]/);
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
