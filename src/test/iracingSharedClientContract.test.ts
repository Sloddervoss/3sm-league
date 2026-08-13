import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const shared = readFileSync("supabase/functions/_shared/iracingClient.ts", "utf8");

describe("gedeelde iRacing OAuth/BFF-client", () => {
  it("houdt login en cookies uitsluitend server-side", () => {
    expect(shared).toContain('Deno.env.get("IRACING_EMAIL")');
    expect(shared).toContain('Deno.env.get("IRACING_PASSWORD")');
    expect(shared).toContain('hostname !== "members-ng.iracing.com"');
    expect(shared).not.toMatch(/console\.(log|info|warn|error)/);
  });

  it("gebruikt PKCE en de bewezen BFF-proxy", () => {
    expect(shared).toContain("code_challenge_method: \"S256\"");
    expect(shared).toContain("/bff/pub/proxy${path}");
    expect(shared).toContain("json?.link");
    expect(shared).toContain("fetchWithTimeout");
  });

  it("weigert willekeurige API-paden en data-linkhosts", () => {
    expect(shared).toContain('if (!path.startsWith("/data/"))');
    expect(shared).toContain('link.hostname.endsWith("iracing.com")');
    expect(shared).toContain('link.hostname.endsWith("amazonaws.com")');
  });
});
