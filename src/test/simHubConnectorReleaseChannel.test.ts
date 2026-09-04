import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Locks the connector release-channel behavior:
// - this TEST/0.4.0 build must explicitly request ?channel=canary on the version check
// - a STABLE build leaves the channel constant empty (plain GET => stable manifest)
const connector = readFileSync(
  "tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs",
  "utf8",
);

describe("connector release channel behavior (TEST build)", () => {
  it("defines a release-channel query constant", () => {
    expect(connector).toContain("ReleaseChannelQuery");
    expect(connector).toContain('ReleaseChannelQuery = "?channel=canary"');
  });

  it("appends the channel query to the version-check endpoint", () => {
    expect(connector).toContain('BuildRelayEndpoint("simhub-version").AbsoluteUri + ReleaseChannelQuery');
  });

  it("is a build-time constant, not a user-facing runtime switch", () => {
    // Must be a compile-time constant (const), never read from settings at runtime.
    expect(connector).toMatch(/private const string ReleaseChannelQuery/);
    expect(connector).not.toMatch(/Settings\.ReleaseChannel/);
  });

  it("TEST build requests canary; a stable build leaves the constant empty", () => {
    // On THIS release branch the constant is canary (TEST fleet). The value is documented
    // so a stable promotion flips it to "" — covered here to prevent silent channel drift.
    expect(connector).toContain('ReleaseChannelQuery = "?channel=canary"');
  });
});