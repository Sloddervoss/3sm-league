import { readFileSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

const plugin = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/EnduranceConnectorPlugin.cs", "utf8");
const updater = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector.Updater/Program.cs", "utf8");
const project = readFileSync("tools/simhub-plugin/3SM.EnduranceConnector/3SM.EnduranceConnector.csproj", "utf8");
const endpoint = readFileSync("supabase/functions/simhub-version/index.ts", "utf8");
const publicKey = readFileSync("tools/simhub-plugin/release-signing-public.pem", "utf8");
const artifact = readFileSync("public/downloads/3SM.EnduranceConnector-0.3.0.1.dll");
const manifest = JSON.parse(readFileSync("public/downloads/3SM.EnduranceConnector-0.3.0.1.manifest.json", "utf8")) as {
  version: string;
  dllUrl: string;
  sha256: string;
  byteLength: number;
  fileName: string;
  signature: string;
};

describe("SimHub plugin one-click updater contract", () => {
  it("pins update metadata to the exact 3SM HTTPS release path", () => {
    expect(plugin).toContain('string.Equals(uri.Scheme, Uri.UriSchemeHttps');
    expect(plugin).toContain('string.Equals(uri.Host, "3stripemotorsport.cc"');
    expect(plugin).toContain('"/downloads/3SM.EnduranceConnector-" + version + ".dll"');
    expect(plugin).toContain("NormalizeSha256");
    expect(plugin).toContain("FileVersionInfo.GetVersionInfo(stagedDll).FileVersion");
    expect(plugin).toContain("AssemblyName.GetAssemblyName(stagedDll).Version");
    expect(plugin).toContain("ValidateReleaseManifest");
    expect(plugin).toContain("ReleasePublicKeyXml");
    expect(plugin).toContain("rsa.VerifyData");
    expect(plugin).toContain("BuildPluginDownloadUri(remoteVersion)");
    expect(plugin).not.toContain("dllUrl = Settings.LastKnownRemoteDllUrl");
    expect(endpoint).toContain("SIMHUB_PLUGIN_SHA256");
    expect(endpoint).toContain("SIMHUB_PLUGIN_BYTE_LENGTH");
    expect(endpoint).toContain("SIMHUB_PLUGIN_FILE_NAME");
    expect(endpoint).toContain("SIMHUB_PLUGIN_SIGNATURE");
    expect(endpoint).toContain("sha256.toLowerCase()");
  });

  it("ships an immutable RSA-signed release manifest and rejects tampering", () => {
    const payload = [manifest.version, manifest.dllUrl, manifest.sha256, manifest.byteLength, manifest.fileName].join("\n");
    expect(verify("RSA-SHA256", Buffer.from(payload), publicKey, Buffer.from(manifest.signature, "base64"))).toBe(true);
    const tampered = payload.replace(manifest.sha256, "0".repeat(64));
    expect(verify("RSA-SHA256", Buffer.from(tampered), publicKey, Buffer.from(manifest.signature, "base64"))).toBe(false);
    expect(createHash("sha256").update(artifact).digest("hex")).toBe(manifest.sha256);
    expect(artifact.byteLength).toBe(manifest.byteLength);

    const modulus = plugin.match(/<Modulus>([^<]+)<\/Modulus>/)?.[1];
    const exponent = plugin.match(/<Exponent>([^<]+)<\/Exponent>/)?.[1];
    const toBase64Url = (value: string) => value.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const jwk = createPublicKey(publicKey).export({ format: "jwk" });
    expect(toBase64Url(modulus ?? "")).toBe(jwk.n);
    expect(toBase64Url(exponent ?? "")).toBe(jwk.e);
  });

  it("embeds and launches a separate elevated updater instead of replacing its loaded DLL", () => {
    expect(project).toContain("BuildEmbeddedUpdater");
    expect(project).toContain("3SM.EnduranceConnector.Updater.exe");
    expect(plugin).toContain("ExtractUpdater(updaterExe)");
    expect(plugin).toContain("ComputeSha256(updaterLock)");
    expect(plugin).toContain("FileShare.Read");
    expect(plugin).toContain("readyEvent.WaitOne");
    expect(plugin).toContain("--ready-event");
    expect(plugin).toContain('Verb = "runas"');
    expect(plugin).toContain("Application.Current.MainWindow.Close()");
    expect(plugin).not.toMatch(/File\.(Copy|Move|Replace)\(/);
  });

  it("waits for SimHub exit, replaces atomically, verifies and rolls back", () => {
    expect(updater).toContain("WaitForSimHubExit");
    expect(updater).toContain("File.Replace(incoming, target, backup, true)");
    expect(updater).toContain("RestoreBackupAtomic");
    expect(updater).toContain("RecoverPreviousTransaction");
    expect(updater).toContain("Global\\3SM.EnduranceConnector.Updater");
    expect(updater).toContain("process.StartTime.ToUniversalTime().Ticks");
    expect(updater).toContain("QueryFullProcessImageName");
    expect(updater).toContain("AssemblyName.GetAssemblyName(staged).Version");
    expect(updater).toContain("RejectReparseChain");
    expect(updater).toContain("FixedTimeEquals(Sha256(target), installedHash)");
    expect(updater).toContain("AcquireSimHubProcess");
    expect(updater).toContain("SignalReady");
    expect(updater).toContain("File.Move(temporaryJournal, journal)");
    expect(updater.indexOf("AcquireSimHubProcess(pid")).toBeLessThan(updater.indexOf("WaitForSimHubExit(simHubProcess"));
    expect(updater.indexOf("WaitForSimHubExit(simHubProcess")).toBeLessThan(updater.indexOf("RecoverPreviousTransaction(target"));
    expect(updater).toContain("simulate-failure");
    expect(updater).toContain('FileName = "explorer.exe"');
  });
});