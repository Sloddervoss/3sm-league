import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const featureFiles = [
  "src/features/endurance/core/types.ts",
  "src/features/endurance/core/environment.ts",
  "src/features/endurance/core/EnduranceStore.tsx",
  "src/features/endurance/core/actions.ts",
];

describe("endurance dev isolation", () => {
  it("uses a namespaced local store and keeps production adapters disabled", () => {
    const source = featureFiles.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).toContain('3sm:endurance:dev:v3');
    expect(source).toContain("productionWritesEnabled: false");
    expect(source).toContain("discordWritesEnabled: false");
    expect(source).not.toContain("supabase.from(");
    expect(source).not.toContain("supabase.functions");
    expect(source).not.toContain("api.3stripemotorsport");
  });
});
