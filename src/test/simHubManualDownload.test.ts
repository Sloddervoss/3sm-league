import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/SimHubPairingPage.tsx", "utf8");
const guide = readFileSync("docs/simhub-update-gids.md", "utf8");
const runbook = readFileSync("docs/runbooks/simhub-plugin-release.md", "utf8");
const versionedPath = "public/downloads/3SM.EnduranceConnector-0.4.2.1.zip";
const latestPath = "public/downloads/3SM.EnduranceConnector-latest.zip";
const expectedZipSha = "d7836192a62675b702c7ee307d88cc2c4658d8a67e8b2c0a193efdf13110f4b4";
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("public SimHub connector human download", () => {
  it("routes the public-facing button to the stable ZIP, never the updater DLL", () => {
    expect(page).toContain('href="/downloads/3SM.EnduranceConnector-latest.zip"');
    expect(page).toContain("Versie 0.4.2.1 · Handmatige installatie");
    expect(page).not.toContain('href="/downloads/3SM.EnduranceConnector-0.3.9.0.dll"');
  });

  it("ships immutable versioned and stable ZIP artifacts with identical bytes", () => {
    expect(existsSync(versionedPath)).toBe(true);
    expect(existsSync(latestPath)).toBe(true);
    expect(statSync(versionedPath).size).toBe(255403);
    expect(statSync(latestPath).size).toBe(255403);
    expect(sha256(versionedPath)).toBe(expectedZipSha);
    expect(sha256(latestPath)).toBe(expectedZipSha);
  });

  it("documents the machine DLL versus human ZIP boundary", () => {
    expect(runbook).toContain("MACHINE artifact");
    expect(runbook).toContain("HUMAN artifact");
    expect(runbook).toContain("The public-facing website button points to the HUMAN ZIP.");
    expect(guide).toContain("3SM.EnduranceConnector-latest.zip");
    expect(guide).toContain("0.3.8.0 → 0.3.9.0");
    expect(guide).toContain("Huidige versie: `0.4.2.1`");
  });
});
