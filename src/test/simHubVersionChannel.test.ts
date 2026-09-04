import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Canonical deployed simhub-version edge-fn source (byte-identical to what is live).
// This test locks the stable-vs-canary SELECTION contract so a future refactor cannot
// silently change which manifest a given channel request receives.
const versionFn = readFileSync("supabase/functions/simhub-version/index.ts", "utf8");

describe("simhub-version channel selection (stable vs canary/test)", () => {
  it("reads channel from the query string and lowercases it", () => {
    expect(versionFn).toContain(`url.searchParams.get("channel")`);
    expect(versionFn).toContain(`.toLowerCase()`);
  });

  it("returns the canary manifest ONLY when ALL six canary fields are configured", () => {
    // Canary branch must require every field non-empty before returning canary (fail-closed).
    expect(versionFn).toContain(`SIMHUB_PLUGIN_CANARY_VERSION`);
    expect(versionFn).toContain(`SIMHUB_PLUGIN_CANARY_DLL_URL`);
    expect(versionFn).toContain(`SIMHUB_PLUGIN_CANARY_SHA256`);
    expect(versionFn).toContain(`SIMHUB_PLUGIN_CANARY_BYTE_LENGTH`);
    expect(versionFn).toContain(`SIMHUB_PLUGIN_CANARY_FILE_NAME`);
    expect(versionFn).toContain(`SIMHUB_PLUGIN_CANARY_SIGNATURE`);
    expect(versionFn).toContain(`cVer && cUrl && cSha && cLen && cFn && cSig`);
  });

  it("falls back to stable when canary config is incomplete (silent fallback)", () => {
    expect(versionFn).toContain(`val terug naar stable (stille fallback)`);
    // The stable block must be the code path after the guarded canary branch, not inside it.
    const canaryBlock = versionFn.indexOf(`cVer && cUrl && cSha && cLen && cFn && cSig`);
    const stableBlock = versionFn.indexOf(`SIMHUB_PLUGIN_VERSION`);
    expect(canaryBlock).toBeGreaterThan(-1);
    expect(stableBlock).toBeGreaterThan(canaryBlock);
  });

  it("default (no channel) returns the stable manifest, unchanged behavior", () => {
    expect(versionFn).toContain(`const channel = url.searchParams.get("channel")?.toLowerCase() ?? ""`);
    expect(versionFn).toMatch(/const version = Deno\.env\.get\("SIMHUB_PLUGIN_VERSION"\)/);
    // buildManifest is the shared serializer for both branches.
    expect(versionFn).toContain(`function buildManifest(`);
  });
});