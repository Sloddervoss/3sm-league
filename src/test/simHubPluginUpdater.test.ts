import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const plugin = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs", "utf8");
const updater = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector.Updater/Program.cs", "utf8");
const project = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/3SM.EnduranceConnector.csproj", "utf8");
const endpoint = readFileSync("supabase/functions/simhub-version/index.ts", "utf8");

describe("SimHub plugin one-click updater contract", () => {
  it("pins update metadata to the exact 3SM HTTPS release path", () => {
    expect(plugin).toContain('string.Equals(uri.Scheme, Uri.UriSchemeHttps');
    expect(plugin).toContain('string.Equals(uri.Host, "3stripemotorsport.cc"');
    expect(plugin).toContain('"/downloads/3SM.EnduranceConnector-" + version + ".dll"');
    expect(plugin).toContain("NormalizeSha256");
    expect(plugin).toContain("FileVersionInfo.GetVersionInfo(stagedDll).FileVersion");
    expect(endpoint).toContain("SIMHUB_PLUGIN_SHA256");
    expect(endpoint).toContain("sha256.toLowerCase()");
  });

  it("embeds and launches a separate elevated updater instead of replacing its loaded DLL", () => {
    expect(project).toContain("BuildEmbeddedUpdater");
    expect(project).toContain("3SM.EnduranceConnector.Updater.exe");
    expect(plugin).toContain("ExtractUpdater(updaterExe)");
    expect(plugin).toContain('Verb = "runas"');
    expect(plugin).toContain("Application.Current.MainWindow.Close()");
    expect(plugin).not.toMatch(/File\.(Copy|Move|Replace)\(/);
  });

  it("waits for SimHub exit, replaces atomically, verifies and rolls back", () => {
    expect(updater).toContain("WaitForSimHubExit");
    expect(updater).toContain("File.Replace(incoming, target, backup, true)");
    expect(updater).toContain("File.Copy(backup, target, true)");
    expect(updater).toContain("FixedTimeEquals(Sha256(target), expectedHash)");
    expect(updater).toContain("simulate-failure");
    expect(updater).toContain('FileName = "explorer.exe"');
  });
});