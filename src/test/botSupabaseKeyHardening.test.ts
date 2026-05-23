import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const botIndexPath = path.resolve(process.cwd(), "bot/index.js");

describe("Discord bot Supabase key hardening", () => {
  it("requires the service-role key instead of falling back to the anon browser key", () => {
    const source = readFileSync(botIndexPath, "utf8");

    expect(source).toContain("requireEnv('SUPABASE_SERVICE_KEY')");
    expect(source).not.toMatch(/SUPABASE_ANON_KEY/);
  });
});
