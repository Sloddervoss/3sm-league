import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("supabase/functions/track-intelligence-sync/index.ts", "utf8");

describe("Track Intelligence iRacing OAuth contract", () => {
  it("supports the current form-less Remix /u/start login route", () => {
    expect(source).toContain('startUrl.hostname === "oauth.iracing.com"');
    expect(source).toContain('startUrl.pathname === "/u/start"');
    expect(source).toContain("const action = legacyAction ?? remixAction");
  });

  it("uses the current remember-me payload while retaining the legacy form fallback", () => {
    expect(source).toContain('rememberMe: "yes"');
    expect(source).toContain('action=["\']([^"\']+)["\']');
  });

  it("keeps authenticated data calls on the verified BFF proxy path", () => {
    expect(source).toContain('const url = `https://members-ng.iracing.com/bff/pub/proxy${path}`');
    expect(source).not.toContain('const url = `https://members-ng.iracing.com${path}`');
  });
});
